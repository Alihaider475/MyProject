import { Link } from 'react-router-dom';

/* ────────────────────────────────────────────────────────────────────────────
   SafeSite AI — Landing / start page (public route "/")
   Dark, always-on amber design language matching the dashboard's design system
   (see frontend/src/styles/index.css → --brand #F59E0B, accent-teal, accent-red).
──────────────────────────────────────────────────────────────────────────── */

const FEATURES = [
  {
    title: 'Real-Time PPE Detection',
    desc: 'Detect missing helmets, vests, and masks from live camera feeds.',
    icon: (
      <path d="M12 2l8 4v6c0 5-3.4 8.5-8 10-4.6-1.5-8-5-8-10V6l8-4z" />
    ),
  },
  {
    title: 'Multi-Camera Monitoring',
    desc: 'Track multiple site zones from one unified dashboard.',
    icon: (
      <>
        <rect x="2.5" y="6" width="13" height="9" rx="2" />
        <path d="M15.5 9.5l5-2.5v8l-5-2.5z" />
      </>
    ),
  },
  {
    title: 'Automated Violation Logging',
    desc: 'Record violation type, camera, confidence, timestamp, and worker details.',
    icon: (
      <>
        <path d="M6 3h9l4 4v14H6z" />
        <path d="M9 12h7M9 16h7M9 8h3" />
      </>
    ),
  },
  {
    title: 'Worker Identification',
    desc: 'Link violations to registered workers using face recognition.',
    icon: (
      <>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5" />
      </>
    ),
  },
  {
    title: 'Safety Alerts',
    desc: 'Notify managers through email, MQTT, or webhook integrations.',
    icon: (
      <>
        <path d="M6 9a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6z" />
        <path d="M10 20a2 2 0 004 0" />
      </>
    ),
  },
  {
    title: 'Analytics & Reports',
    desc: 'Review trends, export reports, and support payroll deduction workflows.',
    icon: (
      <>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </>
    ),
  },
];

const STEPS = [
  { n: '01', title: 'Connect Camera', desc: 'Add webcam, RTSP, or video source.' },
  { n: '02', title: 'Run YOLO Detection', desc: 'Frames analysed in real time.' },
  { n: '03', title: 'Log Violations', desc: 'Snapshots & details stored automatically.' },
  { n: '04', title: 'Notify Safety Manager', desc: 'Instant email / MQTT / webhook alerts.' },
];

