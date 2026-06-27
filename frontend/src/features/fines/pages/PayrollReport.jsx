import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { api } from '../../../services/api/client.js';
import MonthPicker from '../../../components/ui/MonthPicker.jsx';
import RiskInsightsPanel from '../components/RiskInsightsPanel.jsx';
import { useToast } from '../../../store/ToastContext.jsx';

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
const CHART_TICK_STEP = 15000;
const CHART_VISIBLE_LIMIT = 5;

const STAT_THEMES = {
  neutral: {
    value: 'text-cyan-400',
    dot: 'bg-cyan-400',
    card: 'hover:border-cyan-400/40 hover:bg-cyan-400/[0.03]',
  },
  attention: {
    value: 'text-amber-400',
    dot: 'bg-amber-400',
    card: 'hover:border-amber-400/40 hover:bg-amber-400/[0.04]',
  },
  settled: {
    value: 'text-emerald-400',
    dot: 'bg-emerald-400',
    card: 'hover:border-emerald-400/40 hover:bg-emerald-400/[0.04]',
  },
  inactive: {
    value: 'text-text-muted',
    dot: 'bg-slate-500',
    card: 'hover:border-slate-400/30 hover:bg-slate-400/[0.03]',
  },
};

const STAT_LEGEND = [
  { label: 'Totals', theme: 'neutral' },
  { label: 'Pending', theme: 'attention' },
  { label: 'Settled', theme: 'settled' },
  { label: 'Inactive/zero', theme: 'inactive' },
];

const WORKER_COLUMNS = [
  { key: 'employee_id', label: 'Employee ID', sortable: true, align: 'left' },
  { key: 'worker_name', label: 'Name', sortable: true, align: 'left' },
  { key: 'department', label: 'Department', sortable: true, align: 'left' },
  { key: 'fine_count', label: 'Fine Count', sortable: true, align: 'right' },
  { key: 'breakdown', label: 'Fine Breakdown', sortable: false, align: 'left' },
  { key: 'total_fines', label: 'Total Fines', sortable: true, align: 'right' },
];

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function buildPkrAxis(maxValue) {
  let step = CHART_TICK_STEP;
  let axisMax = Math.max(step, Math.ceil(Number(maxValue || 0) / step) * step);
  while (axisMax / step > 6) step *= 2;
  axisMax = Math.max(step, Math.ceil(Number(maxValue || 0) / step) * step);
  const ticks = Array.from({ length: Math.floor(axisMax / step) + 1 }, (_, i) => i * step);
  return { axisMax, ticks };
}

function compareValues(a, b) {
  if (typeof a === 'number' || typeof b === 'number') {
    return Number(a || 0) - Number(b || 0);
  }
  return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' });
}

function CsvIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 1.75h5l3 3V14.25H4z" />
      <path d="M9 1.75V5h3" />
      <path d="M6.25 8.25h3.5M6.25 10.5h3.5" />
    </svg>
  );
}

function DownloadIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M8 2.25v7" />
      <path d="M5.25 7.25 8 10l2.75-2.75" />
      <path d="M3 13.25h10" />
    </svg>
  );
}

function LockIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3.25" y="7" width="9.5" height="7" rx="1.5" />
      <path d="M5.25 7V5.25a2.75 2.75 0 0 1 5.5 0V7" />
    </svg>
  );
}

function CheckIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m3.25 8.25 3 3L12.75 4.75" />
    </svg>
  );
}

function SortIndicator({ active, direction }) {
  return (
    <span className={`ml-1 inline-flex flex-col ${active ? 'text-brand' : 'text-text-subtle'}`} aria-hidden="true">
      <svg viewBox="0 0 8 5" fill="currentColor" className={`h-1.5 w-2 ${active && direction === 'asc' ? 'opacity-100' : 'opacity-35'}`}>
        <path d="M4 0 8 5H0z" />
      </svg>
      <svg viewBox="0 0 8 5" fill="currentColor" className={`h-1.5 w-2 ${active && direction === 'desc' ? 'opacity-100' : 'opacity-35'}`}>
        <path d="M4 5 0 0h8z" />
      </svg>
    </span>
  );
}

