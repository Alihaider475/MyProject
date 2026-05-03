import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';

function startOfTodayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function formatRelativeTime(iso) {
  if (!iso) return 'never';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 172800) return 'yesterday';
  return `${Math.floor(seconds / 86400)} days ago`;
}

/** Animate a number counting up from 0 to `target` over `duration` ms */
function useCountUp(target, duration = 800) {
  const [displayed, setDisplayed] = useState(null);
  const rafRef = useRef(null);
  const prevTarget = useRef(null);

  useEffect(() => {
    if (target === null || target === undefined) { setDisplayed(null); return; }
    if (prevTarget.current === null) {
      // First load — animate from 0
      const start = performance.now();
      const from = 0;
      const to = target;
      function step(now) {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // ease-out-cubic
        setDisplayed(Math.round(from + (to - from) * eased));
        if (progress < 1) rafRef.current = requestAnimationFrame(step);
      }
      rafRef.current = requestAnimationFrame(step);
    } else {
      setDisplayed(target);
    }
    prevTarget.current = target;
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);

  return displayed;
}

/** Small trend arrow — purely decorative (no real historical data available) */
function TrendArrow({ accent }) {
  // Stateless decoration — shows a neutral "stable" indicator
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-medium" style={{ color: accent, opacity: 0.75 }}>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <path d="M5 8V2M5 2L2 5M5 2L8 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      Live
    </span>
  );
}

function KpiCard({ icon, label, value, accentClass, accentColor, delay = 0 }) {
  const animated = useCountUp(typeof value === 'number' ? value : null);

  return (
    <div
      className={`kpi-card fade-up ${accentClass}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Subtle background glow circle */}
      <div
        className="absolute -top-4 -right-4 w-20 h-20 rounded-full opacity-10 blur-xl pointer-events-none"
        style={{ background: accentColor }}
      />

      {/* Icon */}
      <span className="absolute top-4 right-4 text-2xl opacity-50 select-none">{icon}</span>

      {/* Label + trend */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs uppercase tracking-widest text-text-muted font-medium">{label}</span>
        <TrendArrow accent={accentColor} />
      </div>

      {/* Value */}
      <div className="text-3xl font-bold tabular-nums text-text-base leading-none count-in">
        {animated !== null ? animated : '—'}
      </div>
    </div>
  );
}

export default function StatsCard() {
  const [kpis, setKpis] = useState({ active: null, today: null, total: null, lastAlert: null });
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const [health, recent, today] = await Promise.all([
        api.health(),
        api.listViolations({ page_size: 1 }),
        api.listViolations({ from: startOfTodayIso(), page_size: 1 }),
      ]);
      setKpis({
        active: health.cameras_active,
        today: today.total,
        total: recent.total,
        lastAlert: recent.items[0]?.timestamp ?? null,
      });
    } catch {
      // silent — badge handles offline state
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="kpi-card h-24">
            <div className="skel-line w-24 mb-3" />
            <div className="skel-line w-12 h-7" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <KpiCard
        icon="📹"
        label="Active Cameras"
        value={kpis.active}
        accentClass="kpi-teal"
        accentColor="#0d9488"
        delay={0}
      />
      <KpiCard
        icon="⚠️"
        label="Violations Today"
        value={kpis.today}
        accentClass="kpi-yellow"
        accentColor="#ca8a04"
        delay={75}
      />
      <KpiCard
        icon="🗄️"
        label="Total Violations"
        value={kpis.total}
        accentClass="kpi-red"
        accentColor="#dc2626"
        delay={150}
      />

      <div
        className="kpi-card fade-up kpi-purple"
        style={{ animationDelay: '225ms' }}
      >
        <div className="absolute -top-4 -right-4 w-20 h-20 rounded-full opacity-10 blur-xl pointer-events-none" style={{ background: '#9333ea' }} />
        <span className="absolute top-4 right-4 text-2xl opacity-50 select-none">🕐</span>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs uppercase tracking-widest text-text-muted font-medium">Last Alert</span>
          <span className="inline-flex items-center gap-0.5 text-xs font-medium" style={{ color: '#9333ea', opacity: 0.75 }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M5 3v2.5l1.5 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Recent
          </span>
        </div>
        <div className="text-lg font-semibold text-text-base mt-1 leading-tight count-in">
          {kpis.lastAlert ? formatRelativeTime(kpis.lastAlert) : '—'}
        </div>
      </div>
    </div>
  );
}
