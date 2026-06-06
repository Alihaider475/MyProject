import React, { Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Link, NavLink, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
const WorkerRegistrationPage = React.lazy(() => import('./pages/WorkerRegistrationPage.jsx'));
const TopOffendersPage = React.lazy(() => import('./pages/TopOffendersPage.jsx'));
const SettingsPage = React.lazy(() => import('./pages/SettingsPage.jsx'));
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

function AdminProtectedRoute() {
  const { session, loading, isAdmin } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-surface-0 flex items-center justify-center text-text-muted text-sm">
        Loading…
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

function AuthCallback() {
  const { session, loading, isAdmin } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-surface-0 flex items-center justify-center text-text-muted text-sm">
        Loading…
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  return <Navigate to={isAdmin ? '/admin/workers' : '/dashboard'} replace />;
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

const adminNavCls = ({ isActive }) =>
  `text-sm px-4 py-2 rounded-lg transition-all duration-200 ${
    isActive
      ? 'bg-brand/20 text-brand font-semibold'
      : 'text-text-muted hover:text-text-base hover:bg-surface-2'
  }`;

function AdminLayout() {
  function handleLogout() {
    sessionStorage.removeItem('admin_auth');
  }

  return (
    <div className="min-h-screen bg-surface-0 text-text-base font-sans">
      {/* Admin top bar */}
      <div className="sticky top-0 z-40 flex items-center justify-between px-6 py-3 border-b border-border-soft bg-surface-1/80 backdrop-blur-xl shadow-sm">
        <div className="flex items-center gap-6">
          <span className="font-bold text-base flex items-center gap-2.5 tracking-wide">
            <div className="w-7 h-7 rounded-lg bg-brand/20 border border-brand/40 flex items-center justify-center text-brand text-sm">
              ⛨
            </div>
            Admin Panel
          </span>
          <div className="flex items-center gap-1 bg-surface-2 p-1 rounded-xl border border-border-soft">
            <NavLink to="/admin/register-workers" className={adminNavCls}>Register</NavLink>
            <NavLink to="/admin/workers" className={adminNavCls}>Workers</NavLink>
            <NavLink to="/admin/fine-config" className={adminNavCls}>Fine Config</NavLink>
            <NavLink to="/admin/payroll" className={adminNavCls}>Payroll</NavLink>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/dashboard"
            className="text-sm text-text-muted hover:text-text-base transition-colors flex items-center gap-1.5"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 2L4 7l5 5"/>
            </svg>
            Dashboard
          </Link>
          <div className="h-4 w-px bg-border-strong" />
          <Link
            to="/login"
            onClick={handleLogout}
            className="text-sm text-text-muted hover:text-accent-red transition-colors"
          >
            Sign out
          </Link>
        </div>
      </div>

      <main className="px-4 py-4">
        <Outlet />
      </main>

      <ToastContainer />
    </div>
  );
}

const LOADING_FALLBACK = (
  <div className="min-h-screen bg-surface-0 flex items-center justify-center text-text-muted text-sm">
    Loading…
  </div>
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export default function App() {
  useEffect(() => {
    const onViolationSaved = () => {
      console.log('[WS] Invalidation triggered by violation_saved event');
      queryClient.invalidateQueries({ queryKey: ['dashboardSummary'] });
      queryClient.invalidateQueries({ queryKey: ['violations'] });
      queryClient.invalidateQueries({ queryKey: ['violationStats'] });
      queryClient.invalidateQueries({ queryKey: ['topOffenders'] });
      queryClient.invalidateQueries({ queryKey: ['fines'] });
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
    };
    window.addEventListener('ppe:violation_saved', onViolationSaved);
    return () => window.removeEventListener('ppe:violation_saved', onViolationSaved);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
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
                    <Route path="/auth/callback" element={<AuthCallback />} />

                    {/* Admin routes — independent of Supabase auth */}
                    <Route path="/admin" element={<Navigate to="/admin/workers" replace />} />
                    <Route element={<AdminProtectedRoute />}>
                      <Route element={<AdminLayout />}>
                        <Route path="/admin/register-workers" element={<WorkerRegistrationPage />} />
                        <Route path="/admin/workers" element={<WorkerDashboard />} />
                        <Route path="/admin/fine-config" element={<FineConfigPage />} />
                        <Route path="/admin/payroll" element={<PayrollReport />} />
                      </Route>
                    </Route>

                    <Route element={<ProtectedRoute />}>
                      <Route element={<AppLayout />}>
                        <Route path="/dashboard" element={<Dashboard />} />
                        <Route path="/violations" element={<ViolationsPage />} />
                        <Route path="/top-offenders" element={<TopOffendersPage />} />
                        <Route path="/charts" element={<ChartsPage />} />
                        <Route path="/detect" element={<DetectPage />} />
                        <Route path="/video" element={<VideoDetectPage />} />
                        <Route path="/settings" element={<SettingsPage />} />
                      </Route>
                    </Route>
                  </Routes>
                </Suspense>
              </BrowserRouter>
            </AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </QueryClientProvider>
  );
}

