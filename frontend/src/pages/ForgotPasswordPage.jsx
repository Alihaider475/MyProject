import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../services/supabase.js';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/reset-password',
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setSent(true);
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
            <h1 className="text-xl font-bold text-text-base">Reset your password</h1>
            <p className="text-sm text-text-muted mt-1 text-center">
              {sent
                ? 'Check your inbox for the reset link.'
                : 'Enter your email and we’ll send a reset link.'}
            </p>
          </div>

          {sent ? (
            <div className="text-center">
              <p className="text-emerald-400 text-sm mb-6">
                If an account exists for <span className="font-medium text-text-base">{email}</span>,
                a password reset link is on its way. The link opens a page where you can set a new password.
              </p>
              <Link
                to="/login"
                className="inline-block w-full bg-brand hover:bg-brand-hover text-slate-900 font-semibold py-2.5 px-4 rounded-lg transition-colors text-sm"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              {error && <p className="text-accent-red text-sm mb-4 text-center">{error}</p>}

              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <input
                  type="email"
                  placeholder="Email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-surface-2 border border-border-soft rounded-lg px-3 py-2.5 text-sm text-text-base placeholder-text-muted focus:outline-none focus:border-brand/60 transition-colors"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-brand hover:bg-brand-hover text-slate-900 font-semibold py-2.5 px-4 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed text-sm"
                >
                  {loading ? 'Sending link…' : 'Send reset link'}
                </button>
              </form>

              <p className="text-center text-xs text-text-muted mt-6">
                Remembered it?{' '}
                <Link to="/login" className="text-brand hover:underline">
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
