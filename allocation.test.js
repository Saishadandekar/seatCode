const db = require('./db');
const { allocateSeat, resetZones } = require('./allocation');

// Set high timeout for DB queries
jest.setTimeout(60000);

let client;
let eventId;

beforeAll(async () => {
  client = await db.getClient();
  
  // 1. Create a clean test event
  const eventRes = await client.query(
    `INSERT INTO events (name, date, overflow_cutoff_time, overflow_fill_threshold)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    ['Jest Test Event', new Date(), new Date(Date.now() + 3600000), 0.8]
  );
  eventId = eventRes.rows[0].id;
  
  // 2. Setup the test zone for the IT branch, division A
  // We'll anchor it at S_1_14 with width 4, height 10 (40 capacity preferred zone)
  await client.query(
    `INSERT INTO zones (event_id, branch, division, anchor_seat_id, fill_direction, expected_count, width, height)
     VALUES ($1, 'IT', 'A', 'S_1_14', 'RIGHT_DOWN', 70, 4, 10)`,
    [eventId]
  );
});

afterAll(async () => {
  if (client) {
    // Delete the test event (cascades and deletes test zones & test allocations)
    await client.query('DELETE FROM events WHERE id = $1', [eventId]);
    client.release();
  }
  await db.pool.end();
});

// Helper to create a single test student in the database
async function createTestStudent(rollNo, name, branch, division) {
  const qrToken = `token_${rollNo}`;
  const res = await client.query(
    `INSERT INTO students (roll_no, name, branch, division, year, qr_token, photo_url)
     VALUES ($1, $2, $3, $4, 'FY', $5, 'http://example.com/photo.jpg')
     ON CONFLICT (roll_no) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, roll_no, name, branch, division`,
    [rollNo, name, branch, division, qrToken]
  );
  return res.rows[0];
}

// Helper to batch create test students in the database (much faster)
async function createTestStudentsBatch(studentsData) {
  const values = [];
  const valueClauses = [];
  let paramIndex = 1;
  for (const s of studentsData) {
    const qrToken = `token_${s.rollNo}`;
    valueClauses.push(`($${paramIndex}, $${paramIndex+1}, $${paramIndex+2}, $${paramIndex+3}, 'FY', $${paramIndex+4}, 'http://example.com/photo.jpg')`);
    values.push(s.rollNo, s.name, s.branch, s.division, qrToken);
    paramIndex += 5;
  }
  
  const queryText = `
    INSERT INTO students (roll_no, name, branch, division, year, qr_token, photo_url)
    VALUES ${valueClauses.join(', ')}
    ON CONFLICT (roll_no) DO UPDATE SET name = EXCLUDED.name
    RETURNING id, roll_no, name, branch, division
  `;
  
  const res = await client.query(queryText, values);
  return res.rows;
}

test('does not assign the same seat to two students', async () => {
    await resetZones(client, eventId);

    const student1 = await createTestStudent('TEST-IT-A-01', 'Test Student 1', 'IT', 'A');
    const student2 = await createTestStudent('TEST-IT-A-02', 'Test Student 2', 'IT', 'A');

    await client.query('BEGIN');
    const seat1 = await allocateSeat(client, eventId, student1);
    await client.query('COMMIT');

    await client.query('BEGIN');
    const seat2 = await allocateSeat(client, eventId, student2);
    await client.query('COMMIT');

    expect(seat1).not.toBeNull();
    expect(seat2).not.toBeNull();
    expect(seat1.seatId).not.toBe(seat2.seatId);
});

test('re-scanning the same student returns the same seat (idempotency)', async () => {
    await resetZones(client, eventId);

    const student = await createTestStudent('TEST-IT-A-03', 'Test Student 3', 'IT', 'A');

    await client.query('BEGIN');
    const firstScan = await allocateSeat(client, eventId, student);
    await client.query('COMMIT');

    await client.query('BEGIN');
    const secondScan = await allocateSeat(client, eventId, student);
    await client.query('COMMIT');

    expect(firstScan).not.toBeNull();
    expect(secondScan).not.toBeNull();
    expect(firstScan.seatId).toBe(secondScan.seatId);
    expect(secondScan.isNew).toBe(false);
});

test('overflow assigns seats once a zone is exhausted', async () => {
    await resetZones(client, eventId);

    // Our test zone width is 4 and height is 10 (40 capacity preferred zone).
    // Let's create 41 students in a single batch query for speed.
    const studentData = Array.from({ length: 41 }, (_, i) => ({
        rollNo: `TEST-IT-A-EX-${i+1}`,
        name: `Test Student EX ${i+1}`,
        branch: 'IT',
        division: 'A'
    }));

    const students = await createTestStudentsBatch(studentData);

    const results = [];
    for (const student of students) {
        await client.query('BEGIN');
        const res = await allocateSeat(client, eventId, student);
        await client.query('COMMIT');
        results.push(res);
    }

    // The first 40 should be normal allocations (status: 'allocated')
    for (let i = 0; i < 40; i++) {
        expect(results[i]).not.toBeNull();
        expect(results[i].status).toBe('allocated');
    }

    // The 41st should be overflow (status: 'overflow')
    const lastStudentResult = results[results.length - 1];
    expect(lastStudentResult).not.toBeNull();
    expect(lastStudentResult.status).toBe('overflow');
});