function StatCard({ label, value, rawValue, theme, loading }) {
  const resolvedTheme = !loading && Number(rawValue || 0) === 0 ? 'inactive' : theme;
  const tone = STAT_THEMES[resolvedTheme] ?? STAT_THEMES.neutral;
  return (
    <div className={`bg-surface-1 border border-border-soft rounded-xl px-4 py-3 transition-colors duration-200 ${tone.card}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
        <p className="text-xs text-text-muted">{label}</p>
      </div>
      {loading ? (
        <span className="skel-line w-20 h-7" />
      ) : (
        <p className={`text-2xl font-bold leading-tight tabular-nums ${tone.value}`}>{value}</p>
      )}
    </div>
  );
}

function FineValueLabel({ x = 0, y = 0, width = 0, height = 0, value }) {
  const amount = `PKR ${Number(value).toLocaleString()}`;
  const inside = width > 112;
  return (
    <text
      x={inside ? x + width - 8 : x + width + 8}
      y={y + height / 2}
      dy={4}
      textAnchor={inside ? 'end' : 'start'}
      fill={inside ? '#082f49' : '#94a3b8'}
      fontSize={11}
      fontWeight={600}
    >
      {amount}
    </text>
  );
}

function FineBreakdownBadges({ breakdown = [] }) {
  const visible = breakdown.slice(0, 3);
  const hidden = breakdown.length - visible.length;
  if (breakdown.length === 0) {
    return <span className="text-text-subtle">-</span>;
  }
  return (
    <div className="flex max-w-[18rem] flex-wrap gap-1.5">
      {visible.map((b) => (
        <span key={b.violation_type} className={`${VIOLATION_BADGES[b.violation_type] || 'badge-default'} inline-flex shrink-0 items-center whitespace-nowrap text-[10px]`}>
          {b.violation_type} &times;{b.count}
        </span>
      ))}
      {hidden > 0 && (
        <span
          className="badge-default inline-flex shrink-0 items-center whitespace-nowrap text-[10px]"
          title={breakdown.slice(3).map((b) => `${b.violation_type} x${b.count}`).join(', ')}
        >
          +{hidden} more
        </span>
      )}
    </div>
  );
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
  const [showAllBars, setShowAllBars] = useState(false);
  const [sort, setSort] = useState({ key: null, direction: 'desc' });

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

  const visibleChartData = useMemo(
    () => (showAllBars ? chartData : chartData.slice(0, CHART_VISIBLE_LIMIT)),
    [chartData, showAllBars]
  );

  const hiddenChartCount = Math.max(0, chartData.length - visibleChartData.length);
  const chartMaxValue = visibleChartData.reduce((max, w) => Math.max(max, Number(w.total || 0)), 0);
  const { axisMax: chartAxisMax, ticks: chartTicks } = useMemo(() => buildPkrAxis(chartMaxValue), [chartMaxValue]);
  const chartHeight = Math.max(132, visibleChartData.length * 36 + 54);

  const sortedWorkers = useMemo(() => {
    if (!sort.key) return filteredWorkers;
    const rows = [...filteredWorkers];
    rows.sort((a, b) => {
      const workerA = workerDeptMap[a.worker_id];
      const workerB = workerDeptMap[b.worker_id];
      const direction = sort.direction === 'asc' ? 1 : -1;
      let left;
      let right;
      switch (sort.key) {
        case 'department':
          left = workerA?.department ?? '';
          right = workerB?.department ?? '';
          break;
        case 'fine_count':
        case 'total_fines':
          left = Number(a[sort.key] || 0);
          right = Number(b[sort.key] || 0);
          break;
        default:
          left = a[sort.key] ?? '';
          right = b[sort.key] ?? '';
      }
      return compareValues(left, right) * direction;
    });
    return rows;
  }, [filteredWorkers, sort, workerDeptMap]);

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

  const handleSort = useCallback((key) => {
    setSort((prev) => {
      if (prev.key !== key) return { key, direction: 'desc' };
      return { key, direction: prev.direction === 'desc' ? 'asc' : 'desc' };
    });
  }, []);

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
        doc.text(`${w.worker_name} — ${w.fine_count} violations in ${monthLabel}`, marginX + 10, y + 14 + (i + 1) * 12);
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
          <MonthPicker value={month} onChange={setMonth} className="[&>button]:h-11 [&>button]:py-0" />
          <select
            aria-label="Department"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="form-select h-11 text-xs py-0"
          >
            <option value="">All Departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <button
            onClick={exportCSV}
            disabled={filteredWorkers.length === 0}
            className="btn-outline inline-flex h-11 items-center gap-1.5 px-3 py-0 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <CsvIcon />
            <span>Export CSV</span>
          </button>
          <button
            onClick={exportPDF}
            disabled={filteredWorkers.length === 0}
            className="btn-outline inline-flex h-11 items-center gap-1.5 px-3 py-0 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <DownloadIcon />
            <span>Download PDF</span>
          </button>
          <button
            onClick={handleFinalize}
            disabled={!report?.pending_count || finalizing || loading}
            className={`inline-flex h-11 items-center gap-1.5 rounded-lg border px-3 py-0 text-xs font-semibold transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed ${
              report?.pending_count
                ? 'border-amber-500/40 bg-amber-500/15 text-amber-700 hover:-translate-y-px hover:bg-amber-500/20 dark:text-amber-300'
                : 'border-border-strong bg-surface-1 text-text-muted'
            }`}
            title={report?.pending_count ? `Mark ${report.pending_count} pending fine(s) as deducted` : 'No pending fines for this month'}
          >
            {report?.pending_count ? <LockIcon /> : <CheckIcon />}
            <span>{finalizing ? 'Finalizing…' : report?.pending_count ? `Finalize Month (${report.pending_count})` : 'Finalized ✓'}</span>
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
                {w.worker_name} — {w.fine_count} violations in {monthLabel}. Mandatory safety re-training recommended.
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* n8n Risk Insights (read-only — populated by the monthly n8n agent run) */}
      <RiskInsightsPanel selectedMonth={month} />

      {/* Stats cards */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[10px] text-text-muted">
          {STAT_LEGEND.map((item) => {
            const tone = STAT_THEMES[item.theme];
            return (
              <span key={item.label} className="inline-flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                {item.label}
              </span>
            );
          })}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { label: 'Total PKR', value: totalAmount.toLocaleString(), rawValue: totalAmount, theme: 'neutral' },
            { label: 'Workers with Fines', value: workersCount, rawValue: workersCount, theme: 'neutral' },
            { label: 'Pending Amount', value: pendingAmount.toLocaleString(), rawValue: pendingAmount, theme: 'attention' },
            { label: 'Paid Amount', value: paidAmount.toLocaleString(), rawValue: paidAmount, theme: 'settled' },
            { label: 'Deducted Amount', value: deductedAmount.toLocaleString(), rawValue: deductedAmount, theme: 'settled' },
            { label: 'Waived Amount', value: waivedAmount.toLocaleString(), rawValue: waivedAmount, theme: 'inactive' },
          ].map((item) => (
            <StatCard key={item.label} {...item} loading={loading} />
          ))}
        </div>
      </div>

      {/* Bar chart */}
      <div className="bg-surface-1 border border-border-soft rounded-xl p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-text-base">Total Fine Amount by Worker</h2>
          {chartData.length > CHART_VISIBLE_LIMIT && (
            <button
              type="button"
              onClick={() => setShowAllBars((value) => !value)}
              className="text-[11px] font-medium text-brand hover:text-brand-hover transition-colors"
            >
              {showAllBars ? 'Show top 5' : `Show all (${chartData.length})`}
            </button>
          )}
        </div>
        {loading ? (
          <div className="space-y-3" style={{ height: chartHeight }}>
            {Array.from({ length: Math.min(3, Math.max(1, chartData.length || 3)) }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="skel-line h-3 w-16" />
                <span className="skel-line h-5 flex-1" style={{ maxWidth: `${80 - i * 18}%` }} />
              </div>
            ))}
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex min-h-[132px] items-center justify-center text-text-subtle text-xs">
            No fines for {month}{department ? ` in ${department}` : ''}.
          </div>
        ) : (
          <ResponsiveContainer
            width="100%"
            height={chartHeight}
          >
            <BarChart data={visibleChartData} layout="vertical" margin={{ top: 4, right: 112, left: 8, bottom: 2 }}>
              <CartesianGrid horizontal={false} vertical stroke="rgba(148, 163, 184, 0.14)" />
              <XAxis
                type="number"
                domain={[0, chartAxisMax]}
                ticks={chartTicks}
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
                barSize={visibleChartData.length <= 2 ? 22 : 18}
                minPointSize={2}
                animationDuration={600}
              >
                <LabelList
                  dataKey="total"
                  content={<FineValueLabel />}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        {!loading && hiddenChartCount > 0 && (
          <p className="mt-2 text-[11px] text-text-subtle">
            Showing top {CHART_VISIBLE_LIMIT}; {hiddenChartCount} more worker{hiddenChartCount === 1 ? '' : 's'} hidden.
          </p>
        )}
      </div>

      {/* Worker table */}
      <div className="bg-surface-1 border border-border-soft rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border-soft">
          <h2 className="text-sm font-semibold text-text-base">Workers Summary</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-xs">
            <thead className="bg-surface-2/80">
              <tr className="border-b border-border-soft">
                {WORKER_COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    className={`px-4 py-3 text-text-muted font-semibold uppercase tracking-wider ${
                      column.align === 'right' ? 'text-right' : 'text-left'
                    }`}
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        onClick={() => handleSort(column.key)}
                        className={`inline-flex items-center gap-1 transition-colors hover:text-text-base ${
                          column.align === 'right' ? 'justify-end' : 'justify-start'
                        }`}
                      >
                        <span>{column.label}</span>
                        <SortIndicator active={sort.key === column.key} direction={sort.direction} />
                      </button>
                    ) : (
                      column.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-t border-border-soft">
                    {Array.from({ length: WORKER_COLUMNS.length }).map((__, j) => (
                      <td key={j} className="px-4 py-3"><span className="skel-line" /></td>
                    ))}
                  </tr>
                ))
              ) : filteredWorkers.length === 0 ? (
                <tr>
                  <td colSpan={WORKER_COLUMNS.length} className="px-4 py-10 text-center">
                    <div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-text-subtle">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border-soft bg-surface-2 text-sm">PKR</span>
                      <p className="text-sm font-medium text-text-base">No worker fines found</p>
                      <p className="text-xs">No fines for {month}{department ? ` in ${department}` : ''}.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                sortedWorkers.map((w, index) => {
                  const worker = workerDeptMap[w.worker_id];
                  return (
                    <tr
                      key={w.worker_id}
                      className={`border-t border-border-soft transition-colors hover:bg-cyan-500/5 ${
                        index % 2 === 1 ? 'bg-surface-2/20' : ''
                      }`}
                    >
                      <td className="px-4 py-3 font-mono text-text-muted">{w.employee_id}</td>
                      <td className="px-4 py-3 font-medium text-text-base">{w.worker_name}</td>
                      <td className="px-4 py-3 text-text-muted">{worker?.department ?? '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-text-base">{w.fine_count}</td>
                      <td className="px-4 py-3">
                        <FineBreakdownBadges breakdown={w.breakdown ?? []} />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-cyan-400 font-semibold">
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
