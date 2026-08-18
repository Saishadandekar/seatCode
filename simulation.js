// simulation.js
// Standalone Simulation for Dynamic Zone Seating Allocation with Threshold-Triggered Overflow

const ROWS = 20;
const COLS = 25;

function getRowLabel(rowNum) {
  let label = '';
  let temp = rowNum;
  while (temp > 0) {
    let remainder = (temp - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    temp = Math.floor((temp - 1) / 26);
  }
  return label;
}

// Define Zones (5 branches x 2 divisions)
// We map each zone to an anchor seat and a fill direction.
// We assume a 20x25 grid (500 seats total).
// Let's divide it into 5 vertical bands (5 columns each) and 2 horizontal bands (10 rows each).
const ZONES = {
  'CE-A':   { anchorRow: 1,  anchorCol: 1,  width: 5,  height: 10, fillDirection: 'RIGHT_DOWN', expectedCount: 40 },
  'CE-B':   { anchorRow: 1,  anchorCol: 6,  width: 5,  height: 10, fillDirection: 'RIGHT_DOWN', expectedCount: 40 },
  'IT-A':   { anchorRow: 1,  anchorCol: 11, width: 5,  height: 10, fillDirection: 'RIGHT_DOWN', expectedCount: 40 },
  'IT-B':   { anchorRow: 1,  anchorCol: 16, width: 5,  height: 10, fillDirection: 'RIGHT_DOWN', expectedCount: 40 },
  'EXTC-A': { anchorRow: 1,  anchorCol: 21, width: 5,  height: 10, fillDirection: 'RIGHT_DOWN', expectedCount: 40 },
  'EXTC-B': { anchorRow: 11, anchorCol: 1,  width: 5,  height: 10, fillDirection: 'RIGHT_DOWN', expectedCount: 40 },
  'ME-A':   { anchorRow: 11, anchorCol: 6,  width: 5,  height: 10, fillDirection: 'RIGHT_DOWN', expectedCount: 40 },
  'ME-B':   { anchorRow: 11, anchorCol: 11, width: 5,  height: 10, fillDirection: 'RIGHT_DOWN', expectedCount: 40 },
  'EE-A':   { anchorRow: 11, anchorCol: 16, width: 5,  height: 10, fillDirection: 'RIGHT_DOWN', expectedCount: 40 },
  'EE-B':   { anchorRow: 11, anchorCol: 21, width: 5,  height: 10, fillDirection: 'RIGHT_DOWN', expectedCount: 40 }
};

// Generates the preference list of seats for a zone based on its anchor and width/height configuration
function getPreferredSeats(zoneName) {
  const zone = ZONES[zoneName];
  if (!zone) return [];
  
  const preferred = [];
  // Front-to-back: start at anchorRow and fill up to anchorRow + height - 1 (or all the way to ROWS if not restricted,
  // but let's restrict the *primary* zone preference to its designated block first, then overflow).
  const startRow = zone.anchorRow;
  const endRow = Math.min(ROWS, zone.anchorRow + zone.height - 1);
  const startCol = zone.anchorCol;
  const endCol = Math.min(COLS, zone.anchorCol + zone.width - 1);

  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      preferred.push({ row: r, col: c });
    }
  }
  return preferred;
}

// Calculate Manhattan distance between a seat and a zone's anchor
function getDistance(row, col, zoneName) {
  const zone = ZONES[zoneName];
  return Math.abs(row - zone.anchorRow) + Math.abs(col - zone.anchorCol);
}

class Auditorium {
  constructor() {
    this.grid = Array.from({ length: ROWS }, (_, r) =>
      Array.from({ length: COLS }, (_, c) => ({
        row: r + 1,
        col: c + 1,
        student: null,
        status: null, // 'allocated' or 'overflow'
        zone: null
      }))
    );
    this.allocations = new Map(); // studentId -> seat
  }

  getSeat(row, col) {
    return this.grid[row - 1][col - 1];
  }

  isSeatFree(row, col) {
    return this.getSeat(row, col).student === null;
  }

