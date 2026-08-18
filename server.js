// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { allocateSeat } = require('./allocation');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // For demo, allow connections from any client
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkeyforseatingapp';

app.use(cors());
app.use(express.json());

const scanRateLimit = {};
const RATE_LIMIT_MS = 1000; // 1 second rate limit per device

// Socket.io Connection
io.on('connection', (socket) => {
  console.log('Client connected to socket:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Middleware to authenticate staff user JWT
const authenticateStaff = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  const token = authHeader.split(' ')[1]; // "Bearer TOKEN"
  if (!token) {
    return res.status(401).json({ error: 'Access denied. Invalid token format.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.staff = decoded;
    next();
  } catch (err) {
    res.status(403).json({ error: 'Invalid or expired token.' });
  }
};

// 1. Staff Authentication Route
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  try {
    const result = await db.query('SELECT * FROM staff_users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const staff = result.rows[0];
    const validPass = await bcrypt.compare(password, staff.password_hash);
    if (!validPass) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    // Generate staff token
    const token = jwt.sign(
      { staffId: staff.id, username: staff.username },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token, username: staff.username });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 2. Events API - Fetch active event
app.get('/api/events/active', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM events ORDER BY date ASC LIMIT 1`
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No active events found.' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Fetch event error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin helper to toggle overflow cutoff (for easy demo simulation)
app.post('/api/events/:id/toggle-overflow', authenticateStaff, async (req, res) => {
  const eventId = req.params.id;
  const { triggerNow } = req.body; // boolean

  try {
    const newCutoff = triggerNow ? new Date(Date.now() - 60000) : new Date(Date.now() + 3600000); // 1 min ago vs 1 hour from now
    await db.query(
      `UPDATE events SET overflow_cutoff_time = $1 WHERE id = $2`,
      [newCutoff, eventId]
    );
    
    // Notify all dashboard clients that event details changed
    io.emit('event_updated', { eventId, overflowCutoffTime: newCutoff });
    
    res.json({ success: true, overflowCutoffTime: newCutoff });
  } catch (err) {
    console.error('Toggle overflow error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 3. Scan API - ONLY accessible by staff
app.post('/api/scan', authenticateStaff, async (req, res) => {
  const { qrToken, eventId } = req.body;

  if (!qrToken || !eventId) {
    return res.status(400).json({ error: 'Missing qrToken or eventId.' });
  }

  // Rate-limiting scans per staff user device
  const staffId = req.staff.staffId;
  const now = Date.now();
  if (scanRateLimit[staffId] && (now - scanRateLimit[staffId] < RATE_LIMIT_MS)) {
    return res.status(429).json({ error: 'Scan throttled. Please wait 1 second between scans.' });
  }
  scanRateLimit[staffId] = now;

  // 1. Verify student QR token
  let studentPayload;
  try {
    studentPayload = jwt.verify(qrToken, JWT_SECRET);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid or corrupted student QR token.' });
  }

  const { rollNo } = studentPayload;
  if (!rollNo) {
    return res.status(400).json({ error: 'Invalid QR token payload.' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // 2. Fetch full student details from DB
    const studentRes = await client.query(
      `SELECT id, roll_no, name, branch, division, year, photo_url FROM students WHERE roll_no = $1`,
      [rollNo]
    );

    if (studentRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Student record not found in database.' });
    }

    const student = studentRes.rows[0];

    // 3. Run atomic seating allocation
    const allocation = await allocateSeat(client, eventId, student);
    
    await client.query('COMMIT');

    if (!allocation) {
      // Auditorium full!
      return res.status(409).json({ 
        error: 'Auditorium is full. Student has been waitlisted.',
        student 
      });
    }

    // Broadcast allocation event to live dashboard
    io.emit('seat_updated', {
      seatId: allocation.seatId,
      rowNum: allocation.rowNum,
      colNum: allocation.colNum,
      status: allocation.status,
      student: {
        id: student.id,
        rollNo: student.roll_no,
        name: student.name,
        branch: student.branch,
        division: student.division
      }
    });

    res.json({
      success: true,
      isNewAllocation: allocation.isNew,
      seat: {
        seatId: allocation.seatId,
        rowNum: allocation.rowNum,
        colNum: allocation.colNum,
        status: allocation.status
      },
      student
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Scan transaction failed:', err);
    res.status(500).json({ error: err.message || 'Transaction failed.' });
  } finally {
    client.release();
  }
});

// 4. Seating Grid & Dashboard Stats API
app.get('/api/dashboard/seating/:eventId', async (req, res) => {
  const eventId = req.params.eventId;

  try {
    // Get all seats
    const layoutRes = await db.query(
      `SELECT seat_id, row_num, col_num, is_active FROM auditorium_layout ORDER BY row_num ASC, col_num ASC`
    );

    // Get current allocations
    const allocRes = await db.query(
      `SELECT a.seat_id, a.status, a.scanned_at,
              s.id as student_id, s.roll_no, s.name, s.branch, s.division
       FROM allocations a
       JOIN students s ON a.student_id = s.id
       WHERE a.event_id = $1`,
      [eventId]
    );

    // Build lookup map for allocations
    const allocationsMap = {};
    allocRes.rows.forEach(row => {
      allocationsMap[row.seat_id] = {
        status: row.status,
        scannedAt: row.scanned_at,
        student: {
          id: row.student_id,
          rollNo: row.roll_no,
          name: row.name,
          branch: row.branch,
          division: row.division
        }
      };
    });

    res.json({
      seats: layoutRes.rows,
      allocations: allocationsMap
    });
  } catch (err) {
    console.error('Fetch dashboard stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 5. Absentee Report API
app.get('/api/reports/absentees/:eventId', async (req, res) => {
  const eventId = req.params.eventId;
  try {
    // Find all students that have no allocation for this event
    const result = await db.query(
      `SELECT s.id, s.roll_no, s.name, s.branch, s.division, s.year, s.qr_token, s.photo_url
       FROM students s
       LEFT JOIN allocations a ON s.id = a.student_id AND a.event_id = $1
       WHERE a.id IS NULL
       ORDER BY s.branch ASC, s.division ASC, s.roll_no ASC`,
      [eventId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Fetch absentees error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 6. CSV Export API
app.get('/api/reports/csv/:eventId', async (req, res) => {
  const eventId = req.params.eventId;
  try {
    const result = await db.query(
      `SELECT s.roll_no, s.name, s.branch, s.division, 
              COALESCE(a.seat_id, 'ABSENT') as seat_id,
              COALESCE(a.status, 'absent') as status,
              a.scanned_at
       FROM students s
       LEFT JOIN allocations a ON s.id = a.student_id AND a.event_id = $1
       ORDER BY s.branch ASC, s.division ASC, s.roll_no ASC`,
      [eventId]
    );

    // Build CSV content
    let csvContent = 'Roll No,Name,Branch,Division,Seat ID,Status,Scanned At\n';
    result.rows.forEach(r => {
      const scannedTime = r.scanned_at ? new Date(r.scanned_at).toISOString() : '-';
      csvContent += `"${r.roll_no}","${r.name}","${r.branch}","${r.division}","${r.seat_id}","${r.status}","${scannedTime}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=seating_report_event_${eventId}.csv`);
    res.status(200).send(csvContent);

  } catch (err) {
    console.error('CSV export error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
