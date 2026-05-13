import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

export default function AdminLoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  function handleLogin(e) {
    e.preventDefault();
    setError('');
    const validUser = import.meta.env.VITE_ADMIN_USERNAME;
    const validPass = import.meta.env.VITE_ADMIN_PASSWORD;
    if (username === validUser && password === validPass) {
      sessionStorage.setItem('admin_auth', 'true');
      navigate('/admin/workers', { replace: true });
    } else {
      setError('Invalid username or password.');
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
            <h1 className="text-xl font-bold text-text-base">Admin Panel</h1>
            <p className="text-sm text-text-muted mt-1">Safety Manager Access</p>
          </div>

          {error && (
            <p className="text-accent-red text-sm mb-4 text-center">{error}</p>
          )}

          <form onSubmit={handleLogin} className="flex flex-col gap-3">
            <input
              type="text"
              placeholder="Username"
              required
              value={username}
              onChange={e => setUsername(e.target.value)}
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
              className="w-full bg-brand hover:bg-brand/90 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm"
            >
              Login
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link to="/dashboard" className="text-xs text-text-muted hover:text-text-base transition-colors">
              ← Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
