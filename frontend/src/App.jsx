import { useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import LandingPage from './pages/LandingPage.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ViolationsPage from './pages/ViolationsPage.jsx';
import ChartsPage from './pages/ChartsPage.jsx';
import DetectPage from './pages/DetectPage.jsx';
import VideoDetectPage from './pages/VideoDetectPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import ToastContainer from './components/ToastContainer.jsx';
import HealthBadge from './components/HealthBadge.jsx';
import ReportModal from './components/ReportModal.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import ThemeToggle from './components/ThemeToggle.jsx';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';

function ProtectedRoute() {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-surface-0 flex items-center justify-center text-text-muted text-sm">
        Loading…
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function AppLayout() {
  const [reportOpen, setReportOpen] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const navCls = ({ isActive }) =>
    `text-sm px-4 py-2 rounded-lg transition-all duration-300 ${
      isActive
        ? 'bg-surface-1 text-brand font-semibold shadow-sm ring-1 ring-border-soft'
        : 'text-text-muted hover:text-text-base hover:bg-surface-1/50'
    }`;

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
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
            <NavLink to="/dashboard" className={navCls} end>Dashboard</NavLink>
            <NavLink to="/violations" className={navCls}>Violations</NavLink>
            <NavLink to="/charts" className={navCls}>Charts</NavLink>
            <NavLink to="/detect" className={navCls}>Detect</NavLink>
            <NavLink to="/video" className={navCls}>🎬 Video</NavLink>
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
          <div className="h-6 w-px bg-border-strong mx-1" />
          <HealthBadge />
          {user && (
            <>
              <div className="h-6 w-px bg-border-strong mx-1" />
              <span className="text-xs text-text-muted hidden sm:block max-w-[140px] truncate" title={user.email}>
                {user.email}
              </span>
              <button
                onClick={handleLogout}
                className="text-sm px-3 py-1.5 rounded-lg border border-border-soft text-text-muted hover:text-accent-red hover:border-accent-red/40 transition-all"
              >
                Sign out
              </button>
            </>
          )}
        </div>
      </nav>

      <main className="px-4 py-4">
        <Outlet />
      </main>

      <ToastContainer />
      {reportOpen && <ReportModal onClose={() => setReportOpen(false)} />}
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route element={<ProtectedRoute />}>
                <Route element={<AppLayout />}>
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/violations" element={<ViolationsPage />} />
                  <Route path="/charts" element={<ChartsPage />} />
                  <Route path="/detect" element={<DetectPage />} />
                  <Route path="/video" element={<VideoDetectPage />} />
                </Route>
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
