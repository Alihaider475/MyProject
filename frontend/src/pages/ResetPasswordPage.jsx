import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PasswordInput from '../components/PasswordInput.jsx';
import { supabase } from '../services/supabase.js';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  // Supabase delivers a recovery session via the link's URL hash. Until that
  // session is present, submitting a new password would fail.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // The recovery link establishes a session and fires PASSWORD_RECOVERY.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) setReady(true);
    });
    // Also cover the case where the session is already restored on mount.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setDone(true);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface-0 flex items-center justify-center px-4">
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(245,158,11,0.10) 0%, transparent 65%)' }}
      />

      <div className="animate-fade-in-up relative z-10 w-full max-w-sm">
        <div className="bg-surface-1 border border-border-soft rounded-2xl p-8 shadow-2xl">
          {/* Header */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-12 h-12 rounded-xl bg-brand/20 border border-brand/40 flex items-center justify-center text-brand text-2xl mb-3">
              ⛨
            </div>
            <h1 className="text-xl font-bold text-text-base">Set a new password</h1>
            <p className="text-sm text-text-muted mt-1 text-center">
              {done ? 'Your password has been updated.' : 'Choose a new password for your account.'}
            </p>
          </div>

          {done ? (
            <div className="text-center">
              <p className="text-emerald-400 text-sm mb-6">
                Password updated successfully. You can now sign in with your new password.
              </p>
              <button
                onClick={() => navigate('/login', { replace: true })}
                className="w-full bg-brand hover:bg-brand-hover text-slate-900 font-semibold py-2.5 px-4 rounded-lg transition-colors text-sm"
              >
                Go to sign in
              </button>
            </div>
          ) : (
            <>
              {error && <p className="text-accent-red text-sm mb-4 text-center">{error}</p>}
              {!ready && !error && (
                <p className="text-text-muted text-xs mb-4 text-center">
                  Open this page from the reset link in your email. Waiting for the secure session…
                </p>
              )}

              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <PasswordInput
                  placeholder="New password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <PasswordInput
                  placeholder="Confirm new password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
                <button
                  type="submit"
                  disabled={loading || !ready}
                  className="w-full bg-brand hover:bg-brand-hover text-slate-900 font-semibold py-2.5 px-4 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed text-sm mt-1"
                >
                  {loading ? 'Updating…' : 'Update password'}
                </button>
              </form>

              <p className="text-center text-xs text-text-muted mt-6">
                <Link to="/login" className="text-brand hover:underline">
                  Back to sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
