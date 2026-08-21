// seed.js
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkeyforseatingapp';

function getScanTime(eventDate, index, total, profile) {
  let offsetMinutes = 0;
  if (profile === 'fast') {
    // tight normal-ish distribution: -15m to +15m
    const rand = Math.random() + Math.random() + Math.random() - 1.5;
    offsetMinutes = rand * 10;
  } else if (profile === 'slow') {
    // spread out: -30m to +60m
    offsetMinutes = -30 + Math.random() * 90;
  } else {
    // normal: -20m to +30m
    offsetMinutes = -20 + Math.random() * 50;
  }
  
  // slightly sequential offset
  const sequentialAddition = (index / total) * 15;
  const finalOffset = offsetMinutes + sequentialAddition;
  
  const scanDate = new Date(eventDate);
  scanDate.setMinutes(scanDate.getMinutes() + finalOffset);
  return scanDate;
}

function getDistance(r1, c1, r2, c2) {
  return Math.abs(r1 - r2) + Math.abs(c1 - c2);
}

async function seed() {
  console.log('Starting database seeding...');
  
  let client;
  try {
    client = await db.getClient();
  } catch (err) {
    console.error('\n[DATABASE CONNECTION ERROR]');
    console.error('Could not connect to PostgreSQL. Please ensure:');
    console.error('1. PostgreSQL is installed and running.');
    console.error('2. You have created a database.');
    console.error('3. You have configured the DATABASE_URL in the .env file.');
    console.error(`Current Config DATABASE_URL: ${process.env.DATABASE_URL}\n`);
    process.exit(1);
  }

  try {
    // 1. Run schema.sql to clear and create tables
    console.log('Reading schema.sql...');
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    console.log('Executing schema.sql...');
    await client.query(schemaSql);
    console.log('Schema created successfully.');

    // 2. Insert auditorium layout (20x25 grid = 500 seats)
    console.log('Seeding auditorium layout (20x25)...');
    const seatInsertQuery = `
      INSERT INTO auditorium_layout (seat_id, row_num, col_num, is_active)
      VALUES ($1, $2, $3, $4)
    `;
    
    // Create layout in memory for simulation
    const allSeats = [];
    await client.query('BEGIN');
    for (let r = 1; r <= 20; r++) {
      for (let c = 1; c <= 25; c++) {
        const seatId = `S_${r}_${c}`;
        allSeats.push({ seatId, rowNum: r, colNum: c });
        await client.query(seatInsertQuery, [seatId, r, c, true]);
      }
    }
    await client.query('COMMIT');
    console.log('Auditorium seats seeded.');

    // 3. Insert staff user
    console.log('Seeding staff user...');
    const username = 'admin';
    const password = 'password123';
    const passwordHash = await bcrypt.hash(password, 10);
    await client.query(
      'INSERT INTO staff_users (username, password_hash) VALUES ($1, $2)',
      [username, passwordHash]
    );
    console.log(`Staff user seeded: username="${username}", password="${password}"`);

    // 4. Seed Students (~12 zones x 70 students = 840 students)
    const zonesTemplate = [
      { branch: 'COMPS', division: 'A', anchor: 'S_1_1',   dir: 'RIGHT_DOWN', expected: 70, w: 5, h: 10 },
      { branch: 'IT',    division: 'C', anchor: 'S_11_1',  dir: 'RIGHT_DOWN', expected: 70, w: 5, h: 10 },
      { branch: 'IT',    division: 'B', anchor: 'S_1_21',  dir: 'RIGHT_DOWN', expected: 70, w: 5, h: 10 },
      { branch: 'MECH',  division: '',  anchor: 'S_11_21', dir: 'RIGHT_DOWN', expected: 70, w: 5, h: 10 },
      { branch: 'COMPS', division: 'B', anchor: 'S_1_6',   dir: 'RIGHT_DOWN', expected: 70, w: 4, h: 10 },
      { branch: 'COMPS', division: 'C', anchor: 'S_1_10',  dir: 'RIGHT_DOWN', expected: 70, w: 4, h: 10 },
      { branch: 'IT',    division: 'A', anchor: 'S_1_14',  dir: 'RIGHT_DOWN', expected: 70, w: 4, h: 10 },
      { branch: 'AIML',  division: '',  anchor: 'S_1_18',  dir: 'RIGHT_DOWN', expected: 70, w: 3, h: 10 },
      { branch: 'AIDS',  division: '',  anchor: 'S_11_6',  dir: 'RIGHT_DOWN', expected: 70, w: 4, h: 10 },
      { branch: 'CS&E',  division: '',  anchor: 'S_11_10', dir: 'RIGHT_DOWN', expected: 70, w: 4, h: 10 },
      { branch: 'CIVIL', division: '',  anchor: 'S_11_14', dir: 'RIGHT_DOWN', expected: 70, w: 4, h: 10 },
      { branch: 'EXTC',  division: '',  anchor: 'S_11_18', dir: 'RIGHT_DOWN', expected: 70, w: 3, h: 10 }
    ];

    console.log('Seeding students and signing QR tokens...');
    await client.query('BEGIN');
    const allStudents = [];
    for (const z of zonesTemplate) {
      for (let i = 1; i <= 70; i++) {
        const rollNoStr = String(i).padStart(2, '0');
        const rollNo = `23-${z.branch}${z.division}${rollNoStr}-27`;
        const name = `${z.branch} Student ${z.division} #${i}`;
        const year = 'FY';
        const qrToken = jwt.sign(
          { rollNo, name, branch: z.branch, division: z.division },
          JWT_SECRET
        );
        const photoUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${rollNo}`;
        
        const sRes = await client.query(
          `INSERT INTO students (roll_no, name, branch, division, year, qr_token, photo_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [rollNo, name, z.branch, z.division, year, qrToken, photoUrl]
        );
        allStudents.push({
          id: sRes.rows[0].id,
          roll_no: rollNo,
          name,
          branch: z.branch,
          division: z.division
        });
      }
    }
    await client.query('COMMIT');
    console.log(`Seeded ${allStudents.length} students.`);

    // 5. Seed Events & Allocations
    const eventsToSeed = [
      {
        name: 'Freshers Induction Ceremony 2025',
        date: new Date(Date.now() - 180 * 86400000), // 6 months ago
        cutoffMinutes: 15,
        cutoffTriggerPercent: 1.0,
        fillThreshold: 0.8,
        profile: 'normal',
        attendanceRate: 0.82
      },
      {
        name: 'Winter Sports Convocation 2025',
        date: new Date(Date.now() - 120 * 86400000), // 4 months ago
        cutoffMinutes: -10, // forced early cutoff
        cutoffTriggerPercent: 0.1,
        fillThreshold: 0.8,
        profile: 'slow',
        attendanceRate: 0.45
      },
      {
        name: 'National Spring Hackathon 2026',
        date: new Date(Date.now() - 60 * 86400000), // 2 months ago
        cutoffMinutes: 30,
        cutoffTriggerPercent: 1.0,
        fillThreshold: 0.85,
        profile: 'fast',
        attendanceRate: 0.52
      },
      {
        name: 'Cultural Festival Concert Night 2026',
        date: new Date(Date.now() - 30 * 86400000), // 1 month ago
        cutoffMinutes: 20,
        cutoffTriggerPercent: 0.7,
        fillThreshold: 0.75,
        profile: 'fast',
        attendanceRate: 0.97
      },
      {
        name: 'Annual Tech Fest Convocation 2026', // Active event
        date: new Date(Date.now() + 86400000), // Tomorrow
        cutoffMinutes: 60,
        cutoffTriggerPercent: 1.0,
        fillThreshold: 0.8,
        profile: 'normal',
        attendanceRate: 0.22 // partially seeded for demo
      }
    ];

    for (const e of eventsToSeed) {
      console.log(`Seeding event: "${e.name}"...`);
      const eventResult = await client.query(
        `INSERT INTO events (name, date, layout_id, overflow_cutoff_time, overflow_fill_threshold)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [e.name, e.date, 'standard', e.date, e.fillThreshold]
      );
      const eventId = eventResult.rows[0].id;

      // Seed zones for this event
      const zoneInsertQuery = `
        INSERT INTO zones (event_id, branch, division, anchor_seat_id, fill_direction, expected_count, width, height)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `;
      for (const z of zonesTemplate) {
        await client.query(zoneInsertQuery, [eventId, z.branch, z.division, z.anchor, z.dir, z.expected, z.w, z.h]);
      }

      // Simulate scans IN-MEMORY (super fast!)
      const shuffleArray = (arr) => arr.sort(() => Math.random() - 0.5);
      const attendanceCount = Math.floor(allStudents.length * e.attendanceRate);
      const scannedStudents = shuffleArray([...allStudents]).slice(0, attendanceCount);

      console.log(`Simulating ${scannedStudents.length} allocations in memory...`);

      const occupiedSeats = new Set();
      const studentAllocations = [];
      const triggerCutoffAt = Math.floor(scannedStudents.length * e.cutoffTriggerPercent);

      for (let i = 0; i < scannedStudents.length; i++) {
        const student = scannedStudents[i];
        const globalOverflowTriggered = (i >= triggerCutoffAt);

        // Find student zone
        const z = zonesTemplate.find(zt => zt.branch === student.branch && zt.division === student.division);
        if (!z) throw new Error(`No zone configured for student branch ${student.branch}`);

        const anchorParts = z.anchor.split('_');
        const anchorRow = parseInt(anchorParts[1], 10);
        const anchorCol = parseInt(anchorParts[2], 10);
        const startRow = anchorRow;
        const endRow = Math.min(20, anchorRow + z.h - 1);
        const startCol = anchorCol;
        const endCol = Math.min(25, anchorCol + z.w - 1);

        let targetSeatId = null;

        if (!globalOverflowTriggered) {
          // Find free seats in the preferred zone
          const freePreferred = allSeats.filter(seat => 
            seat.rowNum >= startRow && seat.rowNum <= endRow &&
            seat.colNum >= startCol && seat.colNum <= endCol &&
            !occupiedSeats.has(seat.seatId)
          );
          
          // Sort by row, then col ascending
          freePreferred.sort((a, b) => {
            if (a.rowNum !== b.rowNum) return a.rowNum - b.rowNum;
            return a.colNum - b.colNum;
          });
          
          if (freePreferred.length > 0) {
            targetSeatId = freePreferred[0].seatId;
          }
        }

        // If zone is full or global overflow is triggered
        if (!targetSeatId) {
          const freeSeats = allSeats.filter(seat => !occupiedSeats.has(seat.seatId));
          if (freeSeats.length > 0) {
            freeSeats.sort((a, b) => {
              const distA = getDistance(a.rowNum, a.colNum, anchorRow, anchorCol);
              const distB = getDistance(b.rowNum, b.colNum, anchorRow, anchorCol);
              if (distA !== distB) return distA - distB;
              if (a.rowNum !== b.rowNum) return a.rowNum - b.rowNum;
              return a.colNum - b.colNum;
            });
            targetSeatId = freeSeats[0].seatId;
          }
        }

        if (targetSeatId) {
          occupiedSeats.add(targetSeatId);
          const seatInfo = allSeats.find(seat => seat.seatId === targetSeatId);
          const isWithinZone = seatInfo.rowNum >= startRow && seatInfo.rowNum <= endRow &&
                               seatInfo.colNum >= startCol && seatInfo.colNum <= endCol;
          const status = isWithinZone ? 'allocated' : 'overflow';
          const scanTime = getScanTime(e.date, i, scannedStudents.length, e.profile);
          
          studentAllocations.push({
            studentId: student.id,
            seatId: targetSeatId,
            status,
            scannedAt: scanTime
          });
        }
      }

      // Batch insert all allocations for this event (massive speedup!)
      if (studentAllocations.length > 0) {
        console.log(`Batch inserting ${studentAllocations.length} allocations into database...`);
        const values = [];
        const clauses = [];
        let pIndex = 1;
        
        await client.query('BEGIN');
        // Chunk inserts to avoid exceeding PostgreSQL parameter limits (65,535 parameters limit)
        // 5 parameters per allocation. We can chunk by 2000 allocations (10,000 parameters)
        const chunkSize = 2000;
        for (let i = 0; i < studentAllocations.length; i += chunkSize) {
          const chunk = studentAllocations.slice(i, i + chunkSize);
          const chunkClauses = [];
          const chunkValues = [];
          let chunkPIndex = 1;
          
          for (const sa of chunk) {
            chunkClauses.push(`($${chunkPIndex}, $${chunkPIndex+1}, $${chunkPIndex+2}, $${chunkPIndex+3}, $${chunkPIndex+4})`);
            chunkValues.push(eventId, sa.studentId, sa.seatId, sa.status, sa.scannedAt);
            chunkPIndex += 5;
          }
          
          await client.query(
            `INSERT INTO allocations (event_id, student_id, seat_id, status, scanned_at)
             VALUES ${chunkClauses.join(', ')}`,
            chunkValues
          );
        }
        await client.query('COMMIT');
      }

      // Set actual historical cutoff
      const finalCutoffTime = new Date(e.date);
      finalCutoffTime.setMinutes(finalCutoffTime.getMinutes() + e.cutoffMinutes);
      await client.query(
        'UPDATE events SET overflow_cutoff_time = $1 WHERE id = $2',
        [finalCutoffTime, eventId]
      );
    }

    console.log('Database Seeding Completed Successfully.');
    process.exit(0);

  } catch (err) {
    if (client) await client.query('ROLLBACK');
    console.error('Error during seeding:', err);
    process.exit(1);
  } finally {
    if (client) client.release();
  }
}

seed();
