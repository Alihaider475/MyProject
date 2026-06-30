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
  P1: 'High Priority',
  P2: 'Medium Priority',
  P3: 'Standard Priority',
};

const PRIORITY_TOOLTIP = {
  P1: 'High Priority — needs urgent attention from the admin',
  P2: 'Medium Priority — should be handled soon',
  P3: 'Standard Priority — routine corrective action',
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
  effective: 'Training Worked',
  partially_effective: 'Some Improvement',
  not_effective: 'Needs More Action',
  no_after_data: 'Not Enough New Data Yet',
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
    label: 'High-Risk Worker Found',
    desc: 'Automation flags a worker with repeated violations',
    Icon: AlertTriIcon,
    pingColor: '#f87171',
    bg: 'bg-red-500/10',
    ring: 'border-red-500/30',
    text: 'text-red-400',
    connectorColor: 'from-red-400/50 to-amber-400/50',
  },
  {
    label: 'Safety Task Assigned',
    desc: 'A corrective safety task is created automatically',
    Icon: ClipboardPlusIcon,
    pingColor: '#fbbf24',
    bg: 'bg-amber-500/10',
    ring: 'border-amber-500/30',
    text: 'text-amber-400',
    connectorColor: 'from-amber-400/50 to-sky-400/50',
  },
  {
    label: 'Task Completed by Admin',
    desc: 'The admin carries out and completes the task',
    Icon: CheckIcon,
    pingColor: '#38bdf8',
    bg: 'bg-sky-500/10',
    ring: 'border-sky-500/30',
    text: 'text-sky-400',
    connectorColor: 'from-sky-400/50 to-emerald-400/50',
  },
  {
    label: 'Result Checked by Automation',
    desc: 'Checks whether violations went down afterward',
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

function InfoTip({ text }) {
  return (
    <span
      title={text}
      className="ml-1 cursor-help rounded px-0.5 align-middle text-[10px] text-text-subtle transition-colors duration-150 hover:text-text-base"
    >
      ⓘ
    </span>
  );
}

function ChevronIcon({ open, className = 'w-3 h-3' }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={`${className} transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 6 8 10.5 12.5 6" />
    </svg>
  );
}

function TrainingResult({ effectiveness }) {
  const label = EFFECTIVENESS_LABEL[effectiveness.status] ?? effectiveness.status;
  const cls = EFFECTIVENESS_CLASS[effectiveness.status] ?? EFFECTIVENESS_CLASS.no_after_data;
  const pct = effectiveness.improvement_percentage;
  return (
    <div className="rounded-lg border border-border-soft bg-surface-2/60 p-2.5 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold text-text-subtle uppercase tracking-wide">
          Training Result
          <InfoTip text="Checked automatically after the task is completed, by comparing violations before and after training." />
        </span>
      </div>
      <Pill value={label} className={cls} />
      {pct != null && (
        <div className="grid grid-cols-2 gap-1.5 text-[11px] tabular-nums pt-0.5">
          <p className="text-text-muted">
            Before Training<InfoTip text="Number of violations by this worker before the safety task was completed." />:{' '}
            <span className="text-text-base font-semibold">{effectiveness.before_count} violations</span>
          </p>
          <p className="text-text-muted">
            After Training<InfoTip text="Number of violations by this worker after the safety task was completed." />:{' '}
            <span className="text-text-base font-semibold">{effectiveness.after_count} violations</span>
          </p>
          <p className={`col-span-2 font-semibold ${pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {pct >= 0 ? `${pct.toFixed(0)}% fewer violations` : `${Math.abs(pct).toFixed(0)}% more violations`}
          </p>
        </div>
      )}
    </div>
  );
}

