// seed.js
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkeyforseatingapp';

async function seed() {
  console.log('Starting database seeding...');
  
  let client;
  try {
    client = await db.getClient();
  } catch (err) {
    console.error('\n[DATABASE CONNECTION ERROR]');
    console.error('Could not connect to PostgreSQL. Please ensure:');
    console.error('1. PostgreSQL is installed and running.');
    console.error('2. You have created a database (e.g. named "seatcode").');
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
    
    // We run this in a transaction block
    await client.query('BEGIN');
    for (let r = 1; r <= 20; r++) {
      for (let c = 1; c <= 25; c++) {
        const seatId = `S_${r}_${c}`;
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

    // 4. Insert an event
    console.log('Seeding default event...');
    const eventName = 'Annual Tech Fest Convocation 2026';
    const eventDate = new Date();
    eventDate.setDate(eventDate.getDate() + 1); // tomorrow
    
    // Set default cutoff time to 1 hour from now (meaning global overflow is NOT triggered by default)
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() + 1);

    const eventResult = await client.query(
      `INSERT INTO events (name, date, layout_id, overflow_cutoff_time, overflow_fill_threshold)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [eventName, eventDate, 'standard', cutoffTime, 0.8]
    );
    const eventId = eventResult.rows[0].id;
    console.log(`Event seeded: "${eventName}" (ID: ${eventId})`);

    // 5. Seed zones
    console.log('Seeding zones...');
    const zones = [
      { branch: 'CE',   division: 'A', anchor: 'S_1_1',   dir: 'RIGHT_DOWN', expected: 40 },
      { branch: 'CE',   division: 'B', anchor: 'S_1_6',   dir: 'RIGHT_DOWN', expected: 40 },
      { branch: 'IT',   division: 'A', anchor: 'S_1_11',  dir: 'RIGHT_DOWN', expected: 40 },
      { branch: 'IT',   division: 'B', anchor: 'S_1_16',  dir: 'RIGHT_DOWN', expected: 40 },
      { branch: 'EXTC', division: 'A', anchor: 'S_1_21',  dir: 'RIGHT_DOWN', expected: 40 },
      { branch: 'EXTC', division: 'B', anchor: 'S_11_1',  dir: 'RIGHT_DOWN', expected: 40 },
      { branch: 'ME',   division: 'A', anchor: 'S_11_6',  dir: 'RIGHT_DOWN', expected: 40 },
      { branch: 'ME',   division: 'B', anchor: 'S_11_11', dir: 'RIGHT_DOWN', expected: 40 },
      { branch: 'EE',   division: 'A', anchor: 'S_11_16', dir: 'RIGHT_DOWN', expected: 40 },
      { branch: 'EE',   division: 'B', anchor: 'S_11_21', dir: 'RIGHT_DOWN', expected: 40 }
    ];

    const zoneInsertQuery = `
      INSERT INTO zones (event_id, branch, division, anchor_seat_id, fill_direction, expected_count)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;

    for (const z of zones) {
      await client.query(zoneInsertQuery, [eventId, z.branch, z.division, z.anchor, z.dir, z.expected]);
    }
    console.log('Zones seeded.');

    // 6. Seed Students (~5 branches x 2 divisions x 40 students = 400 students)
    console.log('Seeding students and signing QR tokens (this may take a few seconds)...');
    const branches = ['CE', 'IT', 'EXTC', 'ME', 'EE'];
    const divisions = ['A', 'B'];
    
    await client.query('BEGIN');
    let studentCount = 0;
    
    for (const branch of branches) {
      for (const div of divisions) {
        for (let i = 1; i <= 40; i++) {
          const rollNo = `${branch}-${div}-${String(i).padStart(2, '0')}`;
          const name = `${branch} Student ${div} #${i}`;
          const year = 'FY';
          // Sign token with student data
          const qrToken = jwt.sign(
            { rollNo, name, branch, division: div },
            JWT_SECRET
          );
          
          // Dicebear avatar as mock photo URL
          const photoUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${rollNo}`;
          
          await client.query(
            `INSERT INTO students (roll_no, name, branch, division, year, qr_token, photo_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [rollNo, name, branch, div, year, qrToken, photoUrl]
          );
          studentCount++;
        }
      }
    }
    await client.query('COMMIT');
    console.log(`Successfully seeded ${studentCount} students with signed QR tokens.`);
    console.log('Database Seeding Completed Successfully.');
    process.exit(0);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error during seeding:', err);
    process.exit(1);
  } finally {
    client.release();
  }
}

seed();
