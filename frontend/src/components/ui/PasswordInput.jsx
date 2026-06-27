import { useState } from 'react';

const baseInputClass =
  'w-full bg-surface-2 border border-border-soft rounded-lg px-3 py-2.5 pr-10 text-sm text-text-base placeholder-text-muted focus:outline-none focus:border-brand/60 transition-colors';

function EyeIcon() {
  return (
    <svg
      className="w-5 h-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      className="w-5 h-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6A2 2 0 0012 14a2 2 0 001.4-.6" />
      <path d="M9.9 4.4A9.3 9.3 0 0112 4c6.5 0 10 8 10 8a18.2 18.2 0 01-3.2 4.4" />
      <path d="M6.2 6.2A18 18 0 002 12s3.5 8 10 8a9.5 9.5 0 004.1-.9" />
    </svg>
  );
}

export default function PasswordInput({ className = baseInputClass, ...props }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative w-full">
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        className={className}
      />
      <button
        type="button"
        aria-label={visible ? 'Hide password' : 'Show password'}
        onClick={() => setVisible(current => !current)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-brand focus:outline-none focus:text-brand transition-colors"
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}
