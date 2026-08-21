# SeatCode Seating and Attendance System

A real-time seating allocation and attendance management system for events, featuring live seating updates via WebSockets (Socket.io), QR code student identification, and dynamic zone-based seating allocation with threshold-triggered overflow logic.

## Project Structure

```
seatCode/
├── frontend/             # React + Vite Frontend application
│   ├── src/              # React source files (components, App.jsx, App.css)
│   ├── package.json      # Frontend scripts and dependencies
│   ├── vite.config.js    # Vite configuration
│   └── .oxlintrc.json    # Oxlint configuration
├── package.json          # Backend & workspace scripts and dependencies
├── server.js             # Express & Socket.io server
├── db.js                 # PostgreSQL connection pool using pg
├── schema.sql            # Database tables and constraints schema
├── seed.js               # Database initialization and mock data generator
├── allocation.js         # Core seat allocation logic
├── allocation.test.js    # Jest test suite for allocation & overflow logic
├── simulation.js         # CLI-based auditorium seating simulation script
└── .env                  # Configuration variables (port, db connection, JWT secret)
```

---

## Getting Started

### 1. Prerequisites
- **Node.js** (v18.x or higher recommended)
- **npm** (v7.x or higher)
- **PostgreSQL Database**: 
  - *Note:* The project is pre-configured with a hosted Neon PostgreSQL database in the `.env` file (`DATABASE_URL`). You do not need to install local PostgreSQL to run this, provided you have internet access.

---

### 2. Installation & Setup

1. **Install Root/Backend Dependencies:**
   ```bash
   npm install
   ```

2. **Install Frontend Dependencies:**
   ```bash
   cd frontend
   npm install
   cd ..
   ```

3. **Seed the Database:**
   This command creates the required schema, inserts a 20x25 grid layout (500 seats), registers a default staff user, generates a convocation event, and seeds 400 mock students with signed QR tokens:
   ```bash
   npm run seed
   ```
   *Staff Credentials seeded:*
   - **Username:** `admin`
   - **Password:** `password123`

---

### 3. Running the Application

#### Option A: Run Full Stack Concurrently (Recommended)
From the **root directory** (`seatCode/`):
```bash
npm run dev
```
This starts both the backend (`nodemon server.js` on port `5000`) and the frontend Vite dev server (on `http://localhost:5173`) concurrently using `concurrently`.

#### Option B: Run Backend and Frontend Separately
- **Backend Only (from root directory):**
  ```bash
  npm start
  ```
  or with auto-reload:
  ```bash
  npx nodemon server.js
  ```
  Runs at `http://localhost:5000`.

- **Frontend Only (from `frontend/` directory):**
  ```bash
  cd frontend
  npm run dev
  ```
  Runs at `http://localhost:5173`.

---

### 4. Running the Test Suite

To run the Jest test suite covering seat allocation, idempotency on re-scans, and zone overflow assignments:

From the **root directory** (`seatCode/`):
```bash
npm test
```

---

### 5. Running the Standalone Seating Simulation

To run the console-based dynamic zone allocation simulation that tests seating grid boundaries, fill directions, and threshold-triggered overflow:

From the **root directory** (`seatCode/`):
```bash
npm run simulation
```
