import { useState } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
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
import ReportModal from './components/ReportModal.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import Navbar from './components/Navbar.jsx';

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

  return (
    <div className="min-h-screen bg-surface-0 text-text-base font-sans transition-colors duration-300">
      <Navbar onReportOpen={() => setReportOpen(true)} />

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
