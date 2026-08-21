// App.jsx
import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { 
  QrCode, Users, Layout, FileSpreadsheet, Shield, 
  CheckCircle, AlertTriangle, LogOut, Power, Search, 
  UserCheck, RefreshCw, Camera, AlertCircle, BarChart2, TrendingUp, Calendar, AlertOctagon
} from 'lucide-react';
import { 
  ResponsiveContainer, LineChart, Line, BarChart, Bar, 
  XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip, Legend, Cell
} from 'recharts';
import { Html5QrcodeScanner } from 'html5-qrcode';
import './App.css';

const BACKEND_URL = 'http://localhost:5000';

const getRowLabel = (rowNum) => {
  let label = '';
  let temp = rowNum;
  while (temp > 0) {
    let remainder = (temp - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    temp = Math.floor((temp - 1) / 26);
  }
  return label;
};

function App() {
  const [token, setToken] = useState(localStorage.getItem('staff_token') || '');
  const [username, setUsername] = useState(localStorage.getItem('staff_username') || '');
  const [activeTab, setActiveTab] = useState('dashboard');
  const [activeEvent, setActiveEvent] = useState(null);
  
  // Login form state
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');

  // Dashboard seating & stats state
  const [seats, setSeats] = useState([]);
  const [allocations, setAllocations] = useState({});
  const [globalOverflow, setGlobalOverflow] = useState(false);

  // Scanner state
  const [scanResult, setScanResult] = useState(null);
  const [scanError, setScanError] = useState('');
  const [manualTokenInput, setManualTokenInput] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const scannerRef = useRef(null);

  // Simulator state
  const [studentsList, setStudentsList] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [simSearch, setSimSearch] = useState('');

  // Reports state
  const [absenteesList, setAbsenteesList] = useState([]);
  const [reportSearch, setReportSearch] = useState('');

  // Analytics state
  const [eventsList, setEventsList] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [singleEventAnalytics, setSingleEventAnalytics] = useState(null);
  const [trendsData, setTrendsData] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState('');

  const fetchEventsList = async (activeId) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/events`);
      if (res.ok) {
        const data = await res.json();
        setEventsList(data);
        if (data.length > 0) {
          const defaultId = activeId || data[0].id.toString();
          setSelectedEventId(defaultId);
        }
      }
    } catch (err) {
      console.error('Error fetching events list:', err);
    }
  };

  const fetchSingleEventAnalytics = async (eventId) => {
    if (!eventId) return;
    setAnalyticsLoading(true);
    setAnalyticsError('');
    try {
      const res = await fetch(`${BACKEND_URL}/api/analytics/event/${eventId}`);
      if (res.ok) {
        const data = await res.json();
        setSingleEventAnalytics(data);
      } else {
        setAnalyticsError('Failed to fetch event analytics.');
      }
    } catch (err) {
      setAnalyticsError('Error connecting to analytics API.');
      console.error(err);
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const fetchTrendsAnalytics = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/analytics/trends`);
      if (res.ok) {
        const data = await res.json();
        setTrendsData(data);
      }
    } catch (err) {
      console.error('Error fetching trends:', err);
    }
  };

  const selectedEventIdRef = useRef('');
  const activeEventIdRef = useRef('');

  useEffect(() => {
    selectedEventIdRef.current = selectedEventId;
  }, [selectedEventId]);

  useEffect(() => {
    activeEventIdRef.current = activeEvent ? activeEvent.id.toString() : '';
  }, [activeEvent]);

  useEffect(() => {
    if (activeTab === 'analytics') {
      fetchTrendsAnalytics();
    }
  }, [activeTab]);

  // Global selector loads data dynamically for selectedEventId
  useEffect(() => {
    if (selectedEventId) {
      fetchSeatingData(selectedEventId);
      fetchAbsentees(selectedEventId);
      fetchStudentsForSimulator(selectedEventId);
      fetchSingleEventAnalytics(selectedEventId);
    }
  }, [selectedEventId]);

  // Load active event & event listings on mount
  useEffect(() => {
    const init = async () => {
      let activeId = '';
      try {
        const res = await fetch(`${BACKEND_URL}/api/events/active`);
        if (res.ok) {
          const data = await res.json();
          setActiveEvent(data);
          if (data) activeId = data.id.toString();
        }
      } catch (err) {
        console.error('Error fetching active event on mount:', err);
      }
      await fetchEventsList(activeId);
    };
    init();
  }, []);

  // Socket.io Real-time Setup
  useEffect(() => {
    const socket = io(BACKEND_URL);

    socket.on('connect', () => {
      console.log('Connected to real-time socket updates');
    });

    socket.on('seat_allocated', (data) => {
      console.log('Real-time seat allocated:', data);
    });

    socket.on('seat_updated', (data) => {
      // Update allocations map dynamically if we are currently viewing the active event
      if (selectedEventIdRef.current === activeEventIdRef.current) {
        setAllocations(prev => ({
          ...prev,
          [data.seatId]: {
            status: data.status,
            student: data.student
          }
        }));
      }

      // Update absentees list (remove student if present)
      setAbsenteesList(prev => prev.filter(s => s.id !== data.student.id));
    });

    socket.on('event_updated', (data) => {
      if (activeEvent && activeEvent.id === parseInt(data.eventId)) {
        setActiveEvent(prev => ({
          ...prev,
          overflow_cutoff_time: data.overflowCutoffTime
        }));
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [activeEvent]);

  // Audio Feedbacks (Synthesized chimes)
  const playBeep = (type) => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      if (type === 'success') {
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(600, audioCtx.currentTime); // High pitch
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.15);
        
        // Double beep for extra satisfaction
        setTimeout(() => {
          const osc2 = audioCtx.createOscillator();
          const gain2 = audioCtx.createGain();
          osc2.connect(gain2);
          gain2.connect(audioCtx.destination);
          osc2.type = 'sine';
          osc2.frequency.setValueAtTime(800, audioCtx.currentTime);
          gain2.gain.setValueAtTime(0.1, audioCtx.currentTime);
          osc2.start();
          osc2.stop(audioCtx.currentTime + 0.15);
        }, 120);
      } else {
        // Error buzzer
        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(150, audioCtx.currentTime); // Low pitch
        gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.4);
      }
    } catch (e) {
      console.warn('Audio Context failed to play sound:', e);
    }
  };

  const fetchActiveEvent = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/events/active`);
      if (res.ok) {
        const data = await res.json();
        setActiveEvent(data);
      }
    } catch (err) {
      console.error('Error fetching active event:', err);
    }
  };

  const fetchSeatingData = async (eventId) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/dashboard/seating/${eventId}`);
      if (res.ok) {
        const data = await res.json();
        setSeats(data.seats);
        setAllocations(data.allocations);
      }
    } catch (err) {
      console.error('Error fetching seating:', err);
    }
  };

  const fetchStudentsForSimulator = async (eventId) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/reports/absentees/${eventId}`);
      if (res.ok) {
        const data = await res.json();
        setStudentsList(data);
        if (data.length > 0) {
          setSelectedStudent(data[0]);
        }
      }
    } catch (err) {
      console.error('Error fetching students list:', err);
    }
  };

  const fetchAbsentees = async (eventId) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/reports/absentees/${eventId}`);
      if (res.ok) {
        const data = await res.json();
        setAbsenteesList(data);
      }
    } catch (err) {
      console.error('Error fetching absentees:', err);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUser, password: loginPass })
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem('staff_token', data.token);
        localStorage.setItem('staff_username', data.username);
        setToken(data.token);
        setUsername(data.username);
      } else {
        setLoginError(data.error || 'Login failed.');
      }
    } catch (err) {
      setLoginError('Could not connect to server.');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('staff_token');
    localStorage.removeItem('staff_username');
    setToken('');
    setUsername('');
    setActiveTab('dashboard');
  };

  // Trigger global overflow manually for simulation
  const toggleOverflowCutoff = async () => {
    if (!selectedEventId) return;
    const currentlyTriggered = isDashboardEventCutoffPassed();
    try {
      const res = await fetch(`${BACKEND_URL}/api/events/${selectedEventId}/toggle-overflow`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ triggerNow: !currentlyTriggered })
      });
      const data = await res.json();
      if (res.ok) {
        setEventsList(prev => prev.map(e => e.id.toString() === selectedEventId ? { ...e, overflow_cutoff_time: data.overflowCutoffTime } : e));
        if (activeEvent && activeEvent.id.toString() === selectedEventId) {
          setActiveEvent(prev => ({
            ...prev,
            overflow_cutoff_time: data.overflowCutoffTime
          }));
        }
      }
    } catch (err) {
      console.error('Failed to toggle cutoff:', err);
    }
  };

  const isDashboardEventCutoffPassed = () => {
    const selectedDashboardEvent = eventsList.find(e => e.id.toString() === selectedEventId);
    if (!selectedDashboardEvent) return false;
    return new Date() >= new Date(selectedDashboardEvent.overflow_cutoff_time);
  };

  // Call API to allocate seat
  const processScanToken = async (qrTokenStr) => {
    setScanError('');
    setScanResult(null);

    try {
      const res = await fetch(`${BACKEND_URL}/api/scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          qrToken: qrTokenStr,
          eventId: selectedEventId
        })
      });

      const data = await res.json();

      if (res.ok) {
        setScanResult(data);
        playBeep('success');
        // Refresh local listings
        fetchSeatingData(selectedEventId);
        fetchAbsentees(selectedEventId);
      } else {
        setScanError(data.error || 'Verification failed.');
        playBeep('error');
      }
    } catch (err) {
      setScanError('Connection to scan API failed.');
      playBeep('error');
    }
  };

  // Initialize camera scanner when entering scanner tab
  useEffect(() => {
    if (activeTab === 'scanner' && token && isScanning) {
      const html5QrcodeScanner = new Html5QrcodeScanner(
        "qr-reader-viewfinder", 
        { fps: 10, qrbox: { width: 250, height: 250 } },
        false
      );

      html5QrcodeScanner.render(
        (decodedText) => {
          processScanToken(decodedText);
          // Stop scanning to allow reviewing the result card
          html5QrcodeScanner.clear().catch(err => console.error(err));
          setIsScanning(false);
        }, 
        (error) => {
          // Silent log or throttle to prevent spamming console
        }
      );

      scannerRef.current = html5QrcodeScanner;
    }

    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(err => console.warn('Clean error:', err));
        scannerRef.current = null;
      }
    };
  }, [activeTab, isScanning, token]);

  const handleManualScanSubmit = (e) => {
    e.preventDefault();
    if (manualTokenInput.trim()) {
      processScanToken(manualTokenInput.trim());
      setManualTokenInput('');
    }
  };

  const handleDownloadCSV = () => {
    if (!selectedEventId) return;
    window.open(`${BACKEND_URL}/api/reports/csv/${selectedEventId}`);
  };

  // Grid Statistics calculations
  const totalSeats = seats.length || 500;
  const occupiedCount = Object.keys(allocations).length;
  const occupancyPercent = totalSeats > 0 ? ((occupiedCount / totalSeats) * 100).toFixed(1) : 0;
  
  const overflowAllocCount = Object.values(allocations).filter(a => a.status === 'overflow').length;

  // Branch fill rates
  const getBranchOccupied = (branch) => {
    return Object.values(allocations).filter(a => a.student && a.student.branch === branch).length;
  };

  // Format seat display (e.g. S_11_5 -> Row K Col 5)
  const formatSeatId = (id) => {
    if (!id) return '-';
    const parts = id.split('_');
    if (parts.length === 3) {
      return `Row ${getRowLabel(parseInt(parts[1], 10))} Col ${parts[2]}`;
    }
    return id;
  };

  return (
    <div className="app-container">
      <header className="glass-panel">
        <div className="logo-section">
          <h1><QrCode size={24} /> SEATCODE</h1>
          <p>Autonomous Event Seating & Attendance</p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(255, 255, 255, 0.03)', padding: '0.4rem 1rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>CURRENT EVENT:</span>
          <div className="select-container" style={{ position: 'relative' }}>
            <select
              className="search-input-box"
              style={{ paddingRight: '2rem', cursor: 'pointer', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid var(--border-color)', color: '#fff', borderRadius: '8px', padding: '0.4rem 2rem 0.4rem 0.75rem', fontSize: '0.85rem', fontWeight: 600 }}
              value={selectedEventId}
              onChange={(e) => setSelectedEventId(e.target.value)}
            >
              {eventsList.map(e => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="nav-tabs">
          <button 
            className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <Layout size={16} /> Dashboard
          </button>
          
          <button 
            className={`tab-btn ${activeTab === 'simulator' ? 'active' : ''}`}
            onClick={() => setActiveTab('simulator')}
          >
            <Users size={16} /> ID Card Simulator
          </button>

          <button 
            className={`tab-btn ${activeTab === 'scanner' ? 'active' : ''}`}
            onClick={() => {
              if (!token) setActiveTab('login');
              else setActiveTab('scanner');
            }}
          >
            <Camera size={16} /> Staff Scanner
          </button>

          <button 
            className={`tab-btn ${activeTab === 'absentees' ? 'active' : ''}`}
            onClick={() => setActiveTab('absentees')}
          >
            <FileSpreadsheet size={16} /> Absentees
          </button>

          <button 
            className={`tab-btn ${activeTab === 'analytics' ? 'active' : ''}`}
            onClick={() => setActiveTab('analytics')}
          >
            <BarChart2 size={16} /> Analytics
          </button>

          {token ? (
            <button className="tab-btn" onClick={handleLogout} style={{ color: '#f87171' }}>
              <LogOut size={16} /> Logout ({username})
            </button>
          ) : (
            <button 
              className={`tab-btn ${activeTab === 'login' ? 'active' : ''}`}
              onClick={() => setActiveTab('login')}
            >
              <Shield size={16} /> Staff Portal
            </button>
          )}
        </div>
      </header>

      <main>
        {/* Render Tabs */}
        {activeTab === 'login' && !token && (
          <div className="login-container glass-panel">
            <div className="login-header">
              <h2>Staff Authentication</h2>
              <p>Sign in on your scanner device to access scanner functions</p>
            </div>
            
            {loginError && <div className="error-banner">{loginError}</div>}
            
            <form onSubmit={handleLogin}>
              <div className="input-group">
                <label>USERNAME</label>
                <input 
                  type="text" 
                  value={loginUser} 
                  onChange={(e) => setLoginUser(e.target.value)} 
                  placeholder="Enter staff username"
                  required
                />
              </div>
              <div className="input-group">
                <label>PASSWORD</label>
                <input 
                  type="password" 
                  value={loginPass} 
                  onChange={(e) => setLoginPass(e.target.value)} 
                  placeholder="••••••••"
                  required
                />
              </div>
              <button type="submit" className="login-btn">Authenticate Device</button>
            </form>
          </div>
        )}

        {activeTab === 'dashboard' && selectedEventId && (
          <div>

            {/* Stats Overview */}
            <div className="stats-grid">
              <div className="stat-card glass-panel">
                <div className="stat-icon"><Users size={20} /></div>
                <div className="stat-info">
                  <h3>Total Scanned</h3>
                  <div className="stat-val">{occupiedCount} / {totalSeats}</div>
                </div>
              </div>

              <div className="stat-card glass-panel">
                <div className="stat-icon"><Layout size={20} /></div>
                <div className="stat-info">
                  <h3>Occupancy Rate</h3>
                  <div className="stat-val">{occupancyPercent}%</div>
                </div>
              </div>

              <div className="stat-card glass-panel">
                <div className="stat-icon" style={{ color: 'var(--color-overflow)' }}><AlertTriangle size={20} /></div>
                <div className="stat-info">
                  <h3>Overflow Scans</h3>
                  <div className="stat-val">{overflowAllocCount}</div>
                </div>
              </div>

              <div className="stat-card glass-panel">
                <div className="stat-icon" style={{ color: isDashboardEventCutoffPassed() ? 'var(--color-overflow)' : 'var(--text-secondary)' }}><Power size={20} /></div>
                <div className="stat-info">
                  <h3>Overflow Cutoff</h3>
                  <div className="stat-val" style={{ fontSize: '0.9rem' }}>
                    {isDashboardEventCutoffPassed() ? 'T-10m Cutoff Passed' : 'Active (Cutoff in future)'}
                  </div>
                </div>
              </div>
            </div>

            {/* Dashboard grid layout */}
            <div className="dashboard-layout">
              {/* Seating Grid */}
              <div className="seating-panel glass-panel">
                <div className="panel-header">
                  <div className="panel-title"><Layout size={18} /> Auditorium Grid View</div>
                </div>

                <div className="grid-container">
                  <div className="auditorium-stage">STAGE</div>
                  <div className="seating-grid">
                    {/* Header Columns */}
                    <div className="grid-label"></div>
                    {Array.from({ length: 25 }, (_, i) => {
                      const colNum = i + 1;
                      return (
                        <React.Fragment key={`col-hdr-${i}`}>
                          <div className="grid-label column-header">
                            {String(colNum).padStart(2, '0')}
                          </div>
                          {colNum === 5 && <div className="grid-aisle-vertical-header"></div>}
                          {colNum === 20 && <div className="grid-aisle-vertical-header"></div>}
                        </React.Fragment>
                      );
                    })}

                    {/* Seating Layout Rows */}
                    {Array.from({ length: 20 }, (_, rIndex) => {
                      const rowNum = rIndex + 1;
                      return (
                        <React.Fragment key={`row-${rowNum}`}>
                          {/* Row side label */}
                          <div className="grid-label">{getRowLabel(rowNum)}</div>
                          {Array.from({ length: 25 }, (_, cIndex) => {
                            const colNum = cIndex + 1;
                            const seatId = `S_${rowNum}_${colNum}`;
                            const allocation = allocations[seatId];
                            
                            let seatClass = '';
                            if (allocation) {
                              if (allocation.status === 'overflow') {
                                seatClass = 'occupied seat-overflow';
                              } else {
                                seatClass = `occupied branch-${allocation.student.branch.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
                              }
                            }

                            const tooltipClass = `tooltip ${rowNum <= 4 ? 'pos-down' : ''} ${colNum <= 4 ? 'pos-left' : colNum >= 22 ? 'pos-right' : ''}`;

                            return (
                              <React.Fragment key={seatId}>
                                <div 
                                  className={`seat ${seatClass}`}
                                  style={{ color: allocation?.status === 'overflow' ? 'var(--color-overflow)' : `var(--color-${allocation?.student.branch.toLowerCase().replace(/[^a-z0-9]/g, '')})` }}
                                >
                                  {allocation && (
                                    <div className={tooltipClass}>
                                      <div className="tooltip-title">{allocation.student.name}</div>
                                      <div className="tooltip-row">
                                        <span>Roll No:</span>
                                        <span className="tooltip-val">{allocation.student.rollNo}</span>
                                      </div>
                                      <div className="tooltip-row">
                                        <span>Branch:</span>
                                        <span className="tooltip-val">{allocation.student.branch}{allocation.student.division ? `-${allocation.student.division}` : ''}</span>
                                      </div>
                                      <div className="tooltip-row">
                                        <span>Seat:</span>
                                        <span className="tooltip-val">{formatSeatId(seatId)}</span>
                                      </div>
                                      <div className="tooltip-row">
                                        <span>Status:</span>
                                        <span className="tooltip-val" style={{ color: allocation.status === 'overflow' ? 'var(--color-overflow)' : 'var(--color-it)' }}>
                                          {allocation.status.toUpperCase()}
                                        </span>
                                      </div>
                                    </div>
                                  )}
                                </div>
                                {colNum === 5 && <div className="grid-aisle-vertical"></div>}
                                {colNum === 20 && <div className="grid-aisle-vertical"></div>}
                              </React.Fragment>
                            );
                          })}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Sidebar */}
              <div className="sidebar-panel">
                <div className="side-block glass-panel">
                  <h3>Legend</h3>
                  <div className="legend-grid">
                    <div className="legend-item">
                      <div className="legend-dot" style={{ backgroundColor: 'var(--color-comps)' }}></div>
                      <span>COMPS</span>
                    </div>
                    <div className="legend-item">
                      <div className="legend-dot" style={{ backgroundColor: 'var(--color-it)' }}></div>
                      <span>IT</span>
                    </div>
                    <div className="legend-item">
                      <div className="legend-dot" style={{ backgroundColor: 'var(--color-aiml)' }}></div>
                      <span>AIML</span>
                    </div>
                    <div className="legend-item">
                      <div className="legend-dot" style={{ backgroundColor: 'var(--color-aids)' }}></div>
                      <span>AIDS</span>
                    </div>
                    <div className="legend-item">
                      <div className="legend-dot" style={{ backgroundColor: 'var(--color-cse)' }}></div>
                      <span>CS&E</span>
                    </div>
                    <div className="legend-item">
                      <div className="legend-dot" style={{ backgroundColor: 'var(--color-mech)' }}></div>
                      <span>MECH</span>
                    </div>
                    <div className="legend-item">
                      <div className="legend-dot" style={{ backgroundColor: 'var(--color-civil)' }}></div>
                      <span>CIVIL</span>
                    </div>
                    <div className="legend-item">
                      <div className="legend-dot" style={{ backgroundColor: 'var(--color-extc)' }}></div>
                      <span>EXTC</span>
                    </div>
                    <div className="legend-item">
                      <div className="legend-dot" style={{ backgroundColor: 'var(--color-overflow)' }}></div>
                      <span>Overflow</span>
                    </div>
                    <div className="legend-item">
                      <div className="legend-dot" style={{ backgroundColor: '#1e293b' }}></div>
                      <span>Empty</span>
                    </div>
                  </div>
                </div>

                <div className="side-block glass-panel">
                  <h3>Branch Stats</h3>
                  <div className="branch-list">
                    {[
                      { name: 'COMPS', capacity: 210 },
                      { name: 'IT', capacity: 210 },
                      { name: 'AIML', capacity: 70 },
                      { name: 'AIDS', capacity: 70 },
                      { name: 'CS&E', capacity: 70 },
                      { name: 'MECH', capacity: 70 },
                      { name: 'CIVIL', capacity: 70 },
                      { name: 'EXTC', capacity: 70 }
                    ].map(br => {
                      const count = getBranchOccupied(br.name);
                      const pct = br.capacity > 0 ? ((count / br.capacity) * 100).toFixed(0) : 0;
                      const colorVar = `var(--color-${br.name.toLowerCase().replace(/[^a-z0-9]/g, '')})`;

                      return (
                        <div key={br.name} className="branch-progress-item">
                          <div className="branch-progress-label">
                            <span>{br.name}</span>
                            <span>{count} / {br.capacity} ({pct}%)</span>
                          </div>
                          <div className="progress-track">
                            <div 
                              className="progress-bar" 
                              style={{ width: `${Math.min(100, (count/br.capacity)*100)}%`, backgroundColor: colorVar }}
                            ></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {token && (
                  <div className="side-block glass-panel">
                    <h3>Simulation Controls</h3>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                      Force trigger T-10 overflow to test dynamic fallback seating:
                    </p>
                    <button 
                      className={`toggle-btn ${isDashboardEventCutoffPassed() ? 'active' : ''}`}
                      onClick={toggleOverflowCutoff}
                    >
                      <Power size={14} /> 
                      {isDashboardEventCutoffPassed() ? 'Cutoff Cutoff EARLY (ACTIVE)' : 'Trigger Cutoff Cutoff NOW'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'simulator' && selectedEventId && (
          <div className="simulator-layout">
            {/* Student list sidebar */}
            <div className="student-selector-panel glass-panel">
              <h3>Select Student Card</h3>
              <input 
                type="text" 
                className="student-search-input"
                placeholder="Search name or roll no..."
                value={simSearch}
                onChange={(e) => setSimSearch(e.target.value)}
              />

              <div className="student-list-scrollable">
                {studentsList
                  .filter(s => 
                    s.name.toLowerCase().includes(simSearch.toLowerCase()) || 
                    s.roll_no.toLowerCase().includes(simSearch.toLowerCase())
                  )
                  .map(s => (
                    <div 
                      key={s.id} 
                      className={`student-list-item ${selectedStudent?.id === s.id ? 'selected' : ''}`}
                      onClick={() => setSelectedStudent(s)}
                    >
                      <div className="student-list-item-name">{s.name}</div>
                      <div className="student-list-item-sub">{s.roll_no} • {s.branch}{s.division ? `-${s.division}` : ''}</div>
                    </div>
                  ))
                }
              </div>
            </div>

            {/* Visual ID Card rendering */}
            <div className="id-card-display glass-panel">
              {selectedStudent ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
                  <div className="id-card-visual">
                    <div className="card-header">
                      <h4>Universal College ID</h4>
                      <p>Student Identity Card</p>
                    </div>

                    <img 
                      src={selectedStudent.photo_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${selectedStudent.roll_no}`} 
                      className="card-avatar"
                      alt={selectedStudent.name}
                    />

                    <div className="card-details">
                      <div className="card-name">{selectedStudent.name}</div>
                      <div className="card-roll">{selectedStudent.roll_no}</div>
                       <div className="card-branch-tag" style={{ color: `var(--color-${selectedStudent.branch.toLowerCase().replace(/[^a-z0-9]/g, '')})`, borderColor: `var(--color-${selectedStudent.branch.toLowerCase().replace(/[^a-z0-9]/g, '')})` }}>
                         {selectedStudent.branch} {selectedStudent.division ? `- DIV ${selectedStudent.division}` : ''}
                       </div>
                    </div>

                    {/* QR Code Container */}
                    <div className="card-qr-box">
                      <img 
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=130x130&data=${encodeURIComponent(selectedStudent.qr_token)}`} 
                        alt="QR Code Token"
                      />
                    </div>

                    <div className="card-footer-msg">Scan QR to Assign Seating</div>
                  </div>

                  <button 
                    className="toggle-btn"
                    style={{ padding: '0.5rem 1rem', width: 'auto', background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', borderColor: 'rgba(59, 130, 246, 0.3)' }}
                    onClick={(e) => {
                      navigator.clipboard.writeText(selectedStudent.qr_token || '');
                      // Show temporary visual feedback
                      const btn = e.currentTarget;
                      const origText = btn.innerText;
                      btn.innerText = 'Token Copied!';
                      setTimeout(() => { btn.innerText = origText; }, 1500);
                    }}
                  >
                    Copy Signed QR Token (For Staff Scanner Fallback)
                  </button>

                  <div style={{ textAlign: 'center', maxWidth: '360px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    <p style={{ marginBottom: '0.4rem' }}>
                      <strong>Demo instructions:</strong> 
                    </p>
                    <ol style={{ paddingLeft: '1rem', textAlign: 'left' }}>
                      <li style={{ marginBottom: '0.2rem' }}>Login to the <strong>Staff Scanner</strong> tab on a phone or scan this screen directly.</li>
                      <li>Scan the QR code printed above.</li>
                      <li>The system will atomically book their seat and register attendance.</li>
                    </ol>
                  </div>
                </div>
              ) : (
                <div className="viewfinder-mock">
                  <UserCheck size={48} />
                  <p>Select a student from the panel to generate ID Card QR.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'scanner' && token && selectedEventId && (
          <div className="scanner-layout">
            <div className="scanner-box glass-panel">
              <div className="panel-header" style={{ width: '100%' }}>
                <div className="panel-title"><Camera size={18} /> Staff Seating Terminal</div>
                {!isScanning && (
                  <button className="toggle-btn" style={{ width: 'auto', padding: '0.4rem 1rem' }} onClick={() => setIsScanning(true)}>
                    Start Camera Scan
                  </button>
                )}
              </div>

              {isScanning ? (
                <div className="scanner-viewfinder" id="qr-reader-viewfinder">
                  <div className="scan-laser"></div>
                </div>
              ) : (
                <div className="scanner-viewfinder">
                  <div className="viewfinder-mock">
                    <QrCode size={48} style={{ color: 'var(--text-secondary)' }} />
                    <p>Camera Scanner Off</p>
                    <button className="login-btn" style={{ width: 'auto', padding: '0.5rem 1.5rem' }} onClick={() => setIsScanning(true)}>
                      Enable Camera
                    </button>
                  </div>
                </div>
              )}

              {/* Fallback code entry */}
              <form onSubmit={handleManualScanSubmit} className="scanner-fallback-form">
                <input 
                  type="text" 
                  placeholder="Paste signed student QR token..."
                  value={manualTokenInput}
                  onChange={(e) => setManualTokenInput(e.target.value)}
                />
                <button type="submit">Verify Token</button>
              </form>

              {scanError && (
                <div className="error-banner" style={{ marginTop: '1.25rem', width: '100%', maxWidth: '450px' }}>
                  <AlertCircle size={14} style={{ display: 'inline', marginRight: '0.25rem', verticalAlign: 'middle' }} />
                  {scanError}
                </div>
              )}
            </div>

            {/* Visual Cross-check screen */}
            <div className="result-card glass-panel success-glow">
              {scanResult ? (
                <div>
                  <div className="profile-avatar-wrapper">
                    <img 
                      src={scanResult.student.photo_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${scanResult.student.roll_no}`} 
                      className="profile-photo"
                      alt={scanResult.student.name}
                    />
                    <div className={`profile-status-badge ${scanResult.seat.status}`}>
                      {scanResult.seat.status}
                    </div>
                  </div>

                  <div className="student-info-name">{scanResult.student.name}</div>
                  <div className="student-info-roll">{scanResult.student.roll_no}</div>

                  <div className="badge-row">
                    <span className="info-badge">{scanResult.student.branch}</span>
                    <span className="info-badge">DIV {scanResult.student.division}</span>
                    <span className="info-badge">{scanResult.student.year} Year</span>
                  </div>

                  <div className="seat-assignment-box">
                    <div className="seat-label-text">ASSIGNED SEATING</div>
                    <div className="assigned-seat-val">{formatSeatId(scanResult.seat.seatId)}</div>
                  </div>

                  <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>
                    <CheckCircle size={12} /> Visual Photo Cross-Check Completed
                  </div>
                </div>
              ) : (
                <div className="viewfinder-mock">
                  <UserCheck size={48} style={{ color: 'var(--text-secondary)' }} />
                  <h3>Visual Verification Screen</h3>
                  <p style={{ maxWidth: '280px', fontSize: '0.75rem' }}>
                    Once a student's card is scanned, their database photo will appear here for staff verification.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'absentees' && selectedEventId && (
          <div className="reports-layout glass-panel" style={{ padding: '1.5rem' }}>
            <div className="reports-actions-row">
              <div className="panel-title"><FileSpreadsheet size={18} /> Student Seating & Attendance Roster</div>
              
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <input 
                  type="text" 
                  className="search-input-box"
                  placeholder="Search name, roll, branch..."
                  value={reportSearch}
                  onChange={(e) => setReportSearch(e.target.value)}
                />
                
                <button className="csv-btn" onClick={handleDownloadCSV}>
                  <FileSpreadsheet size={16} /> Export CSV Roster
                </button>
              </div>
            </div>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Roll No</th>
                    <th>Full Name</th>
                    <th>Branch</th>
                    <th>Div</th>
                    <th>Seating Location</th>
                    <th>Attendance Status</th>
                  </tr>
                </thead>
                <tbody>
                  {studentsList
                    .filter(s => 
                      s.name.toLowerCase().includes(reportSearch.toLowerCase()) || 
                      s.roll_no.toLowerCase().includes(reportSearch.toLowerCase()) ||
                      s.branch.toLowerCase().includes(reportSearch.toLowerCase())
                    )
                    .map(s => {
                      // Find if student is allocated a seat
                      // Match by looking in allocations values
                      const seatEntry = Object.entries(allocations).find(
                        ([_, alloc]) => alloc.student && alloc.student.id === s.id
                      );

                      const isPresent = !!seatEntry;
                      const seatLabel = isPresent ? formatSeatId(seatEntry[0]) : '-';
                      const statusVal = isPresent ? seatEntry[1].status : 'absent';

                      return (
                        <tr key={s.id}>
                          <td style={{ fontWeight: 600 }}>{s.roll_no}</td>
                          <td>{s.name}</td>
                          <td>{s.branch}</td>
                          <td>{s.division}</td>
                          <td>{seatLabel}</td>
                          <td>
                            <span className={`status-cell-badge ${statusVal === 'allocated' ? 'present' : statusVal}`}>
                              {statusVal === 'allocated' ? 'Present' : statusVal.toUpperCase()}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  }
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="analytics-layout">
            {/* Event Selector */}
            <div className="analytics-selector-panel glass-panel" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#fff' }}>
                    <BarChart2 size={20} style={{ color: 'var(--primary)' }} /> Seating & Attendance Analytics
                  </h2>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Review scan efficiency, zone fill rates, and historical attendance trends</p>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <label htmlFor="event-selector" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>SELECT EVENT</label>
                  <div className="select-container" style={{ position: 'relative' }}>
                    <select
                      id="event-selector"
                      className="search-input-box"
                      style={{ paddingRight: '2rem', cursor: 'pointer', background: 'rgba(15, 23, 42, 0.6)', border: '1px solid var(--border-color)', color: '#fff', borderRadius: '8px', padding: '0.5rem 2rem 0.5rem 1rem' }}
                      value={selectedEventId}
                      onChange={(e) => setSelectedEventId(e.target.value)}
                    >
                      {eventsList.map(e => (
                        <option key={e.id} value={e.id}>
                          {e.name} ({new Date(e.date).toLocaleDateString()})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {analyticsError && <div className="error-banner" style={{ marginBottom: '1.5rem' }}>{analyticsError}</div>}

            {analyticsLoading ? (
              <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                <RefreshCw className="animate-spin" size={32} style={{ margin: '0 auto 1rem auto' }} />
                <p>Loading analytics data...</p>
              </div>
            ) : (
              singleEventAnalytics && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  
                  {/* Single Event Stats Cards */}
                  <div className="stats-grid">
                    <div className="stat-card glass-panel">
                      <div className="stat-icon" style={{ color: 'var(--primary)' }}><Users size={20} /></div>
                      <div className="stat-info">
                        <h3>Total Scanned</h3>
                        <div className="stat-val">{singleEventAnalytics.total_allocations}</div>
                        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Scanned attendees</p>
                      </div>
                    </div>

                    <div className="stat-card glass-panel">
                      <div className="stat-icon" style={{ color: 'var(--color-overflow)' }}><AlertTriangle size={20} /></div>
                      <div className="stat-info">
                        <h3>Overflow Rate</h3>
                        <div className="stat-val">{singleEventAnalytics.overflow_rate}%</div>
                        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Of total scans</p>
                      </div>
                    </div>

                    <div className="stat-card glass-panel">
                      <div className="stat-icon" style={{ color: '#f87171' }}><AlertOctagon size={20} /></div>
                      <div className="stat-info">
                        <h3>Total No-Shows</h3>
                        <div className="stat-val">
                          {singleEventAnalytics.fill_by_zone.reduce((sum, item) => sum + item.noShows, 0)}
                        </div>
                        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Expected but absent</p>
                      </div>
                    </div>
                  </div>

                  {/* Single Event Visualizations */}
                  <div className="dashboard-layout" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: '1.5rem' }}>
                    
                    {/* Attendance Timeline LineChart */}
                    <div className="seating-panel glass-panel" style={{ padding: '1.25rem 1.5rem' }}>
                      <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#fff', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <TrendingUp size={16} style={{ color: 'var(--primary)' }} /> Attendance Progress (Cumulative)
                      </h3>
                      {singleEventAnalytics.attendance_timeline.length === 0 ? (
                        <div style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                          No scan timeline data recorded.
                        </div>
                      ) : (
                        <div style={{ width: '100%', height: '300px' }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={singleEventAnalytics.attendance_timeline} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                              <XAxis dataKey="time" stroke="var(--text-secondary)" fontSize={11} />
                              <YAxis stroke="var(--text-secondary)" fontSize={11} />
                              <ChartTooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid var(--border-color)', color: '#fff', borderRadius: '8px' }} />
                              <Line type="monotone" dataKey="count" name="Cumulative Scans" stroke="var(--primary)" strokeWidth={2.5} activeDot={{ r: 6 }} dot={{ r: 3 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>

                    {/* Zone Fill Rate BarChart */}
                    <div className="seating-panel glass-panel" style={{ padding: '1.25rem 1.5rem' }}>
                      <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#fff', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Layout size={16} style={{ color: 'var(--color-it)' }} /> Zone Occupancy Fill Rate (%)
                      </h3>
                      <div style={{ width: '100%', height: '300px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={singleEventAnalytics.fill_by_zone} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis dataKey="name" stroke="var(--text-secondary)" fontSize={10} />
                            <YAxis stroke="var(--text-secondary)" fontSize={11} domain={[0, 100]} />
                            <ChartTooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid var(--border-color)', color: '#fff', borderRadius: '8px' }} />
                            <Bar dataKey="fillPercent" name="Fill Rate %" radius={[4, 4, 0, 0]}>
                              {singleEventAnalytics.fill_by_zone.map((entry, index) => {
                                const branchColor = `var(--color-${entry.branch.toLowerCase().replace(/[^a-z0-9]/g, '')})`;
                                return <Cell key={`cell-${index}`} fill={branchColor} />;
                              })}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>

                  {/* Section Divider */}
                  <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '1rem 0' }} />

                  {/* Cross-Event Trends */}
                  <div>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#fff', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <TrendingUp size={20} style={{ color: 'var(--color-aiml)' }} /> Cross-Event Trends
                    </h2>

                    {eventsList.length < 2 ? (
                      <div className="trends-no-data glass-panel" style={{ padding: '3rem 2rem', textAlign: 'center', border: '1px dashed var(--border-color)' }}>
                        <AlertCircle size={40} style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }} />
                        <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#fff', marginBottom: '0.5rem' }}>Not enough events yet for trend analysis</h3>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: '400px', margin: '0 auto' }}>
                          At least 2 events are required in the database to run historical comparisons.
                        </p>
                      </div>
                    ) : (
                      trendsData && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                          
                          {/* Trends Charts Grid */}
                          <div className="dashboard-layout" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: '1.5rem' }}>
                            
                            {/* Attendance Rate Trend */}
                            <div className="seating-panel glass-panel" style={{ padding: '1.25rem 1.5rem' }}>
                              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#fff', marginBottom: '1.25rem' }}>
                                Average Attendance Rate over Time (%)
                              </h3>
                              <div style={{ width: '100%', height: '280px' }}>
                                <ResponsiveContainer width="100%" height="100%">
                                  <LineChart data={trendsData.trends} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                    <XAxis dataKey="eventName" stroke="var(--text-secondary)" fontSize={9} tickFormatter={(name) => name.replace(' Ceremony', '').replace(' Festival', '').replace(' Convocation', '')} />
                                    <YAxis stroke="var(--text-secondary)" fontSize={11} domain={[0, 100]} />
                                    <ChartTooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid var(--border-color)', color: '#fff', borderRadius: '8px' }} />
                                    <Line type="monotone" dataKey="attendanceRate" name="Attendance %" stroke="var(--color-it)" strokeWidth={2.5} activeDot={{ r: 6 }} />
                                  </LineChart>
                                </ResponsiveContainer>
                              </div>
                            </div>

                            {/* Seating Speed Trend */}
                            <div className="seating-panel glass-panel" style={{ padding: '1.25rem 1.5rem' }}>
                              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#fff', marginBottom: '1.25rem' }}>
                                Seating Speed: Time-to-90% Seated (minutes)
                              </h3>
                              <div style={{ width: '100%', height: '280px' }}>
                                <ResponsiveContainer width="100%" height="100%">
                                  <LineChart data={trendsData.trends} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                    <XAxis dataKey="eventName" stroke="var(--text-secondary)" fontSize={9} tickFormatter={(name) => name.replace(' Ceremony', '').replace(' Festival', '').replace(' Convocation', '')} />
                                    <YAxis stroke="var(--text-secondary)" fontSize={11} />
                                    <ChartTooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid var(--border-color)', color: '#fff', borderRadius: '8px' }} />
                                    <Line type="monotone" dataKey="timeTo90Percent" name="Minutes" stroke="var(--color-extc)" strokeWidth={2.5} activeDot={{ r: 6 }} connectNulls />
                                  </LineChart>
                                </ResponsiveContainer>
                              </div>
                            </div>

                            {/* Overflow Rate Trend */}
                            <div className="seating-panel glass-panel" style={{ padding: '1.25rem 1.5rem' }}>
                              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#fff', marginBottom: '1.25rem' }}>
                                Overflow Rate Trend (%)
                              </h3>
                              <div style={{ width: '100%', height: '280px' }}>
                                <ResponsiveContainer width="100%" height="100%">
                                  <LineChart data={trendsData.trends} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                    <XAxis dataKey="eventName" stroke="var(--text-secondary)" fontSize={9} tickFormatter={(name) => name.replace(' Ceremony', '').replace(' Festival', '').replace(' Convocation', '')} />
                                    <YAxis stroke="var(--text-secondary)" fontSize={11} />
                                    <ChartTooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid var(--border-color)', color: '#fff', borderRadius: '8px' }} />
                                    <Line type="monotone" dataKey="overflowRate" name="Overflow %" stroke="var(--color-overflow)" strokeWidth={2.5} activeDot={{ r: 6 }} />
                                  </LineChart>
                                </ResponsiveContainer>
                              </div>
                            </div>

                            {/* Reporting Accuracy per Branch */}
                            <div className="seating-panel glass-panel" style={{ padding: '1.25rem 1.5rem' }}>
                              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#fff', marginBottom: '1.25rem' }}>
                                Average Attendance vs Expected Capacity per Branch (%)
                              </h3>
                              <div style={{ width: '100%', height: '280px' }}>
                                <ResponsiveContainer width="100%" height="100%">
                                  <BarChart data={trendsData.under_over_reporting} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                    <XAxis dataKey="branch" stroke="var(--text-secondary)" fontSize={11} />
                                    <YAxis stroke="var(--text-secondary)" fontSize={11} />
                                    <ChartTooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid var(--border-color)', color: '#fff', borderRadius: '8px' }} />
                                    <Bar dataKey="avgRatioPercent" name="Avg Attendance %" radius={[4, 4, 0, 0]}>
                                      {trendsData.under_over_reporting.map((entry, index) => {
                                        let fill = 'var(--primary)';
                                        if (entry.status === 'under-reporting') fill = '#f87171'; // Red
                                        else if (entry.status === 'over-reporting') fill = '#fbbf24'; // Amber
                                        return <Cell key={`cell-${index}`} fill={fill} />;
                                      })}
                                    </Bar>
                                  </BarChart>
                                </ResponsiveContainer>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '0.5rem', fontSize: '0.7rem' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#f87171' }}>
                                  <span style={{ display: 'inline-block', width: '8px', height: '8px', backgroundColor: '#f87171', borderRadius: '50%' }}></span> Under-reporting (&lt;80%)
                                </span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#fbbf24' }}>
                                  <span style={{ display: 'inline-block', width: '8px', height: '8px', backgroundColor: '#fbbf24', borderRadius: '50%' }}></span> Over-reporting (&gt;100%)
                                </span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--primary)' }}>
                                  <span style={{ display: 'inline-block', width: '8px', height: '8px', backgroundColor: 'var(--primary)', borderRadius: '50%' }}></span> Normal (80% - 100%)
                                </span>
                              </div>
                            </div>

                          </div>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
