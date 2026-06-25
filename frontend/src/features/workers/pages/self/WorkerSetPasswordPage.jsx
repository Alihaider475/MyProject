import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PasswordInput from '../../../../components/ui/PasswordInput.jsx';
import { supabase } from '../../../../services/supabase.js';
import { useAuth, WORKER_HOME } from '../../../../context/AuthContext.jsx';

export default function WorkerSetPasswordPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

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
    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setSubmitting(false);
      return;
    }
    navigate(WORKER_HOME, { replace: true });
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-0 flex items-center justify-center text-text-muted text-sm">
        Loading…
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-[#07070a] flex items-center justify-center px-4">
        <div className="w-full max-w-sm bg-surface-1 border border-border-soft rounded-2xl p-8 shadow-2xl text-center">
          <p className="text-sm font-semibold text-text-base mb-2">Link expired</p>
          <p className="text-xs text-text-muted">
            This invite link is invalid or has expired. Contact your administrator for a new one.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#07070a] flex items-center justify-center px-4">
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(14,165,233,0.10) 0%, transparent 65%)' }}
      />
      <div className="animate-fade-in-up relative z-10 w-full max-w-sm">
        <div className="bg-surface-1 border border-border-soft rounded-2xl p-8 shadow-2xl">
          <div className="flex flex-col items-center mb-8">
            <div className="w-12 h-12 rounded-xl bg-brand/20 border border-brand/40 flex items-center justify-center text-brand text-2xl mb-3">
              ⛨
            </div>
            <h1 className="text-xl font-bold text-text-base">Welcome to SafeSite AI</h1>
            <p className="text-sm text-text-muted mt-1">Set your password to access your dashboard</p>
          </div>

          {error && <p className="text-accent-red text-sm mb-4 text-center">{error}</p>}

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <PasswordInput
              placeholder="New password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <PasswordInput
              placeholder="Confirm password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-brand hover:bg-brand/90 text-white font-medium py-2.5 px-4 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed text-sm mt-1"
            >
              {submitting ? 'Saving…' : 'Set Password & Continue'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
