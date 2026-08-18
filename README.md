# SeatCode Seating and Attendance System

A seating allocation and attendance management system for events, featuring real-time seating updates via WebSockets (Socket.io), QR code student identification, and dynamic zone-based seating allocation with threshold-triggered overflow logic.

## Project Structure

```
seatCode/
├── frontend/             # React + Vite Frontend application
│   ├── src/              # React source files (components, App.jsx, App.css)
│   ├── package.json      # Frontend scripts and dependencies
│   └── vite.config.js    # Vite configuration
├── package.json          # Backend scripts and dependencies
├── server.js             # Express & Socket.io server
├── db.js                 # PostgreSQL connection pool using pg
├── schema.sql            # Database tables and constraints schema
├── seed.js               # Database initialization and mock data generator
├── allocation.js         # Core seat allocation logic
├── simulation.js         # CLI-based auditorium seating simulation script
└── .env                  # Configuration variables (port, db connection, JWT secret)
```

---

## Getting Started

### 1. Prerequisites
- **Node.js** (v16.x or higher recommended)
- **npm** (v7.x or higher)
- **PostgreSQL Database**: 
  - *Note:* The project is pre-configured with a hosted Neon PostgreSQL database in the `.env` file (`DATABASE_URL`). You do not need to install local PostgreSQL to run this, provided you have internet access.

---

### 2. Backend Setup & Running

From the **root directory** (`seatCode/`):

1. **Install Backend Dependencies:**
   ```bash
   npm install
   ```

2. **Seed the Database:**
   This command creates the required schema, inserts a 20x25 grid layout (500 seats), registers a default staff user, generates a convocations event, and seeds 400 mock students with signed QR tokens:
   ```bash
   npm run seed
   ```
   *Staff Credentials seeded:*
   - **Username:** `admin`
   - **Password:** `password123`

3. **Start the Backend Server (Development Mode):**
   Starts the Express server with file watching via `nodemon`:
   ```bash
   npm run dev
   ```
   The backend server runs at `http://localhost:5000`.

---

### 3. Frontend Setup & Running

From the **frontend directory** (`seatCode/frontend/`):

1. **Navigate to the frontend folder:**
   ```bash
   cd frontend
   ```

2. **Install Frontend Dependencies:**
   ```bash
   npm install
   ```

3. **Start the Vite Development Server:**
   ```bash
   npm run dev
   ```
   Open your browser and navigate to the printed URL (typically `http://localhost:5173`).

---

### 4. Running the Standalone Seating Simulation

To run the console-based dynamic zone allocation simulation that tests the seating grid boundaries, fill directions, and threshold-triggered overflow:

From the **root directory** (`seatCode/`):
```bash
npm run simulation
```
