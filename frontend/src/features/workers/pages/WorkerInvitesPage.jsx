import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../services/api/client.js';

const FILTERS = [
  { label: 'All', value: '' },
  { label: 'Pending', value: 'pending' },
  { label: 'Completed', value: 'completed' },
  { label: 'Invited', value: 'invited' },
  { label: 'Clicked', value: 'clicked' },
  { label: 'Registered', value: 'registered' },
  { label: 'Logged In', value: 'logged_in' },
];

const STATUS_BADGE = {
  invited: 'bg-amber-400/10 text-amber-400 border-amber-400/30',
  clicked: 'bg-blue-400/10 text-blue-400 border-blue-400/30',
  registered: 'bg-orange-400/10 text-orange-400 border-orange-400/30',
  logged_in: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/30',
};

const STATUS_LABEL = {
  invited: 'Invited',
  clicked: 'Clicked',
  registered: 'Registered',
  logged_in: 'Logged In',
};

function fmt(dt) {
  if (!dt) return '—';
  // Backend returns naive UTC strings without 'Z'; append it so JS parses as UTC
  // and toLocaleString() converts to the browser's local timezone correctly.
  const utc = dt.endsWith('Z') || dt.includes('+') ? dt : dt + 'Z';
  return new Date(utc).toLocaleString();
}

function SummaryCard({ label, value, color }) {
  return (
    <div className={`bg-surface-1 border border-border-soft rounded-xl p-4 flex flex-col gap-1 ${color}`}>
      <span className="text-[11px] text-text-muted uppercase tracking-wider">{label}</span>
      <span className="text-2xl font-bold text-text-base tabular-nums">{value ?? 0}</span>
    </div>
  );
}

export default function WorkerInvitesPage() {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (activeFilter) => {
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (activeFilter === 'pending') params.view = 'pending';
      else if (activeFilter === 'completed') params.view = 'completed';
      else if (activeFilter) params.status = activeFilter;
      const result = await api.getInviteTracker(params);
      setData(result);
    } catch (err) {
      setError(err.message || 'Failed to load invite tracker');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(filter); }, [load, filter]);

  const summary = data?.summary ?? {};
  const items = data?.items ?? [];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Info card */}
      <div className="bg-surface-1 border border-border-soft rounded-xl p-5">
        <h1 className="text-sm font-semibold text-text-base mb-1">Worker Invite Tracker</h1>
        <p className="text-xs text-text-muted leading-relaxed">
          This page tracks each worker's invite journey from email invite to first dashboard login.
          Authentication is handled securely through the existing magic link flow.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <SummaryCard label="Total Invites" value={summary.total} color="" />
        <SummaryCard label="Invited" value={summary.invited} color="border-amber-400/20" />
        <SummaryCard label="Clicked" value={summary.clicked} color="border-blue-400/20" />
        <SummaryCard label="Registered" value={summary.registered} color="border-orange-400/20" />
        <SummaryCard label="Logged In" value={summary.logged_in} color="border-emerald-400/20" />
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              filter === f.value
                ? 'bg-brand/15 text-brand border-brand/30 font-semibold'
                : 'bg-surface-1 text-text-muted border-border-soft hover:text-text-base hover:bg-surface-2/60'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-surface-1 border border-border-soft rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-soft bg-surface-2/50">
                <th className="px-4 py-2 text-left text-text-muted font-semibold uppercase tracking-wider">Name</th>
                <th className="px-4 py-2 text-left text-text-muted font-semibold uppercase tracking-wider">Email</th>
                <th className="px-4 py-2 text-center text-text-muted font-semibold uppercase tracking-wider">Status</th>
                <th className="px-4 py-2 text-left text-text-muted font-semibold uppercase tracking-wider">Invited At</th>
                <th className="px-4 py-2 text-left text-text-muted font-semibold uppercase tracking-wider">Clicked At</th>
                <th className="px-4 py-2 text-left text-text-muted font-semibold uppercase tracking-wider">Registered At</th>
                <th className="px-4 py-2 text-left text-text-muted font-semibold uppercase tracking-wider">First Login At</th>
                <th className="px-4 py-2 text-center text-text-muted font-semibold uppercase tracking-wider">Resends</th>
                <th className="px-4 py-2 text-left text-text-muted font-semibold uppercase tracking-wider">Last Updated</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-b border-border-soft">
                    {Array.from({ length: 9 }).map((__, j) => (
                      <td key={j} className="px-4 py-3"><span className="skel-line" /></td>
                    ))}
                  </tr>
                ))
              ) : error ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-accent-red text-xs">{error}</td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-text-subtle text-xs">
                    No invite records found.
                  </td>
                </tr>
              ) : items.map((row) => (
                <tr key={row.worker_id} className="border-b border-border-soft hover:bg-surface-2/30 transition-colors">
                  <td className="px-4 py-2.5 font-medium text-text-base">{row.worker_name}</td>
                  <td className="px-4 py-2.5 text-text-muted">{row.email}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${STATUS_BADGE[row.status] || 'bg-surface-3 text-text-subtle border-border-soft'}`}>
                      {STATUS_LABEL[row.status] || row.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-text-muted tabular-nums">{fmt(row.invited_at)}</td>
                  <td className="px-4 py-2.5 text-text-muted tabular-nums">{fmt(row.clicked_at)}</td>
                  <td className="px-4 py-2.5 text-text-muted tabular-nums">{fmt(row.registered_at)}</td>
                  <td className="px-4 py-2.5 text-text-muted tabular-nums">{fmt(row.first_login_at)}</td>
                  <td className="px-4 py-2.5 text-center text-text-muted tabular-nums">{row.resend_count}</td>
                  <td className="px-4 py-2.5 text-text-muted tabular-nums">{fmt(row.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
