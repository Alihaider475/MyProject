import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import SnapshotModal from './SnapshotModal.jsx';

const VIOLATION_BADGES = {
  'NO-Hardhat': 'badge-hardhat',
  'NO-Mask': 'badge-mask',
  'NO-Safety Vest': 'badge-vest',
};

const SEVERITY_BY_TYPE = {
  'NO-Hardhat': 'High',
  'NO-Vest': 'High',
  'NO-Safety Vest': 'High',
  'NO-Mask': 'Medium',
};

const SEVERITY_CLASSES = {
  High: 'bg-red-500/10 text-red-400 border-red-500/30',
  Medium: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
};

const TIME_RANGE_MS = {
  '24h': 24 * 3600_000,
  '7d': 7 * 86400_000,
  '30d': 30 * 86400_000,
  all: null,
};

function formatDateTime(iso) {
  if (!iso) return '';
  const raw = iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z';
  const d = new Date(raw);
  const day = d.getDate();
  const mon = d.toLocaleString('en-US', { month: 'short' });
  const year = d.getFullYear();
  const time = d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const now = new Date();
  if (d.getFullYear() === now.getFullYear()) {
    return `${day} ${mon}, ${time}`;
  }
  return `${day} ${mon} ${year}, ${time}`;
}

function buildParams(filters) {
  const params = { page_size: 50 };
  const ms = TIME_RANGE_MS[filters.time];
  if (ms) params.from = new Date(Date.now() - ms).toISOString();
  if (filters.camera_id) params.camera_id = filters.camera_id;
  if (filters.violation_type) params.violation_type = filters.violation_type;
  if (['open', 'pending', 'unassigned', 'fine_generated'].includes(filters.resolved)) params.is_resolved = false;
  if (filters.resolved === 'resolved') params.is_resolved = true;
  if (filters.track_id) params.track_id = filters.track_id;
  if (filters.worker_id) params.worker_id = filters.worker_id;
  return params;
}

function getSeverity(violationType) {
  return SEVERITY_BY_TYPE[violationType] || 'Medium';
}

function getStatusMeta(v) {
  if (v.is_false_positive) {
    return {
      label: 'False Positive',
      className: 'bg-surface-3 text-text-muted border-border-soft',
    };
  }
  if (v.is_resolved) {
    return {
      label: 'Resolved',
      className: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
    };
  }
  if (v.worker_id == null) {
    return {
      label: 'Unassigned',
      className: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
    };
  }
  if (v.fine_amount != null) {
    return {
      label: 'Fine Generated',
      className: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
    };
  }
  return {
    label: 'Pending',
    className: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
  };
}

function matchesStatusFilter(v, status) {
  if (!status || status === 'open' || status === 'resolved') return true;
  if (status === 'pending') return v.worker_id != null && v.fine_amount == null && !v.is_resolved && !v.is_false_positive;
  if (status === 'unassigned') return v.worker_id == null && !v.is_resolved && !v.is_false_positive;
  if (status === 'fine_generated') return v.fine_amount != null && !v.is_resolved && !v.is_false_positive;
  return true;
}

