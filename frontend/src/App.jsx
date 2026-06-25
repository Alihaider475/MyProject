import React, { Suspense, useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from './context/ToastContext.jsx';
import ToastContainer from './components/ToastContainer.jsx';
import ReportModal from './components/ReportModal.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { AuthProvider, useAuth, ADMIN_HOME, USER_HOME, WORKER_HOME } from './context/AuthContext.jsx';
import Navbar from './components/Navbar.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { api } from './api/client.js';

const LandingPage = React.lazy(() => import('./features/landing/pages/LandingPage.jsx'));
const Dashboard = React.lazy(() => import('./pages/Dashboard.jsx'));
const CamerasPage = React.lazy(() => import('./features/cameras/pages/CamerasPage.jsx'));
const CCTVWallPage = React.lazy(() => import('./features/cameras/pages/CCTVWallPage.jsx'));
const ViolationsPage = React.lazy(() => import('./features/violations/pages/ViolationsPage.jsx'));
const ChartsPage = React.lazy(() => import('./features/charts/pages/ChartsPage.jsx'));
const DetectPage = React.lazy(() => import('./features/detection/pages/DetectPage.jsx'));
const VideoDetectPage = React.lazy(() => import('./features/detection/pages/VideoDetectPage.jsx'));
const WorkerDashboard = React.lazy(() => import('./features/workers/pages/WorkerDashboard.jsx'));
const FineConfigPage = React.lazy(() => import('./pages/FineConfigPage.jsx'));
const PayrollReport = React.lazy(() => import('./pages/PayrollReport.jsx'));
const WorkerRegistrationPage = React.lazy(() => import('./features/workers/pages/WorkerRegistrationPage.jsx'));
const TopOffendersPage = React.lazy(() => import('./features/workers/pages/TopOffendersPage.jsx'));
const SettingsPage = React.lazy(() => import('./pages/SettingsPage.jsx'));
const AlertLogsPage = React.lazy(() => import('./pages/AlertLogsPage.jsx'));
const AlertConfigPage = React.lazy(() => import('./pages/AlertConfigPage.jsx'));
const LoginPage = React.lazy(() => import('./pages/LoginPage.jsx'));
const RegisterPage = React.lazy(() => import('./pages/RegisterPage.jsx'));
const WorkerSelfDashboard = React.lazy(() => import('./features/workers/pages/self/WorkerSelfDashboard.jsx'));
const WorkerSetPasswordPage = React.lazy(() => import('./features/workers/pages/self/WorkerSetPasswordPage.jsx'));

function ProtectedRoute() {
  const { session, loading, isAdmin, isWorker } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-surface-0 flex items-center justify-center text-text-muted text-sm">
        Loading…
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  if (isAdmin) return <Navigate to={ADMIN_HOME} replace />;
  if (isWorker) return <Navigate to={WORKER_HOME} replace />;
  return <Outlet />;
}

function AdminProtectedRoute() {
  const { session, loading, isAdmin, isWorker } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-surface-0 flex items-center justify-center text-text-muted text-sm">
        Loading…
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to={isWorker ? WORKER_HOME : USER_HOME} replace />;
  return <Outlet />;
}

function WorkerProtectedRoute() {
  const { session, loading, isAdmin, isWorker } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-surface-0 flex items-center justify-center text-text-muted text-sm">
        Loading…
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  if (!isWorker) return <Navigate to={isAdmin ? ADMIN_HOME : USER_HOME} replace />;
  return <Outlet />;
}

function AuthCallback() {
  const { session, loading, isAdmin, isWorker } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-surface-0 flex items-center justify-center text-text-muted text-sm">
        Loading…
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace />;
  return <Navigate to={isAdmin ? ADMIN_HOME : isWorker ? WORKER_HOME : USER_HOME} replace />;
}

function ModelInitBanner() {
  const [status, setStatus] = useState('initializing');

  useEffect(() => {
    if (status === 'ready') return;
    const check = async () => {
      try {
        const data = await api.ready();
        setStatus(data.status);
      } catch {
        setStatus('initializing');
      }
    };
    check();
    const t = setInterval(check, 3000);
    return () => clearInterval(t);
  }, [status]);

  if (status === 'ready') return null;

  const isError = status === 'error';
  return (
    <div
      className={`w-full text-center text-xs py-1.5 px-4 font-medium ${
        isError
          ? 'bg-red-700/90 text-white'
          : 'bg-yellow-600/90 text-white'
      }`}
    >
      {isError
        ? 'Model failed to load — detection unavailable. Check server logs.'
        : 'Backend initializing — detection unavailable while model loads…'}
    </div>
  );
}

function AppLayout() {
  const [reportOpen, setReportOpen] = useState(false);

  return (
    <div className="min-h-screen bg-surface-0 text-text-base font-sans transition-colors duration-300">
      <ModelInitBanner />
      <Navbar onReportOpen={() => setReportOpen(true)} />

      <main className="px-4 py-4">
        <Outlet />
      </main>

      <ToastContainer />
      {reportOpen && <ReportModal onClose={() => setReportOpen(false)} />}
    </div>
  );
}

const ADMIN_TABS = [
  {
    to: '/admin/register-workers',
    label: 'Register',
    icon: (
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="5" r="2.8" />
        <path d="M1.2 14.5v-1A3.8 3.8 0 015 9.7h2a3.8 3.8 0 013.8 3.8v1" />
        <line x1="12.5" y1="3.5" x2="12.5" y2="7.5" />
        <line x1="10.5" y1="5.5" x2="14.5" y2="5.5" />
      </svg>
    ),
  },
  {
    to: '/admin/workers',
    label: 'Workers',
    icon: (
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="5.5" cy="5" r="2.5" />
        <path d="M1 14.5v-.8A3.3 3.3 0 014.3 10.4h2.4A3.3 3.3 0 0110 13.7v.8" />
        <circle cx="11.8" cy="5.8" r="1.8" />
        <path d="M10.7 9.9a2.8 2.8 0 013 2.8v1.8" />
      </svg>
    ),
  },
  {
    to: '/admin/fine-config',
    label: 'Fine Config',
    icon: (
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="8" r="6.3" />
        <path d="M10 6.1c-.3-.6-1-.9-1.9-.9-1.1 0-1.9.6-1.9 1.4 0 .9.8 1.2 1.9 1.4 1.2.3 2.1.6 2.1 1.6 0 .9-.9 1.5-2.1 1.5-.9 0-1.7-.4-2-1" />
        <line x1="8" y1="3.9" x2="8" y2="12.1" />
      </svg>
    ),
  },
  {
    to: '/admin/payroll',
    label: 'Payroll',
    icon: (
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="1.3" width="10" height="13.4" rx="1.4" />
        <line x1="5.5" y1="5" x2="10.5" y2="5" />
        <line x1="5.5" y1="8" x2="10.5" y2="8" />
        <line x1="5.5" y1="11" x2="8.5" y2="11" />
      </svg>
    ),
  },
  {
    to: '/admin/alert-config',
    label: 'Alert Config',
    icon: (
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="2" y1="4" x2="14" y2="4" />
        <line x1="2" y1="8" x2="14" y2="8" />
        <line x1="2" y1="12" x2="14" y2="12" />
        <circle cx="6" cy="4" r="1.3" fill="currentColor" stroke="none" />
        <circle cx="10" cy="8" r="1.3" fill="currentColor" stroke="none" />
        <circle cx="7" cy="12" r="1.3" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
];

const adminNavCls = ({ isActive }) =>
  `inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm whitespace-nowrap transition-all duration-200 ${
    isActive
      ? 'bg-brand/15 text-brand font-semibold shadow-[inset_0_-2px_0_0_var(--brand)]'
      : 'text-text-muted hover:text-text-base hover:bg-surface-1/60'
  }`;

function AdminLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-surface-0 text-text-base font-sans">
      <ModelInitBanner />
      {/* Admin top bar */}
      <div className="sticky top-0 z-40 flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-border-soft bg-surface-1/80 backdrop-blur-xl shadow-sm">
        {/* Brand */}
        <span className="shrink-0 font-bold text-base flex items-center gap-2.5 tracking-wide">
          <div className="w-7 h-7 rounded-lg bg-brand/20 border border-brand/40 flex items-center justify-center text-brand text-sm">
            ⛨
          </div>
          <span className="hidden sm:inline">Admin Panel</span>
        </span>

        {/* Tabs — centered on md+, horizontally scrollable without a visible scrollbar when cramped */}
        <nav className="flex-1 min-w-0 flex md:justify-center overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1 bg-surface-2 p-1 rounded-xl border border-border-soft shrink-0">
            {ADMIN_TABS.map(tab => (
              <NavLink key={tab.to} to={tab.to} className={adminNavCls}>
                {tab.icon}
                <span>{tab.label}</span>
              </NavLink>
            ))}
          </div>
        </nav>

        {/* Sign out */}
        <button
          type="button"
          onClick={handleLogout}
          className="shrink-0 inline-flex items-center gap-2 h-9 px-3.5 rounded-lg text-sm font-medium text-text-muted border border-border-soft bg-surface-1 hover:text-accent-red hover:border-accent-red/40 hover:bg-accent-red/5 transition-all duration-200"
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>

      <main className="px-4 py-4">
        <Outlet />
      </main>

      <ToastContainer />
    </div>
  );
}

function WorkerLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-surface-0 text-text-base font-sans">
      <ModelInitBanner />
      <div className="sticky top-0 z-40 flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-border-soft bg-surface-1/80 backdrop-blur-xl shadow-sm">
        <span className="shrink-0 font-bold text-base flex items-center gap-2.5 tracking-wide">
          <div className="w-7 h-7 rounded-lg bg-brand/20 border border-brand/40 flex items-center justify-center text-brand text-sm">
            ⛨
          </div>
          <span className="hidden sm:inline">My Dashboard</span>
        </span>

        <div className="flex-1" />

        <button
          type="button"
          onClick={handleLogout}
          className="shrink-0 inline-flex items-center gap-2 h-9 px-3.5 rounded-lg text-sm font-medium text-text-muted border border-border-soft bg-surface-1 hover:text-accent-red hover:border-accent-red/40 hover:bg-accent-red/5 transition-all duration-200"
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          <span className="hidden sm:inline">Sign out</span>
        </button>
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
      queryClient.invalidateQueries({ queryKey: ['alertLogs'] });
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
                    <Route path="/worker/set-password" element={<WorkerSetPasswordPage />} />

                    {/* Admin routes — require an authenticated admin (Supabase user_metadata.role === 'admin') */}
                    <Route path="/admin" element={<Navigate to={ADMIN_HOME} replace />} />
                    <Route element={<AdminProtectedRoute />}>
                      <Route element={<AdminLayout />}>
                        <Route path="/admin/register-workers" element={<WorkerRegistrationPage />} />
                        <Route path="/admin/workers" element={<WorkerDashboard />} />
                        <Route path="/admin/fine-config" element={<FineConfigPage />} />
                        <Route path="/admin/payroll" element={<PayrollReport />} />
                        <Route path="/admin/alert-config" element={<AlertConfigPage />} />
                      </Route>
                    </Route>

                    {/* Worker routes — require an authenticated worker (Supabase user_metadata.role === 'worker') */}
                    <Route element={<WorkerProtectedRoute />}>
                      <Route element={<WorkerLayout />}>
                        <Route path="/worker/dashboard" element={<WorkerSelfDashboard />} />
                      </Route>
                    </Route>

                    <Route element={<ProtectedRoute />}>
                      <Route element={<AppLayout />}>
                        <Route path="/dashboard" element={<Dashboard />} />
                        <Route path="/cameras" element={<CamerasPage />} />
                        <Route path="/cctv-wall" element={<CCTVWallPage />} />
                        <Route path="/violations" element={<ViolationsPage />} />
                        <Route path="/alert-logs" element={<AlertLogsPage />} />
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

