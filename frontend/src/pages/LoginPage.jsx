import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GOOGLE_OAUTH_ENABLED = import.meta.env.VITE_ENABLE_GOOGLE_OAUTH === 'true';

function ShieldMark() {
  return (
    <div className="relative mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-brand/40 bg-brand/15 text-brand shadow-glow">
      <div className="absolute inset-0 rounded-2xl bg-brand/10 blur-xl" />
      <svg
        className="relative h-7 w-7"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 3 5 6v5c0 4.3 2.9 8.2 7 9.4 4.1-1.2 7-5.1 7-9.4V6l-7-3Z" />
        <path d="m9 12 2 2 4-5" />
      </svg>
    </div>
  );
}

function AlertMessage({ type = 'error', children }) {
  const styles =
    type === 'error'
      ? 'border-accent-red/30 bg-red-500/10 text-red-200'
      : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100';

  return (
    <div className={`rounded-xl border px-3.5 py-3 text-sm leading-relaxed shadow-sm ${styles}`}>
      {children}
    </div>
  );
}

function FieldError({ children }) {
  if (!children) return null;
  return <p className="mt-1.5 text-xs font-medium text-accent-red">{children}</p>;
}

function PasswordToggle({ visible, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={visible ? 'Hide password' : 'Show password'}
      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-text-muted transition-colors hover:text-brand focus:outline-none focus:ring-2 focus:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {visible ? (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 3l18 18" />
          <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
          <path d="M9.4 5.4A10.8 10.8 0 0 1 12 5c5 0 8.5 4.3 9.7 6a14.8 14.8 0 0 1-2.1 2.7" />
          <path d="M6.1 6.1A15.6 15.6 0 0 0 2.3 11c1.2 1.7 4.7 6 9.7 6a10.9 10.9 0 0 0 4-.8" />
        </svg>
      ) : (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2.3 12s3.5-6 9.7-6 9.7 6 9.7 6-3.5 6-9.7 6-9.7-6-9.7-6Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
    </button>
  );
}

function validateLogin(email, password) {
  const nextErrors = {};
  const trimmedEmail = email.trim();

  if (!trimmedEmail) {
    nextErrors.email = 'Email is required';
  } else if (!EMAIL_PATTERN.test(trimmedEmail)) {
    nextErrors.email = 'Invalid email format';
  }

  if (!password) {
    nextErrors.password = 'Password is required';
  } else if (password.length < 8) {
    nextErrors.password = 'Password must be at least 8 characters';
  }

  return nextErrors;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  async function handleLogin(e) {
    e.preventDefault();
    setError('');

    const nextErrors = validateLogin(email, password);
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      const msg = error.message.toLowerCase().includes('invalid login credentials')
        ? 'Invalid email or password. If you just registered, please confirm your email first.'
        : error.message;
      setError(msg);
      setLoading(false);
    } else {
      if (data.user?.user_metadata?.role === 'admin') {
        navigate('/admin/workers', { replace: true });
      } else {
        navigate('/dashboard', { replace: true });
      }
    }
  }

  async function handleGoogleLogin() {
    setError('');
    setGoogleLoading(true);

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/dashboard`,
        },
      });

      if (error) {
        console.error('Google sign-in failed:', error);
        setError('Google sign-in failed. Please try again or use email and password.');
        setGoogleLoading(false);
      }
    } catch (err) {
      console.error('Google sign-in failed:', err);
      setError('Google sign-in failed. Please try again or use email and password.');
      setGoogleLoading(false);
    }
  }

  const busy = loading || googleLoading;

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#07070a] px-4 py-10 sm:px-6">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_75%_45%_at_50%_-10%,rgba(0,229,255,0.18),transparent_62%)]" />
      <div className="pointer-events-none fixed inset-0 opacity-[0.16] [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:36px_36px]" />
      <div className="pointer-events-none fixed bottom-[-18rem] right-[-10rem] h-[32rem] w-[32rem] rounded-full bg-brand/10 blur-3xl" />

      <div className="animate-fade-in-up relative z-10 w-full max-w-md">
        <div className="rounded-3xl border border-cyan-400/25 bg-[#0f172a]/95 p-8 shadow-2xl shadow-cyan-500/10 md:p-10">
          <div className="mb-7 flex flex-col items-center text-center">
            <ShieldMark />
            <h1 className="text-2xl font-bold text-white sm:text-3xl">SafeSite AI</h1>
            <p className="mt-2 text-sm text-text-muted">
              Sign in to your safety monitoring dashboard
            </p>
          </div>

          {error && (
            <div className="mb-4">
              <AlertMessage>{error}</AlertMessage>
            </div>
          )}

          <form onSubmit={handleLogin} noValidate className="space-y-4">
            <div>
              <label htmlFor="login-email" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                placeholder="you@company.com"
                value={email}
                disabled={busy}
                aria-invalid={Boolean(fieldErrors.email)}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: '' }));
                }}
                className="w-full rounded-xl border border-border-soft bg-surface-2 px-3.5 py-3 text-sm text-text-base placeholder-text-muted transition-all duration-200 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 disabled:cursor-not-allowed disabled:opacity-70"
              />
              <FieldError>{fieldErrors.email}</FieldError>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="login-password" className="block text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Password
                </label>
              </div>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  value={password}
                  disabled={busy}
                  aria-invalid={Boolean(fieldErrors.password)}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: '' }));
                  }}
                  className="w-full rounded-xl border border-border-soft bg-surface-2 px-3.5 py-3 pr-11 text-sm text-text-base placeholder-text-muted transition-all duration-200 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 disabled:cursor-not-allowed disabled:opacity-70"
                />
                <PasswordToggle
                  visible={showPassword}
                  onClick={() => setShowPassword((value) => !value)}
                  disabled={busy}
                />
              </div>
              <FieldError>{fieldErrors.password}</FieldError>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="flex min-h-11 w-full items-center justify-center rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-[#041013] shadow-glow transition-all duration-200 hover:bg-brand-hover focus:outline-none focus:ring-2 focus:ring-brand/40 focus:ring-offset-2 focus:ring-offset-[#07070a] disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          {GOOGLE_OAUTH_ENABLED && (
            <>
              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-border-soft" />
                <span className="text-xs font-medium text-text-muted">or</span>
                <div className="h-px flex-1 bg-border-soft" />
              </div>

              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={busy}
                className="flex min-h-11 w-full items-center justify-center gap-3 rounded-xl border border-border-strong bg-white px-4 py-3 text-sm font-semibold text-gray-800 transition-all duration-200 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-brand/40 focus:ring-offset-2 focus:ring-offset-[#07070a] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {googleLoading ? (
                  <>
                    <svg className="h-4 w-4 animate-spin text-gray-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Redirecting...
                  </>
                ) : (
                  <>
                    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                    </svg>
                    Continue with Google
                  </>
                )}
              </button>
            </>
          )}

          <p className="mt-6 text-center text-sm text-text-muted">
            Don't have an account?{' '}
            <Link to="/register" className="font-semibold text-brand transition-colors hover:text-brand-hover hover:underline">
              Create account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
