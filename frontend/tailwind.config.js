/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: 'var(--brand)',
        'brand-hover': 'var(--brand-hover)',
        'surface-0': 'var(--surface-0)',
        'surface-1': 'var(--surface-1)',
        'surface-2': 'var(--surface-2)',
        'surface-3': 'var(--surface-3)',
        'border-soft': 'var(--border-soft)',
        'border-strong': 'var(--border-strong)',
        'text-base': 'var(--text-base)',
        'text-muted': 'var(--text-muted)',
        'text-subtle': 'var(--text-subtle)',
        'accent-teal':   'var(--accent-teal)',
        'accent-yellow': 'var(--accent-yellow)',
        'accent-red':    'var(--accent-red)',
        'accent-purple': 'var(--accent-purple)',
      },
      fontFamily: {
        sans: ['Outfit', 'Inter', 'sans-serif'],
        display: ['Space Grotesk', 'Outfit', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        'glass':          'var(--shadow-sm)',
        'glow':           '0 0 20px rgba(245, 158, 11, 0.22)',
        'glow-teal':      '0 0 24px rgba(13, 148, 136, 0.15)',
        'glow-yellow':    '0 0 24px rgba(245, 158, 11, 0.2)',
        'glow-red':       '0 0 24px rgba(220, 38, 38, 0.15)',
        'glow-purple':    '0 0 24px rgba(147, 51, 234, 0.15)',
        'glow-brand':     '0 0 24px rgba(245, 158, 11, 0.18)',
        'card-hover':     'var(--shadow-md)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'glass-gradient':  'linear-gradient(135deg, var(--glass-bg) 0%, var(--glass-bg) 100%)',
      },
      keyframes: {
        'count-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'rec-pulse': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%':      { opacity: '0.35', transform: 'scale(0.8)' },
        },
        'slide-down': {
          from: { opacity: '0', transform: 'translateY(-12px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        'fade-in-up': {
          '0%':   { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'scan-line': {
          '0%':   { top: '0%', opacity: '0' },
          '10%':  { opacity: '1' },
          '90%':  { opacity: '0.8' },
          '100%': { top: '100%', opacity: '0' },
        },
      },
      animation: {
        'count-up':   'count-up 0.5s cubic-bezier(0.4,0,0.2,1) backwards',
        'rec-pulse':  'rec-pulse 1.4s ease-in-out infinite',
        'slide-down': 'slide-down 0.3s cubic-bezier(0.4,0,0.2,1)',
        'fade-in':    'fade-in 0.4s ease',
        'fade-in-up': 'fade-in-up 0.6s ease both',
        shimmer:      'shimmer 1.4s linear infinite',
        'scan-line':  'scan-line 3s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
