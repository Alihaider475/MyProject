import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import SnapshotModal from './SnapshotModal.jsx';

const VIOLATION_BADGES = {
  'NO-Hardhat':     'badge-hardhat',
  'NO-Mask':        'badge-mask',
  'NO-Safety Vest': 'badge-vest',
};

const TIME_RANGE_MS = {
  '24h': 24 * 3600_000,
  '7d':  7  * 86400_000,
  '30d': 30 * 86400_000,
  'all': null,
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
  if (filters.resolved === 'open') params.is_resolved = false;
  if (filters.resolved === 'resolved') params.is_resolved = true;
  if (filters.track_id) params.track_id = filters.track_id;
  if (filters.worker_id) params.worker_id = filters.worker_id;
  return params;
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
        <p className="text-xs text-text-muted mb-4">{violation.violation_type} — Camera {violation.camera_id}</p>
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

export default function ViolationsTable({ filters }) {
  const { showToast } = useToast();
  const [items, setItems] = useState(null);
  const [selected, setSelected] = useState(null);
  const [assignTarget, setAssignTarget] = useState(null);
  const [autoIdentifying, setAutoIdentifying] = useState(false);
  const lastSeenIdRef = useRef(0);
  const firstLoadRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api.listViolations(buildParams(filters));
      setItems((prev) => {
        // New violation toast notifications
        if (firstLoadRef.current && data.items.length > 0) {
          const fresh = data.items.filter((v) => v.id > lastSeenIdRef.current);
          fresh.slice(0, 3).forEach((v) => {
            showToast({
              title: `${v.violation_type} detected`,
              message: `Camera ${v.camera_id} · ${(v.confidence * 100).toFixed(0)}% confidence`,
              level: 'danger',
              duration: 7000,
            });
          });
          if (fresh.length > 3) {
            showToast({ title: `${fresh.length - 3} more violations`, level: 'warning', duration: 5000 });
          }
        }
        if (data.items.length > 0) lastSeenIdRef.current = data.items[0].id;
        firstLoadRef.current = true;
        return data.items;
      });
    } catch { /* silent */ }
  }, [filters, showToast]);

  useEffect(() => {
    firstLoadRef.current = false;
    setItems(null);
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  // Instantly refresh the table when the backend confirms a violation was saved.
  useEffect(() => {
    window.addEventListener('ppe:violation_saved', refresh);
    return () => window.removeEventListener('ppe:violation_saved', refresh);
  }, [refresh]);

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
          message: `Scanned ${result.processed} unassigned — fines created automatically`,
          level: 'success',
          duration: 5000,
        });
        refresh();
      } else if (result.processed > 0) {
        showToast({
          title: 'No matches found',
          message: `Scanned ${result.processed} unassigned violations — no faces matched enrolled workers`,
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
      {/* Auto-Identify toolbar */}
      {items && unassignedCount > 0 && (
        <div className="flex items-center justify-between px-3 py-2 mb-2 rounded-lg bg-violet-500/5 border border-violet-500/20">
          <span className="text-xs text-violet-300">
            {unassignedCount} unassigned violation{unassignedCount > 1 ? 's' : ''} — auto-match faces to assign fines
          </span>
          <button
            onClick={handleAutoIdentify}
            disabled={autoIdentifying}
            className="text-[11px] px-3 py-1 rounded-lg bg-violet-600 text-white font-medium hover:bg-violet-500 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {autoIdentifying ? (
              <>
                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                Scanning...
              </>
            ) : (
              'Auto-Identify'
            )}
          </button>
        </div>
      )}

      <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 680 }}>
        <table className="w-full min-w-[600px] text-xs">
          <thead className="sticky top-0 bg-surface-1 z-10">
            <tr className="border-b border-border-soft">
              <th className="px-3 py-2 text-left uppercase tracking-wider text-text-muted font-semibold">Time</th>
              <th className="px-3 py-2 text-left uppercase tracking-wider text-text-muted font-semibold">Camera</th>
              <th className="px-3 py-2 text-left uppercase tracking-wider text-text-muted font-semibold">Type</th>
              <th className="px-3 py-2 text-left uppercase tracking-wider text-text-muted font-semibold">Conf</th>
              <th className="px-3 py-2 text-center uppercase tracking-wider text-text-muted font-semibold">Status</th>
              <th className="px-3 py-2 text-left uppercase tracking-wider text-text-muted font-semibold">Worker / Fine</th>
              <th className="px-1 py-2 w-12"></th>
              <th className="px-3 py-2 text-right uppercase tracking-wider text-text-muted font-semibold w-28">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items === null ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-border-soft">
                  {Array.from({ length: 8 }).map((__, j) => (
                    <td key={j} className="px-3 py-2"><span className="skel-line" /></td>
                  ))}
                </tr>
              ))
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-text-subtle text-xs">
                  No violations matching your filters.
                </td>
              </tr>
            ) : items.map((v) => {
              const badgeCls = VIOLATION_BADGES[v.violation_type] || 'badge-default';
              const statusIcon = v.is_false_positive
                ? '\uD83D\uDEA9'
                : v.is_resolved ? '\u2705' : '\uD83D\uDFE1';
              return (
                <tr
                  key={v.id}
                  className={`group violation-row border-b border-border-soft cursor-pointer transition-colors duration-100 hover:bg-cyan-500/5 ${v.is_false_positive ? 'opacity-50' : ''}`}
                  onClick={() => setSelected(v)}
                >
                  <td className="px-3 py-2 text-nowrap text-text-muted">{formatDateTime(v.timestamp)}</td>
                  <td className="px-3 py-2">{'\uD83D\uDCF9'} {v.camera_id}</td>
                  <td className="px-3 py-2">
                    <span className={badgeCls}>{v.violation_type}</span>
                    {v.track_id != null && (
                      <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                        Person #{v.track_id}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{(v.confidence * 100).toFixed(0)}%</td>
                  <td className="px-3 py-2 text-center">{statusIcon}</td>
                  <td className="px-3 py-2">
                    {v.worker_id != null ? (
                      <div className="flex flex-col gap-0.5">
                        {v.worker_name && (
                          <span className="text-[10px] text-text-muted truncate max-w-[120px]">{v.worker_name}</span>
                        )}
                        {v.fine_amount != null && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-400/10 text-amber-400 border border-amber-400/30 w-fit">
                            PKR {v.fine_amount}
                          </span>
                        )}
                      </div>
                    ) : !v.is_false_positive ? (
                      <span className="text-[10px] text-text-subtle italic">Unassigned</span>
                    ) : null}
                  </td>
                  <td className="px-1 py-1 w-12">
                    {v.frame_url && (
                      <img
                        src={v.frame_url}
                        alt=""
                        className="w-11 h-7 object-cover rounded border border-border-soft opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                      />
                    )}
                  </td>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      <button
                        className="text-[10px] px-2 py-0.5 rounded bg-surface-3 text-text-muted hover:text-brand hover:bg-brand/10 transition-colors border border-border-soft"
                        onClick={() => setSelected(v)}
                      >
                        View
                      </button>
                      {v.worker_id == null && !v.is_false_positive && (
                        <button
                          className="text-[10px] px-2 py-0.5 rounded bg-surface-3 text-text-muted hover:text-violet-400 hover:bg-violet-500/10 transition-colors border border-border-soft"
                          onClick={() => setAssignTarget(v)}
                        >
                          Assign
                        </button>
                      )}
                      {v.worker_id != null && (
                        <button
                          className="text-[10px] px-2 py-0.5 rounded bg-surface-3 text-text-muted hover:text-amber-400 hover:bg-amber-500/10 transition-colors border border-border-soft"
                          onClick={() => window.open(api.violationChallanUrl(v.id), '_blank')}
                        >
                          Challan
                        </button>
                      )}
                      {!v.is_resolved && !v.is_false_positive && (
                        <button
                          className="text-[10px] px-2 py-0.5 rounded bg-surface-3 text-text-muted hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors border border-border-soft"
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