const TECH = ['React', 'FastAPI', 'YOLO', 'OpenCV', 'WebSocket', 'MJPEG', 'SQLite', 'Supabase'];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0A0F14] text-[#ECF0F4] font-sans overflow-x-hidden">
      {/* Ambient amber glow + faint safety grid */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            'radial-gradient(ellipse 90% 55% at 50% -5%, rgba(245,158,11,0.10) 0%, transparent 60%)',
        }}
      />
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(245,158,11,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(245,158,11,0.6) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      <div className="relative z-10">
        {/* ── Top bar ─────────────────────────────────────────────────────── */}
        <header className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="grid place-items-center w-9 h-9 rounded-lg bg-[#F59E0B]/12 border border-[#F59E0B]/30">
              <HardHatIcon className="w-5 h-5" />
            </span>
            <span className="text-lg font-display font-semibold tracking-tight">
              SafeSite <span className="text-[#F59E0B]">AI</span>
            </span>
          </div>
          <Link
            to="/login"
            className="text-sm font-medium text-[#CBD5E1] hover:text-[#F59E0B] transition-colors"
          >
            Sign in
          </Link>
        </header>

        {/* ── Hero — two columns ──────────────────────────────────────────── */}
        <section className="max-w-6xl mx-auto px-6 pt-10 pb-16 md:pt-16 md:pb-24 grid lg:grid-cols-2 gap-12 lg:gap-10 items-center">
          {/* Left */}
          <div className="text-center lg:text-left">
            <span
              className="animate-fade-in-up inline-flex items-center gap-2 rounded-full border border-[#F59E0B]/30 bg-[#F59E0B]/10 px-3 py-1 text-xs font-medium text-[#FCD34D]"
              style={{ animationDelay: '0.05s' }}
            >
              <span className="live-dot !mr-0" />
              Real-Time PPE Compliance Monitoring
            </span>

            <h1
              className="animate-fade-in-up font-display text-4xl md:text-6xl font-bold tracking-tight leading-[1.05] mt-5"
              style={{ animationDelay: '0.15s' }}
            >
              SafeSite <span className="text-[#F59E0B]">AI</span>
              <br />
              <span className="text-3xl md:text-5xl text-[#CBD5E1] font-semibold">
                AI-Powered PPE Detection
              </span>
            </h1>

            <p
              className="animate-fade-in-up text-[#CBD5E1] text-base md:text-lg max-w-xl mx-auto lg:mx-0 mt-5"
              style={{ animationDelay: '0.25s' }}
            >
              Monitor construction sites with YOLO-powered live camera analysis, automated
              violation logging, worker identification, and instant safety alerts.
            </p>

            <div
              className="animate-fade-in-up flex flex-wrap gap-3 justify-center lg:justify-start mt-8"
              style={{ animationDelay: '0.35s' }}
            >
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-2 rounded-lg bg-[#F59E0B] px-7 py-3 font-semibold text-[#0A0F14] shadow-[0_4px_14px_rgba(245,158,11,0.3)] transition-all duration-200 hover:bg-[#D97706] hover:-translate-y-0.5"
              >
                Enter Dashboard
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </Link>
              <Link
                to="/violations"
                className="inline-flex items-center gap-2 rounded-lg border border-[#253445] bg-white/5 px-7 py-3 font-semibold text-[#ECF0F4] transition-all duration-200 hover:border-[#F59E0B]/60 hover:-translate-y-0.5"
              >
                View Violations
              </Link>
            </div>

            {/* Mini stats */}
            <div
              className="animate-fade-in-up flex flex-wrap gap-x-8 gap-y-3 justify-center lg:justify-start mt-10 text-sm"
              style={{ animationDelay: '0.45s' }}
            >
              {[
                ['Real-time', 'detection'],
                ['Multi-camera', 'support'],
                ['Automated', 'logging'],
              ].map(([a, b]) => (
                <div key={a} className="text-left">
                  <div className="font-display font-semibold text-[#F59E0B]">{a}</div>
                  <div className="text-[#64748B]">{b}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Right — live detection mockup */}
          <div
            className="animate-fade-in-up relative mx-auto w-full max-w-md"
            style={{ animationDelay: '0.3s' }}
          >
            <DetectionPreview />
          </div>
        </section>

        {/* ── Features ────────────────────────────────────────────────────── */}
        <section className="max-w-6xl mx-auto px-6 py-12">
          <SectionHeading eyebrow="Capabilities" title="Everything you need for site safety" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-10">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group rounded-2xl border border-[#253445] bg-white/[0.025] p-6 transition-all duration-200 hover:-translate-y-1 hover:border-[#F59E0B]/50 hover:bg-white/[0.04]"
              >
                <span className="grid place-items-center w-11 h-11 rounded-xl bg-[#F59E0B]/12 border border-[#F59E0B]/25 text-[#F59E0B] transition-colors group-hover:bg-[#F59E0B]/20">
                  <svg
                    className="w-5 h-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    {f.icon}
                  </svg>
                </span>
                <h3 className="mt-4 text-base font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#94A3B8]">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── How it works ────────────────────────────────────────────────── */}
        <section className="max-w-6xl mx-auto px-6 py-12">
          <SectionHeading eyebrow="How it works" title="From camera to alert in four steps" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mt-10">
            {STEPS.map((s) => (
              <div
                key={s.n}
                className="relative rounded-2xl border border-[#253445] bg-white/[0.025] p-6"
              >
                <span className="font-display text-3xl font-bold text-[#F59E0B]/30">{s.n}</span>
                <h3 className="mt-3 text-sm font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-[#94A3B8]">{s.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Tech strip ──────────────────────────────────────────────────── */}
        <section className="max-w-6xl mx-auto px-6 py-12">
          <p className="text-center text-xs uppercase tracking-[0.2em] text-[#64748B]">
            Built with
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2.5">
            {TECH.map((t) => (
              <span
                key={t}
                className="rounded-full border border-[#253445] bg-white/[0.025] px-4 py-1.5 text-sm font-medium text-[#CBD5E1] transition-colors hover:border-[#F59E0B]/50 hover:text-[#F59E0B]"
              >
                {t}
              </span>
            ))}
          </div>
        </section>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <footer className="mt-8 border-t border-[#253445]/70 py-10 text-center">
          <div className="flex items-center justify-center gap-2">
            <HardHatIcon className="w-5 h-5" />
            <span className="font-display font-semibold">
              SafeSite AI
              <span className="ml-2 inline-block rounded-full border border-[#F59E0B]/30 bg-[#F59E0B]/10 px-2 py-0.5 text-xs font-medium text-[#F59E0B]">
                Final Year Project
              </span>
            </span>
          </div>
          <p className="mt-3 text-sm text-[#64748B]">
            AI-based construction safety monitoring system.
          </p>
        </footer>
      </div>
    </div>
  );
}

/* ── Section heading helper ──────────────────────────────────────────────── */
function SectionHeading({ eyebrow, title }) {
  return (
    <div className="text-center">
      <p className="text-xs uppercase tracking-[0.2em] text-[#F59E0B]">{eyebrow}</p>
      <h2 className="mt-2 font-display text-2xl md:text-3xl font-bold tracking-tight">{title}</h2>
    </div>
  );
}

/* ── Live detection preview ──────────────────────────────────────────────────
   Self-contained SVG/CSS mockup of a worker with PPE detection overlays.

   ► TO SWAP IN A REAL PHOTO LATER:
     1. Drop an image at  frontend/src/assets/worker.jpg
     2. At the top of this file add:  import workerImg from '../assets/worker.jpg';
     3. Replace the <WorkerSilhouette /> below with:
          <img
            src={workerImg}
            alt="Construction worker wearing a hard hat and safety vest detected by SafeSite AI"
            className="absolute inset-0 w-full h-full object-cover"
          />
   The bounding boxes / badges are positioned with percentages so they keep
   working over a real photo.
─────────────────────────────────────────────────────────────────────────── */
function DetectionPreview() {
  return (
    <div className="rounded-2xl border border-[#F59E0B]/25 bg-[#0F1620] p-3 shadow-[0_20px_60px_rgba(0,0,0,0.6)]">
      {/* Camera chrome */}
      <div className="flex items-center justify-between px-1 pb-2.5">
        <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
          <span className="rec-dot" />
          <span className="font-medium text-[#ECF0F4]">LIVE</span>
          <span className="text-[#64748B]">· Camera 01 — Zone A</span>
        </div>
        <span className="font-mono text-[10px] text-[#64748B]">YOLO · 30 FPS</span>
      </div>

      {/* Detection frame */}
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-gradient-to-b from-[#1C2835] to-[#0A0F14]">
        {/* swappable visual */}
        <WorkerSilhouette />

        {/* scan line (reuses keyframe from tailwind.config.js) */}
        <div
          className="pointer-events-none absolute left-0 right-0 h-px bg-[#F59E0B]/60 animate-scan-line"
          style={{ boxShadow: '0 0 12px 1px rgba(245,158,11,0.6)' }}
        />

        {/* Helmet — compliant (green) */}
        <DetBox style={{ top: '12%', left: '38%', width: '24%', height: '16%' }} tone="ok" label="Helmet 0.97" />
        {/* Vest — compliant (green) */}
        <DetBox style={{ top: '46%', left: '30%', width: '40%', height: '26%' }} tone="ok" label="Vest 0.93" />
        {/* Mask — violation (red) */}
        <DetBox style={{ top: '28%', left: '40%', width: '20%', height: '12%' }} tone="bad" label="NO-Mask 0.88" />
      </div>

      {/* Status row */}
      <div className="flex items-center justify-between px-1 pt-3 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 font-semibold text-emerald-400">
          <span className="status-dot-green" /> 2 Compliant
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-red-500/25 bg-red-500/10 px-2 py-0.5 font-semibold text-red-400">
          1 Violation
        </span>
      </div>
    </div>
  );
}

function DetBox({ style, tone, label }) {
  const ok = tone === 'ok';
  const color = ok ? '#10b981' : '#ef4444';
  return (
    <div
      className="absolute rounded-[3px] border-2"
      style={{ ...style, borderColor: color, boxShadow: `0 0 0 1px ${color}33` }}
    >
      <span
        className="absolute -top-[18px] left-0 whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[10px] font-semibold text-[#0A0F14]"
        style={{ background: color }}
      >
        {label}
      </span>
    </div>
  );
}

/* Neutral worker silhouette — placeholder for a real photo (see notes above). */
function WorkerSilhouette() {
  return (
    <svg
      viewBox="0 0 200 150"
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#334155" />
          <stop offset="100%" stopColor="#1e293b" />
        </linearGradient>
      </defs>
      {/* shoulders / torso */}
      <path d="M55 150 C55 100 75 88 100 88 C125 88 145 100 145 150 Z" fill="url(#body)" />
      {/* head */}
      <circle cx="100" cy="62" r="20" fill="#475569" />
      {/* hard hat */}
      <path d="M76 58 C76 42 124 42 124 58 Z" fill="#F59E0B" />
      <rect x="72" y="56" width="56" height="6" rx="3" fill="#F59E0B" />
      {/* vest hint */}
      <path d="M82 92 L100 100 L118 92 L118 150 L82 150 Z" fill="#3f4a5a" />
      <rect x="96" y="96" width="8" height="54" fill="#F59E0B" opacity="0.5" />
    </svg>
  );
}

function HardHatIcon({ className = 'w-5 h-5' }) {
  return (
    <svg viewBox="0 0 80 80" className={className} fill="none" aria-hidden="true">
      <path d="M16 46 C16 26 64 26 64 46" fill="#F59E0B" />
      <rect x="9" y="44" width="62" height="9" rx="4.5" fill="#F59E0B" />
      <rect x="36" y="17" width="8" height="9" rx="2" fill="#D97706" />
      <rect x="37.5" y="25" width="5" height="20" rx="1" fill="#D97706" opacity="0.35" />
    </svg>
  );
}
