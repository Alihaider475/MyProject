import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function PasswordToggle({ visible, onClick, disabled, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={visible ? `Hide ${label}` : `Show ${label}`}
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

function validateRegister(email, password, confirm) {
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

  if (password && password !== confirm) {
    nextErrors.confirm = 'Passwords do not match';
  }

  return nextErrors;
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [needsConfirm, setNeedsConfirm] = useState(false);

  async function handleRegister(e) {
    e.preventDefault();
    setError('');

    const nextErrors = validateRegister(email, password, confirm);
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { role: 'user' } },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else if (data.session) {
      navigate('/dashboard', { replace: true });
    } else {
      setNeedsConfirm(true);
      setLoading(false);
    }
  }

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
              Create your safety monitoring account
            </p>
          </div>

          {needsConfirm ? (
            <div className="space-y-4 text-center">
              <AlertMessage type="success">
                Account created. Check your email to confirm your address, then sign in.
              </AlertMessage>
              <button
                type="button"
                onClick={() => navigate('/login', { replace: true })}
                className="flex min-h-11 w-full items-center justify-center rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-[#041013] shadow-glow transition-all duration-200 hover:bg-brand-hover focus:outline-none focus:ring-2 focus:ring-brand/40 focus:ring-offset-2 focus:ring-offset-[#07070a]"
              >
                Go to Sign in
              </button>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4">
                  <AlertMessage>{error}</AlertMessage>
                </div>
              )}

              <form onSubmit={handleRegister} noValidate className="space-y-4">
                <div>
                  <label htmlFor="register-email" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
                    Email
                  </label>
                  <input
                    id="register-email"
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    disabled={loading}
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
                  <label htmlFor="register-password" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="register-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Create a password"
                      value={password}
                      disabled={loading}
                      aria-invalid={Boolean(fieldErrors.password)}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: '' }));
                        if (fieldErrors.confirm) setFieldErrors((prev) => ({ ...prev, confirm: '' }));
                      }}
                      className="w-full rounded-xl border border-border-soft bg-surface-2 px-3.5 py-3 pr-11 text-sm text-text-base placeholder-text-muted transition-all duration-200 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 disabled:cursor-not-allowed disabled:opacity-70"
                    />
                    <PasswordToggle
                      visible={showPassword}
                      onClick={() => setShowPassword((value) => !value)}
                      disabled={loading}
                      label="password"
                    />
                  </div>
                  <FieldError>{fieldErrors.password}</FieldError>
                </div>

                <div>
                  <label htmlFor="register-confirm" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <input
                      id="register-confirm"
                      type={showConfirm ? 'text' : 'password'}
                      placeholder="Repeat your password"
                      value={confirm}
                      disabled={loading}
                      aria-invalid={Boolean(fieldErrors.confirm)}
                      onChange={(e) => {
                        setConfirm(e.target.value);
                        if (fieldErrors.confirm) setFieldErrors((prev) => ({ ...prev, confirm: '' }));
                      }}
                      className="w-full rounded-xl border border-border-soft bg-surface-2 px-3.5 py-3 pr-11 text-sm text-text-base placeholder-text-muted transition-all duration-200 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 disabled:cursor-not-allowed disabled:opacity-70"
                    />
                    <PasswordToggle
                      visible={showConfirm}
                      onClick={() => setShowConfirm((value) => !value)}
                      disabled={loading}
                      label="password confirmation"
                    />
                  </div>
                  <FieldError>{fieldErrors.confirm}</FieldError>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="flex min-h-11 w-full items-center justify-center rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-[#041013] shadow-glow transition-all duration-200 hover:bg-brand-hover focus:outline-none focus:ring-2 focus:ring-brand/40 focus:ring-offset-2 focus:ring-offset-[#07070a] disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
                >
                  {loading ? 'Creating account...' : 'Create account'}
                </button>
              </form>

              <p className="mt-6 text-center text-sm text-text-muted">
                Already have an account?{' '}
                <Link to="/login" className="font-semibold text-brand transition-colors hover:text-brand-hover hover:underline">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
