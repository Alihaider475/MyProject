import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '../../../services/api/client.js';

function startOfTodayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function formatRelativeTime(iso) {
  if (!iso) return 'never';
  // Backend timestamps are naive UTC — append 'Z' so the diff isn't skewed by
  // the local timezone offset (matches ViolationsTable / AlertLogsPage).
  const raw = iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z';
  const seconds = Math.floor((Date.now() - new Date(raw).getTime()) / 1000);
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

/** Trend arrow showing real delta from the last poll — stable inline SVGs */
const TrendArrow = memo(function TrendArrow({ delta, accentColor }) {
  const style = useMemo(
    () => ({ color: accentColor, opacity: delta === 0 ? 0.6 : 0.75 }),
    [accentColor, delta]
  );
  if (delta === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-medium" style={style}>
        <svg aria-hidden="true" focusable="false" width="10" height="10" viewBox="0 0 10 10" fill="none">
          <circle cx="5" cy="5" r="2.5" fill="currentColor" />
        </svg>
        Stable
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-medium" style={style}>
      <svg aria-hidden="true" focusable="false" width="10" height="10" viewBox="0 0 10 10" fill="none">
        {delta > 0 ? (
          <path d="M5 8V2M5 2L2 5M5 2L8 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M5 2v6M5 8L2 5M5 8L8 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
      {delta > 0 ? `+${delta}` : `${delta}`}
    </span>
  );
});

export const KpiCard = memo(function KpiCard({ icon, label, value, accentClass, accentColor, accentRgb, delay = 0, delta = 0 }) {
  const animated = useCountUp(typeof value === 'number' ? value : null);
  const [hovered, setHovered] = useState(false);

  // Stable style objects — only recompute when hovered / accentRgb change
  const cardStyle = useMemo(() => ({
    animationDelay: `${delay}ms`,
    boxShadow: hovered ? `0 0 24px rgba(${accentRgb}, 0.35)` : undefined,
    transition: 'box-shadow 0.3s ease',
  }), [delay, hovered, accentRgb]);

  const glowStyle = useMemo(() => ({ background: accentColor }), [accentColor]);

  const handleMouseEnter = useCallback(() => setHovered(true), []);
  const handleMouseLeave = useCallback(() => setHovered(false), []);

  return (
    <div
      className={`kpi-card fade-up ${accentClass}`}
      style={cardStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Subtle background glow circle */}
      <div
        className="absolute -top-4 -right-4 w-20 h-20 rounded-full opacity-10 blur-xl pointer-events-none"
        style={glowStyle}
      />

      {/* Icon */}
      <span className="absolute top-4 right-4 text-2xl opacity-50 select-none">{icon}</span>

      {/* Label + trend */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs uppercase tracking-widest text-text-muted font-medium">{label}</span>
        <TrendArrow delta={delta} accentColor={accentColor} />
      </div>

      {/* Value */}
      <div className="text-2xl sm:text-3xl font-bold tabular-nums text-text-base leading-none count-in">
        {animated !== null ? animated : '—'}
      </div>
    </div>
  );
});

// Stable skeleton so React does not recreate DOM nodes on re-renders
const SkeletonGrid = memo(function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="kpi-card h-24">
          <div className="skel-line w-24 mb-3" />
          <div className="skel-line w-12 h-7" />
        </div>
      ))}
    </div>
  );
});

// Stable style for the last-alert purple glow so it never recreates on re-render
const PURPLE_GLOW_STYLE = { background: '#9333ea' };
const PURPLE_CLOCK_COLOR = { color: '#9333ea', opacity: 0.75 };

export default function StatsCard() {
  const { data: summary, isLoading } = useQuery({
    queryKey: ['dashboardSummary'],
    queryFn: ({ signal }) => api.fetchDashboardSummary({ signal }),
    staleTime: 5000,
    gcTime: 60000,
    placeholderData: keepPreviousData,
  });

  const [deltas, setDeltas] = useState({ active: 0, today: 0, total: 0 });
  const prevKpisRef = useRef(null);

  const kpis = useMemo(() => {
    if (!summary) return { active: null, today: null, total: null, lastAlert: null };
    return {
      active: summary.active_cameras ?? 0,
      today: summary.violations_today ?? 0,
      total: summary.total_violations ?? 0,
      lastAlert: summary.recent_violations?.[0]?.timestamp ?? null,
    };
  }, [summary]);

  useEffect(() => {
    if (!summary) return;
    const lastAlertTs = summary.recent_violations?.[0]?.timestamp ?? null;
    const newKpis = {
      active: summary.active_cameras ?? 0,
      today: summary.violations_today ?? 0,
      total: summary.total_violations ?? 0,
      lastAlert: lastAlertTs,
    };

    if (prevKpisRef.current !== null) {
      setDeltas({
        active: (newKpis.active ?? 0) - (prevKpisRef.current.active ?? 0),
        today:  (newKpis.today  ?? 0) - (prevKpisRef.current.today  ?? 0),
        total:  (newKpis.total  ?? 0) - (prevKpisRef.current.total  ?? 0),
      });
    }
    prevKpisRef.current = newKpis;
  }, [summary]);

  if (isLoading && !summary) return <SkeletonGrid />;


  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
      <KpiCard
        icon="📹"
        label="Active Cameras"
        value={kpis.active}
        accentClass="kpi-teal"
        accentColor="#0d9488"
        accentRgb="13, 148, 136"
        delta={deltas.active}
        delay={0}
      />
      <KpiCard
        icon="⚠️"
        label="Violations Today"
        value={kpis.today}
        accentClass="kpi-yellow"
        accentColor="#ca8a04"
        accentRgb="202, 138, 4"
        delta={deltas.today}
        delay={75}
      />
      <KpiCard
        icon="🗄️"
        label="Total Violations"
        value={kpis.total}
        accentClass="kpi-red"
        accentColor="#dc2626"
        accentRgb="220, 38, 38"
        delta={deltas.total}
        delay={150}
      />

      <div
        className="kpi-card fade-up kpi-purple"
        style={{ animationDelay: '225ms' }}
      >
        <div className="absolute -top-4 -right-4 w-20 h-20 rounded-full opacity-10 blur-xl pointer-events-none" style={PURPLE_GLOW_STYLE} />
        <span className="absolute top-4 right-4 text-2xl opacity-50 select-none">🕐</span>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs uppercase tracking-widest text-text-muted font-medium">Last Alert</span>
          <span className="inline-flex items-center gap-0.5 text-xs font-medium" style={PURPLE_CLOCK_COLOR}>
            <svg aria-hidden="true" focusable="false" width="10" height="10" viewBox="0 0 10 10" fill="none">
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
