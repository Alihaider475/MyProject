import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../services/api/client.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const FILTERS = [
  { label: 'All',        value: '' },
  { label: 'Pending',    value: 'pending' },
  { label: 'Completed',  value: 'completed' },
  { label: 'Invited',    value: 'invited' },
  { label: 'Clicked',    value: 'clicked' },
  { label: 'Registered', value: 'registered' },
  { label: 'Logged In',  value: 'logged_in' },
];

const STATUS_BADGE = {
  invited:    'bg-amber-400/10 text-amber-400 border-amber-400/30',
  clicked:    'bg-blue-400/10 text-blue-400 border-blue-400/30',
  registered: 'bg-orange-400/10 text-orange-400 border-orange-400/30',
  logged_in:  'bg-emerald-400/10 text-emerald-400 border-emerald-400/30',
};

const STATUS_LABEL = {
  invited:    'Invited',
  clicked:    'Clicked',
  registered: 'Registered',
  logged_in:  'Logged In',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(dt) {
  if (!dt) return null;
  const utc = dt.endsWith('Z') || dt.includes('+') ? dt : dt + 'Z';
  return new Date(utc).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

// ─── Journey steps (explanation card) ────────────────────────────────────────

const JOURNEY_STEPS = [
  {
    label: 'Invite Sent',
    desc: 'Magic link emailed',
    color: 'text-amber-400',
    bg: 'bg-amber-400/10 border-amber-400/25',
    dot: 'bg-amber-400',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 4h12v9H2V4Z"/><path d="M2 4l6 5 6-5"/>
      </svg>
    ),
  },
  {
    label: 'Link Clicked',
    desc: 'Worker opened email',
    color: 'text-blue-400',
    bg: 'bg-blue-400/10 border-blue-400/25',
    dot: 'bg-blue-400',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 3l6 5-6 5"/><path d="M2 8h10"/>
      </svg>
    ),
  },
  {
    label: 'Registered',
    desc: 'Password set',
    color: 'text-orange-400',
    bg: 'bg-orange-400/10 border-orange-400/25',
    dot: 'bg-orange-400',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="5" r="2.5"/><path d="M3 14v-1a4 4 0 018 0v1"/>
        <path d="M11.5 9.5l1.5 1.5 2-2" strokeWidth="1.3"/>
      </svg>
    ),
  },
  {
    label: 'First Login',
    desc: 'Dashboard accessed',
    color: 'text-emerald-400',
    bg: 'bg-emerald-400/10 border-emerald-400/25',
    dot: 'bg-emerald-400',
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 8h10m-4-4l4 4-4 4"/>
        <rect x="1" y="2" width="14" height="12" rx="2"/>
      </svg>
    ),
  },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({ label, value, icon, accent }) {
  return (
    <div className={`bg-surface-1 border rounded-xl p-4 flex flex-col gap-2 ${accent}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-text-muted uppercase tracking-widest">{label}</span>
        <span className="opacity-60">{icon}</span>
      </div>
      <span className="text-2xl font-bold text-text-base tabular-nums leading-none">{value ?? 0}</span>
    </div>
  );
}

function DateCell({ value }) {
  const display = fmt(value);
  if (!display) return <span className="text-text-subtle">—</span>;
  return <span className="whitespace-nowrap">{display}</span>;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WorkerInvitesPage() {
  const [data, setData]       = useState(null);
  const [filter, setFilter]   = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const load = useCallback(async (activeFilter) => {
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (activeFilter === 'pending')        params.view   = 'pending';
      else if (activeFilter === 'completed') params.view   = 'completed';
      else if (activeFilter)                 params.status = activeFilter;
      setData(await api.getInviteTracker(params));
    } catch (err) {
      setError(err.message || 'Failed to load invite tracker');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(filter); }, [load, filter]);

  const summary = data?.summary ?? {};
  const items   = data?.items   ?? [];

  return (
    <div className="max-w-6xl mx-auto space-y-5">

      {/* ── Header + journey flow ─────────────────────────────────────────── */}
      <div className="bg-surface-1 border border-border-soft rounded-xl p-5 space-y-4">
        <div>
          <h1 className="text-base font-semibold text-text-base">Worker Invite Tracker</h1>
          <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
            Real-time visibility into each worker's onboarding journey — from the moment an
            invite is sent to their first authenticated dashboard session.
          </p>
        </div>

        {/* Journey flow */}
        <div className="flex items-start gap-0 flex-wrap sm:flex-nowrap">
          {JOURNEY_STEPS.map((step, i) => (
            <div key={step.label} className="flex items-center flex-1 min-w-[120px]">
              {/* Step pill */}
              <div className={`flex-1 flex flex-col items-center gap-1.5 border rounded-xl px-3 py-2.5 ${step.bg}`}>
                <span className={step.color}>{step.icon}</span>
                <span className={`text-[11px] font-semibold ${step.color}`}>{step.label}</span>
                <span className="text-[10px] text-text-subtle text-center leading-tight">{step.desc}</span>
              </div>
              {/* Arrow connector */}
              {i < JOURNEY_STEPS.length - 1 && (
                <div className="px-1 text-text-subtle shrink-0">
                  <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 6h8M7 3l3 3-3 3"/>
                  </svg>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Summary cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <SummaryCard
          label="Total"
          value={summary.total}
          accent="border-border-soft"
          icon={
            <svg className="w-4 h-4 text-text-muted" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/>
              <rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>
            </svg>
          }
        />
        <SummaryCard
          label="Invited"
          value={summary.invited}
          accent="border-amber-400/25 bg-amber-400/[0.03]"
          icon={
            <svg className="w-4 h-4 text-amber-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 4h12v9H2V4Z"/><path d="M2 4l6 5 6-5"/>
            </svg>
          }
        />
        <SummaryCard
          label="Clicked"
          value={summary.clicked}
          accent="border-blue-400/25 bg-blue-400/[0.03]"
          icon={
            <svg className="w-4 h-4 text-blue-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 8h10M9 4l4 4-4 4"/>
            </svg>
          }
        />
        <SummaryCard
          label="Registered"
          value={summary.registered}
          accent="border-orange-400/25 bg-orange-400/[0.03]"
          icon={
            <svg className="w-4 h-4 text-orange-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="7" cy="5" r="2.5"/><path d="M2 14v-1a4 4 0 018 0v1"/>
              <path d="M11.5 8.5l1.5 1.5 2-2" strokeWidth="1.3"/>
            </svg>
          }
        />
        <SummaryCard
          label="Logged In"
          value={summary.logged_in}
          accent="border-emerald-400/25 bg-emerald-400/[0.03]"
          icon={
            <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 3l4 4-4 4M3 7h11"/><path d="M6 1H3a2 2 0 00-2 2v10a2 2 0 002 2h3"/>
            </svg>
          }
        />
      </div>

      {/* ── Filter bar ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] text-text-subtle mr-1">Filter:</span>
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              filter === f.value
                ? 'bg-brand/15 text-brand border-brand/30 font-semibold shadow-[0_0_0_1px_var(--brand-30)]'
                : 'bg-surface-1 text-text-muted border-border-soft hover:text-text-base hover:bg-surface-2/60'
            }`}
          >
            {f.label}
          </button>
        ))}

        <button
          onClick={() => load(filter)}
          title="Refresh"
          aria-label="Refresh invite records"
          className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg border border-border-strong bg-surface-2 text-text-base shadow-sm hover:border-brand/60 hover:bg-brand/10 hover:text-brand focus:outline-none focus:ring-2 focus:ring-brand/40 transition-colors"
        >
          <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 8A6 6 0 112 8"/><path d="M14 4v4h-4"/>
          </svg>
        </button>
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <div className="bg-surface-1 border border-border-soft rounded-xl overflow-hidden">
        {/* Table header with count */}
        <div className="px-4 py-2.5 border-b border-border-soft flex items-center justify-between">
          <span className="text-xs font-semibold text-text-base">Invite Records</span>
          {!loading && !error && (
            <span className="text-[11px] text-text-subtle tabular-nums">
              {items.length} {items.length === 1 ? 'worker' : 'workers'}
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-strong bg-surface-2/80">
                {['Worker', 'Email', 'Status', 'Invited', 'Clicked', 'Registered', 'First Login', 'Resends', 'Updated'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-[11px] text-text-base font-bold uppercase tracking-wider whitespace-nowrap first:rounded-tl-none">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-border-soft/60">
                    {Array.from({ length: 9 }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <span className="skel-line" style={{ width: j === 2 ? 60 : j === 0 ? 90 : 80 }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : error ? (
                <tr>
                  <td colSpan={9} className="py-14 text-center">
                    <div className="inline-flex flex-col items-center gap-2">
                      <svg className="w-8 h-8 text-accent-red/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
                      </svg>
                      <p className="text-xs text-accent-red font-medium">{error}</p>
                      <button
                        onClick={() => load(filter)}
                        className="text-[11px] px-3 py-1 rounded-md border border-border-soft bg-surface-2 text-text-muted hover:text-text-base transition-colors"
                      >
                        Retry
                      </button>
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-14 text-center">
                    <div className="inline-flex flex-col items-center gap-2">
                      <svg className="w-8 h-8 text-text-subtle/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 8l9-5 9 5v8l-9 5-9-5V8Z"/><path d="M12 3v14M3 8l9 5 9-5"/>
                      </svg>
                      <p className="text-xs text-text-subtle font-medium">No invite records found</p>
                      <p className="text-[11px] text-text-subtle/60">
                        {filter ? 'Try a different filter.' : 'Send an invite from the Register Worker page to get started.'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((row) => (
                  <tr
                    key={row.worker_id}
                    className="border-b border-border-soft/60 hover:bg-brand/[0.04] transition-colors group"
                  >
                    <td className="px-4 py-3 font-medium text-text-base whitespace-nowrap group-hover:text-brand transition-colors">
                      {row.worker_name}
                    </td>
                    <td className="px-4 py-3 text-text-muted max-w-[180px] truncate">{row.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border whitespace-nowrap ${STATUS_BADGE[row.status] || 'bg-surface-3 text-text-subtle border-border-soft'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          row.status === 'invited'    ? 'bg-amber-400' :
                          row.status === 'clicked'    ? 'bg-blue-400'  :
                          row.status === 'registered' ? 'bg-orange-400':
                          row.status === 'logged_in'  ? 'bg-emerald-400': 'bg-text-subtle'
                        }`} />
                        {STATUS_LABEL[row.status] || row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-muted tabular-nums whitespace-nowrap"><DateCell value={row.invited_at} /></td>
                    <td className="px-4 py-3 text-text-muted tabular-nums whitespace-nowrap"><DateCell value={row.clicked_at} /></td>
                    <td className="px-4 py-3 text-text-muted tabular-nums whitespace-nowrap"><DateCell value={row.registered_at} /></td>
                    <td className="px-4 py-3 text-text-muted tabular-nums whitespace-nowrap"><DateCell value={row.first_login_at} /></td>
                    <td className="px-4 py-3 text-center text-text-muted tabular-nums">
                      {row.resend_count > 0
                        ? <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-surface-3 text-[10px] font-semibold text-text-muted">{row.resend_count}</span>
                        : <span className="text-text-subtle">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-text-subtle tabular-nums whitespace-nowrap"><DateCell value={row.updated_at} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
