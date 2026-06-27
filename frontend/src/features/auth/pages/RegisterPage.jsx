import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PasswordInput from '../../../components/ui/PasswordInput.jsx';
import { supabase } from '../../../services/supabase.js';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [needsConfirm, setNeedsConfirm] = useState(false);

  async function handleRegister(e) {
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

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { role: 'user' } },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else if (data.session) {
      navigate('/dashboard', { replace: true });
    } else {
      // Email confirmation required
      setNeedsConfirm(true);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#07070a] flex items-center justify-center px-4">
      <div
        className="fixed inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 80% 50% at 50% -10%, rgba(14,165,233,0.10) 0%, transparent 65%)' }}
      />

      <div className="animate-fade-in-up relative z-10 w-full max-w-sm">
        <div className="bg-surface-1 border border-border-soft rounded-2xl p-8 shadow-2xl">
          {/* Header */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-12 h-12 rounded-xl bg-brand/20 border border-brand/40 flex items-center justify-center text-brand text-2xl mb-3">
              ⛨
            </div>
            <h1 className="text-xl font-bold text-text-base">PPE Detection</h1>
            <p className="text-sm text-text-muted mt-1">Create an account</p>
          </div>

          {needsConfirm ? (
            <div className="text-center">
              <p className="text-green-400 text-sm mb-4">
                Account created! Check your email to confirm your address, then sign in.
              </p>
              <button
                onClick={() => navigate('/login', { replace: true })}
                className="w-full bg-brand hover:bg-brand/90 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm"
              >
                Go to Sign in
              </button>
            </div>
          ) : (
            <>
              {error && (
                <p className="text-accent-red text-sm mb-4 text-center">{error}</p>
              )}

              <form onSubmit={handleRegister} className="flex flex-col gap-3">
                <input
                  type="email"
                  placeholder="Email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full bg-surface-2 border border-border-soft rounded-lg px-3 py-2.5 text-sm text-text-base placeholder-text-muted focus:outline-none focus:border-brand/60 transition-colors"
                />
                <PasswordInput
                  placeholder="Password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
                <PasswordInput
                  placeholder="Confirm password"
                  required
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-brand hover:bg-brand/90 text-white font-medium py-2.5 px-4 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed text-sm mt-1"
                >
                  {loading ? 'Creating account…' : 'Register'}
                </button>
              </form>

              <p className="text-center text-xs text-text-muted mt-6">
                Already have an account?{' '}
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
