import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import HealthBadge from './HealthBadge.jsx';
import ThemeToggle from './ThemeToggle.jsx';

const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-purple-500',
  'bg-pink-500',
  'bg-green-500',
  'bg-yellow-500',
  'bg-red-500',
];

function getAvatarColor(email) {
  return AVATAR_COLORS[email.charCodeAt(0) % AVATAR_COLORS.length];
}

function getInitials(email) {
  const local = email.split('@')[0];
  return local.length === 1
    ? local.toUpperCase()
    : (local[0] + local[local.length - 1]).toUpperCase();
}

function AvatarDropdown({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onOutsideClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, []);

  const color = getAvatarColor(user.email);
  const initials = getInitials(user.email);

  return (
    <div ref={ref} className="relative">
      {/* Avatar button */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-10 h-10 rounded-full ${color} text-white font-bold text-sm flex items-center justify-center transition-all duration-200 hover:scale-110 hover:shadow-lg hover:shadow-black/30 cursor-pointer select-none`}
        aria-label="Account menu"
      >
        {initials}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="animate-slide-down absolute right-0 mt-2 z-50 w-56 max-sm:fixed max-sm:left-0 max-sm:right-0 max-sm:w-full max-sm:mx-0 max-sm:rounded-none sm:rounded-xl bg-surface-1 border border-border-soft shadow-2xl overflow-hidden">
          {/* Email */}
          <div className="px-4 py-3">
            <p className="text-xs text-text-muted truncate" title={user.email}>
              {user.email}
            </p>
          </div>

          <div className="h-px bg-border-soft mx-3" />

          {/* Menu items */}
          <div className="p-2 flex flex-col gap-0.5">
            <button
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-text-muted hover:text-text-base hover:bg-surface-2 transition-colors text-left"
              onClick={() => setOpen(false)}
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Settings
            </button>

            <button
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-text-muted hover:text-accent-red hover:bg-surface-2 transition-colors text-left"
              onClick={() => { setOpen(false); onLogout(); }}
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Navbar({ onReportOpen }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const drawerRef = useRef(null);

  const navCls = ({ isActive }) =>
    `text-sm px-4 py-2 rounded-lg transition-all duration-300 ${
      isActive
        ? 'bg-surface-1 text-brand font-semibold shadow-sm ring-1 ring-border-soft'
        : 'text-text-muted hover:text-text-base hover:bg-surface-1/50'
    }`;

  const mobileNavCls = ({ isActive }) =>
    `flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-all duration-200 ${
      isActive
        ? 'bg-brand/10 text-brand font-semibold'
        : 'text-text-muted hover:text-text-base hover:bg-surface-2'
    }`;

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  // Close drawer on ESC
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Prevent body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  return (
    <>
      <nav className="sticky top-0 z-40 flex items-center justify-between px-6 py-3 border-b border-border-soft bg-surface-1/80 backdrop-blur-xl shadow-sm transition-colors duration-300">
        <div className="flex items-center gap-8">
          <span className="font-bold text-lg flex items-center gap-3 tracking-wide">
            <div className="w-8 h-8 rounded-lg bg-brand/20 border border-brand/40 flex items-center justify-center text-brand">
              ⛨
            </div>
            PPE Detection
          </span>
          <div className="hidden md:flex items-center gap-1 bg-surface-2 p-1 rounded-xl border border-border-soft">
            <NavLink to="/dashboard" className={navCls} end>Dashboard</NavLink>
            <NavLink to="/violations" className={navCls}>Violations</NavLink>
            <NavLink to="/charts" className={navCls}>Charts</NavLink>
            <NavLink to="/detect" className={navCls}>Detect</NavLink>
            <NavLink to="/video" className={navCls}>Video</NavLink>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          <button
            className="btn-outline hidden sm:flex items-center gap-2 border-border-soft bg-surface-1 hover:border-brand/50 hover:text-brand transition-all shadow-sm"
            onClick={onReportOpen}
          >
            Report
          </button>
          <div className="hidden md:block h-6 w-px bg-border-strong" />
          <HealthBadge />
          {user && (
            <>
              <div className="hidden md:block h-6 w-px bg-border-strong" />
              <AvatarDropdown user={user} onLogout={handleLogout} />
            </>
          )}
          {/* Hamburger — mobile only */}
          <button
            className="md:hidden flex items-center justify-center w-10 h-10 rounded-lg border border-border-strong text-text-muted hover:text-text-base hover:bg-surface-2 transition-colors"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <line x1="2" y1="4.5" x2="16" y2="4.5"/>
              <line x1="2" y1="9" x2="16" y2="9"/>
              <line x1="2" y1="13.5" x2="16" y2="13.5"/>
            </svg>
          </button>
        </div>
      </nav>

      {/* Mobile drawer overlay */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-50 md:hidden"
          onClick={() => setMenuOpen(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

          {/* Drawer panel */}
          <div
            ref={drawerRef}
            className="absolute left-0 top-0 h-full w-72 bg-surface-1 border-r border-border-soft shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
            style={{ animation: 'slideInLeft 0.25s cubic-bezier(0.4,0,0.2,1)' }}
          >
            {/* Drawer header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-soft">
              <span className="font-bold text-base flex items-center gap-2.5 tracking-wide">
                <div className="w-7 h-7 rounded-lg bg-brand/20 border border-brand/40 flex items-center justify-center text-brand text-sm">
                  ⛨
                </div>
                PPE Detection
              </span>
              <button
                onClick={() => setMenuOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-base hover:bg-surface-2 transition-colors"
                aria-label="Close menu"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="2" y1="2" x2="14" y2="14"/>
                  <line x1="14" y1="2" x2="2" y2="14"/>
                </svg>
              </button>
            </div>

            {/* Nav links */}
            <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
              <NavLink to="/dashboard" className={mobileNavCls} end onClick={() => setMenuOpen(false)}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/>
                  <rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/>
                </svg>
                Dashboard
              </NavLink>
              <NavLink to="/violations" className={mobileNavCls} onClick={() => setMenuOpen(false)}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 1L15 14H1L8 1z"/><line x1="8" y1="6" x2="8" y2="9"/><circle cx="8" cy="11.5" r="0.5" fill="currentColor"/>
                </svg>
                Violations
              </NavLink>
              <NavLink to="/charts" className={mobileNavCls} onClick={() => setMenuOpen(false)}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="1,12 5,6 9,9 13,3"/><line x1="1" y1="15" x2="15" y2="15"/>
                </svg>
                Charts
              </NavLink>
              <NavLink to="/detect" className={mobileNavCls} onClick={() => setMenuOpen(false)}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="8" cy="8" r="3"/><path d="M1 1l4 4M15 1l-4 4M1 15l4-4M15 15l-4-4"/>
                </svg>
                Detect
              </NavLink>
              <NavLink to="/video" className={mobileNavCls} onClick={() => setMenuOpen(false)}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1" y="3" width="10" height="10" rx="1.5"/><path d="M11 6.5l4-2v7l-4-2V6.5z"/>
                </svg>
                Video
              </NavLink>

              <div className="pt-2">
                <button
                  className="w-full btn-outline flex items-center gap-2 justify-center"
                  onClick={() => { setMenuOpen(false); onReportOpen(); }}
                >
                  Report
                </button>
              </div>
            </nav>

            {/* Drawer footer — user info */}
            {user && (
              <div className="border-t border-border-soft px-4 py-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className={`w-9 h-9 rounded-full ${getAvatarColor(user.email)} text-white font-bold text-xs flex items-center justify-center flex-shrink-0`}>
                    {getInitials(user.email)}
                  </div>
                  <p className="text-xs text-text-muted truncate flex-1" title={user.email}>
                    {user.email}
                  </p>
                </div>
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-text-muted hover:text-accent-red hover:bg-surface-2 transition-colors"
                  onClick={() => { setMenuOpen(false); handleLogout(); }}
                >
                  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