  getOccupancyRate() {
    let occupied = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (this.grid[r][c].student !== null) occupied++;
      }
    }
    return occupied / (ROWS * COLS);
  }

  // Pure logic for seat allocation
  allocate(student, globalOverflowTriggered = false) {
    // 1. Idempotency Check
    if (this.allocations.has(student.id)) {
      return { seat: this.allocations.get(student.id), exists: true };
    }

    const zoneName = `${student.branch}-${student.division}`;
    const preferredSeats = getPreferredSeats(zoneName);

    // Check if zone is full
    const freePreferredSeats = preferredSeats.filter(s => this.isSeatFree(s.row, s.col));
    const isZoneFull = freePreferredSeats.length === 0;

    let targetSeat = null;
    let status = 'allocated';

    // 2. Normal allocation: Before global overflow AND when zone is not full
    if (!globalOverflowTriggered && !isZoneFull) {
      const nextSeatLoc = freePreferredSeats[0]; // first empty seat in preference path
      targetSeat = this.getSeat(nextSeatLoc.row, nextSeatLoc.col);
      status = 'allocated';
    } 
    // 3. Overflow allocation: Global overflow is triggered OR zone is full
    else {
      // Find the nearest available seat in the entire auditorium to the zone anchor
      let candidates = [];
      for (let r = 1; r <= ROWS; r++) {
        for (let c = 1; c <= COLS; c++) {
          if (this.isSeatFree(r, c)) {
            const dist = getDistance(r, c, zoneName);
            candidates.push({ row: r, col: c, dist });
          }
        }
      }

      if (candidates.length > 0) {
        // Sort by distance (Manhattan), then by row (front-to-back), then by col (left-to-right)
        candidates.sort((a, b) => {
          if (a.dist !== b.dist) return a.dist - b.dist;
          if (a.row !== b.row) return a.row - b.row;
          return a.col - b.col;
        });
        const bestSeatLoc = candidates[0];
        targetSeat = this.getSeat(bestSeatLoc.row, bestSeatLoc.col);
        status = 'overflow';
      }
    }

    // 4. Assign seat if found, otherwise Waitlist
    if (targetSeat) {
      targetSeat.student = student;
      targetSeat.status = status;
      targetSeat.zone = zoneName;
      this.allocations.set(student.id, targetSeat);
      return { seat: targetSeat, exists: false };
    } else {
      return { seat: null, exists: false }; // waitlist
    }
  }

  // Print a colored representation of the auditorium
  printMap() {
    const colors = {
      'CE-A': '\x1b[31m',   // Red
      'CE-B': '\x1b[91m',   // Light Red
      'IT-A': '\x1b[32m',   // Green
      'IT-B': '\x1b[92m',   // Light Green
      'EXTC-A': '\x1b[34m', // Blue
      'EXTC-B': '\x1b[94m', // Light Blue
      'ME-A': '\x1b[35m',   // Magenta
      'ME-B': '\x1b[95m',   // Light Magenta
      'EE-A': '\x1b[36m',   // Cyan
      'EE-B': '\x1b[96m',   // Light Cyan
      'reset': '\x1b[0m',
      'empty': '\x1b[90m',  // Dark Gray
      'overflow': '\x1b[33m' // Yellow (for overflow seats)
    };

    console.log('\n--- AUDITORIUM SEATING MAP (20x25) ---');
    console.log('   ' + Array.from({ length: COLS }, (_, i) => String(i + 1).padStart(2, '0')).join(' '));
    for (let r = 0; r < ROWS; r++) {
      let rowStr = getRowLabel(r + 1).padStart(2, ' ') + ' ';
      for (let c = 0; c < COLS; c++) {
        const seat = this.grid[r][c];
        if (seat.student === null) {
          rowStr += colors.empty + ' . ' + colors.reset;
        } else {
          // If status is overflow, highlight in Yellow, otherwise color by student's branch-div
          const zoneColor = seat.status === 'overflow' ? colors.overflow : (colors[seat.zone] || colors.reset);
          rowStr += zoneColor + `[${seat.student.branch[0]}${seat.student.division}]` + colors.reset;
        }
      }
      console.log(rowStr);
    }
    console.log('Legend: [BranchFirstLetter + Div] e.g. [CA] = CE-A, [CB] = CE-B. \x1b[33mYellow []\x1b[0m represents Overflow allocations. \x1b[90m.\x1b[0m is empty.\n');
  }
}

// Generate dummy students
function generateStudents() {
  const branches = ['CE', 'IT', 'EXTC', 'ME', 'EE'];
  const divisions = ['A', 'B'];
  const students = [];
  let id = 1;

  for (const branch of branches) {
    for (const division of divisions) {
      const zoneKey = `${branch}-${division}`;
      const count = ZONES[zoneKey].expectedCount;
      // We will generate slightly variable counts to simulate overfill/underfill
      let actualCount = count;
      if (zoneKey === 'CE-A') actualCount = 65; // Overfill (expected 40, has 65 arriving)
      if (zoneKey === 'EE-B') actualCount = 15; // Underfill (expected 40, has 15 arriving)

      for (let i = 1; i <= actualCount; i++) {
        students.push({
          id: `STU${String(id++).padStart(3, '0')}`,
          name: `Student ${branch}-${division} ${i}`,
          branch,
          division
        });
      }
    }
  }
  return students;
}

