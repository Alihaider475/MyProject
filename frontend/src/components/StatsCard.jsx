import { memo, useEffect, useMemo, useRef, useState } from 'react';

function formatRelativeTime(iso) {
  if (!iso) return 'No alerts yet';
  const raw = iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`;
  const time = new Date(raw).getTime();
  if (Number.isNaN(time)) return 'No alerts yet';
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 172800) return 'yesterday';
  return `${Math.floor(seconds / 86400)} days ago`;
}

function useCountUp(target, duration = 700) {
  const [displayed, setDisplayed] = useState(null);
  const rafRef = useRef(null);
  const prevTarget = useRef(null);

  useEffect(() => {
    if (typeof target !== 'number') {
      setDisplayed(null);
      return undefined;
    }

    if (prevTarget.current === null) {
      const start = performance.now();
      function step(now) {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setDisplayed(Math.round(target * eased));
        if (progress < 1) rafRef.current = requestAnimationFrame(step);
      }
      rafRef.current = requestAnimationFrame(step);
    } else {
      setDisplayed(target);
    }

    prevTarget.current = target;
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [duration, target]);

  return displayed;
}

const SkeletonGrid = memo(function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="kpi-card h-28">
          <div className="skel-line mb-3 h-3 w-28" />
          <div className="skel-line mb-3 h-7 w-20" />
          <div className="skel-line h-3 w-32" />
        </div>
      ))}
    </div>
  );
});

const KpiCard = memo(function KpiCard({
  label,
  value,
  context,
  accentClass,
  accentColor,
  accentRgb,
  numericValue,
  icon,
  delay = 0,
}) {
  const animated = useCountUp(numericValue);
  const displayValue = typeof numericValue === 'number' ? animated : value;
  const style = useMemo(() => ({ animationDelay: `${delay}ms` }), [delay]);
  const glowStyle = useMemo(() => ({ background: accentColor }), [accentColor]);
  const hoverStyle = useMemo(() => ({ '--kpi-hover-glow': `rgba(${accentRgb}, 0.22)` }), [accentRgb]);

  return (
    <article className={`kpi-card fade-up ${accentClass}`} style={{ ...style, ...hoverStyle }}>
      <div className="absolute -right-5 -top-5 h-20 w-20 rounded-full opacity-10 blur-xl" style={glowStyle} />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">{label}</p>
          <p className="mt-3 truncate text-2xl font-bold leading-none text-text-base sm:text-3xl">
            {displayValue ?? value ?? 'Unknown'}
          </p>
        </div>
        <span className="dashboard-icon" aria-hidden="true">{icon}</span>
      </div>
      <p className="mt-3 text-sm font-medium text-text-muted">{context}</p>
    </article>
  );
});

export default function StatsCard({ summary, loading, error }) {
  if (loading && !summary) return <SkeletonGrid />;

  if (!summary) {
    const unavailable = [
      ['Active Cameras', 'Unknown', 'Running status unavailable', 'CAM', 'kpi-teal', '#0d9488', '13, 148, 136'],
      ['Violations Today', 'Unknown', 'Today count unavailable', 'ALR', 'kpi-yellow', '#ca8a04', '202, 138, 4'],
      ['Total Violations', 'Unknown', 'All-time count unavailable', 'LOG', 'kpi-red', '#dc2626', '220, 38, 38'],
      ['Last Alert', 'Unknown', 'No activity data', 'CLK', 'kpi-purple', '#9333ea', '147, 51, 234'],
    ];
    return (
      <div className="space-y-3">
        {error && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-100">
            Dashboard metrics are unavailable until the API responds.
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {unavailable.map(([label, value, context, icon, accentClass, accentColor, accentRgb], index) => (
            <KpiCard
              key={label}
              label={label}
              value={value}
              context={context}
              icon={icon}
              accentClass={accentClass}
              accentColor={accentColor}
              accentRgb={accentRgb}
              delay={index * 60}
            />
          ))}
        </div>
      </div>
    );
  }

  const cameras = summary?.cameras ?? [];
  const running = summary?.active_cameras ?? summary?.health?.cameras_active ?? cameras.filter((c) => c.is_running).length;
  const total = cameras.length;
  const today = summary?.violations_today ?? 0;
  const allTime = summary?.total_violations ?? 0;
  const lastAlert = summary?.recent_violations?.[0]?.timestamp ?? null;

  const cards = [
    {
      label: 'Active Cameras',
      value: total > 0 ? `${running} / ${total}` : `${running} / 0`,
      context: total > 0 ? `${running} / ${total} running` : 'No cameras configured',
      icon: 'CAM',
      accentClass: 'kpi-teal',
      accentColor: '#0d9488',
      accentRgb: '13, 148, 136',
    },
    {
      label: 'Violations Today',
      value: `${today}`,
      numericValue: today,
      context: today === 0 ? '0 detected today' : `${today} detected today`,
      icon: 'ALR',
      accentClass: 'kpi-yellow',
      accentColor: '#ca8a04',
      accentRgb: '202, 138, 4',
    },
    {
      label: 'Total Violations',
      value: `${allTime}`,
      numericValue: allTime,
      context: 'All time',
      icon: 'LOG',
      accentClass: 'kpi-red',
      accentColor: '#dc2626',
      accentRgb: '220, 38, 38',
    },
    {
      label: 'Last Alert',
      value: formatRelativeTime(lastAlert),
      context: lastAlert ? 'Recent' : 'No activity',
      icon: 'CLK',
      accentClass: 'kpi-purple',
      accentColor: '#9333ea',
      accentRgb: '147, 51, 234',
    },
  ];

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-100">
          Dashboard metrics are showing the last available values where possible.
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card, index) => (
          <KpiCard key={card.label} {...card} delay={index * 60} />
        ))}
      </div>
    </div>
  );
}
