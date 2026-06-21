import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import MonthPicker from '../components/MonthPicker.jsx';

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const STATUS_CLS = {
  pending: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
  deducted: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  waived: 'text-text-muted bg-surface-3 border-border-soft',
};

const VIOLATION_COLORS = {
  'NO-Mask':        '#F59E0B',
  'NO-Hardhat':     '#EF4444',
  'NO-Safety Vest': '#F97316',
};

const VIOLATION_TYPES = Object.keys(VIOLATION_COLORS);

function FineTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;
  const segments = payload.filter((p) => p.value > 0);
  const total = segments.reduce((s, p) => s + p.value, 0);
  return (
    <div className="rounded-lg border border-[#2d2d44] bg-[#1a1a2e] px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-slate-200 mb-1">{label}</p>
      {segments.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4" style={{ color: p.fill }}>
          <span>{p.dataKey}</span>
          <span>PKR {Number(p.value).toLocaleString()} ({p.payload.counts?.[p.dataKey] ?? 0}×)</span>
        </div>
      ))}
      <div className="flex items-center justify-between gap-4 mt-1 pt-1 border-t border-[#2d2d44] text-slate-400">
        <span>Total</span>
        <span>PKR {Number(total).toLocaleString()}</span>
      </div>
    </div>
  );
}

