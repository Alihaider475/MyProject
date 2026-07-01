import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../../services/api/client.js';
import { useToast } from '../../../../store/ToastContext.jsx';
import MonthPicker from '../../../../components/ui/MonthPicker.jsx';

const VIOLATION_BADGES = {
  'NO-Hardhat': 'badge-hardhat',
  'NO-Mask': 'badge-mask',
  'NO-Safety Vest': 'badge-vest',
};

const STATUS_CLS = {
  pending: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
  paid: 'text-sky-400 bg-sky-400/10 border-sky-400/30',
  deducted: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  waived: 'text-text-muted bg-surface-3 border-border-soft',
};

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatPkr(value) {
  return `PKR ${Number(value || 0).toLocaleString()}`;
}

export default function WorkerSelfDashboard() {
  const { showToast } = useToast();
  const [month, setMonth] = useState(currentMonth);
  const [dashboard, setDashboard] = useState(null);
  const [violations, setViolations] = useState([]);
  const [fines, setFines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setErrorStatus(null);
    try {
      const [dash, viol, fineList] = await Promise.all([
        api.getMyWorkerDashboard(month),
        api.getMyViolations({ page: 1, page_size: 100 }),
        api.getMyFines({ month, page: 1, page_size: 100 }),
      ]);
      setDashboard(dash);
      setViolations(viol?.items ?? []);
      setFines(fineList?.items ?? []);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 404 || status === 403) {
        setErrorStatus(status);
      } else {
        showToast({ title: 'Error', message: err.message, level: 'error' });
      }
    } finally {
      setLoading(false);
    }
  }, [month, showToast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (errorStatus === 404) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center bg-surface-1 border border-border-soft rounded-xl p-8">
        <p className="text-sm font-semibold text-text-base mb-2">No worker profile linked</p>
        <p className="text-xs text-text-muted">
          Your account isn't linked to a worker profile yet. Contact your administrator.
        </p>
      </div>
    );
  }

  if (errorStatus === 403) {
    return (
      <div className="max-w-xl mx-auto mt-16 text-center bg-surface-1 border border-border-soft rounded-xl p-8">
        <p className="text-sm font-semibold text-text-base mb-2">Access denied</p>
        <p className="text-xs text-text-muted">This account does not have worker access.</p>
      </div>
    );
  }

  const cards = [
    { label: 'Salary', value: dashboard ? formatPkr(dashboard.base_salary) : '—', color: 'text-text-base' },
    { label: 'Pending Fine', value: dashboard ? formatPkr(dashboard.pending_fine_amount) : '—', color: 'text-amber-400' },
    { label: 'Deducted', value: dashboard ? formatPkr(dashboard.deducted_fine_amount) : '—', color: 'text-emerald-400' },
    { label: 'Total Violations', value: dashboard ? dashboard.total_violations : '—', color: 'text-blue-400' },
  ];
  const hasSalaryCut = Number(dashboard?.deducted_fine_amount || 0) > 0;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-base">
            {dashboard ? `Welcome, ${dashboard.worker_name}` : 'My Dashboard'}
          </h1>
          {dashboard && (
            <p className="text-xs text-text-muted mt-0.5">
              {dashboard.employee_id}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-muted">Month:</label>
          <MonthPicker value={month} onChange={setMonth} />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map(({ label, value, color }) => (
          <div key={label} className="bg-surface-1 border border-border-soft rounded-xl p-4">
            <p className="text-xs text-text-muted mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {dashboard && hasSalaryCut && (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-emerald-300">Fine cut from salary</p>
              <p className="mt-1 text-xs text-text-muted">
                {formatPkr(dashboard.base_salary)} salary - {formatPkr(dashboard.deducted_fine_amount)} deducted fine
              </p>
            </div>
            <div className="text-left sm:text-right">
              <p className="text-xs text-text-muted">Salary after fine cut</p>
              <p className="text-xl font-bold text-emerald-300">{formatPkr(dashboard.net_salary)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Fines table */}
      <div className="bg-surface-1 border border-border-soft rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border-soft">
          <h2 className="text-sm font-semibold text-text-base">My Fines</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface-2">
              <tr>
                {['Date', 'Challan #', 'Amount', 'Status', 'Deduction Month', 'Download'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-text-muted font-semibold uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-t border-border-soft">
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-4 py-2.5"><span className="skel-line" /></td>
                    ))}
                  </tr>
                ))
              ) : fines.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-text-subtle">
                    No fines for {month}.
                  </td>
                </tr>
              ) : (
                fines.map((fine) => (
                  <tr key={fine.id} className="border-t border-border-soft hover:bg-surface-2/40 transition-colors">
                    <td className="px-4 py-2.5 text-text-muted">{new Date(fine.fine_date).toLocaleDateString()}</td>
                    <td className="px-4 py-2.5 font-mono text-text-muted">{fine.challan_number}</td>
                    <td className="px-4 py-2.5 tabular-nums">{fine.currency} {Number(fine.fine_amount).toFixed(2)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col items-start gap-1">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${STATUS_CLS[fine.status] ?? STATUS_CLS.waived}`}>
                          {fine.status}
                        </span>
                        {fine.status === 'deducted' && (
                          <span className="text-[10px] font-medium text-emerald-400">Cut from salary</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-text-muted">{fine.deduction_month || '—'}</td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => window.open(api.challanUrl(fine.id), '_blank')}
                        className="text-[11px] px-2 py-1 rounded-md bg-surface-3 text-text-muted hover:text-brand hover:bg-brand/10 transition-colors border border-border-soft"
                      >
                        PDF
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Violations table */}
      <div className="bg-surface-1 border border-border-soft rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border-soft">
          <h2 className="text-sm font-semibold text-text-base">My Violations</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface-2">
              <tr>
                {['Date & Time', 'Violation Type', 'Confidence', 'Fine Amount', 'Resolved'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-text-muted font-semibold uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-t border-border-soft">
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j} className="px-4 py-2.5"><span className="skel-line" /></td>
                    ))}
                  </tr>
                ))
              ) : violations.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-text-subtle">
                    No violations on record.
                  </td>
                </tr>
              ) : (
                violations.map((v) => (
                  <tr key={v.id} className="border-t border-border-soft hover:bg-surface-2/40 transition-colors">
                    <td className="px-4 py-2.5 text-text-muted">{new Date(v.timestamp).toLocaleString()}</td>
                    <td className="px-4 py-2.5">
                      <span className={`${VIOLATION_BADGES[v.violation_type] || 'badge-default'} text-[10px]`}>
                        {v.violation_type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-text-muted">{(v.confidence * 100).toFixed(0)}%</td>
                    <td className="px-4 py-2.5 tabular-nums">{v.fine_amount != null ? `PKR ${Number(v.fine_amount).toFixed(2)}` : '—'}</td>
                    <td className="px-4 py-2.5 text-text-muted">{v.resolved_at ? 'Yes' : 'No'}</td>
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