// RUN THE SIMULATION SCENARIOS
function runSimulation() {
  console.log('====================================================');
  console.log('   DYNAMIC SEATING ALLOCATION SIMULATION RUNNER');
  console.log('====================================================');

  // Scenario 1: Normal filling, under capacity, no overflow triggered
  console.log('\n--- SCENARIO 1: NORMAL SEATING (Under Capacity, No Global Overflow) ---');
  let auditorium = new Auditorium();
  let students = generateStudents();
  // Filter students so total is about 300 (under capacity of 500)
  let normalStudents = students.filter((_, idx) => idx % 5 !== 0); // ~320 students

  // Shuffle arrivals to simulate random entry
  normalStudents.sort(() => Math.random() - 0.5);

  for (const s of normalStudents) {
    auditorium.allocate(s, false);
  }
  auditorium.printMap();
  console.log(`Total Occupancy: ${(auditorium.getOccupancyRate() * 100).toFixed(1)}%`);

  // Scenario 2: Zone fills before overflow trigger (CE-A overfilled)
  console.log('\n--- SCENARIO 2: ZONE OVERFILLS (Before Global Overflow Cutoff) ---');
  console.log('CE-A expected count is 40. We will scan 65 CE-A students.');
  auditorium = new Auditorium();
  
  // Get all CE-A students (65 total)
  const ceaStudents = students.filter(s => s.branch === 'CE' && s.division === 'A');
  const otherStudents = students.filter(s => !(s.branch === 'CE' && s.division === 'A')).slice(0, 150);
  
  // Merge and scan
  const mixedArrivals = [...ceaStudents, ...otherStudents].sort(() => Math.random() - 0.5);

  for (const s of mixedArrivals) {
    auditorium.allocate(s, false);
  }
  auditorium.printMap();
  
  // Count how many CE-A students ended up in overflow
  const ceaAllocations = Array.from(auditorium.allocations.values()).filter(seat => seat.zone === 'CE-A');
  const ceaNormal = ceaAllocations.filter(seat => seat.status === 'allocated').length;
  const ceaOverflow = ceaAllocations.filter(seat => seat.status === 'overflow').length;
  console.log(`CE-A Allocations: Normal: ${ceaNormal}, Overflow: ${ceaOverflow}`);
  console.log(`(Notice that overflow CE-A students are sitting in the nearest available seats, e.g., CE-B or EXTC-B)`);

  // Scenario 3: Global Overflow Cutoff Triggered (T-10min reached)
  console.log('\n--- SCENARIO 3: GLOBAL OVERFLOW CUTOFF TRIGGERED ---');
  console.log('We scan 200 students normally, then trigger global overflow, then scan remaining 200.');
  auditorium = new Auditorium();
  
  const allStudents = [...students].sort(() => Math.random() - 0.5);
  const firstBatch = allStudents.slice(0, 200);
  const secondBatch = allStudents.slice(200);

  // Scan first batch (normal allocation)
  for (const s of firstBatch) {
    auditorium.allocate(s, false);
  }

  // Trigger global overflow
  console.log('>> T-10 Minutes reached! Global overflow trigger activated.');
  
  // Scan second batch (overflow allowed)
  for (const s of secondBatch) {
    auditorium.allocate(s, true);
  }

  auditorium.printMap();
  const overflowTotal = Array.from(auditorium.allocations.values()).filter(seat => seat.status === 'overflow').length;
  console.log(`Total Occupancy: ${(auditorium.getOccupancyRate() * 100).toFixed(1)}%`);
  console.log(`Total Overflow Seats Allocated: ${overflowTotal}`);

  // Scenario 4: Auditorium 100% full (Waitlist)
  console.log('\n--- SCENARIO 4: AUDITORIUM 100% FULL (Waitlist Edge Case) ---');
  auditorium = new Auditorium();
  
  // Create 550 mock students (auditorium has 500 seats)
  const heavyStudents = [];
  for (let i = 1; i <= 550; i++) {
    const branches = ['CE', 'IT', 'EXTC', 'ME', 'EE'];
    const divs = ['A', 'B'];
    heavyStudents.push({
      id: `STU_H_${i}`,
      name: `Heavy Student ${i}`,
      branch: branches[i % 5],
      division: divs[i % 2]
    });
  }

  let waitlistCount = 0;
  let allocatedCount = 0;
  for (const s of heavyStudents) {
    const res = auditorium.allocate(s, true); // global overflow triggered to fill completely
    if (res.seat === null) {
      waitlistCount++;
    } else {
      allocatedCount++;
    }
  }

  auditorium.printMap();
  console.log(`Allocated: ${allocatedCount} students`);
  console.log(`Waitlisted (Auditorium Full): ${waitlistCount} students`);
}

runSimulation();
