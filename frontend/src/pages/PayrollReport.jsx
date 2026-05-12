import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function PayrollReport() {
  const { showToast } = useToast();
  const [month, setMonth] = useState(currentMonth);
  const [report, setReport] = useState(null);
  const [workers, setWorkers] = useState([]);
  const [department, setDepartment] = useState('');
  const [loading, setLoading] = useState(false);

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

  // Pending / deducted amounts need fine-level data — use report totals as proxy
  const allWorkers = report?.workers ?? [];
  const pendingAmount = allWorkers.reduce((s, w) => s + w.total_fines, 0);

  const chartData = filteredWorkers.map((w) => ({
    name: w.worker_name.split(' ')[0],
    total: w.total_fines,
  }));

  function exportCSV() {
    const monthLabel = (() => {
      const [y, m] = month.split('-');
      return new Date(Number(y), Number(m) - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
    })();
    const header = 'Employee ID,Name,Department,Total Fines,Fine Count,Deduction Month';
    const rows = filteredWorkers.map((w) => {
      const worker = workerDeptMap[w.worker_id];
      const dept = worker?.department ?? '';
      return `${w.employee_id},${w.worker_name},${dept},${w.total_fines},${w.fine_count},${monthLabel}`;
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

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold text-text-base">Payroll Report</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs text-text-muted">Month:</label>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-border-soft bg-surface-1 text-text-base text-xs focus:outline-none focus:ring-1 focus:ring-brand"
          />
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
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total PKR', value: loading ? '—' : totalAmount.toLocaleString(), color: 'text-cyan-400' },
          { label: 'Workers with Fines', value: loading ? '—' : workersCount, color: 'text-blue-400' },
          { label: 'Pending Amount', value: loading ? '—' : pendingAmount.toLocaleString(), color: 'text-amber-400' },
          { label: 'Deducted', value: loading ? '—' : (totalAmount - pendingAmount > 0 ? (totalAmount - pendingAmount).toLocaleString() : '0'), color: 'text-emerald-400' },
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
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#e2e8f0' }}
                itemStyle={{ color: '#06b6d4' }}
                formatter={(v) => [`PKR ${Number(v).toFixed(0)}`, 'Total']}
              />
              <Bar dataKey="total" fill="#06b6d4" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Worker table */}
      <div className="bg-surface-1 border border-border-soft rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border-soft">
          <h2 className="text-sm font-semibold text-text-base">Workers Summary</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface-2">
              <tr>
                {['Employee ID', 'Name', 'Department', 'Fine Count', 'Total Fines'].map((h) => (
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
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j} className="px-4 py-2.5"><span className="skel-line" /></td>
                    ))}
                  </tr>
                ))
              ) : filteredWorkers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-text-subtle">
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
