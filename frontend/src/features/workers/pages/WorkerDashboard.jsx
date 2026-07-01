import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';

import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../../../services/api/client.js';
import { useToast } from '../../../store/ToastContext.jsx';
import MonthPicker from '../../../components/ui/MonthPicker.jsx';
import { useEscapeKey } from '../../../hooks/useEscapeKey.js';
import { useFocusTrap } from '../../../hooks/useFocusTrap.js';

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatPkr(value) {
  return `PKR ${Number(value || 0).toLocaleString()}`;
}

const STATUS_CLS = {
  pending: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
  paid: 'text-sky-400 bg-sky-400/10 border-sky-400/30',
  deducted: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  waived: 'text-text-muted bg-surface-3 border-border-soft',
};

const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Manual'];

const VIOLATION_COLORS = {
  'NO-Mask':        '#F59E0B',
  'NO-Hardhat':     '#EF4444',
  'NO-Safety Vest': '#F97316',
};

function FineTooltip({ active, payload }) {
  if (!active || !payload || payload.length === 0) return null;
  const { fullName, total, breakdown } = payload[0].payload;
  const segments = (breakdown ?? []).filter((b) => b.amount > 0);
  return (
    <div className="rounded-lg border border-[#2d2d44] bg-[#1a1a2e] px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-slate-200 mb-1">{fullName}</p>
      {segments.map((b) => (
        <div key={b.violation_type} className="flex items-center justify-between gap-4" style={{ color: VIOLATION_COLORS[b.violation_type] ?? '#94a3b8' }}>
          <span>{b.violation_type}</span>
          <span>PKR {Number(b.amount).toLocaleString()} ({b.count}×)</span>
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

  const { data: workersData } = useQuery({
    queryKey: ['workers'],
    queryFn: () => api.listWorkers().catch(() => []),
    staleTime: 30000,
    gcTime: 300000,
    placeholderData: keepPreviousData,
  });

  const workers = Array.isArray(workersData) ? workersData : [];
  const workerDetailsById = useMemo(
    () => Object.fromEntries(workers.map((worker) => [worker.id, worker])),
    [workers]
  );

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

  // Settlement modals
  const [payModal, setPayModal] = useState({ open: false, fineId: null, payment_method: '', notes: '' });
  const [deductModal, setDeductModal] = useState({ open: false, fineId: null, deduction_month: currentMonth(), notes: '' });
  const [waiveModal, setWaiveModal] = useState({ open: false, fineId: null, reason: '', notes: '' });
  const [paying, setPaying] = useState(false);
  const [deducting, setDeducting] = useState(false);
  const [waiving, setWaiving] = useState(false);

  const panelRef = useRef(null);
  const payPanelRef = useRef(null);
  const deductPanelRef = useRef(null);
  const waivePanelRef = useRef(null);

  useEscapeKey(() => setSelectedWorker(null), !!selectedWorker && !payModal.open && !deductModal.open && !waiveModal.open);
  useEscapeKey(() => setPayModal({ open: false, fineId: null, payment_method: '', notes: '' }), payModal.open && !paying);
  useEscapeKey(() => setDeductModal({ open: false, fineId: null, deduction_month: currentMonth(), notes: '' }), deductModal.open && !deducting);
  useEscapeKey(() => setWaiveModal({ open: false, fineId: null, reason: '', notes: '' }), waiveModal.open && !waiving);

  useFocusTrap(panelRef, !!selectedWorker && !payModal.open && !deductModal.open && !waiveModal.open);
  useFocusTrap(payPanelRef, payModal.open);
  useFocusTrap(deductPanelRef, deductModal.open);
  useFocusTrap(waivePanelRef, waiveModal.open);

  function handleSelectWorker(worker) {
    setSelectedWorker(worker);
  }

  function closePanel() {
    setSelectedWorker(null);
  }

  function applySettlement(updatedFine) {
    queryClient.setQueriesData({ queryKey: ['fines'] }, (old) => {
      if (!old?.items) return old;
      return {
        ...old,
        items: old.items.map((f) => (f.id === updatedFine.id ? { ...f, ...updatedFine } : f)),
      };
    });
    queryClient.invalidateQueries({ queryKey: ['monthlyReport'] });
    queryClient.invalidateQueries({ queryKey: ['fines'] });
  }

  async function submitPay() {
    setPaying(true);
    try {
      const updated = await api.settleFine(payModal.fineId, {
        status: 'paid',
        payment_method: payModal.payment_method,
        notes: payModal.notes || undefined,
      });
      showToast({ title: 'Marked Paid', message: 'Fine has been marked as paid', level: 'success' });
      setPayModal({ open: false, fineId: null, payment_method: '', notes: '' });
      applySettlement(updated);
    } catch (err) {
      showToast({ title: 'Error', message: err.message, level: 'error' });
    } finally {
      setPaying(false);
    }
  }

  async function submitDeduct() {
    setDeducting(true);
    try {
      const updated = await api.settleFine(deductModal.fineId, {
        status: 'deducted',
        deduction_month: deductModal.deduction_month,
        notes: deductModal.notes || undefined,
      });
      showToast({ title: 'Deducted', message: 'Fine will be deducted from payroll', level: 'success' });
      setDeductModal({ open: false, fineId: null, deduction_month: currentMonth(), notes: '' });
      applySettlement(updated);
    } catch (err) {
      showToast({ title: 'Error', message: err.message, level: 'error' });
    } finally {
      setDeducting(false);
    }
  }

  async function submitWaive() {
    setWaiving(true);
    try {
      const updated = await api.settleFine(waiveModal.fineId, {
        status: 'waived',
        waive_reason: waiveModal.reason,
        notes: waiveModal.notes || undefined,
      });
      showToast({ title: 'Waived', message: 'Fine has been waived successfully', level: 'success' });
      setWaiveModal({ open: false, fineId: null, reason: '', notes: '' });
      applySettlement(updated);
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
  const paidCount = (fines ?? []).filter((f) => f.status === 'paid').length;
  const deductedCount = (fines ?? []).filter((f) => f.status === 'deducted').length;

  const chartData = (report?.workers ?? [])
    .map((w) => ({
      name: w.worker_name.split(' ')[0],
      fullName: w.worker_name,
      total: w.total_fines,
      breakdown: w.breakdown ?? [],
    }))
    .sort((a, b) => b.total - a.total);

  // Worker detail summary
  const workerFineTotal = (workerFines ?? []).reduce((s, f) => s + (f.status !== 'waived' ? f.fine_amount : 0), 0);
  const workerByType = (workerFines ?? []).reduce((acc, f) => {
    if (f.status !== 'waived') acc[f.challan_number] = (acc[f.challan_number] || 0) + f.fine_amount;
    return acc;
  }, {});

  const deductFine = useMemo(() => {
    const allVisibleFines = [...(workerFines ?? []), ...(fines ?? [])];
    return allVisibleFines.find((fine) => fine.id === deductModal.fineId) ?? null;
  }, [deductModal.fineId, fines, workerFines]);
  const deductWorkerId = deductFine?.worker_id ?? selectedWorker?.worker_id;
  const deductWorker = deductWorkerId ? workerDetailsById[deductWorkerId] : null;
  const deductFineAmount = Number(deductFine?.fine_amount || 0);
  const deductSalary = Number(deductWorker?.base_salary || 0);
  const salaryAfterDeduction = Math.max(0, deductSalary - deductFineAmount);

  function salaryPreviewForFine(fine) {
    const workerId = fine?.worker_id ?? selectedWorker?.worker_id;
    const worker = workerId ? workerDetailsById[workerId] : null;
    const salary = Number(worker?.base_salary || 0);
    const amount = Number(fine?.fine_amount || 0);
    return {
      hasWorker: Boolean(worker),
      salary,
      amount,
      after: Math.max(0, salary - amount),
    };
  }

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
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {[
          { label: 'Total PKR', value: loading ? '—' : totalAmount.toLocaleString(), color: 'text-cyan-400' },
          { label: 'Workers', value: loading ? '—' : workersCount, color: 'text-blue-400' },
          { label: 'Pending', value: loading ? '—' : pendingCount, color: 'text-amber-400' },
          { label: 'Paid', value: loading ? '—' : paidCount, color: 'text-sky-400' },
          { label: 'Deducted', value: loading ? '—' : deductedCount, color: 'text-emerald-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-surface-1 border border-border-soft rounded-xl p-4">
            <p className="text-xs text-text-muted mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      <div className="bg-surface-1 border border-border-soft rounded-xl p-4">
        <h2 className="text-sm font-semibold text-text-base mb-3">Total Fine Amount by Worker</h2>
        {chartData.length === 0 ? (
          <div className="flex items-center justify-center text-text-subtle text-xs" style={{ height: 220 }}>
            No fines for {month}.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(240, chartData.length * 36)}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 70, left: 10, bottom: 0 }}>
              <XAxis
                type="number"
                stroke="#6B7280"
                tick={{ fontSize: 11, fill: '#6B7280' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => `PKR ${Number(value).toLocaleString()}`}
              />
              <YAxis
                dataKey="name"
                type="category"
                tick={{ fontSize: 11, fill: '#cbd5e1' }}
                tickLine={false}
                axisLine={false}
                width={110}
              />
              <Tooltip content={<FineTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar dataKey="total" fill="#22d3ee" radius={[0, 4, 4, 0]} barSize={18} animationDuration={600}>
                <LabelList
                  dataKey="total"
                  position="right"
                  formatter={(value) => `PKR ${Number(value).toLocaleString()}`}
                  style={{ fill: '#94a3b8', fontSize: 11, fontWeight: 500 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

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
                    role="button"
                    tabIndex={0}
                    className={`border-t border-border-soft cursor-pointer transition-colors ${
                      selectedWorker?.worker_id === w.worker_id
                        ? 'bg-brand/10 text-brand'
                        : 'hover:bg-surface-2/40'
                    }`}
                    onClick={() => handleSelectWorker(w)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectWorker(w); } }}
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
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedWorker.worker_name} fine details`}
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
                aria-label="Close"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-base hover:bg-surface-2 transition-colors"
              >
                <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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

                    {fine.payment_method && (
                      <p className="text-[10px] text-text-muted italic">Paid via {fine.payment_method}</p>
                    )}
                    {fine.waive_reason && (
                      <p className="text-[10px] text-text-muted italic">Reason: {fine.waive_reason}</p>
                    )}
                    {fine.settlement_notes && (
                      <p className="text-[10px] text-text-subtle italic">Notes: {fine.settlement_notes}</p>
                    )}

                    {fine.status === 'pending' && (() => {
                      const preview = salaryPreviewForFine(fine);
                      if (!preview.hasWorker) return null;
                      return (
                        <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                          <span>After deduction salary</span>
                          <span>{formatPkr(preview.after)}</span>
                        </div>
                      );
                    })()}

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => window.open(api.challanUrl(fine.id), '_blank')}
                        className="text-[10px] px-2 py-0.5 rounded bg-brand/10 text-brand border border-brand/30 hover:bg-brand/20 transition-colors"
                      >
                        PDF
                      </button>
                      {fine.status === 'pending' && (
                        <>
                          <button
                            onClick={() => setPayModal({ open: true, fineId: fine.id, payment_method: '', notes: '' })}
                            className="text-[10px] px-2 py-0.5 rounded bg-sky-400/10 text-sky-400 border border-sky-400/30 hover:bg-sky-400/20 transition-colors"
                          >
                            Mark Paid
                          </button>
                          <button
                            onClick={() => setDeductModal({ open: true, fineId: fine.id, deduction_month: currentMonth(), notes: '' })}
                            className="text-[10px] px-2 py-0.5 rounded bg-emerald-400/10 text-emerald-400 border border-emerald-400/30 hover:bg-emerald-400/20 transition-colors"
                          >
                            Deduct
                          </button>
                          <button
                            onClick={() => setWaiveModal({ open: true, fineId: fine.id, reason: '', notes: '' })}
                            className="text-[10px] px-2 py-0.5 rounded bg-amber-400/10 text-amber-400 border border-amber-400/30 hover:bg-amber-400/20 transition-colors"
                          >
                            Waive
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mark as Paid modal */}
      {payModal.open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => !paying && setPayModal({ open: false, fineId: null, payment_method: '', notes: '' })}
        >
          <div
            ref={payPanelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Mark as Paid"
            className="bg-surface-1 border border-border-soft rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-text-base">Mark as Paid</h2>
            <div className="space-y-1">
              <label htmlFor="pay-method" className="text-xs text-text-muted">Payment method</label>
              <select
                id="pay-method"
                value={payModal.payment_method}
                onChange={(e) => setPayModal((p) => ({ ...p, payment_method: e.target.value }))}
                className="form-select w-full text-xs"
              >
                <option value="">Select method…</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="pay-notes" className="text-xs text-text-muted">Notes (optional)</label>
              <textarea
                id="pay-notes"
                rows={2}
                value={payModal.notes}
                onChange={(e) => setPayModal((p) => ({ ...p, notes: e.target.value }))}
                placeholder="Received cash from worker"
                className="form-input w-full resize-none text-xs"
              />
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setPayModal({ open: false, fineId: null, payment_method: '', notes: '' })}
                disabled={paying}
                className="btn-outline text-sm px-4 py-1.5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={submitPay}
                disabled={paying || !payModal.payment_method}
                className="text-sm px-4 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white font-medium transition-colors disabled:opacity-50"
              >
                {paying ? 'Saving…' : 'Confirm Paid'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deduct from Payroll modal */}
      {deductModal.open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => !deducting && setDeductModal({ open: false, fineId: null, deduction_month: currentMonth(), notes: '' })}
        >
          <div
            ref={deductPanelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Deduct from Payroll"
            className="bg-surface-1 border border-border-soft rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-text-base">Deduct from Payroll</h2>
            {deductFine && deductWorker && (
              <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-emerald-300">Salary after deduction</span>
                  <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-xs font-semibold text-emerald-300">
                    {formatPkr(salaryAfterDeduction)}
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-text-muted">
                  {formatPkr(deductSalary)} salary - {formatPkr(deductFineAmount)} fine
                </p>
              </div>
            )}
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Payroll month</label>
              <MonthPicker value={deductModal.deduction_month} onChange={(m) => setDeductModal((p) => ({ ...p, deduction_month: m }))} />
            </div>
            <div className="space-y-1">
              <label htmlFor="deduct-notes" className="text-xs text-text-muted">Notes (optional)</label>
              <textarea
                id="deduct-notes"
                rows={2}
                value={deductModal.notes}
                onChange={(e) => setDeductModal((p) => ({ ...p, notes: e.target.value }))}
                placeholder="Deduct from this month's payroll"
                className="form-input w-full resize-none text-xs"
              />
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setDeductModal({ open: false, fineId: null, deduction_month: currentMonth(), notes: '' })}
                disabled={deducting}
                className="btn-outline text-sm px-4 py-1.5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={submitDeduct}
                disabled={deducting || !deductModal.deduction_month}
                className="text-sm px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white font-medium transition-colors disabled:opacity-50"
              >
                {deducting ? 'Saving…' : 'Confirm Deduct'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Waive modal */}
      {waiveModal.open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => !waiving && setWaiveModal({ open: false, fineId: null, reason: '', notes: '' })}
        >
          <div
            ref={waivePanelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Waive Fine"
            className="bg-surface-1 border border-border-soft rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-text-base">Waive Fine</h2>
            <div className="space-y-1">
              <label htmlFor="waive-reason" className="text-xs text-text-muted">Reason</label>
              <textarea
                id="waive-reason"
                rows={3}
                value={waiveModal.reason}
                onChange={(e) => setWaiveModal((p) => ({ ...p, reason: e.target.value }))}
                placeholder="Waived by Manager - First offense"
                className="form-input w-full resize-none text-xs"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="waive-notes" className="text-xs text-text-muted">Notes (optional)</label>
              <textarea
                id="waive-notes"
                rows={2}
                value={waiveModal.notes}
                onChange={(e) => setWaiveModal((p) => ({ ...p, notes: e.target.value }))}
                placeholder="Additional context"
                className="form-input w-full resize-none text-xs"
              />
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setWaiveModal({ open: false, fineId: null, reason: '', notes: '' })}
                disabled={waiving}
                className="btn-outline text-sm px-4 py-1.5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={submitWaive}
                disabled={waiving || !waiveModal.reason.trim()}
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
