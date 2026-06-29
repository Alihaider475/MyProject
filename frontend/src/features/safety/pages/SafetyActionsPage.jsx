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

const PRIORITY_LABEL = {
  P1: 'P1 — Critical',
  P2: 'P2 — High',
  P3: 'P3 — Standard',
};

const STATUS_CLASS = {
  pending: 'text-sky-400 bg-sky-400/10 border-sky-400/30',
  escalated: 'text-red-400 bg-red-400/10 border-red-400/30',
  completed: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
};

const STATUS_LABEL = {
  pending: 'Pending',
  escalated: 'Escalated',
  completed: 'Completed by Admin',
};

const EFFECTIVENESS_CLASS = {
  effective: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  partially_effective: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
  not_effective: 'text-red-400 bg-red-400/10 border-red-400/30',
  no_after_data: 'text-slate-400 bg-slate-400/10 border-slate-400/30',
};

const EFFECTIVENESS_LABEL = {
  effective: 'Effective',
  partially_effective: 'Partially Effective',
  not_effective: 'Not Effective',
  no_after_data: 'No Data',
};

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(value) {
  if (!value) return '';
  const [y, m] = value.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
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

function AlertTriIcon({ className = 'w-4 h-4' }) {
  return (
    <svg aria-hidden="true" focusable="false" className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2 1.5 13.5h13L8 2z" />
      <path d="M8 6.5V9.5" />
      <circle cx="8" cy="11.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ClipboardPlusIcon({ className = 'w-4 h-4' }) {
  return (
    <svg aria-hidden="true" focusable="false" className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="3.5" width="9" height="10" rx="1.5" />
      <path d="M6 3.5V2.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" />
      <path d="M8 6.5v3M6.5 8h3" />
    </svg>
  );
}

function BarChartIcon({ className = 'w-4 h-4' }) {
  return (
    <svg aria-hidden="true" focusable="false" className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
      <path d="M2 13V8M5.5 13V5M9 13V9M12.5 13V6" />
    </svg>
  );
}

function ArrowRightIcon({ className = 'w-2.5 h-2.5' }) {
  return (
    <svg aria-hidden="true" focusable="false" className={className} viewBox="0 0 10 10" fill="currentColor">
      <path d="M3 1l6 4-6 4V1z" />
    </svg>
  );
}

const WORKFLOW_STEPS = [
  {
    label: 'Risk Detected',
    desc: 'n8n payroll agent flags a high-risk worker',
    Icon: AlertTriIcon,
    pingColor: '#f87171',
    bg: 'bg-red-500/10',
    ring: 'border-red-500/30',
    text: 'text-red-400',
    connectorColor: 'from-red-400/50 to-amber-400/50',
  },
  {
    label: 'Task Created',
    desc: 'Corrective action assigned automatically',
    Icon: ClipboardPlusIcon,
    pingColor: '#fbbf24',
    bg: 'bg-amber-500/10',
    ring: 'border-amber-500/30',
    text: 'text-amber-400',
    connectorColor: 'from-amber-400/50 to-sky-400/50',
  },
  {
    label: 'Admin Acts',
    desc: 'Safety manager completes the task',
    Icon: CheckIcon,
    pingColor: '#38bdf8',
    bg: 'bg-sky-500/10',
    ring: 'border-sky-500/30',
    text: 'text-sky-400',
    connectorColor: 'from-sky-400/50 to-emerald-400/50',
  },
  {
    label: 'n8n Measures',
    desc: 'Violations before vs after compared',
    Icon: BarChartIcon,
    pingColor: '#a78bfa',
    bg: 'bg-violet-500/10',
    ring: 'border-violet-500/30',
    text: 'text-violet-400',
    connectorColor: null,
  },
];

function splitRiskReason(text) {
  if (!text) return [text, null];
  const idx = text.indexOf(' — ');
  if (idx === -1) return [text, null];
  return [text.slice(0, idx), text.slice(idx + 3)];
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
  const [workflowStatus, setWorkflowStatus] = useState(null);
  const [triggeringEffectiveness, setTriggeringEffectiveness] = useState(new Set());
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

  const fetchWorkflowStatus = useCallback(async () => {
    try {
      const data = await api.workflowStatus(month);
      setWorkflowStatus(data);
    } catch {
      // informational only — silently ignore
    }
  }, [month]);

  useEffect(() => {
    fetchTasks();
    fetchWorkflowStatus();
  }, [fetchTasks, fetchWorkflowStatus]);

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

  const latestResult = useMemo(
    () => tasks.find(
      (t) => t.status === 'completed' && t.effectiveness?.improvement_percentage != null
    ) ?? null,
    [tasks]
  );

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
      fetchWorkflowStatus();
    } catch (err) {
      showToast({ title: 'Error', message: err.message, level: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function handleRunEffectivenessWorkflow(task) {
    setTriggeringEffectiveness((prev) => new Set([...prev, task.id]));
    try {
      await api.triggerEffectivenessWorkflow({ task_id: task.id, month: task.month });
      showToast({
        title: 'Workflow triggered',
        message: 'n8n effectiveness workflow started. Results will appear once n8n completes.',
        level: 'success',
      });
      setTimeout(() => {
        fetchTasks();
        fetchWorkflowStatus();
      }, 3500);
    } catch (err) {
      showToast({
        title: 'Failed to trigger',
        message: err?.response?.data?.detail ?? err.message,
        level: 'error',
      });
    } finally {
      setTriggeringEffectiveness((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
    }
  }

  const stepFlags = workflowStatus
    ? [
        workflowStatus.step1_risk_detected,
        workflowStatus.step2_tasks_created,
        workflowStatus.step3_admin_acted,
        workflowStatus.step4_effectiveness_measured,
      ]
    : [false, false, false, false];

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1 className="admin-page-title">Safety Corrective Actions</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="admin-label">Month</label>
          <MonthPicker value={month} onChange={setMonth} />
          <select
            aria-label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="form-select h-10 py-0 text-xs"
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
            className="form-select h-10 py-0 text-xs"
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
            aria-label="Refresh tasks"
            className="btn-outline inline-flex h-10 items-center gap-1.5 px-3 py-0 text-xs disabled:opacity-40"
          >
            <RefreshIcon />
            <span>{loading ? 'Refreshing' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* How n8n Safety Automation Works */}
      <div className="admin-card overflow-hidden">
        {/* Top accent gradient line */}
        <div className="hidden" />

        <div className="p-5 space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="admin-section-title">n8n Safety Automation</h2>
              <p className="mt-1 max-w-xl text-sm leading-5 text-text-muted">
                n8n automatically creates corrective tasks when payroll risk analysis identifies high-risk
                workers. After an admin completes a task, n8n re-runs to measure whether violations reduced.
              </p>
            </div>
            {/* Automated by n8n badge */}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-surface-2 px-2.5 py-1 text-[10px] font-semibold text-text-muted shrink-0 self-start">
              <span className="relative flex w-1.5 h-1.5">
                <span className="hidden" />
                <span className="relative rounded-full w-1.5 h-1.5 bg-brand" />
              </span>
              Automated by n8n
            </span>
          </div>

          {/* Workflow steps — reactive: green when completed, pinging on the current active step */}
          <div className="flex flex-wrap items-center w-full gap-y-3">
            {WORKFLOW_STEPS.map((step, i) => {
              const done = stepFlags[i];
              const active = !done && stepFlags.slice(0, i).every(Boolean);
              const iconBg = done ? 'bg-emerald-500/10' : active ? 'bg-brand/10' : 'bg-surface-2';
              const iconRing = done ? 'border-emerald-500/40' : active ? 'border-brand/45' : 'border-border-strong';
              const iconText = done ? 'text-emerald-400' : active ? 'text-brand' : 'text-text-subtle';
              const labelText = done ? 'text-emerald-400' : active ? 'text-text-base' : 'text-text-muted';
              return (
                <div key={step.label} className="flex min-w-[210px] flex-1 items-center">
                  {/* Step card */}
                  <div className="flex min-w-0 items-center gap-3">
                    {/* Icon */}
                    <div className="relative h-8 w-8 shrink-0">
                      {active && (
                        <span
                          className="hidden"
                        />
                      )}
                      <div className={`absolute inset-0 rounded-full ${iconBg} border ${iconRing} flex items-center justify-center ${iconText} transition-colors duration-200`}>
                        {done ? <CheckIcon className="h-3.5 w-3.5" /> : <step.Icon className="h-3.5 w-3.5" />}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <span className="admin-label block">{`0${i + 1}`}</span>
                      <p className={`text-xs font-semibold ${labelText}`}>{step.label}</p>
                      <p className="truncate text-xs text-text-muted">{step.desc}</p>
                    </div>
                  </div>

                  {/* Animated connector */}
                  {step.connectorColor && (
                    <div className="mx-4 hidden flex-1 items-center sm:flex">
                      <div className={`relative h-px flex-1 overflow-hidden rounded-full transition-colors duration-200 ${done ? 'bg-emerald-500/40' : 'bg-border-strong'}`}>
                        {done ? (
                          <div className="absolute inset-0 bg-emerald-400/60" />
                        ) : (
                          <div
                            className="hidden"
                          />
                        )}
                      </div>
                      <ArrowRightIcon className={`w-2.5 h-2.5 shrink-0 -ml-px transition-colors duration-200 ${done ? 'text-emerald-400' : 'text-text-subtle'}`} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Latest effectiveness result — shown only when a completed task with data exists */}
          {latestResult && (
            <div className="flex flex-wrap items-center gap-2.5 pt-3 border-t border-border-soft text-xs">
              <span className="text-[10px] font-semibold text-text-subtle uppercase tracking-wide">Latest result</span>
              <Pill
                value={EFFECTIVENESS_LABEL[latestResult.effectiveness.status] ?? latestResult.effectiveness.status}
                className={EFFECTIVENESS_CLASS[latestResult.effectiveness.status] ?? EFFECTIVENESS_CLASS.no_after_data}
              />
              {latestResult.effectiveness.improvement_percentage != null && (
                <span className={latestResult.effectiveness.improvement_percentage >= 0 ? 'text-emerald-400 font-medium' : 'text-red-400 font-medium'}>
                  {latestResult.effectiveness.improvement_percentage >= 0
                    ? `↓ ${latestResult.effectiveness.improvement_percentage.toFixed(0)}% violation reduction`
                    : `↑ ${Math.abs(latestResult.effectiveness.improvement_percentage).toFixed(0)}% increase`}
                </span>
              )}
              <span className="text-text-subtle">— {latestResult.worker_name}</span>
            </div>
          )}
        </div>
      </div>

      {/* Status Guide */}
      <div className="admin-card px-4 py-3">
        <p className="admin-label mb-2">Status Guide</p>
        <div className="flex flex-wrap gap-4 text-sm leading-5">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-sky-400 inline-block" />
            <span className="text-sky-400 font-semibold">Pending</span>
            <span className="text-gray-400">— Waiting for admin to take corrective action</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
            <span className="text-red-400 font-semibold">Escalated</span>
            <span className="text-gray-400">— Deadline missed; requires urgent attention</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
            <span className="text-emerald-400 font-semibold">Completed by Admin</span>
            <span className="text-gray-400">— Action completed by admin</span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total', value: counts.total, color: 'text-text-base', dot: 'bg-brand', filterStatus: '' },
          { label: 'Pending', value: counts.pending, color: 'text-brand', dot: 'bg-brand', filterStatus: 'pending' },
          { label: 'Escalated', value: counts.escalated, color: 'text-red-400', dot: 'bg-red-400', filterStatus: 'escalated' },
          { label: 'Completed', value: counts.completed, color: 'text-emerald-400', dot: 'bg-emerald-400', filterStatus: 'completed' },
        ].map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => setStatus(item.filterStatus)}
            aria-pressed={status === item.filterStatus}
            title={`Filter by ${item.label.toLowerCase()}`}
            className={`admin-kpi text-left focus:outline-none focus:ring-1 focus:ring-brand ${status === item.filterStatus ? 'border-brand/50 bg-surface-2' : ''}`}
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className={`w-2 h-2 rounded-full inline-block ${item.dot}`} />
              <p className="admin-label">{item.label}</p>
            </div>
            {loading ? (
              <span className="skel-line w-16 h-7" />
            ) : (
              <p className={`text-2xl font-semibold leading-7 ${item.color}`}>{item.value}</p>
            )}
            <p className="mt-1 text-xs text-text-subtle">{formatMonthLabel(month)}</p>
          </button>
        ))}
      </div>

      <div className="admin-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border-soft">
          <h2 className="admin-section-title">Corrective Action Tasks</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="admin-table min-w-[1120px]">
            <thead>
              <tr>
                {[
                  { label: 'Worker Name' },
                  { label: 'Month' },
                  { label: 'Action Title' },
                  { label: 'Priority', tooltip: 'P1 = Critical risk, P2 = High risk, P3 = Standard risk' },
                  { label: 'Status', tooltip: 'Pending = waiting for admin action · Escalated = deadline missed · Completed by Admin = done' },
                  { label: 'Deadline' },
                  { label: 'Risk Reason' },
                  { label: 'Effectiveness', tooltip: 'Measured by n8n after task completion: compares violation counts before vs after the corrective action' },
                  { label: 'Actions' },
                ].map(({ label, tooltip }) => (
                  <th key={label}>
                    {label}
                    {tooltip && (
                      <span
                        title={tooltip}
                        className="ml-1 cursor-help rounded px-1 align-middle text-[10px] text-text-subtle transition-colors duration-150 hover:text-text-base"
                      >
                        ⓘ
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, row) => (
                  <tr key={row}>
                    {Array.from({ length: 9 }).map((__, col) => (
                      <td key={col}><span className="skel-line" /></td>
                    ))}
                  </tr>
                ))
              ) : tasks.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <ClipboardPlusIcon className="w-6 h-6 text-text-subtle" />
                      <p className="text-sm font-medium text-text-base">No corrective actions found</p>
                      <p className="text-xs text-gray-400">Try a different month, status, or priority filter.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                tasks.map((task, idx) => {
                  const [riskPrimary, riskSecondary] = splitRiskReason(task.risk_reason);
                  return (
                  <tr
                    key={task.id}
                    className={`transition-colors duration-150 ${idx % 2 === 1 ? 'bg-surface-2/20' : ''}`}
                  >
                    <td className="text-text-base font-medium whitespace-nowrap">{task.worker_name}</td>
                    <td className="text-text-muted tabular-nums whitespace-nowrap">{task.month}</td>
                    <td className="text-text-base min-w-48">{task.action_title}</td>
                    <td className="whitespace-nowrap">
                      <Pill value={PRIORITY_LABEL[task.priority] ?? task.priority} className={PRIORITY_CLASS[task.priority] ?? PRIORITY_CLASS.P3} />
                    </td>
                    <td className="whitespace-nowrap">
                      <Pill value={STATUS_LABEL[task.status] ?? task.status} className={STATUS_CLASS[task.status] ?? STATUS_CLASS.pending} />
                    </td>
                    <td className="text-text-muted tabular-nums whitespace-nowrap">{formatDate(task.deadline_date)}</td>
                    <td className="min-w-64 max-w-sm">
                      <p className="text-text-base font-medium text-xs line-clamp-1">{riskPrimary}</p>
                      {riskSecondary && (
                        <p className="text-text-muted text-[11px] mt-0.5 line-clamp-1">{riskSecondary}</p>
                      )}
                    </td>
                    <td className="whitespace-nowrap min-w-36">
                      {task.effectiveness ? (
                        <div className="space-y-1.5">
                          <Pill
                            value={EFFECTIVENESS_LABEL[task.effectiveness.status] ?? task.effectiveness.status}
                            className={EFFECTIVENESS_CLASS[task.effectiveness.status] ?? EFFECTIVENESS_CLASS.no_after_data}
                          />
                          {task.effectiveness.improvement_percentage != null && (
                            <div className="text-[10px] tabular-nums space-y-1">
                              <p className="text-text-muted">Before action: <span className="text-text-base font-semibold">{task.effectiveness.before_count} violations</span></p>
                              <p className="text-text-muted">After action: <span className="text-text-base font-semibold">{task.effectiveness.after_count} violations</span></p>
                              <p className={`font-semibold ${task.effectiveness.improvement_percentage >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {task.effectiveness.improvement_percentage >= 0
                                  ? `${task.effectiveness.improvement_percentage.toFixed(0)}% reduction`
                                  : `${Math.abs(task.effectiveness.improvement_percentage).toFixed(0)}% increase`}
                              </p>
                            </div>
                          )}
                        </div>
                      ) : task.status === 'completed' ? (
                        <span className="text-[10px] text-text-subtle italic">Pending Review</span>
                      ) : (
                        <span className="text-text-subtle">-</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {task.status === 'pending' || task.status === 'escalated' ? (
                        <button
                          type="button"
                          onClick={() => openComplete(task)}
                          title="Complete task"
                          aria-label={`Complete task for ${task.worker_name}`}
                          className="inline-flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded border bg-emerald-400/10 text-emerald-400 border-emerald-400/30 hover:bg-emerald-400/20 transition-colors duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
                        >
                          <CheckIcon />
                          <span>Complete</span>
                        </button>
                      ) : task.status === 'completed' && !task.effectiveness ? (
                        <button
                          type="button"
                          onClick={() => handleRunEffectivenessWorkflow(task)}
                          disabled={triggeringEffectiveness.has(task.id)}
                          title="Trigger n8n effectiveness review workflow for this task"
                          aria-label={`Run effectiveness workflow for ${task.worker_name}`}
                          className="inline-flex items-center gap-1.5 rounded border border-brand/35 bg-brand/10 px-2.5 py-1 text-[10px] text-brand transition-colors duration-200 hover:bg-brand/15 focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <BarChartIcon className="w-3 h-3" />
                          <span>{triggeringEffectiveness.has(task.id) ? 'Triggering…' : 'Run Effectiveness Workflow'}</span>
                        </button>
                      ) : (
                        <span
                          title="No action needed — task completed"
                          className="text-text-subtle opacity-50 cursor-help"
                        >
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                  );
                })
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
            className="w-full max-w-md space-y-4 rounded-xl border border-border-soft bg-surface-1 p-6 mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h2 className="text-base font-semibold text-text-base">Complete Safety Action</h2>
              <p className="text-xs text-gray-400 mt-1">{completeModal.worker_name}</p>
            </div>
            <div className="rounded-lg border border-border-soft bg-surface-2 p-3">
              <p className="text-sm text-text-base font-medium">{completeModal.action_title}</p>
              <p className="text-xs text-gray-400 mt-1">{completeModal.risk_reason}</p>
            </div>
            <div className="space-y-1">
              <label htmlFor="completion-notes" className="text-xs text-gray-400">Completion Notes</label>
              <textarea
                id="completion-notes"
                value={completionNotes}
                onChange={(e) => setCompletionNotes(e.target.value)}
                className="form-input w-full min-h-28 resize-y focus:outline-none focus:ring-2 focus:ring-brand/40"
                placeholder="Optional notes"
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setCompleteModal(null)}
                className="btn-outline text-sm px-4 py-1.5 transition-all duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-brand/40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleComplete}
                disabled={saving}
                className="btn-brand text-sm px-4 py-1.5 inline-flex items-center gap-1.5 disabled:opacity-50 transition-all duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-brand/40"
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