function matchesSearch(v, search) {
  const term = search?.trim().toLowerCase();
  if (!term) return true;

  const status = getStatusMeta(v).label;
  const fine = v.fine_amount != null ? `PKR ${v.fine_amount}` : 'No fine generated';
  const haystack = [
    v.violation_type,
    v.camera_id,
    `Camera ${v.camera_id}`,
    v.worker_name,
    v.worker_id != null ? `Worker #${v.worker_id}` : 'Unassigned',
    status,
    fine,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(term);
}

function AssignWorkerModal({ violation, onClose, onAssigned }) {
  const { showToast } = useToast();
  const [workers, setWorkers] = useState(null);
  const [selectedWorker, setSelectedWorker] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.listWorkers().then(setWorkers).catch(() => {});
  }, []);

  async function handleAssign() {
    if (!selectedWorker) return;
    setSubmitting(true);
    try {
      const updated = await api.assignViolationWorker(violation.id, Number(selectedWorker));
      showToast({ title: 'Worker assigned & fine created', level: 'success', duration: 3000 });
      onAssigned(updated);
      onClose();
    } catch (err) {
      showToast({ title: 'Failed', message: err.message, level: 'danger' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-surface-1 border border-border-soft rounded-xl p-5 w-full max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-text-base mb-3">Assign Worker to Violation #{violation.id}</h3>
        <p className="text-xs text-text-muted mb-4">{violation.violation_type} - Camera {violation.camera_id}</p>
        {workers === null ? (
          <p className="text-xs text-text-subtle">Loading workers...</p>
        ) : workers.length === 0 ? (
          <p className="text-xs text-text-subtle">No workers registered. Register workers first.</p>
        ) : (
          <>
            <select
              value={selectedWorker}
              onChange={(e) => setSelectedWorker(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg bg-surface-2 border border-border-soft text-text-base focus:outline-none focus:ring-1 focus:ring-brand mb-4"
            >
              <option value="">Select a worker...</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>{w.name} ({w.employee_id})</option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg bg-surface-3 text-text-muted border border-border-soft hover:bg-surface-2 transition-colors">
                Cancel
              </button>
              <button
                onClick={handleAssign}
                disabled={!selectedWorker || submitting}
                className="px-3 py-1.5 text-xs rounded-lg bg-brand text-white font-medium hover:bg-brand/90 transition-colors disabled:opacity-50"
              >
                {submitting ? 'Assigning...' : 'Assign & Fine'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function ViolationsTable({ filters, onVisibleItemsChange, onLoadingChange }) {
  const { showToast } = useToast();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [assignTarget, setAssignTarget] = useState(null);
  const [autoIdentifying, setAutoIdentifying] = useState(false);
  const lastSeenIdRef = useRef(0);
  const firstLoadRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api.listViolations(buildParams(filters));
      const rows = data.items ?? [];
      setError(null);
      setItems(() => {
        if (firstLoadRef.current && rows.length > 0) {
          const fresh = rows.filter((v) => v.id > lastSeenIdRef.current);
          fresh.slice(0, 3).forEach((v) => {
            showToast({
              title: `${v.violation_type} detected`,
              message: `Camera ${v.camera_id} - ${(v.confidence * 100).toFixed(0)}% confidence`,
              level: 'danger',
              duration: 7000,
            });
          });
          if (fresh.length > 3) {
            showToast({ title: `${fresh.length - 3} more violations`, level: 'warning', duration: 5000 });
          }
        }
        if (rows.length > 0) lastSeenIdRef.current = rows[0].id;
        firstLoadRef.current = true;
        return rows;
      });
    } catch (err) {
      setError(err.message || 'Unable to load violations.');
      setItems((prev) => prev ?? []);
    }
  }, [filters, showToast]);

  useEffect(() => {
    firstLoadRef.current = false;
    setItems(null);
    setError(null);
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    window.addEventListener('ppe:violation_saved', refresh);
    return () => window.removeEventListener('ppe:violation_saved', refresh);
  }, [refresh]);

  const visibleItems = useMemo(() => {
    if (!items) return [];
    return items.filter((v) => matchesStatusFilter(v, filters.resolved) && matchesSearch(v, filters.search));
  }, [items, filters.resolved, filters.search]);

  useEffect(() => {
    onVisibleItemsChange?.(visibleItems);
  }, [onVisibleItemsChange, visibleItems]);

  useEffect(() => {
    onLoadingChange?.(items === null);
  }, [items, onLoadingChange]);

  function handleUpdate(updated) {
    setItems((prev) => prev?.map((v) => (v.id === updated.id ? updated : v)));
    setSelected(updated);
  }

  async function handleQuickResolve(e, v) {
    e.stopPropagation();
    try {
      const updated = await api.resolveViolation(v.id);
      handleUpdate(updated);
      showToast({ title: 'Resolved', message: `Violation #${v.id}`, level: 'success', duration: 3000 });
    } catch (err) {
      showToast({ title: 'Failed to resolve', message: err.message, level: 'danger' });
    }
  }

  async function handleAutoIdentify() {
    setAutoIdentifying(true);
    try {
      const result = await api.autoIdentifyViolations();
      if (result.identified > 0) {
        showToast({
          title: `Auto-identified ${result.identified} violation${result.identified > 1 ? 's' : ''}`,
          message: `Scanned ${result.processed} unassigned - fines created automatically`,
          level: 'success',
          duration: 5000,
        });
        refresh();
      } else if (result.processed > 0) {
        showToast({
          title: 'No matches found',
          message: `Scanned ${result.processed} unassigned violations - no faces matched enrolled workers`,
          level: 'warning',
          duration: 4000,
        });
      } else {
        showToast({
          title: 'Nothing to process',
          message: 'All violations already have workers assigned',
          level: 'info',
          duration: 3000,
        });
      }
    } catch (err) {
      showToast({ title: 'Auto-identify failed', message: err.message, level: 'danger' });
    } finally {
      setAutoIdentifying(false);
    }
  }

  const unassignedCount = items?.filter((v) => v.worker_id == null && !v.is_false_positive).length || 0;

  return (
    <>
      {items && unassignedCount > 0 && (
        <div className="mx-4 mt-4 mb-3 flex flex-col gap-2 rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2 sm:mx-5 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-violet-300">
            {unassignedCount} unassigned violation{unassignedCount > 1 ? 's' : ''} can be auto-matched to enrolled workers.
          </span>
          <button
            onClick={handleAutoIdentify}
            disabled={autoIdentifying}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
          >
            {autoIdentifying ? (
              <>
                <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Scanning...
              </>
            ) : (
              'Auto-Identify'
            )}
          </button>
        </div>
      )}

      {error && (
        <div className="mx-4 mt-4 rounded-lg border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200 sm:mx-5">
          <p className="font-medium text-red-100">Could not load violations</p>
          <p className="mt-1 text-xs text-red-200/80">{error}</p>
        </div>
      )}

      <div className="px-4 pb-4 sm:px-5">
        <div className="overflow-x-auto overflow-y-auto rounded-lg border border-border-soft bg-surface-1" style={{ maxHeight: 680 }}>
          <table className="w-full min-w-[920px] border-separate border-spacing-0 text-xs">
            <thead className="sticky top-0 z-10 bg-surface-2">
              <tr className="border-b border-border-soft">
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider text-text-muted">Time</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider text-text-muted">Camera</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider text-text-muted">Type</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider text-text-muted">Severity</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider text-text-muted">Confidence</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider text-text-muted">Status</th>
                <th className="px-4 py-3 text-left font-semibold uppercase tracking-wider text-text-muted">Worker / Fine</th>
                <th className="px-2 py-3 w-16 text-left font-semibold uppercase tracking-wider text-text-muted">Snap</th>
                <th className="px-4 py-3 text-right font-semibold uppercase tracking-wider text-text-muted w-36">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items === null ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-border-soft">
                    {Array.from({ length: 9 }).map((__, j) => (
                      <td key={j} className="px-4 py-4"><span className="skel-line" /></td>
                    ))}
                  </tr>
                ))
              ) : visibleItems.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-14 text-center">
                    <div className="mx-auto max-w-sm">
                      <p className="text-sm font-medium text-text-base">
                        {error ? 'No violation data available.' : 'No violations match the current filters.'}
                      </p>
                      <p className="mt-1 text-xs text-text-subtle">
                        {error ? 'Check the API connection and try again.' : 'Adjust the search, time range, camera, type, or status filter.'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : visibleItems.map((v) => {
                const badgeCls = VIOLATION_BADGES[v.violation_type] || 'badge-default';
                const severity = getSeverity(v.violation_type);
                const status = getStatusMeta(v);
                const workerLabel = v.worker_id != null
                  ? (v.worker_name || `Worker #${v.worker_id}`)
                  : 'Unassigned';
                const fineLabel = v.fine_amount != null
                  ? `PKR ${Number(v.fine_amount).toLocaleString()}`
                  : 'No fine generated';

                return (
                  <tr
                    key={v.id}
                    className={`group cursor-pointer border-b border-border-soft transition-colors duration-150 hover:bg-cyan-500/5 ${v.is_false_positive ? 'opacity-60' : ''}`}
                    onClick={() => setSelected(v)}
                  >
                    <td className="px-4 py-3.5 text-nowrap text-text-muted">{formatDateTime(v.timestamp)}</td>
                    <td className="px-4 py-3.5 font-medium text-text-base">Camera {v.camera_id}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={badgeCls}>{v.violation_type}</span>
                        {v.track_id != null && (
                          <span className="rounded-md border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium text-cyan-400">
                            Person #{v.track_id}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${SEVERITY_CLASSES[severity]}`}>
                        {severity}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex min-w-20 flex-col gap-1">
                        <span className="font-semibold tabular-nums text-text-base">{(v.confidence * 100).toFixed(0)}%</span>
                        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-3">
                          <span
                            className="block h-full rounded-full bg-brand"
                            style={{ width: `${Math.max(0, Math.min(100, v.confidence * 100))}%` }}
                          />
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold ${status.className}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex min-w-36 flex-col gap-1">
                        <span className={`text-sm font-medium ${v.worker_id == null ? 'text-text-subtle' : 'text-text-base'}`}>
                          {workerLabel}
                        </span>
                        <span className={`w-fit rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${v.fine_amount != null ? 'border-amber-400/30 bg-amber-400/10 text-amber-300' : 'border-border-soft bg-surface-3 text-text-muted'}`}>
                          {fineLabel}
                        </span>
                      </div>
                    </td>
                    <td className="px-2 py-3.5 w-16">
                      {v.frame_url ? (
                        <img
                          src={v.frame_url}
                          alt=""
                          className="h-9 w-14 rounded-md border border-border-soft object-cover opacity-80 transition-opacity duration-150 group-hover:opacity-100"
                        />
                      ) : (
                        <span className="inline-flex h-9 w-14 items-center justify-center rounded-md border border-border-soft bg-surface-2 text-[10px] text-text-subtle">
                          None
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          className="rounded-md border border-border-soft bg-surface-3 px-2 py-1 text-[10px] text-text-muted transition-colors hover:bg-brand/10 hover:text-brand"
                          onClick={() => setSelected(v)}
                        >
                          View
                        </button>
                        {v.worker_id == null && !v.is_false_positive && (
                          <button
                            className="rounded-md border border-border-soft bg-surface-3 px-2 py-1 text-[10px] text-text-muted transition-colors hover:bg-violet-500/10 hover:text-violet-300"
                            onClick={() => setAssignTarget(v)}
                          >
                            Assign
                          </button>
                        )}
                        {v.worker_id != null && (
                          <button
                            className="rounded-md border border-border-soft bg-surface-3 px-2 py-1 text-[10px] text-text-muted transition-colors hover:bg-amber-500/10 hover:text-amber-300"
                            onClick={() => window.open(api.violationChallanUrl(v.id), '_blank')}
                          >
                            Challan
                          </button>
                        )}
                        {!v.is_resolved && !v.is_false_positive && (
                          <button
                            className="rounded-md border border-border-soft bg-surface-3 px-2 py-1 text-[10px] text-text-muted transition-colors hover:bg-emerald-500/10 hover:text-emerald-300"
                            onClick={(e) => handleQuickResolve(e, v)}
                          >
                            Resolve
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <SnapshotModal
          violation={selected}
          onClose={() => setSelected(null)}
          onUpdate={handleUpdate}
        />
      )}

      {assignTarget && (
        <AssignWorkerModal
          violation={assignTarget}
          onClose={() => setAssignTarget(null)}
          onAssigned={(updated) => handleUpdate(updated)}
        />
      )}
    </>
  );
}