export default function WorkerDashboard() {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(currentMonth);

  const { data: report, isLoading: reportLoading } = useQuery({
    queryKey: ['monthlyReport', month],
    queryFn: () => api.monthlyFineReport(month).catch(() => ({ month, total_amount: 0, workers: [] })),
    staleTime: 10000,
    gcTime: 300000,
    placeholderData: keepPreviousData,
  });

  const { data: finesData, isLoading: finesLoading } = useQuery({
    queryKey: ['fines', { month, page_size: 200 }],
    queryFn: () => api.listFines({ month, page_size: 200 }).catch(() => ({ items: [] })),
    staleTime: 5000,
    gcTime: 300000,
    placeholderData: keepPreviousData,
  });

  const fines = finesData?.items ?? null;
  const loading = reportLoading || finesLoading;

  // Worker detail panel
  const [selectedWorker, setSelectedWorker] = useState(null);

  const { data: workerFinesData, isLoading: workerFinesLoading } = useQuery({
    queryKey: ['fines', { worker_id: selectedWorker?.worker_id, page_size: 100 }],
    queryFn: () => api.listFines({ worker_id: selectedWorker.worker_id, page_size: 100 }),
    enabled: !!selectedWorker?.worker_id,
    staleTime: 5000,
    gcTime: 300000,
    placeholderData: keepPreviousData,
  });

  const workerFines = workerFinesData?.items ?? null;

  // Waive modal
  const [waiveModal, setWaiveModal] = useState({ open: false, fineId: null, reason: '' });
  const [waiving, setWaiving] = useState(false);

  function handleSelectWorker(worker) {
    setSelectedWorker(worker);
  }

  function closePanel() {
    setSelectedWorker(null);
  }

  async function submitWaive() {
    setWaiving(true);
    try {
      await api.waiveFine(waiveModal.fineId, waiveModal.reason || undefined);
      showToast({ title: 'Waived', message: 'Fine has been waived successfully', level: 'success' });
      setWaiveModal({ open: false, fineId: null, reason: '' });
      queryClient.invalidateQueries({ queryKey: ['monthlyReport'] });
      queryClient.invalidateQueries({ queryKey: ['fines'] });
    } catch (err) {
      showToast({ title: 'Error', message: err.message, level: 'error' });
    } finally {
      setWaiving(false);
    }
  }

  const workerMap = Object.fromEntries(
    (report?.workers ?? []).map((w) => [w.worker_id, w.worker_name])
  );

  const totalAmount = report?.total_amount ?? 0;
  const workersCount = report?.workers?.length ?? 0;
  const pendingCount = (fines ?? []).filter((f) => f.status === 'pending').length;
  const deductedCount = (fines ?? []).filter((f) => f.status === 'deducted').length;

  const chartData = (report?.workers ?? []).map((w) => {
    const entry = { name: w.worker_name.split(' ')[0], counts: {} };
    VIOLATION_TYPES.forEach((type) => {
      entry[type] = 0;
      entry.counts[type] = 0;
    });
    (w.breakdown ?? []).forEach((b) => {
      entry[b.violation_type] = b.amount;
      entry.counts[b.violation_type] = b.count;
    });
    return entry;
  });

  // Worker detail summary
  const workerFineTotal = (workerFines ?? []).reduce((s, f) => s + (f.status !== 'waived' ? f.fine_amount : 0), 0);
  const workerByType = (workerFines ?? []).reduce((acc, f) => {
    if (f.status !== 'waived') acc[f.challan_number] = (acc[f.challan_number] || 0) + f.fine_amount;
    return acc;
  }, {});

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold text-text-base">Worker Fine Dashboard</h1>
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-muted">Month:</label>
          <MonthPicker value={month} onChange={setMonth} />
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total PKR', value: loading ? '—' : totalAmount.toLocaleString(), color: 'text-cyan-400' },
          { label: 'Workers', value: loading ? '—' : workersCount, color: 'text-blue-400' },
          { label: 'Pending', value: loading ? '—' : pendingCount, color: 'text-amber-400' },
          { label: 'Deducted', value: loading ? '—' : deductedCount, color: 'text-emerald-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-surface-1 border border-border-soft rounded-xl p-4">
            <p className="text-xs text-text-muted mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      {chartData.length > 0 && (
        <div className="bg-surface-1 border border-border-soft rounded-xl p-4">
          <h2 className="text-sm font-semibold text-text-base mb-3">Fine Amount by Worker</h2>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
              <XAxis dataKey="name" stroke="#6B7280" tick={{ fontSize: 11, fill: '#6B7280' }} />
              <YAxis
                stroke="#6B7280"
                tick={{ fontSize: 11, fill: '#6B7280' }}
                tickFormatter={(value) => `PKR ${Number(value).toLocaleString()}`}
              />
              <Tooltip content={<FineTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Legend verticalAlign="top" align="left" wrapperStyle={{ fontSize: 12 }} />
              {VIOLATION_TYPES.map((type) => (
                <Bar key={type} dataKey={type} name={type} stackId="fines" fill={VIOLATION_COLORS[type]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Workers summary table */}
      {(report?.workers ?? []).length > 0 && (
        <div className="bg-surface-1 border border-border-soft rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border-soft">
            <h2 className="text-sm font-semibold text-text-base">Workers — click row for detail</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-surface-2">
                <tr>
                  {['Name', 'Employee ID', 'Fine Count', 'Total Fines'].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-text-muted font-semibold uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(report?.workers ?? []).map((w) => (
                  <tr
                    key={w.worker_id}
                    className={`border-t border-border-soft cursor-pointer transition-colors ${
                      selectedWorker?.worker_id === w.worker_id
                        ? 'bg-brand/10 text-brand'
                        : 'hover:bg-surface-2/40'
                    }`}
                    onClick={() => handleSelectWorker(w)}
                  >
                    <td className="px-4 py-2.5 text-text-base font-medium">{w.worker_name}</td>
                    <td className="px-4 py-2.5 font-mono text-text-muted">{w.employee_id}</td>
                    <td className="px-4 py-2.5 tabular-nums">{w.fine_count}</td>
                    <td className="px-4 py-2.5 tabular-nums text-cyan-400 font-semibold">
                      PKR {Number(w.total_fines).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Challan table */}
      <div className="bg-surface-1 border border-border-soft rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border-soft">
          <h2 className="text-sm font-semibold text-text-base">Challan Records</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface-2">
              <tr>
                {['Worker', 'Challan #', 'Amount', 'Status', 'Download'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-text-muted font-semibold uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fines === null ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-t border-border-soft">
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j} className="px-4 py-2.5"><span className="skel-line" /></td>
                    ))}
                  </tr>
                ))
              ) : fines.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-text-subtle">No fines for {month}.</td>
                </tr>
              ) : (
                fines.map((fine) => (
                  <tr key={fine.id} className="border-t border-border-soft hover:bg-surface-2/40 transition-colors">
                    <td className="px-4 py-2.5 text-text-base">{workerMap[fine.worker_id] ?? `Worker #${fine.worker_id}`}</td>
                    <td className="px-4 py-2.5 font-mono text-text-muted">{fine.challan_number}</td>
                    <td className="px-4 py-2.5 tabular-nums">{fine.currency} {Number(fine.fine_amount).toFixed(2)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${STATUS_CLS[fine.status] ?? STATUS_CLS.waived}`}>
                        {fine.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => window.open(api.challanUrl(fine.id), '_blank')}
                        className="text-[10px] px-2.5 py-1 rounded bg-brand/10 text-brand border border-brand/30 hover:bg-brand/20 transition-colors"
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

      {/* Worker detail side panel */}
      {selectedWorker && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={closePanel}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-lg bg-surface-1 border-l border-border-soft shadow-2xl flex flex-col h-full overflow-hidden"
            style={{ animation: 'slideInRight 0.25s cubic-bezier(0.4,0,0.2,1)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Panel header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border-soft flex-shrink-0">
              <div>
                <h2 className="text-sm font-semibold text-text-base">{selectedWorker.worker_name}</h2>
                <p className="text-xs text-text-muted">{selectedWorker.employee_id}</p>
              </div>
              <button
                onClick={closePanel}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-base hover:bg-surface-2 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/>
                </svg>
              </button>
            </div>

            {/* Summary bar */}
            <div className="px-5 py-3 bg-surface-2/50 border-b border-border-soft flex-shrink-0">
              <p className="text-xs text-text-muted">Total accumulated (non-waived)</p>
              <p className="text-xl font-bold text-cyan-400">PKR {workerFineTotal.toLocaleString()}</p>
            </div>

            {/* Fine timeline */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">Violation History</h3>
              {workerFinesLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="rounded-lg border border-border-soft p-3 space-y-2">
                    <span className="skel-line" />
                    <span className="skel-line" style={{ width: '60%' }} />
                  </div>
                ))
              ) : (workerFines ?? []).length === 0 ? (
                <p className="text-xs text-text-subtle py-4 text-center">No fines found.</p>
              ) : (
                (workerFines ?? []).map((fine) => (
                  <div
                    key={fine.id}
                    className="rounded-lg border border-border-soft bg-surface-2/30 p-3 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium text-text-base">{fine.challan_number}</p>
                        <p className="text-[10px] text-text-muted">
                          {new Date(fine.fine_date).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}
                          {fine.deduction_month && ` · Deduct: ${fine.deduction_month}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${STATUS_CLS[fine.status] ?? STATUS_CLS.waived}`}>
                          {fine.status}
                        </span>
                        <span className="text-xs font-semibold tabular-nums text-text-base">
                          {fine.currency} {Number(fine.fine_amount).toFixed(0)}
                        </span>
                      </div>
                    </div>

                    {fine.waive_reason && (
                      <p className="text-[10px] text-text-muted italic">Reason: {fine.waive_reason}</p>
                    )}

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => window.open(api.challanUrl(fine.id), '_blank')}
                        className="text-[10px] px-2 py-0.5 rounded bg-brand/10 text-brand border border-brand/30 hover:bg-brand/20 transition-colors"
                      >
                        PDF
                      </button>
                      {fine.status === 'pending' && (
                        <button
                          onClick={() => setWaiveModal({ open: true, fineId: fine.id, reason: '' })}
                          className="text-[10px] px-2 py-0.5 rounded bg-amber-400/10 text-amber-400 border border-amber-400/30 hover:bg-amber-400/20 transition-colors"
                        >
                          Waive
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Waive modal */}
      {waiveModal.open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setWaiveModal({ open: false, fineId: null, reason: '' })}
        >
          <div
            className="bg-surface-1 border border-border-soft rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-text-base">Waive Fine</h2>
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Reason (optional)</label>
              <textarea
                rows={3}
                value={waiveModal.reason}
                onChange={(e) => setWaiveModal((p) => ({ ...p, reason: e.target.value }))}
                placeholder="Waived by Manager - First offense"
                className="form-input w-full resize-none text-xs"
                autoFocus
              />
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setWaiveModal({ open: false, fineId: null, reason: '' })}
                className="btn-outline text-sm px-4 py-1.5"
              >
                Cancel
              </button>
              <button
                onClick={submitWaive}
                disabled={waiving}
                className="text-sm px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white font-medium transition-colors disabled:opacity-50"
              >
                {waiving ? 'Waiving…' : 'Confirm Waive'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
