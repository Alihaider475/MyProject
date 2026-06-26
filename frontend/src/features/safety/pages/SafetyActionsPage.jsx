import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../services/api/client.js';
import MonthPicker from '../../../components/ui/MonthPicker.jsx';
import { useToast } from '../../../store/ToastContext.jsx';
import { useEscapeKey } from '../../../hooks/useEscapeKey.js';
import { useFocusTrap } from '../../../hooks/useFocusTrap.js';

const PRIORITY_CLASS = {
  P1: 'text-red-400 bg-red-400/10 border-red-400/30',
  P2: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
  P3: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
};

const STATUS_CLASS = {
  pending: 'text-sky-400 bg-sky-400/10 border-sky-400/30',
  escalated: 'text-red-400 bg-red-400/10 border-red-400/30',
  completed: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
};

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatDate(value) {
  if (!value) return '-';
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function CheckIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg aria-hidden="true" focusable="false" className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13.2 4.2 6.4 11 2.8 7.4" />
    </svg>
  );
}

function RefreshIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg aria-hidden="true" focusable="false" className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13.2 6.2A5.2 5.2 0 0 0 3.1 4.8" />
      <path d="M3.1 2.2v2.6h2.6" />
      <path d="M2.8 9.8a5.2 5.2 0 0 0 10.1 1.4" />
      <path d="M12.9 13.8v-2.6h-2.6" />
    </svg>
  );
}

function Pill({ value, className }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${className}`}>
      {value}
    </span>
  );
}

export default function SafetyActionsPage() {
  const { showToast } = useToast();
  const [month, setMonth] = useState(currentMonth);
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [completeModal, setCompleteModal] = useState(null);
  const [completionNotes, setCompletionNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const panelRef = useRef(null);

  useEscapeKey(() => setCompleteModal(null), !!completeModal && !saving);
  useFocusTrap(panelRef, !!completeModal);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listSafetyActions({ month, status, priority });
      setTasks(data.tasks ?? []);
    } catch (err) {
      showToast({ title: 'Error', message: err.message, level: 'error' });
    } finally {
      setLoading(false);
    }
  }, [month, status, priority, showToast]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const counts = useMemo(() => {
    return tasks.reduce(
      (acc, task) => {
        acc.total += 1;
        acc[task.status] = (acc[task.status] ?? 0) + 1;
        return acc;
      },
      { total: 0, pending: 0, escalated: 0, completed: 0 }
    );
  }, [tasks]);

  function openComplete(task) {
    setCompleteModal(task);
    setCompletionNotes('');
  }

  async function handleComplete() {
    if (!completeModal) return;
    setSaving(true);
    try {
      await api.completeSafetyAction(completeModal.id, {
        completion_notes: completionNotes.trim() || null,
      });
      showToast({ title: 'Completed', message: 'Safety action task marked completed.', level: 'success' });
      setCompleteModal(null);
      await fetchTasks();
    } catch (err) {
      showToast({ title: 'Error', message: err.message, level: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold text-text-base">Safety Corrective Actions</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs text-text-muted">Month:</label>
          <MonthPicker value={month} onChange={setMonth} />
          <select
            aria-label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="form-select text-xs py-1.5"
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="escalated">Escalated</option>
            <option value="completed">Completed</option>
          </select>
          <select
            aria-label="Priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="form-select text-xs py-1.5"
          >
            <option value="">All Priorities</option>
            <option value="P1">P1</option>
            <option value="P2">P2</option>
            <option value="P3">P3</option>
          </select>
          <button
            type="button"
            onClick={fetchTasks}
            disabled={loading}
            title="Refresh tasks"
            className="btn-outline text-xs px-3 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-40"
          >
            <RefreshIcon />
            <span>{loading ? 'Refreshing' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total', value: counts.total, color: 'text-cyan-400' },
          { label: 'Pending', value: counts.pending, color: 'text-sky-400' },
          { label: 'Escalated', value: counts.escalated, color: 'text-red-400' },
          { label: 'Completed', value: counts.completed, color: 'text-emerald-400' },
        ].map((item) => (
          <div key={item.label} className="bg-surface-1 border border-border-soft rounded-xl p-4">
            <p className="text-xs text-text-muted mb-1">{item.label}</p>
            <p className={`text-2xl font-bold ${item.color}`}>{loading ? '-' : item.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-surface-1 border border-border-soft rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border-soft">
          <h2 className="text-sm font-semibold text-text-base">Tasks</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface-2">
              <tr>
                {['Worker Name', 'Month', 'Action Title', 'Priority', 'Status', 'Deadline', 'Risk Reason', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-text-muted font-semibold uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, row) => (
                  <tr key={row} className="border-t border-border-soft">
                    {Array.from({ length: 8 }).map((__, col) => (
                      <td key={col} className="px-4 py-3"><span className="skel-line" /></td>
                    ))}
                  </tr>
                ))
              ) : tasks.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-text-subtle">
                    No safety action tasks for the selected filters.
                  </td>
                </tr>
              ) : (
                tasks.map((task) => (
                  <tr key={task.id} className="border-t border-border-soft hover:bg-surface-2/40 transition-colors">
                    <td className="px-4 py-3 text-text-base font-medium whitespace-nowrap">{task.worker_name}</td>
                    <td className="px-4 py-3 text-text-muted tabular-nums whitespace-nowrap">{task.month}</td>
                    <td className="px-4 py-3 text-text-base min-w-48">{task.action_title}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Pill value={task.priority} className={PRIORITY_CLASS[task.priority] ?? PRIORITY_CLASS.P3} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Pill value={task.status} className={STATUS_CLASS[task.status] ?? STATUS_CLASS.pending} />
                    </td>
                    <td className="px-4 py-3 text-text-muted tabular-nums whitespace-nowrap">{formatDate(task.deadline_date)}</td>
                    <td className="px-4 py-3 text-text-muted min-w-64 max-w-sm">
                      <span className="line-clamp-2">{task.risk_reason}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {task.status === 'pending' || task.status === 'escalated' ? (
                        <button
                          type="button"
                          onClick={() => openComplete(task)}
                          title="Complete task"
                          className="inline-flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded border bg-emerald-400/10 text-emerald-400 border-emerald-400/30 hover:bg-emerald-400/20 transition-colors"
                        >
                          <CheckIcon />
                          <span>Complete</span>
                        </button>
                      ) : (
                        <span className="text-text-subtle">-</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {completeModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setCompleteModal(null)}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Complete Safety Action"
            className="bg-surface-1 border border-border-soft rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h2 className="text-base font-semibold text-text-base">Complete Safety Action</h2>
              <p className="text-xs text-text-muted mt-1">{completeModal.worker_name}</p>
            </div>
            <div className="rounded-lg border border-border-soft bg-surface-2 p-3">
              <p className="text-sm text-text-base font-medium">{completeModal.action_title}</p>
              <p className="text-xs text-text-muted mt-1">{completeModal.risk_reason}</p>
            </div>
            <div className="space-y-1">
              <label htmlFor="completion-notes" className="text-xs text-text-muted">Completion Notes</label>
              <textarea
                id="completion-notes"
                value={completionNotes}
                onChange={(e) => setCompletionNotes(e.target.value)}
                className="form-input w-full min-h-28 resize-y"
                placeholder="Optional notes"
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setCompleteModal(null)}
                className="btn-outline text-sm px-4 py-1.5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleComplete}
                disabled={saving}
                className="btn-brand text-sm px-4 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <CheckIcon />
                <span>{saving ? 'Completing' : 'Confirm Complete'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
