// allocation.js
// Database-backed Seating Allocation Algorithm

/**
 * Calculates Manhattan distance
 */
function getDistance(r1, c1, r2, c2) {
  return Math.abs(r1 - r2) + Math.abs(c1 - c2);
}

/**
 * Atomically allocates a seat for a student at a given event.
 * Runs inside an active database transaction using the provided client.
 * 
 * @param {import('pg').PoolClient} client - The pg transaction client
 * @param {number} eventId - The ID of the event
 * @param {object} student - The student object (id, branch, division, name)
 * @returns {Promise<object>} The allocated seat details or null if waitlisted
 */
async function allocateSeat(client, eventId, student) {
  const studentId = student.id;
  const branch = student.branch;
  const division = student.division;

  // 1. Idempotency Check: Has this student already been allocated a seat?
  const existingRes = await client.query(
    `SELECT a.seat_id, al.row_num, al.col_num, a.status 
     FROM allocations a
     JOIN auditorium_layout al ON a.seat_id = al.seat_id
     WHERE a.event_id = $1 AND a.student_id = $2`,
    [eventId, studentId]
  );

  if (existingRes.rows.length > 0) {
    const existing = existingRes.rows[0];
    return {
      seatId: existing.seat_id,
      rowNum: existing.row_num,
      colNum: existing.col_num,
      status: existing.status,
      isNew: false
    };
  }

  // 2. Fetch Event Parameters and check if Global Overflow is triggered
  const eventRes = await client.query(
    `SELECT overflow_cutoff_time, overflow_fill_threshold FROM events WHERE id = $1`,
    [eventId]
  );
  if (eventRes.rows.length === 0) {
    throw new Error(`Event with ID ${eventId} not found`);
  }
  const { overflow_cutoff_time, overflow_fill_threshold } = eventRes.rows[0];

  // Check occupancy stats
  const totalSeatsRes = await client.query(
    `SELECT COUNT(*) FROM auditorium_layout WHERE is_active = true`
  );
  const allocatedSeatsRes = await client.query(
    `SELECT COUNT(*) FROM allocations WHERE event_id = $1`,
    [eventId]
  );
  
  const totalActiveSeats = parseInt(totalSeatsRes.rows[0].count, 10);
  const allocatedSeatsCount = parseInt(allocatedSeatsRes.rows[0].count, 10);
  const currentFillPercent = totalActiveSeats > 0 ? (allocatedSeatsCount / totalActiveSeats) : 0;

  const now = new Date();
  const cutoffPassed = now >= new Date(overflow_cutoff_time);
  const thresholdReached = currentFillPercent >= parseFloat(overflow_fill_threshold);
  
  let globalOverflowTriggered = cutoffPassed || thresholdReached;

  // 3. Fetch Zone configuration for this student's branch + division
  const zoneRes = await client.query(
    `SELECT z.anchor_seat_id, z.fill_direction, z.expected_count, z.width, z.height,
            al.row_num as anchor_row, al.col_num as anchor_col
     FROM zones z
     JOIN auditorium_layout al ON z.anchor_seat_id = al.seat_id
     WHERE z.event_id = $1 AND z.branch = $2 AND z.division = $3`,
    [eventId, branch, division]
  );

  if (zoneRes.rows.length === 0) {
    throw new Error(`No zone configured for event ${eventId}, branch ${branch}, division ${division}`);
  }

  const { anchor_seat_id, anchor_row, anchor_col, fill_direction, width, height } = zoneRes.rows[0];

  // We loop to handle potential concurrency race conditions on the chosen seat
  let attempts = 0;
  while (attempts < 5) {
    attempts++;
    let targetSeatId = null;
    let isOverflow = false;

    // Define Zone preferred range
    const startRow = anchor_row;
    const endRow = Math.min(20, anchor_row + height - 1);
    const startCol = anchor_col;
    const endCol = Math.min(25, anchor_col + width - 1);

    let freePreferredSeats = [];

    // If global overflow is not triggered, look for seats in the preferred zone
    if (!globalOverflowTriggered) {
      const preferredSeatsRes = await client.query(
        `SELECT al.seat_id, al.row_num, al.col_num
         FROM auditorium_layout al
         LEFT JOIN allocations a ON al.seat_id = a.seat_id AND a.event_id = $1
         WHERE al.is_active = true
           AND al.row_num >= $2 AND al.row_num <= $3
           AND al.col_num >= $4 AND al.col_num <= $5
           AND a.id IS NULL
         ORDER BY al.row_num ASC, al.col_num ASC`,
        [eventId, startRow, endRow, startCol, endCol]
      );
      freePreferredSeats = preferredSeatsRes.rows;
    }

    const isZoneFull = freePreferredSeats.length === 0;

    // A. Normal Seat Assignment (Zone has seats and global overflow is NOT triggered)
    if (!globalOverflowTriggered && !isZoneFull) {
      targetSeatId = freePreferredSeats[0].seat_id;
      isOverflow = false;
    } 
    // B. Overflow Seat Assignment (Zone is full OR global overflow cutoff triggered)
    else {
      // Fetch all unallocated active seats in the auditorium
      const allFreeSeatsRes = await client.query(
        `SELECT al.seat_id, al.row_num, al.col_num
         FROM auditorium_layout al
         LEFT JOIN allocations a ON al.seat_id = a.seat_id AND a.event_id = $1
         WHERE al.is_active = true AND a.id IS NULL`,
        [eventId]
      );

      const freeSeats = allFreeSeatsRes.rows;
      if (freeSeats.length > 0) {
        // Sort by Manhattan distance to the anchor seat, then front-to-back, then left-to-right
        freeSeats.sort((a, b) => {
          const distA = getDistance(a.row_num, a.col_num, anchor_row, anchor_col);
          const distB = getDistance(b.row_num, b.col_num, anchor_row, anchor_col);
          if (distA !== distB) return distA - distB;
          if (a.row_num !== b.row_num) return a.row_num - b.row_num;
          return a.col_num - b.col_num;
        });
        targetSeatId = freeSeats[0].seat_id;
        isOverflow = true;
      }
    }

    // C. Try to acquire lock and allocate target seat
    if (targetSeatId) {
      // Row lock on allocations for this event+seat, or verify it remains unassigned
      const lockRes = await client.query(
        `SELECT id FROM allocations 
         WHERE event_id = $1 AND seat_id = $2
         FOR UPDATE`,
        [eventId, targetSeatId]
      );

      // If lockRes is empty, it means the seat has NOT been allocated.
      // We also do a FOR UPDATE lock on the auditorium_layout to be absolutely safe
      const seatLockRes = await client.query(
        `SELECT seat_id, row_num, col_num FROM auditorium_layout 
         WHERE seat_id = $1 AND is_active = true
         FOR UPDATE`,
        [targetSeatId]
      );

      // Double check if another transaction created an allocation in between
      const doubleCheckRes = await client.query(
        `SELECT id FROM allocations WHERE event_id = $1 AND seat_id = $2`,
        [eventId, targetSeatId]
      );

      if (doubleCheckRes.rows.length === 0 && seatLockRes.rows.length > 0) {
        // Seat is free! We allocate it.
        const allocatedRow = seatLockRes.rows[0].row_num;
        const allocatedCol = seatLockRes.rows[0].col_num;
        const isWithinZone = allocatedRow >= startRow && allocatedRow <= endRow &&
                             allocatedCol >= startCol && allocatedCol <= endCol;
        const status = isWithinZone ? 'allocated' : 'overflow';
        await client.query(
          `INSERT INTO allocations (event_id, student_id, seat_id, status)
           VALUES ($1, $2, $3, $4)`,
          [eventId, studentId, targetSeatId, status]
        );
        
        return {
          seatId: targetSeatId,
          rowNum: seatLockRes.rows[0].row_num,
          colNum: seatLockRes.rows[0].col_num,
          status: status,
          isNew: true
        };
      } else {
        // Race condition: someone grabbed this seat right before us.
        // We log and retry (loop will search for the next seat)
        console.warn(`Race condition detected for seat ${targetSeatId}, retrying...`);
        continue;
      }
    } else {
      // No seats available anywhere in the auditorium (Waitlist)
      return null;
    }
  }

  throw new Error('Failed to allocate seat after multiple concurrent retry attempts');
}

/**
 * Resets all allocations for a given event.
 * 
 * @param {import('pg').PoolClient} client - The pg client
 * @param {number} eventId - The ID of the event
 */
async function resetZones(client, eventId) {
  await client.query('DELETE FROM allocations WHERE event_id = $1', [eventId]);
}

module.exports = {
  allocateSeat,
  resetZones
};

