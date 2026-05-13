import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
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
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/auth/callback' },
    });
    if (error) {
      setError(error.message);
      setGoogleLoading(false);
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
            <p className="text-sm text-text-muted mt-1">Sign in to continue</p>
          </div>

          {error && (
            <p className="text-accent-red text-sm mb-4 text-center">{error}</p>
          )}

          <form onSubmit={handleLogin} className="flex flex-col gap-3 mb-4">
            <input
              type="email"
              placeholder="Email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-surface-2 border border-border-soft rounded-lg px-3 py-2.5 text-sm text-text-base placeholder-text-muted focus:outline-none focus:border-brand/60 transition-colors"
            />
            <input
              type="password"
              placeholder="Password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-surface-2 border border-border-soft rounded-lg px-3 py-2.5 text-sm text-text-base placeholder-text-muted focus:outline-none focus:border-brand/60 transition-colors"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand hover:bg-brand/90 text-white font-medium py-2.5 px-4 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed text-sm"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-border-soft" />
            <span className="text-xs text-text-muted">or</span>
            <div className="flex-1 h-px bg-border-soft" />
          </div>

          {/* Google OAuth */}
          <button
            onClick={handleGoogleLogin}
            disabled={googleLoading}
            className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-50 text-gray-800 font-medium py-2.5 px-4 rounded-lg border border-gray-200 transition-colors disabled:opacity-60 disabled:cursor-not-allowed text-sm"
          >
            {googleLoading ? (
              <>
                <svg className="animate-spin w-4 h-4 text-gray-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Redirecting…
              </>
            ) : (
              <>
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </>
            )}
          </button>

          <p className="text-center text-xs text-text-muted mt-6">
            Don't have an account?{' '}
            <Link to="/register" className="text-brand hover:underline">
              Register
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
