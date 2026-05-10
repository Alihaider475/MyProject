import { Link } from 'react-router-dom';

const FEATURES = [
  {
    icon: '⚡',
    title: 'Real-time Detection',
    desc: 'Processes live camera feeds frame-by-frame with YOLO for instant PPE compliance checks.',
  },
  {
    icon: '📷',
    title: 'Multi-Camera Support',
    desc: 'Monitor multiple construction zones simultaneously from a single unified dashboard.',
  },
  {
    icon: '🎯',
    title: 'High Accuracy',
    desc: 'Trained model detects hardhat, safety vest, and mask compliance with high confidence.',
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#07070a] text-white font-sans overflow-x-hidden">

      {/* Hero */}
      <section className="min-h-screen flex flex-col items-center justify-center text-center px-6 relative">
        {/* Ambient glow */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 90% 55% at 50% -5%, rgba(14,165,233,0.12) 0%, transparent 65%)' }}
        />

        {/* Hard-hat icon */}
        <div className="animate-fade-in-up mb-8 relative z-10" style={{ animationDelay: '0.1s' }}>
          <HardHatIcon />
        </div>

        <h1
          className="animate-fade-in-up relative z-10 text-4xl md:text-6xl font-bold tracking-tight mb-5 leading-tight"
          style={{ animationDelay: '0.25s' }}
        >
          AI-Powered{' '}
          <span className="text-[#0ea5e9]">PPE Detection</span>
          <br />System
        </h1>

        <p
          className="animate-fade-in-up relative z-10 text-slate-400 text-lg md:text-xl max-w-xl mb-10"
          style={{ animationDelay: '0.4s' }}
        >
          Real-time helmet, vest &amp; mask detection using YOLO — keeping construction sites safe.
        </p>

        <Link
          to="/dashboard"
          className="animate-fade-in-up relative z-10 inline-flex items-center gap-2 border border-[#0ea5e9] text-[#0ea5e9] font-semibold px-8 py-3 rounded-lg transition-all duration-200 hover:bg-[#0ea5e9] hover:text-[#07070a] hover:scale-105"
          style={{ animationDelay: '0.55s' }}
        >
          Enter Dashboard
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </Link>
      </section>

      {/* Features */}
      <section className="py-20 px-6">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="bg-white/5 border border-white/10 rounded-xl p-6 transition-all duration-200 hover:-translate-y-1 hover:border-[#0ea5e9]/40 cursor-default"
            >
              <div className="text-3xl mb-4">{f.icon}</div>
              <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
              <p className="text-slate-400 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 border-t border-white/10 text-center text-slate-500 text-sm">
        PPE Detection System &middot;{' '}
        <span className="inline-block bg-[#0ea5e9]/10 text-[#0ea5e9] border border-[#0ea5e9]/30 text-xs font-medium px-2 py-0.5 rounded-full ml-1">
          Final Year Project
        </span>
      </footer>

    </div>
  );
}

function HardHatIcon() {
  return (
    <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* shadow/glow under brim */}
      <ellipse cx="40" cy="56" rx="30" ry="5" fill="#0ea5e9" opacity="0.12" />
      {/* dome */}
      <path d="M16 46 C16 26 64 26 64 46" fill="#0ea5e9" />
      {/* brim */}
      <rect x="9" y="44" width="62" height="9" rx="4.5" fill="#0ea5e9" />
      {/* top nub */}
      <rect x="36" y="17" width="8" height="9" rx="2" fill="#0284c7" />
      {/* center ridge */}
      <rect x="37.5" y="25" width="5" height="20" rx="1" fill="#0284c7" opacity="0.35" />
    </svg>
  );
}
