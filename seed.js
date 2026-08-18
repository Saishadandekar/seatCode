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
      // Left wing (width 5, height 10)
      { branch: 'COMPS', division: 'A', anchor: 'S_1_1',   dir: 'RIGHT_DOWN', expected: 70, w: 5, h: 10 },
      { branch: 'IT',    division: 'C', anchor: 'S_11_1',  dir: 'RIGHT_DOWN', expected: 70, w: 5, h: 10 },
      // Right wing (width 5, height 10)
      { branch: 'IT',    division: 'B', anchor: 'S_1_21',  dir: 'RIGHT_DOWN', expected: 70, w: 5, h: 10 },
      { branch: 'MECH',  division: '',  anchor: 'S_11_21', dir: 'RIGHT_DOWN', expected: 70, w: 5, h: 10 },
      // Center section (Rows 1-10: height 10, Rows 11-20: height 10)
      // Split columns 6-20 (15 cols) into 4 blocks of widths: 4, 4, 4, 3
      { branch: 'COMPS', division: 'B', anchor: 'S_1_6',   dir: 'RIGHT_DOWN', expected: 70, w: 4, h: 10 },
      { branch: 'COMPS', division: 'C', anchor: 'S_1_10',  dir: 'RIGHT_DOWN', expected: 70, w: 4, h: 10 },
      { branch: 'IT',    division: 'A', anchor: 'S_1_14',  dir: 'RIGHT_DOWN', expected: 70, w: 4, h: 10 },
      { branch: 'AIML',  division: '',  anchor: 'S_1_18',  dir: 'RIGHT_DOWN', expected: 70, w: 3, h: 10 },
      { branch: 'AIDS',  division: '',  anchor: 'S_11_6',  dir: 'RIGHT_DOWN', expected: 70, w: 4, h: 10 },
      { branch: 'CS&E',  division: '',  anchor: 'S_11_10', dir: 'RIGHT_DOWN', expected: 70, w: 4, h: 10 },
      { branch: 'CIVIL', division: '',  anchor: 'S_11_14', dir: 'RIGHT_DOWN', expected: 70, w: 4, h: 10 },
      { branch: 'EXTC',  division: '',  anchor: 'S_11_18', dir: 'RIGHT_DOWN', expected: 70, w: 3, h: 10 }
    ];

    const zoneInsertQuery = `
      INSERT INTO zones (event_id, branch, division, anchor_seat_id, fill_direction, expected_count, width, height)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;

    for (const z of zones) {
      await client.query(zoneInsertQuery, [eventId, z.branch, z.division, z.anchor, z.dir, z.expected, z.w, z.h]);
    }
    console.log('Zones seeded.');

    // 6. Seed Students (~12 zones x 70 students = 840 students)
    console.log('Seeding students and signing QR tokens (this may take a few seconds)...');
    
    await client.query('BEGIN');
    let studentCount = 0;
    
    for (const z of zones) {
      for (let i = 1; i <= 70; i++) {
        const rollNoStr = String(i).padStart(2, '0');
        const rollNo = `23-${z.branch}${z.division}${rollNoStr}-27`;
        const name = `${z.branch} Student ${z.division} #${i}`;
        const year = 'FY';
        // Sign token with student data
        const qrToken = jwt.sign(
          { rollNo, name, branch: z.branch, division: z.division },
          JWT_SECRET
        );
        
        // Dicebear avatar as mock photo URL
        const photoUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${rollNo}`;
        
        await client.query(
          `INSERT INTO students (roll_no, name, branch, division, year, qr_token, photo_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [rollNo, name, z.branch, z.division, year, qrToken, photoUrl]
        );
        studentCount++;
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
