import React, { Suspense, useState } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { ToastProvider } from './context/ToastContext.jsx';
import ToastContainer from './components/ToastContainer.jsx';
import ReportModal from './components/ReportModal.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import Navbar from './components/Navbar.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

const LandingPage = React.lazy(() => import('./pages/LandingPage.jsx'));
const Dashboard = React.lazy(() => import('./pages/Dashboard.jsx'));
const ViolationsPage = React.lazy(() => import('./pages/ViolationsPage.jsx'));
const ChartsPage = React.lazy(() => import('./pages/ChartsPage.jsx'));
const DetectPage = React.lazy(() => import('./pages/DetectPage.jsx'));
const VideoDetectPage = React.lazy(() => import('./pages/VideoDetectPage.jsx'));
const WorkerDashboard = React.lazy(() => import('./pages/WorkerDashboard.jsx'));
const FineConfigPage = React.lazy(() => import('./pages/FineConfigPage.jsx'));
const PayrollReport = React.lazy(() => import('./pages/PayrollReport.jsx'));
const LoginPage = React.lazy(() => import('./pages/LoginPage.jsx'));
const RegisterPage = React.lazy(() => import('./pages/RegisterPage.jsx'));

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

const LOADING_FALLBACK = (
  <div className="min-h-screen bg-surface-0 flex items-center justify-center text-text-muted text-sm">
    Loading…
  </div>
);

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <BrowserRouter>
              <Suspense fallback={LOADING_FALLBACK}>
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
                      <Route path="/workers" element={<WorkerDashboard />} />
                      <Route path="/fine-config" element={<FineConfigPage />} />
                      <Route path="/payroll" element={<PayrollReport />} />
                    </Route>
                  </Route>
                </Routes>
              </Suspense>
            </BrowserRouter>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
