import { useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ReferenceDot, LabelList,
} from 'recharts';
import { api } from '../api/client.js';
import { violationHex, VIOLATION_FALLBACK_HEX } from '../utils/violationColors.js';

const FALLBACK_COLOR = VIOLATION_FALLBACK_HEX;

const TOOLTIP_STYLE = {
  backgroundColor: '#111218',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8,
  color: '#f8fafc',
  fontSize: 12,
  padding: '8px 12px',
};

const RANGE_OPTIONS = [
  { label: '24h', value: '24h' },
  { label: '7d',  value: '7d'  },
  { label: '30d', value: '30d' },
];

const CACHE_TIME_BUCKET_MS = 5 * 60 * 1000;

function bucketedNowMs() {
  return Math.floor(Date.now() / CACHE_TIME_BUCKET_MS) * CACHE_TIME_BUCKET_MS;
}

function getRangeFrom(range, referenceTimeMs) {
  const now = referenceTimeMs;
  if (range === '24h') return new Date(now - 48 * 3600 * 1000).toISOString(); // 48h for yesterday compare
  if (range === '7d')  return new Date(now - 7  * 24 * 3600 * 1000).toISOString();
  return                       new Date(now - 30 * 24 * 3600 * 1000).toISOString();
}

export default function ViolationChart() {
  const [range, setRange]   = useState('7d');
  const referenceTimeMs = useMemo(() => bucketedNowMs(), [range]);
  const from = useMemo(() => getRangeFrom(range, referenceTimeMs), [range, referenceTimeMs]);

  const { data: stats, isLoading, error, refetch } = useQuery({
    queryKey: ['violationStats', range, from],
    queryFn: () => api.violationStats({ from }),
    staleTime: 15000,
    gcTime: 300000,
    placeholderData: keepPreviousData,
  });


  // ── Hourly / daily chart data ──────────────────────────────────────────────
  const hourlyData = useMemo(() => {
    if (!stats) return [];
    if (range === '24h') {
      // API was called with from=48h ago → by_hour has ~49 buckets
      // Split in half: first half = yesterday, second half = today
      const hours     = stats.by_hour || [];
      const today     = hours.slice(-24);
      const yesterday = hours.slice(-48, -24);
      return today.map((b, i) => ({
        hour:      String(new Date(b.hour).getHours()).padStart(2, '0') + ':00',
        today:     b.count,
        yesterday: yesterday[i]?.count ?? 0,
      }));
    }
    const days  = stats.by_day || [];
    const slice = range === '7d' ? days.slice(-7) : days;
    return slice.map((b) => ({
      hour: range === '7d'
        ? new Date(b.date + 'T12:00:00').toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' })
        : new Date(b.date + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' }),
      today:     b.count,
      yesterday: undefined,
    }));
  }, [stats, range]);

  const peakPoint = useMemo(() => {
    if (!hourlyData.length) return null;
    return hourlyData.reduce((mx, d) => d.today > (mx?.today ?? -1) ? d : mx, null);
  }, [hourlyData]);

  // ── Donut data ─────────────────────────────────────────────────────────────
  const typeData = useMemo(() => {
    const total = (stats?.by_type || []).reduce((s, b) => s + b.count, 0);
    return (stats?.by_type || []).map((b) => ({
      name:  b.type,
      value: b.count,
      pct:   total > 0 ? ((b.count / total) * 100).toFixed(1) : '0.0',
      color: violationHex(b.type),
    }));
  }, [stats]);

  const donutTotal = typeData.reduce((s, d) => s + d.value, 0);

  // ── Camera bar data ────────────────────────────────────────────────────────
  const cameraData = useMemo(() => {
    const camTotal = (stats?.by_camera || []).reduce((s, b) => s + b.count, 0);
    return (stats?.by_camera || []).map((b, i) => {
      const pct = camTotal > 0 ? ((b.count / camTotal) * 100).toFixed(1) : '0.0';
      return {
        name:  `Camera ${b.camera_id}`,
        count: b.count,
        label: `${b.count}  (${pct}%)`,
        isTop: i === 0,
      };
    });
  }, [stats]);

  // ── Summary stats ──────────────────────────────────────────────────────────
  const totalViolations = stats?.total ?? 0;

  const peakHourLabel = useMemo(() => {
    if (!peakPoint || peakPoint.today === 0) return '—';
    return `${peakPoint.hour} (${peakPoint.today})`;
  }, [peakPoint]);

  const topType   = typeData[0]?.name?.replace('NO-', '') || '—';
  const topCamera = cameraData[0]?.name || '—';

  const barHeight = Math.max(80, cameraData.length * 52 + 24);

  return (
    <div className="space-y-4">

      {/* ── Header + time range selector ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xs font-semibold text-text-muted uppercase tracking-widest">
          Violation Analytics
        </h2>
        <div className="flex items-center gap-0.5 bg-surface-2 border border-border-soft rounded-lg p-1">
          {RANGE_OPTIONS.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setRange(value)}
              className={`px-3 py-1 rounded text-xs font-semibold transition-all duration-200 ${
                range === value
                  ? 'bg-brand text-slate-900 font-bold shadow-sm'
                  : 'text-text-muted hover:text-text-base'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Error state */}
      {error && !stats && (
        <div className="card py-12 flex flex-col items-center justify-center gap-3">
          <p className="text-red-400 text-sm">⚠ {error.message || 'Failed to load chart data'}</p>
          <button onClick={() => refetch()} className="text-xs px-4 py-1.5 rounded-lg bg-brand/10 text-brand border border-brand/30 hover:bg-brand/20 transition-colors">Retry</button>
        </div>
      )}

      {/* Loading skeleton (initial load only) */}
      {isLoading && !stats && !error && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="card p-3"><div className="skel-line w-20 mb-2" /><div className="skel-line w-12 h-6" /></div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="card lg:col-span-3 h-72"><div className="skel-box w-full h-full" /></div>
            <div className="card lg:col-span-2 h-72"><div className="skel-box w-full h-full" /></div>
          </div>
        </div>
      )}

      {/* Charts content (hidden during initial load) */}
      {stats && (
      <div className={`space-y-4 transition-opacity duration-300 ${isLoading ? 'opacity-50' : 'opacity-100'}`}>

      {/* ── Summary row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 fade-up">
        {[
          { label: 'Total Violations',   value: totalViolations, accent: 'text-red-400',    icon: '⚠️' },
          { label: 'Peak Hour',          value: peakHourLabel,   accent: 'text-orange-400', icon: '📈' },
          { label: 'Top Violation Type', value: topType,         accent: 'text-yellow-400', icon: '🔴' },
          { label: 'Top Camera',         value: topCamera,       accent: 'text-brand',      icon: '📷' },
        ].map(({ label, value, accent, icon }) => (
          <div key={label} className="card p-3 hover:border-border-strong transition-colors duration-200">
            <div className="text-xs text-text-muted mb-1.5 flex items-center gap-1.5">
              <span>{icon}</span>
              <span>{label}</span>
            </div>
            <div className={`text-xl font-bold truncate ${accent}`}>{value ?? '—'}</div>
          </div>
        ))}
      </div>

      {/* ── Main charts row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 fade-up" style={{ animationDelay: '80ms' }}>

        {/* Area chart — hourly / daily */}
        <div className="card lg:col-span-3">
          <div className="card-header">
            <span className="font-medium text-text-base">
              {range === '24h' ? '📈 Violations per hour' :
               range === '7d'  ? '📈 Violations per day — 7d' :
                                  '📈 Violations per day — 30d'}
            </span>
            {range === '24h' && (
              <div className="flex items-center gap-3 text-xs text-text-muted">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-5 h-[2px] bg-red-500 rounded" />
                  Today
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-5 h-0"
                    style={{ borderTop: '2px dashed #6b7280' }}
                  />
                  Yesterday
                </span>
              </div>
            )}
          </div>
          <div className="p-4" style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hourlyData} margin={{ top: 28, right: 16, left: -22, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradToday" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#ef4444" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0}   />
                  </linearGradient>
                  <linearGradient id="gradYesterday" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#6b7280" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#6b7280" stopOpacity={0}    />
                  </linearGradient>
                </defs>

                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.045)"
                  vertical={false}
                />
                <XAxis
                  dataKey="hour"
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  width={28}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: '#94a3b8', marginBottom: 4, fontSize: 11 }}
                  formatter={(v, name) => [v, name === 'today' ? 'Today' : 'Yesterday']}
                />

                {range === '24h' && (
                  <Area
                    type="monotone"
                    dataKey="yesterday"
                    stroke="#6b7280"
                    strokeWidth={1.5}
                    strokeDasharray="5 3"
                    fill="url(#gradYesterday)"
                    dot={false}
                    activeDot={{ r: 4, fill: '#9ca3af', stroke: '#fff', strokeWidth: 1 }}
                    animationDuration={900}
                  />
                )}

                <Area
                  type="monotone"
                  dataKey="today"
                  stroke="#ef4444"
                  strokeWidth={2.5}
                  fill="url(#gradToday)"
                  dot={false}
                  activeDot={{ r: 5, fill: '#ef4444', stroke: '#fff', strokeWidth: 2 }}
                  animationDuration={1100}
                />

                {peakPoint && peakPoint.today > 0 && (
                  <ReferenceDot
                    x={peakPoint.hour}
                    y={peakPoint.today}
                    r={5}
                    fill="#ef4444"
                    stroke="#fff"
                    strokeWidth={2}
                    label={{
                      value: `Peak: ${peakPoint.today}`,
                      position: 'top',
                      fill: '#fca5a5',
                      fontSize: 10,
                      fontWeight: 600,
                    }}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Donut — by type */}
        <div className="card lg:col-span-2">
          <div className="card-header">
            <span className="font-medium text-text-base">🥧 By violation type</span>
          </div>
          <div className="p-4">
            {typeData.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-text-subtle text-xs">
                No data
              </div>
            ) : (
              <>
                {/* Donut with center text overlay */}
                <div className="relative" style={{ height: 165 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={typeData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius="50%"
                        outerRadius="78%"
                        paddingAngle={2}
                        animationBegin={0}
                        animationDuration={1000}
                        label={({ cx, cy, midAngle, outerRadius, percent }) => {
                          if (percent < 0.06) return null;
                          const RADIAN = Math.PI / 180;
                          const r = outerRadius * 1.28;
                          const x = cx + r * Math.cos(-midAngle * RADIAN);
                          const y = cy + r * Math.sin(-midAngle * RADIAN);
                          return (
                            <text
                              x={x} y={y}
                              textAnchor={x > cx ? 'start' : 'end'}
                              dominantBaseline="central"
                              fill="#94a3b8"
                              fontSize={10}
                            >
                              {(percent * 100).toFixed(0)}%
                            </text>
                          );
                        }}
                        labelLine={false}
                      >
                        {typeData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        formatter={(v, name) => {
                          const d = typeData.find((x) => x.name === name);
                          return [`${v}  (${d?.pct ?? 0}%)`, name];
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>

                  {/* Center overlay */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-2xl font-bold text-text-base leading-none">{donutTotal}</span>
                    <span className="text-[10px] text-text-muted mt-0.5 uppercase tracking-wide">total</span>
                  </div>
                </div>

                {/* Legend */}
                <div className="mt-3 space-y-1.5 border-t border-border-soft pt-3">
                  {typeData.map((d) => (
                    <div key={d.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                          style={{ backgroundColor: d.color }}
                        />
                        <span className="text-text-muted">{d.name}</span>
                      </div>
                      <div className="tabular-nums flex items-center gap-1.5">
                        <span className="font-semibold text-text-base">{d.value}</span>
                        <span className="text-text-subtle">({d.pct}%)</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Camera bar chart ── */}
      <div className="card fade-up" style={{ animationDelay: '160ms' }}>
        <div className="card-header">
          <span className="font-medium text-text-base">📷 By camera</span>
          {cameraData.length > 0 && (
            <span className="text-xs text-text-muted">
              Top: <span className="text-red-400 font-semibold">{cameraData[0]?.name}</span>
            </span>
          )}
        </div>
        <div className="p-4" style={{ height: barHeight }}>
          {cameraData.length === 0 ? (
            <div className="flex items-center justify-center h-full text-text-subtle text-xs">
              No data
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={cameraData}
                layout="vertical"
                margin={{ top: 0, right: 60, left: 10, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.04)"
                  vertical={true}
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  tick={{ fill: '#64748b', fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  tick={{ fill: '#cbd5e1', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={95}
                />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} animationDuration={900}>
                  {cameraData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.isTop ? '#ef4444' : '#f59e0b'}
                      fillOpacity={entry.isTop ? 0.9 : 0.65}
                    />
                  ))}
                  <LabelList
                    dataKey="label"
                    position="right"
                    style={{ fill: '#94a3b8', fontSize: 11, fontWeight: 500 }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      </div>
      )}

    </div>
  );
}
