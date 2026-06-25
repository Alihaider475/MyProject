import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { api } from '../../../api/client.js';
import MonthPicker from '../../../components/ui/MonthPicker.jsx';
import { useToast } from '../../../context/ToastContext.jsx';

const VIOLATION_BADGES = {
  'NO-Hardhat':     'badge-hardhat',
  'NO-Mask':        'badge-mask',
  'NO-Safety Vest': 'badge-vest',
};

const VIOLATION_COLORS = {
  'NO-Mask':        '#F59E0B',
  'NO-Hardhat':     '#EF4444',
  'NO-Safety Vest': '#F97316',
};

const RISK_VIOLATION_THRESHOLD = 50;

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

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

export default function PayrollReport() {
  const { showToast } = useToast();
  const [month, setMonth] = useState(currentMonth);
  const [report, setReport] = useState(null);
  const [workers, setWorkers] = useState([]);
  const [department, setDepartment] = useState('');
  const [loading, setLoading] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [reportData, workersData] = await Promise.all([
        api.monthlyFineReport(month).catch(() => ({ month, total_amount: 0, workers: [] })),
        api.listWorkers().catch(() => []),
      ]);
      setReport(reportData);
      setWorkers(Array.isArray(workersData) ? workersData : workersData?.items ?? []);
    } catch (err) {
      showToast({ title: 'Error', message: err.message, level: 'error' });
    } finally {
      setLoading(false);
    }
  }, [month, showToast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Build worker lookup for department
  const workerDeptMap = useMemo(() => {
    const map = {};
    workers.forEach((w) => { map[w.id] = w; });
    return map;
  }, [workers]);

  const departments = useMemo(() => {
    const depts = new Set(workers.map((w) => w.department).filter(Boolean));
    return Array.from(depts).sort();
  }, [workers]);

  const filteredWorkers = useMemo(() => {
    const rows = report?.workers ?? [];
    if (!department) return rows;
    return rows.filter((r) => {
      const w = workerDeptMap[r.worker_id];
      return w?.department === department;
    });
  }, [report, department, workerDeptMap]);

  const totalAmount = filteredWorkers.reduce((s, w) => s + w.total_fines, 0);
  const workersCount = filteredWorkers.length;

  // Status-based PKR totals for the month, computed server-side — global
  // (not department-filtered), matching the existing pending_count/finalize-month scope.
  const pendingAmount = report?.total_pending ?? 0;
  const paidAmount = report?.total_paid ?? 0;
  const deductedAmount = report?.total_deducted ?? 0;
  const waivedAmount = report?.total_waived ?? 0;

  const chartData = useMemo(
    () =>
      filteredWorkers
        .map((w) => ({
          name: w.worker_name.split(' ')[0],
          fullName: w.worker_name,
          total: w.total_fines,
          breakdown: w.breakdown ?? [],
        }))
        .sort((a, b) => b.total - a.total),
    [filteredWorkers]
  );

  const monthLabel = useMemo(() => {
    const [y, m] = month.split('-');
    return new Date(Number(y), Number(m) - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
  }, [month]);

  const riskWorkers = useMemo(
    () => filteredWorkers.filter((w) => w.fine_count > RISK_VIOLATION_THRESHOLD),
    [filteredWorkers]
  );

  const handleFinalize = useCallback(async () => {
    if (!report?.pending_count) return;
    const ok = window.confirm(
      `Finalize ${monthLabel}? This marks ${report.pending_count} pending fine${report.pending_count === 1 ? '' : 's'} as deducted and cannot be undone.`
    );
    if (!ok) return;
    setFinalizing(true);
    try {
      const res = await api.finalizeMonth(month);
      showToast({ title: 'Month finalized', message: `${res.updated_count} fine(s) marked as deducted.`, level: 'success' });
      await fetchData();
    } catch (err) {
      showToast({ title: 'Error', message: err.message, level: 'error' });
    } finally {
      setFinalizing(false);
    }
  }, [report, month, monthLabel, showToast, fetchData]);

  function exportCSV() {
    const header = 'Employee ID,Name,Department,Total Fines,Fine Count,Fine Breakdown,Deduction Month';
    const rows = filteredWorkers.map((w) => {
      const worker = workerDeptMap[w.worker_id];
      const dept = worker?.department ?? '';
      const breakdown = (w.breakdown ?? []).map((b) => `${b.violation_type} x${b.count}`).join('; ');
      return `${w.employee_id},${w.worker_name},${dept},${w.total_fines},${w.fine_count},${breakdown},${monthLabel}`;
    });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPDF() {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const marginX = 40;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const navy = [15, 32, 64];
    const money = (n) => `PKR ${Number(n).toLocaleString()}`;

    // Correct totals: sum the actual fine counts (not the worker count)
    const totalFineCount = filteredWorkers.reduce((s, w) => s + Number(w.fine_count), 0);

    // ── Corporate header band ──────────────────────────────────────────────
    doc.setFillColor(...navy);
    doc.rect(0, 0, pageWidth, 70, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('SafeSite AI', marginX, 32);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text('Payroll Deduction Report', marginX, 52);

    // Meta block
    doc.setTextColor(71, 85, 105);
    doc.setFontSize(10);
    doc.text(`Month: ${monthLabel}`, marginX, 96);
    doc.text(`Department: ${department || 'All Departments'}`, marginX, 110);
    doc.text(`Generated: ${new Date().toLocaleString()}`, marginX, 124);

    // ── Table ──────────────────────────────────────────────────────────────
    autoTable(doc, {
      startY: 144,
      margin: { left: marginX, right: marginX, bottom: 60 },
      head: [['Employee ID', 'Name', 'Department', 'Fine Count', 'Fine Breakdown', 'Total Fines']],
      body: filteredWorkers.map((w) => {
        const worker = workerDeptMap[w.worker_id];
        const breakdown = (w.breakdown ?? []).map((b) => `${b.violation_type} ×${b.count}`).join(', ');
        return [
          w.employee_id || '—',
          w.worker_name,
          worker?.department ?? '—',
          String(w.fine_count),
          breakdown || '—',
          money(w.total_fines),
        ];
      }),
      foot: [['', '', 'Total', String(totalFineCount), '', money(totalAmount)]],
      styles: { fontSize: 9, cellPadding: 6 },
      headStyles: { fillColor: navy, textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [226, 232, 240], textColor: navy, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      // Right-align numeric columns (Fine Count, Total Fines); shrink breakdown text
      columnStyles: { 3: { halign: 'right' }, 4: { fontSize: 7.5 }, 5: { halign: 'right' } },
    });

    // ── Risk alert box (conditional — any worker over the violation threshold) ──
    let y = doc.lastAutoTable.finalY + 30;
    if (riskWorkers.length > 0) {
      const boxHeight = 18 + riskWorkers.length * 12;
      if (y + boxHeight > pageHeight - 110) {
        doc.addPage();
        y = 50;
      }
      doc.setFillColor(255, 251, 235);
      doc.setDrawColor(245, 158, 11);
      doc.roundedRect(marginX, y, pageWidth - marginX * 2, boxHeight, 4, 4, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(146, 64, 14);
      doc.text('High Violation Volume — Mandatory Safety Re-training Recommended', marginX + 10, y + 14);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      riskWorkers.forEach((w, i) => {
        doc.text(`${w.worker_name} — ${w.fine_count} violations this month`, marginX + 10, y + 14 + (i + 1) * 12);
      });
      y += boxHeight + 30;
    } else {
      y += 30;
    }

    // ── Signature block ────────────────────────────────────────────────────
    if (y > pageHeight - 110) {
      doc.addPage();
      y = 90;
    }
    const lineW = 190;
    const rightX = pageWidth - marginX - lineW;
    doc.setDrawColor(148, 163, 184);
    doc.line(marginX, y, marginX + lineW, y);
    doc.line(rightX, y, rightX + lineW, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...navy);
    doc.text('Prepared By', marginX, y + 14);
    doc.text('Approved By', rightX, y + 14);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text('Safety Manager', marginX, y + 28);
    doc.text('System Administrator', rightX, y + 28);

    // ── Footer: page numbers + confidentiality notice on every page ────────
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i += 1) {
      doc.setPage(i);
      const ph = doc.internal.pageSize.getHeight();
      const pw = doc.internal.pageSize.getWidth();
      doc.setDrawColor(226, 232, 240);
      doc.line(marginX, ph - 38, pw - marginX, ph - 38);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184);
      doc.text('CONFIDENTIAL — SafeSite AI. For internal payroll use only.', marginX, ph - 24);
      doc.text(`Page ${i} of ${pageCount}`, pw - marginX, ph - 24, { align: 'right' });
    }

    doc.save(`payroll-${month}.pdf`);
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold text-text-base">Payroll Report</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs text-text-muted">Month:</label>
          <MonthPicker value={month} onChange={setMonth} />
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="form-select text-xs py-1.5"
          >
            <option value="">All Departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <button
            onClick={exportCSV}
            disabled={filteredWorkers.length === 0}
            className="btn-outline text-xs px-3 py-1.5 disabled:opacity-40"
          >
            Export CSV
          </button>
          <button
            onClick={exportPDF}
            disabled={filteredWorkers.length === 0}
            className="btn-outline text-xs px-3 py-1.5 disabled:opacity-40"
          >
            Download PDF
          </button>
          <button
            onClick={handleFinalize}
            disabled={!report?.pending_count || finalizing || loading}
            className="btn-outline text-xs px-3 py-1.5 disabled:opacity-40"
            title={report?.pending_count ? `Mark ${report.pending_count} pending fine(s) as deducted` : 'No pending fines for this month'}
          >
            {finalizing ? 'Finalizing…' : report?.pending_count ? `Finalize Month (${report.pending_count})` : 'Finalized ✓'}
          </button>
        </div>
      </div>

      {/* Risk alert banner */}
      {riskWorkers.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
          <p className="text-sm font-semibold text-amber-400 mb-1.5">⚠ High violation volume detected</p>
          <ul className="text-xs text-amber-300/90 space-y-0.5">
            {riskWorkers.map((w) => (
              <li key={w.worker_id}>
                {w.worker_name} — {w.fine_count} violations this month. Mandatory safety re-training recommended.
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: 'Total PKR', value: loading ? '—' : totalAmount.toLocaleString(), color: 'text-cyan-400' },
          { label: 'Workers with Fines', value: loading ? '—' : workersCount, color: 'text-blue-400' },
          { label: 'Pending Amount', value: loading ? '—' : pendingAmount.toLocaleString(), color: 'text-amber-400' },
          { label: 'Paid Amount', value: loading ? '—' : paidAmount.toLocaleString(), color: 'text-sky-400' },
          { label: 'Deducted Amount', value: loading ? '—' : deductedAmount.toLocaleString(), color: 'text-emerald-400' },
          { label: 'Waived Amount', value: loading ? '—' : waivedAmount.toLocaleString(), color: 'text-text-muted' },
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
            No fines for {month}{department ? ` in ${department}` : ''}.
          </div>
        ) : (
          <ResponsiveContainer
            width="100%"
            height={chartData.length === 1 ? 240 : Math.max(260, chartData.length * 44)}
          >
            <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 70, left: 10, bottom: 8 }}>
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
              <Bar
                dataKey="total"
                fill="#22d3ee"
                radius={[0, 4, 4, 0]}
                barSize={chartData.length <= 2 ? 40 : chartData.length <= 6 ? 28 : 18}
                animationDuration={600}
              >
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

      {/* Worker table */}
      <div className="bg-surface-1 border border-border-soft rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border-soft">
          <h2 className="text-sm font-semibold text-text-base">Workers Summary</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface-2">
              <tr>
                {['Employee ID', 'Name', 'Department', 'Fine Count', 'Fine Breakdown', 'Total Fines'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-text-muted font-semibold uppercase tracking-wider">
                    {h}
                  </th>
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
              ) : filteredWorkers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-text-subtle">
                    No fines for {month}{department ? ` in ${department}` : ''}.
                  </td>
                </tr>
              ) : (
                filteredWorkers.map((w) => {
                  const worker = workerDeptMap[w.worker_id];
                  return (
                    <tr key={w.worker_id} className="border-t border-border-soft hover:bg-surface-2/40 transition-colors">
                      <td className="px-4 py-2.5 font-mono text-text-muted">{w.employee_id}</td>
                      <td className="px-4 py-2.5 text-text-base">{w.worker_name}</td>
                      <td className="px-4 py-2.5 text-text-muted">{worker?.department ?? '—'}</td>
                      <td className="px-4 py-2.5 tabular-nums">{w.fine_count}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {(w.breakdown ?? []).map((b) => (
                            <span key={b.violation_type} className={`${VIOLATION_BADGES[b.violation_type] || 'badge-default'} text-[10px]`}>
                              {b.violation_type} &times;{b.count}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-cyan-400 font-semibold">
                        PKR {Number(w.total_fines).toLocaleString()}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
