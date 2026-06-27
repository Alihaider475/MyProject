import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../services/api/client.js';

// Read-only panel showing the latest n8n Payroll Risk Analysis run.
//
// The n8n agent runs the analysis monthly and writes an audit log. This panel only
// READS the latest log via the existing Supabase JWT — it never runs the analysis
// itself and never handles the server-only agent shared secret.

const STATUS_BADGE = {
  success: { label: 'Success', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  empty:   { label: 'No data', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  failed:  { label: 'Failed',  cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
};

const TREND_LABEL = {
  improved: { label: '↓ Improved', cls: 'text-emerald-400' },
  worsened: { label: '↑ Worsened', cls: 'text-red-400' },
  stable:   { label: '→ Stable',   cls: 'text-text-muted' },
};

// Format a "YYYY-MM" string into a human label like "June 2025".
function monthLabelFor(month) {
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return month || '—';
  const [y, m] = month.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString('default', {
    month: 'long',
    year: 'numeric',
  });
}

function Stat({ label, value, color = 'text-text-base' }) {
  return (
    <div>
      <p className="text-[11px] text-text-muted mb-0.5">{label}</p>
      <p className={`text-lg font-semibold ${color}`}>{value}</p>
    </div>
  );
}

function ClockIcon({ className = 'w-4 h-4' }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 4.75V8l2.25 1.5" />
    </svg>
  );
}

export default function RiskInsightsPanel({ selectedMonth } = {}) {
  const [log, setLog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .payrollRiskHistory(1, selectedMonth)
      .then((rows) => { if (active) setLog(Array.isArray(rows) && rows.length ? rows[0] : null); })
      .catch(() => { if (active) setLog(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedMonth]);

  const lastRun = useMemo(() => {
    if (!log?.created_at) return '—';
    return new Date(log.created_at).toLocaleString();
  }, [log]);

  if (loading) {
    return (
      <div className="bg-surface-1 border border-border-soft rounded-xl px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="skel-box block h-9 w-9 rounded-lg" />
          <div className="flex-1 space-y-2">
            <span className="skel-line w-40" />
            <span className="skel-line w-64 max-w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!log) {
    return (
      <div className="bg-surface-1 border border-border-soft rounded-xl px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border-soft bg-surface-2 text-text-muted">
            <ClockIcon />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text-base">Latest n8n Risk Analysis</h2>
            <p className="text-xs text-text-subtle">
              {selectedMonth
                ? `No n8n risk analysis has run for ${monthLabelFor(selectedMonth)} yet.`
                : 'No n8n analysis runs yet.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const badge = STATUS_BADGE[log.status] ?? STATUS_BADGE.empty;
  const trend = TREND_LABEL[log.trend] ?? TREND_LABEL.stable;
  const analysisMonthLabel = monthLabelFor(log.month);

  return (
    <div className="bg-surface-1 border border-border-soft rounded-xl p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text-base">
            Latest n8n Risk Analysis — {analysisMonthLabel}
          </h2>
          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${badge.cls}`}>{badge.label}</span>
        </div>
        <span className="text-[11px] text-text-muted">Last run: {lastRun}</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <Stat label="High-risk workers" value={log.high_risk_workers_count} color="text-red-400" />
        <Stat label="Medium-risk workers" value={log.medium_risk_workers_count} color="text-amber-400" />
        <Stat label="Monthly trend" value={<span className={trend.cls}>{trend.label}</span>} />
        <Stat label="Total fine analyzed" value={`PKR ${Number(log.total_fine_amount || 0).toLocaleString()}`} color="text-cyan-400" />
        <Stat label="Recommendations" value={log.recommendations_count} color="text-blue-400" />
      </div>

      {log.error_message && (
        <p className="mt-3 text-xs text-red-400">Error: {log.error_message}</p>
      )}

      {log.high_risk_workers_count > 0 && (
        <div className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 space-y-1.5">
          <p className="text-[11px] font-semibold text-amber-400 uppercase tracking-wide">Automation Result</p>
          <div className="space-y-1 text-xs text-text-muted">
            <p><span className="text-text-base font-medium">High-risk workers detected:</span> {log.high_risk_workers_count}</p>
            <p><span className="text-text-base font-medium">Risk reason:</span> High violation count and fine total flagged by n8n agent</p>
            <p><span className="text-text-base font-medium">Suggested corrective action:</span> Mandatory safety re-training assigned automatically</p>
            <p className="text-emerald-400">✓ Safety tasks created automatically via n8n workflow</p>
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between flex-wrap gap-2">
        <Link
          to="/admin/safety-actions"
          className="text-xs text-sky-400 hover:text-sky-300 underline underline-offset-2 transition-colors"
        >
          View Safety Actions →
        </Link>
        <button
          onClick={() => setModalOpen(true)}
          disabled={!log.response_snapshot_json}
          className="btn-outline text-xs px-3 py-1.5 disabled:opacity-40"
        >
          View Full Analysis
        </button>
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setModalOpen(false)}
          role="presentation"
        >
          <div
            className="bg-surface-1 border border-border-soft rounded-xl max-w-3xl w-full max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Full risk analysis"
          >
            <div className="px-4 py-3 border-b border-border-soft flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-base">Full Risk Analysis — {analysisMonthLabel}</h3>
              <button onClick={() => setModalOpen(false)} className="btn-icon" aria-label="Close">✕</button>
            </div>
            <div className="p-4 overflow-auto">
              <pre className="text-[11px] text-text-muted whitespace-pre-wrap break-words">
                {JSON.stringify(log.response_snapshot_json, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
