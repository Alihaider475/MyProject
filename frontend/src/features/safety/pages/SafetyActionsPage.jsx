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
    } catch (err) {
      showToast({ title: 'Error', message: err.message, level: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold text-text-base tracking-tight">Safety Corrective Actions</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-sm text-text-muted">Month:</label>
          <MonthPicker value={month} onChange={setMonth} />
          <select
            aria-label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="form-select text-xs h-9 py-0 rounded-lg border border-border-soft transition-all duration-200 ease-out hover:border-brand/40 focus:outline-none focus:ring-2 focus:ring-brand/40"
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
            className="form-select text-xs h-9 py-0 rounded-lg border border-border-soft transition-all duration-200 ease-out hover:border-brand/40 focus:outline-none focus:ring-2 focus:ring-brand/40"
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
            className="btn-outline text-xs h-9 px-3 py-0 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-40 transition-all duration-200 ease-out hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand/40"
          >
            <RefreshIcon />
            <span>{loading ? 'Refreshing' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* How n8n Safety Automation Works */}
      <div className="relative bg-surface-1 border border-white/10 rounded-xl overflow-hidden">
        {/* Top accent gradient line */}
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-sky-400/35 to-transparent pointer-events-none" />

        <div className="p-5 space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold text-text-base">How n8n Safety Automation Works</h2>
              <p className="text-sm text-gray-400 mt-1 max-w-xl">
                n8n automatically creates corrective tasks when payroll risk analysis identifies high-risk
                workers. After an admin completes a task, n8n re-runs to measure whether violations reduced.
              </p>
            </div>
            {/* Automated by n8n badge */}
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-500/10 border border-violet-500/25 text-violet-400 text-[10px] font-semibold shrink-0 self-start">
              <span className="relative flex w-1.5 h-1.5">
                <span className="absolute inset-0 rounded-full bg-violet-400 animate-ping motion-reduce:animate-none opacity-70" style={{ animationDuration: '2s' }} />
                <span className="relative rounded-full w-1.5 h-1.5 bg-violet-400" />
              </span>
              Automated by n8n
            </span>
          </div>

          {/* Workflow steps */}
          <div className="flex flex-wrap items-start w-full gap-y-6">
            {WORKFLOW_STEPS.map((step, i) => (
              <div key={step.label} className="flex items-start basis-1/2 sm:basis-auto sm:flex-1">
                {/* Step card */}
                <div className="group flex flex-col items-center shrink-0 w-full sm:w-auto px-1 cursor-default transition-transform duration-200 ease-out hover:-translate-y-1 motion-reduce:hover:translate-y-0">
                  {/* Icon with pulsing ping ring */}
                  <div className="relative w-10 h-10 shrink-0">
                    <span
                      className="absolute inset-0 rounded-full animate-ping motion-reduce:animate-none"
                      style={{
                        backgroundColor: step.pingColor,
                        opacity: 0.18,
                        animationDelay: `${i * 0.55}s`,
                        animationDuration: '2.4s',
                      }}
                    />
                    <div className={`absolute inset-0 rounded-full ${step.bg} border ${step.ring} flex items-center justify-center ${step.text} shadow-sm group-hover:shadow-md transition-shadow duration-200`}>
                      <step.Icon className="w-4 h-4" />
                    </div>
                  </div>
                  {/* Step number badge */}
                  <span className="mt-2 mb-1 text-[9px] font-bold tracking-widest uppercase text-text-subtle">{`0${i + 1}`}</span>
                  <p className="text-[11px] font-semibold text-text-base text-center leading-tight px-1">{step.label}</p>
                  <p className="text-[10px] text-gray-400 text-center mt-0.5 leading-snug px-1">{step.desc}</p>
                </div>

                {/* Animated connector */}
                {step.connectorColor && (
                  <div className="hidden sm:flex items-center flex-1 min-w-[16px] pt-5 mx-1 self-stretch">
                    <div className="relative flex-1 h-[3px] overflow-hidden rounded-full bg-border-strong">
                      <div
                        className={`absolute inset-0 origin-left bg-gradient-to-r ${step.connectorColor} animate-flow-line motion-reduce:animate-none`}
                        style={{ animationDelay: `${i * 0.25}s` }}
                      />
                    </div>
                    <ArrowRightIcon className="w-2.5 h-2.5 text-text-subtle shrink-0 -ml-px" />
                  </div>
                )}
              </div>
            ))}
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
      <div className="bg-surface-1 border border-white/10 rounded-xl px-4 py-3">
        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-2">Status Guide</p>
        <div className="flex flex-wrap gap-4 text-sm">
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
          { label: 'Total', value: counts.total, color: 'text-cyan-400', dot: 'bg-cyan-400', filterStatus: '' },
          { label: 'Pending', value: counts.pending, color: 'text-sky-400', dot: 'bg-sky-400', filterStatus: 'pending' },
          { label: 'Escalated', value: counts.escalated, color: 'text-red-400', dot: 'bg-red-400', filterStatus: 'escalated' },
          { label: 'Completed', value: counts.completed, color: 'text-emerald-400', dot: 'bg-emerald-400', filterStatus: 'completed' },
        ].map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => setStatus(item.filterStatus)}
            aria-pressed={status === item.filterStatus}
            title={`Filter by ${item.label.toLowerCase()}`}
            className={`text-left bg-surface-1 border rounded-xl p-3.5 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-lg hover:border-white/25 focus:outline-none focus:ring-2 focus:ring-brand/40 ${status === item.filterStatus ? 'border-white/25 shadow-md' : 'border-white/10'}`}
          >
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className={`w-2 h-2 rounded-full inline-block ${item.dot}`} />
              <p className="text-sm text-gray-400">{item.label}</p>
            </div>
            {loading ? (
              <span className="skel-line w-16 h-7" />
            ) : (
              <p className={`text-2xl font-bold leading-none ${item.color}`}>{item.value}</p>
            )}
            <p className="text-[10px] text-gray-500 mt-1">{formatMonthLabel(month)}</p>
          </button>
        ))}
      </div>

      <div className="bg-surface-1 border border-white/10 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border-soft">
          <h2 className="text-lg font-semibold text-text-base">Corrective Action Tasks</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-white/5">
              <tr className="border-b border-white/10">
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
                  <th key={label} className="px-4 py-3 text-left text-text-muted font-semibold uppercase tracking-wider">
                    {label}
                    {tooltip && (
                      <span
                        title={tooltip}
                        className="ml-1 cursor-help text-text-subtle text-[10px] align-middle px-1 rounded transition-colors duration-150 ease-out hover:bg-white/10 hover:text-text-base"
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
                  <tr key={row} className="border-b border-white/10">
                    {Array.from({ length: 9 }).map((__, col) => (
                      <td key={col} className="px-4 py-3.5"><span className="skel-line" /></td>
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
                    className={`border-b border-white/10 hover:bg-white/5 transition-colors duration-150 ease-out ${idx % 2 === 1 ? 'bg-white/[0.02]' : ''}`}
                  >
                    <td className="px-4 py-3.5 text-text-base font-medium whitespace-nowrap">{task.worker_name}</td>
                    <td className="px-4 py-3.5 text-text-muted tabular-nums whitespace-nowrap">{task.month}</td>
                    <td className="px-4 py-3.5 text-text-base min-w-48">{task.action_title}</td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <Pill value={PRIORITY_LABEL[task.priority] ?? task.priority} className={PRIORITY_CLASS[task.priority] ?? PRIORITY_CLASS.P3} />
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <Pill value={STATUS_LABEL[task.status] ?? task.status} className={STATUS_CLASS[task.status] ?? STATUS_CLASS.pending} />
                    </td>
                    <td className="px-4 py-3.5 text-text-muted tabular-nums whitespace-nowrap">{formatDate(task.deadline_date)}</td>
                    <td className="px-4 py-3.5 min-w-64 max-w-sm">
                      <p className="text-text-base font-medium text-xs line-clamp-1">{riskPrimary}</p>
                      {riskSecondary && (
                        <p className="text-gray-400 text-[11px] mt-0.5 line-clamp-1">{riskSecondary}</p>
                      )}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap min-w-36">
                      {task.effectiveness ? (
                        <div className="space-y-1.5">
                          <Pill
                            value={EFFECTIVENESS_LABEL[task.effectiveness.status] ?? task.effectiveness.status}
                            className={EFFECTIVENESS_CLASS[task.effectiveness.status] ?? EFFECTIVENESS_CLASS.no_after_data}
                          />
                          {task.effectiveness.improvement_percentage != null && (
                            <div className="text-[10px] tabular-nums space-y-1">
                              <p className="text-gray-400">Before action: <span className="text-text-base font-semibold">{task.effectiveness.before_count} violations</span></p>
                              <p className="text-gray-400">After action: <span className="text-text-base font-semibold">{task.effectiveness.after_count} violations</span></p>
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
                    <td className="px-4 py-3.5 whitespace-nowrap">
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
            className="bg-surface-1 border border-border-soft rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h2 className="text-base font-semibold text-text-base">Complete Safety Action</h2>
              <p className="text-xs text-gray-400 mt-1">{completeModal.worker_name}</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-surface-2 p-3">
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
