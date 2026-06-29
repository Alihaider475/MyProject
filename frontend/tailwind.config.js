/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: 'rgb(var(--brand-rgb) / <alpha-value>)',
        'brand-hover': 'rgb(var(--brand-hover-rgb) / <alpha-value>)',
        'surface-0': 'rgb(var(--surface-0-rgb) / <alpha-value>)',
        'surface-1': 'rgb(var(--surface-1-rgb) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2-rgb) / <alpha-value>)',
        'surface-3': 'rgb(var(--surface-3-rgb) / <alpha-value>)',
        'border-soft': 'rgb(var(--border-soft-rgb) / <alpha-value>)',
        'border-strong': 'rgb(var(--border-strong-rgb) / <alpha-value>)',
        'text-base': 'rgb(var(--text-base-rgb) / <alpha-value>)',
        'text-muted': 'rgb(var(--text-muted-rgb) / <alpha-value>)',
        'text-subtle': 'rgb(var(--text-subtle-rgb) / <alpha-value>)',
        'accent-teal':   'rgb(var(--accent-teal-rgb) / <alpha-value>)',
        'accent-yellow': 'rgb(var(--accent-yellow-rgb) / <alpha-value>)',
        'accent-red':    'rgb(var(--accent-red-rgb) / <alpha-value>)',
        'accent-purple': 'rgb(var(--accent-purple-rgb) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        'glass':          'var(--shadow-sm)',
        'glow':           'none',
        'glow-teal':      'none',
        'glow-yellow':    'none',
        'glow-red':       'none',
        'glow-purple':    'none',
        'glow-brand':     'none',
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
        'flow-line': {
          '0%':   { transform: 'scaleX(0)', opacity: '0.2' },
          '30%':  { opacity: '1' },
          '100%': { transform: 'scaleX(1)', opacity: '1' },
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
        'flow-line':  'flow-line 1s cubic-bezier(0.4,0,0.2,1) forwards',
      },
    },
  },
  plugins: [],
};