function TaskCard({ task, onComplete, onRunEffectiveness, isTriggering }) {
  const [expanded, setExpanded] = useState(false);
  const [riskPrimary, riskSecondary] = splitRiskReason(task.risk_reason);

  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-base truncate">{task.worker_name}</p>
          <p className="text-xs text-text-muted truncate">{task.action_title}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="inline-flex items-center">
            <Pill value={PRIORITY_LABEL[task.priority] ?? task.priority} className={PRIORITY_CLASS[task.priority] ?? PRIORITY_CLASS.P3} />
            <InfoTip text={PRIORITY_TOOLTIP[task.priority] ?? 'How urgently this task needs attention.'} />
          </span>
          <Pill value={STATUS_LABEL[task.status] ?? task.status} className={STATUS_CLASS[task.status] ?? STATUS_CLASS.pending} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
        <span>Month: <span className="text-text-base">{task.month}</span></span>
        <span>Deadline: <span className="text-text-base">{formatDate(task.deadline_date)}</span></span>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-border-soft bg-surface-2/40 px-2.5 py-1.5 text-left text-xs text-text-muted transition-colors duration-150 hover:bg-surface-2/70 focus:outline-none focus:ring-1 focus:ring-brand"
      >
        <span className="font-medium text-text-base">Why this task was created</span>
        <ChevronIcon open={expanded} />
      </button>
      {expanded && (
        <div className="rounded-md border border-border-soft bg-surface-2/30 px-2.5 py-2">
          <p className="text-xs text-text-base">{riskPrimary}</p>
          {riskSecondary && <p className="text-[11px] text-text-muted mt-0.5">{riskSecondary}</p>}
        </div>
      )}

      {task.effectiveness ? (
        <TrainingResult effectiveness={task.effectiveness} />
      ) : task.status === 'completed' ? (
        <p className="text-[11px] text-text-subtle italic">Waiting for automation to check the result…</p>
      ) : null}

      <div className="flex justify-end pt-1">
        {task.status === 'pending' || task.status === 'escalated' ? (
          <button
            type="button"
            onClick={() => onComplete(task)}
            title="Mark this safety task as completed"
            aria-label={`Complete task for ${task.worker_name}`}
            className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded border bg-emerald-400/10 text-emerald-400 border-emerald-400/30 hover:bg-emerald-400/20 transition-colors duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-emerald-400/40"
          >
            <CheckIcon />
            <span>Mark as Completed</span>
          </button>
        ) : task.status === 'completed' && !task.effectiveness ? (
          <button
            type="button"
            onClick={() => onRunEffectiveness(task)}
            disabled={isTriggering}
            title="Check whether the safety training reduced violations for this worker"
            aria-label={`Check training result for ${task.worker_name}`}
            className="inline-flex items-center gap-1.5 rounded border border-brand/35 bg-brand/10 px-2.5 py-1 text-[11px] text-brand transition-colors duration-200 hover:bg-brand/15 focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <BarChartIcon className="w-3 h-3" />
            <span>{isTriggering ? 'Checking…' : 'Check Training Result'}</span>
          </button>
        ) : null}
      </div>
    </div>
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
        title: 'Check started',
        message: 'Automation is checking the result. It will appear here shortly.',
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
            <option value="P1">High Priority</option>
            <option value="P2">Medium Priority</option>
            <option value="P3">Standard Priority</option>
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

      {/* Plain-language explanation banner for demo viewers */}
      <div className="admin-card border-brand/25 bg-brand/5 px-4 py-3">
        <p className="text-sm leading-5 text-text-base">
          This page shows how SafeSite AI automatically finds high-risk workers, creates a corrective
          safety task, lets the admin complete it, and then checks whether violations reduced after the task.
        </p>
      </div>

      {/* How the automated safety workflow works */}
      <div className="admin-card overflow-hidden">
        {/* Top accent gradient line */}
        <div className="hidden" />

        <div className="p-5 space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="admin-section-title">How This Automation Works</h2>
              <p className="mt-1 max-w-xl text-sm leading-5 text-text-muted">
                The system automatically creates a safety task when a worker is found to be high-risk.
                Once the admin completes that task, the system checks on its own whether violations went down.
              </p>
            </div>
            {/* Fully automated badge */}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-surface-2 px-2.5 py-1 text-[10px] font-semibold text-text-muted shrink-0 self-start">
              <span className="relative flex w-1.5 h-1.5">
                <span className="hidden" />
                <span className="relative rounded-full w-1.5 h-1.5 bg-brand" />
              </span>
              Fully Automated
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

          {/* Latest training result — shown only when a completed task with data exists */}
          {latestResult && (
            <div className="pt-3 border-t border-border-soft">
              <p className="text-[10px] font-semibold text-text-subtle uppercase tracking-wide mb-2">Latest Result</p>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                <div>
                  <p className="text-text-subtle">Result</p>
                  <Pill
                    value={EFFECTIVENESS_LABEL[latestResult.effectiveness.status] ?? latestResult.effectiveness.status}
                    className={EFFECTIVENESS_CLASS[latestResult.effectiveness.status] ?? EFFECTIVENESS_CLASS.no_after_data}
                  />
                </div>
                <div>
                  <p className="text-text-subtle">Worker</p>
                  <p className="text-text-base font-semibold">{latestResult.worker_name}</p>
                </div>
                <div>
                  <p className="text-text-subtle">Before Training</p>
                  <p className="text-text-base font-semibold tabular-nums">{latestResult.effectiveness.before_count} violations</p>
                </div>
                <div>
                  <p className="text-text-subtle">After Training</p>
                  <p className="text-text-base font-semibold tabular-nums">{latestResult.effectiveness.after_count} violations</p>
                </div>
                <div>
                  <p className="text-text-subtle">Improvement</p>
                  {latestResult.effectiveness.improvement_percentage != null && (
                    <p className={`font-semibold tabular-nums ${latestResult.effectiveness.improvement_percentage >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {latestResult.effectiveness.improvement_percentage >= 0
                        ? `${latestResult.effectiveness.improvement_percentage.toFixed(0)}% fewer violations`
                        : `${Math.abs(latestResult.effectiveness.improvement_percentage).toFixed(0)}% more violations`}
                    </p>
                  )}
                </div>
              </div>
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
          <h2 className="admin-section-title">Safety Tasks</h2>
        </div>
        {loading ? (
          <div className="divide-y divide-border-soft">
            {Array.from({ length: 4 }).map((_, row) => (
              <div key={row} className="p-4 space-y-2">
                <span className="skel-line w-1/3 h-4" />
                <span className="skel-line w-2/3 h-3" />
                <span className="skel-line w-full h-8" />
              </div>
            ))}
          </div>
        ) : tasks.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <div className="flex flex-col items-center gap-2 text-gray-400">
              <ClipboardPlusIcon className="w-6 h-6 text-text-subtle" />
              <p className="text-sm font-medium text-text-base">No safety tasks found</p>
              <p className="text-xs text-gray-400">Try a different month, status, or priority filter.</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border-soft">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onComplete={openComplete}
                onRunEffectiveness={handleRunEffectivenessWorkflow}
                isTriggering={triggeringEffectiveness.has(task.id)}
              />
            ))}
          </div>
        )}
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
              <p className="text-[10px] font-semibold text-text-subtle uppercase tracking-wide mt-2">Why this task was created</p>
              <p className="text-xs text-gray-400 mt-0.5">{completeModal.risk_reason}</p>
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
