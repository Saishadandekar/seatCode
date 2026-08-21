# SeatCode Frontend

React 19 + Vite frontend application for the SeatCode Seating and Attendance System.

## Features
- **Live Seating Grid**: Visual interactive 20x25 auditorium grid with real-time seat assignment updates over WebSockets (`socket.io-client`).
- **QR Code Scanner**: Integrated camera scanner (`html5-qrcode`) for fast attendee verification and seat check-in.
- **Analytics & Dashboard**: Occupancy and zone metrics visualized with `recharts`.
- **Staff Authentication**: Secure login and JWT-based session management.

## Scripts

From the `frontend` folder:

- `npm run dev`: Starts the local Vite dev server (defaults to `http://localhost:5173`).
- `npm run build`: Bundles the application for production into `dist/`.
- `npm run preview`: Previews the production build locally.
- `npm run lint`: Runs `oxlint` for fast code linting.
