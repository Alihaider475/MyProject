import { useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import ViolationsPage from './pages/ViolationsPage.jsx';
import ChartsPage from './pages/ChartsPage.jsx';
import DetectPage from './pages/DetectPage.jsx';
import VideoDetectPage from './pages/VideoDetectPage.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import ToastContainer from './components/ToastContainer.jsx';
import HealthBadge from './components/HealthBadge.jsx';
import ReportModal from './components/ReportModal.jsx';

import { ThemeProvider } from './context/ThemeContext.jsx';
import ThemeToggle from './components/ThemeToggle.jsx';

export default function App() {
  const [reportOpen, setReportOpen] = useState(false);

  return (
    <ThemeProvider>
      <ToastProvider>
        <BrowserRouter>
          <div className="min-h-screen bg-surface-0 text-text-base font-sans transition-colors duration-300">
            {/* Navbar */}
            <nav className="sticky top-0 z-40 flex items-center justify-between px-6 py-3 border-b border-border-soft bg-surface-1/80 backdrop-blur-xl shadow-sm transition-colors duration-300">
              <div className="flex items-center gap-8">
                <span className="font-bold text-lg flex items-center gap-3 tracking-wide">
                  <div className="w-8 h-8 rounded-lg bg-brand/20 border border-brand/40 flex items-center justify-center text-brand">
                    ⛨
                  </div>
                  PPE Detection
                </span>
                <div className="hidden md:flex items-center gap-1 bg-surface-2 p-1 rounded-xl border border-border-soft">
                  <NavLink to="/" className={({ isActive }) => `text-sm px-4 py-2 rounded-lg transition-all duration-300 ${isActive ? 'bg-surface-1 text-brand font-semibold shadow-sm ring-1 ring-border-soft' : 'text-text-muted hover:text-text-base hover:bg-surface-1/50'}`} end>
                    Dashboard
                  </NavLink>
                  <NavLink to="/violations" className={({ isActive }) => `text-sm px-4 py-2 rounded-lg transition-all duration-300 ${isActive ? 'bg-surface-1 text-brand font-semibold shadow-sm ring-1 ring-border-soft' : 'text-text-muted hover:text-text-base hover:bg-surface-1/50'}`}>
                    Violations
                  </NavLink>
                  <NavLink to="/charts" className={({ isActive }) => `text-sm px-4 py-2 rounded-lg transition-all duration-300 ${isActive ? 'bg-surface-1 text-brand font-semibold shadow-sm ring-1 ring-border-soft' : 'text-text-muted hover:text-text-base hover:bg-surface-1/50'}`}>
                    Charts
                  </NavLink>
                  <NavLink to="/detect" className={({ isActive }) => `text-sm px-4 py-2 rounded-lg transition-all duration-300 ${isActive ? 'bg-surface-1 text-brand font-semibold shadow-sm ring-1 ring-border-soft' : 'text-text-muted hover:text-text-base hover:bg-surface-1/50'}`}>
                    Detect
                  </NavLink>
                  <NavLink to="/video" className={({ isActive }) => `text-sm px-4 py-2 rounded-lg transition-all duration-300 ${isActive ? 'bg-surface-1 text-brand font-semibold shadow-sm ring-1 ring-border-soft' : 'text-text-muted hover:text-text-base hover:bg-surface-1/50'}`}>
                    🎬 Video
                  </NavLink>
                </div>
              </div>
              
              <div className="flex items-center gap-4">
                <ThemeToggle />
                <button
                  className="btn-outline flex items-center gap-2 border-border-soft bg-surface-1 hover:border-brand/50 hover:text-brand transition-all shadow-sm"
                  onClick={() => setReportOpen(true)}
                >
                  Report
                </button>
                <div className="h-6 w-px bg-border-strong mx-1"></div>
                <HealthBadge />
              </div>
            </nav>

          <main className="px-4 py-4">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/violations" element={<ViolationsPage />} />
              <Route path="/charts" element={<ChartsPage />} />
              <Route path="/detect" element={<DetectPage />} />
              <Route path="/video" element={<VideoDetectPage />} />
            </Routes>
          </main>

          <ToastContainer />
          {reportOpen && <ReportModal onClose={() => setReportOpen(false)} />}
        </div>
      </BrowserRouter>
    </ToastProvider>
  </ThemeProvider>
);
}
