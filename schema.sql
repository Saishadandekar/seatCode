-- schema.sql
-- Database schema for Seating and Attendance system

-- Drop tables if they exist
DROP TABLE IF EXISTS allocations CASCADE;
DROP TABLE IF EXISTS zones CASCADE;
DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS auditorium_layout CASCADE;
DROP TABLE IF EXISTS students CASCADE;
DROP TABLE IF EXISTS staff_users CASCADE;

-- 1. Students Table
CREATE TABLE students (
    id SERIAL PRIMARY KEY,
    roll_no VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    branch VARCHAR(20) NOT NULL,
    division VARCHAR(10) NOT NULL,
    year VARCHAR(10) NOT NULL,
    qr_token TEXT UNIQUE NOT NULL,
    photo_url VARCHAR(255)
);

-- 2. Auditorium Layout Table
CREATE TABLE auditorium_layout (
    seat_id VARCHAR(20) PRIMARY KEY, -- e.g., "S_1_1" for Row 1 Col 1
    row_num INT NOT NULL,
    col_num INT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    CONSTRAINT unique_row_col UNIQUE(row_num, col_num)
);

-- 3. Events Table
CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    date TIMESTAMP WITH TIME ZONE NOT NULL,
    layout_id VARCHAR(50) DEFAULT 'standard',
    overflow_cutoff_time TIMESTAMP WITH TIME ZONE NOT NULL,
    overflow_fill_threshold DECIMAL(3,2) DEFAULT 0.8
);

-- 4. Zones Table
CREATE TABLE zones (
    id SERIAL PRIMARY KEY,
    event_id INT REFERENCES events(id) ON DELETE CASCADE,
    branch VARCHAR(20) NOT NULL,
    division VARCHAR(10) NOT NULL,
    anchor_seat_id VARCHAR(20) REFERENCES auditorium_layout(seat_id) ON DELETE CASCADE,
    fill_direction VARCHAR(20) NOT NULL DEFAULT 'RIGHT_DOWN',
    expected_count INT NOT NULL,
    width INT NOT NULL DEFAULT 5,
    height INT NOT NULL DEFAULT 10,
    CONSTRAINT unique_event_zone UNIQUE(event_id, branch, division)
);

-- 5. Allocations Table (stores results of scans)
CREATE TABLE allocations (
    id SERIAL PRIMARY KEY,
    event_id INT REFERENCES events(id) ON DELETE CASCADE,
    student_id INT REFERENCES students(id) ON DELETE CASCADE,
    seat_id VARCHAR(20) REFERENCES auditorium_layout(seat_id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('allocated', 'overflow')),
    scanned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_student_event UNIQUE(event_id, student_id),
    CONSTRAINT unique_seat_event UNIQUE(event_id, seat_id)
);

-- 6. Staff Users Table (for staff authenticated devices)
CREATE TABLE staff_users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL
);
