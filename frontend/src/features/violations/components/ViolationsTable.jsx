import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '../../../services/api/client.js';
import { useToast } from '../../../store/ToastContext.jsx';
import SnapshotModal from '../../../components/ui/SnapshotModal.jsx';
import { useEscapeKey } from '../../../hooks/useEscapeKey.js';
import { useFocusTrap } from '../../../hooks/useFocusTrap.js';

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

const CACHE_TIME_BUCKET_MS = 5 * 60 * 1000;

function bucketedNowMs() {
  return Math.floor(Date.now() / CACHE_TIME_BUCKET_MS) * CACHE_TIME_BUCKET_MS;
}

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

function buildParams(filters, page, pageSize, referenceTimeMs) {
  const params = { page, page_size: pageSize };
  const ms = TIME_RANGE_MS[filters.time];
  if (ms) params.from = new Date(referenceTimeMs - ms).toISOString();
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
  const panelRef = useRef(null);

  useEscapeKey(onClose, !submitting);
  useFocusTrap(panelRef, true);

  useEffect(() => {
    api.listWorkers({ active_only: true }).then(setWorkers).catch(() => {});
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
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Assign Worker to Violation #${violation.id}`}
        className="bg-surface-1 border border-border-soft rounded-xl p-5 w-full max-w-sm shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-text-base mb-3">Assign Worker to Violation #{violation.id}</h3>
        <p className="text-xs text-text-muted mb-4">{violation.violation_type} — Camera {violation.camera_id}</p>
        {workers === null ? (
          <p className="text-xs text-text-subtle">Loading workers...</p>
        ) : workers.length === 0 ? (
          <p className="text-xs text-text-subtle">No workers registered. Register workers first.</p>
        ) : (
          <>
            <select
              aria-label="Select worker to assign"
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
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState(null);
  const [assignTarget, setAssignTarget] = useState(null);
  const [autoIdentifying, setAutoIdentifying] = useState(false);
  const lastSeenIdRef = useRef(0);
  const firstLoadRef = useRef(false);
  const pollCountRef = useRef(0);

  const [page, setPage] = useState(1);
  const pageSize = 25;

  const referenceTimeMs = useMemo(() => bucketedNowMs(), [filters.time]);
  const queryParams = useMemo(
    () => buildParams(filters, page, pageSize, referenceTimeMs),
    [filters, page, pageSize, referenceTimeMs]
  );

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['violations', queryParams],
    queryFn: () => api.listViolations(queryParams),
    staleTime: 5000,
    gcTime: 300000,
    placeholderData: keepPreviousData,
    // Always poll every 15 s so live-camera violations appear without a manual
    // reload (the LiveFeed WebSocket that fires ppe:violation_saved is only open
    // when the Dashboard is mounted, not when the user is on this page).
    // Additionally: when unidentified violations are present, poll faster for a
    // bounded number of cycles so worker assignments resolve automatically.
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const unassigned = items.filter((v) => v.worker_id == null && !v.is_false_positive).length;
      if (unassigned > 0 && pollCountRef.current < 5) {
        pollCountRef.current += 1;
        return 3000;
      }
      if (unassigned === 0) pollCountRef.current = 0;
      return 15000;
    },
  });

  const items = data?.items ?? null;
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  useEffect(() => {
    if (!data) return;
    if (firstLoadRef.current && data.items.length > 0) {
      if (page === 1) {
        const fresh = data.items.filter((v) => v.id > lastSeenIdRef.current);
        // New violations arrived (e.g. a fresh upload) — re-arm the bounded poll window
        // so background worker-identification results are picked up automatically.
        if (fresh.length > 0) pollCountRef.current = 0;
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
    }
    if (data.items.length > 0 && page === 1) {
      lastSeenIdRef.current = Math.max(lastSeenIdRef.current, data.items[0].id);
    }
    firstLoadRef.current = true;
  }, [data, page, showToast]);

  useEffect(() => {
    setPage(1);
    firstLoadRef.current = false;
    pollCountRef.current = 0;
  }, [filters]);

  // Refresh immediately when the live camera saves a new violation.
  // The ppe:violation_saved window event is fired by LiveFeed's WebSocket
  // (only active on the Dashboard). Additionally, open our own WebSocket
  // connections to any running cameras so this page reacts instantly even
  // when the Dashboard is not mounted.
  useEffect(() => {
    function handleViolationSaved() {
      queryClient.invalidateQueries({ queryKey: ['violations'] });
    }
    window.addEventListener('ppe:violation_saved', handleViolationSaved);
    return () => window.removeEventListener('ppe:violation_saved', handleViolationSaved);
  }, [queryClient]);

  useEffect(() => {
    let cancelled = false;
    const sockets = [];

    api.listCameras().then((cameras) => {
      if (cancelled) return;
      const running = cameras.filter((c) => c.is_running);
      for (const cam of running) {
        try {
          const ws = new WebSocket(api.wsUrl(cam.id));
          ws.onmessage = (e) => {
            try {
              const d = JSON.parse(e.data);
              if (d.type === 'violation_saved') {
                queryClient.invalidateQueries({ queryKey: ['violations'] });
              }
            } catch { /* ignore */ }
          };
          ws.onerror = () => {};
          sockets.push(ws);
        } catch { /* ignore */ }
      }
    }).catch(() => {});

    return () => {
      cancelled = true;
      sockets.forEach((ws) => { try { ws.close(); } catch { /* ignore */ } });
    };
  }, [queryClient]);

  const handleUpdate = useCallback((updated) => {
    queryClient.invalidateQueries({ queryKey: ['violations'] });
    setSelected(updated);
  }, [queryClient]);

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
      if (result.started) {
        // Backend now scans the backlog in the background and returns immediately, so
        // the button never hangs. Re-arm the bounded auto-refresh so matched workers +
        // fines appear on their own as the scan resolves them.
        pollCountRef.current = 0;
        refetch();
        showToast({
          title: 'Scanning in background',
          message: 'Matched workers and fines will appear automatically in a few seconds.',
          level: 'info',
          duration: 4000,
        });
      } else if (result.identified > 0) {
        showToast({
          title: `Auto-identified ${result.identified} violation${result.identified > 1 ? 's' : ''}`,
          message: `Scanned ${result.processed} unassigned — fines created automatically`,
          level: 'success',
          duration: 5000,
        });
        refetch();
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
                <svg aria-hidden="true" focusable="false" className="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                Scanning...
              </>
            ) : (
              'Auto-Identify'
            )}
          </button>
        </div>
      )}

      {!isLoading && !error && (
        <div className="px-3 py-2 mb-2 rounded-lg bg-surface-2 border border-border-soft">
          <span className="text-sm text-text-base">
            Total matching filters: <span className="font-semibold text-white">{total}</span> violation{total === 1 ? '' : 's'}
          </span>
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
              <th className="px-1 py-2 w-12 text-left uppercase tracking-wider text-text-muted font-semibold">Frame</th>
              <th className="px-3 py-2 text-right uppercase tracking-wider text-text-muted font-semibold w-28">Actions</th>
            </tr>
          </thead>
          <tbody>
            {error ? (
              <tr>
                <td colSpan={8} className="py-8 text-center">
                  <p className="text-red-400 text-xs mb-2">⚠ {error.message || 'Failed to load violations'}</p>
                  <button onClick={() => refetch()} className="text-xs px-3 py-1 rounded-lg bg-brand/10 text-brand border border-brand/30 hover:bg-brand/20 transition-colors">Retry</button>
                </td>
              </tr>
            ) : items === null ? (
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
              const statusLabel = v.is_false_positive
                ? 'False positive'
                : v.is_resolved ? 'Resolved' : 'Open';
              return (
                <tr
                  key={v.id}
                  role="button"
                  tabIndex={0}
                  className={`group violation-row border-b border-border-soft cursor-pointer transition-colors duration-100 hover:bg-cyan-500/5 ${v.is_false_positive ? 'opacity-50' : ''}`}
                  onClick={() => setSelected(v)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(v); } }}
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
                  <td className="px-3 py-2 text-center" title={statusLabel}>
                    <span aria-hidden="true">{statusIcon}</span>
                    <span className="sr-only">{statusLabel}</span>
                  </td>
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
                      <span className="text-[10px] text-text-subtle italic">Unidentified</span>
                    ) : null}
                  </td>
                  <td className="px-1 py-1 w-12">
                    {(v.thumbnail_url || v.frame_url) && (
                      <img
                        src={v.thumbnail_url || v.frame_url}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        onError={(e) => {
                          e.target.onerror = null;
                          e.target.src = v.frame_url;
                        }}
                        className="w-11 h-7 object-cover rounded border border-border-soft"
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

      {/* Pagination Controls */}
      {!isLoading && !error && total > 0 && (
        <div className="flex items-center justify-between px-4 py-4 border-t border-white/10">
          <div className="text-sm text-gray-400">
            Showing <span className="text-white font-medium">{(page - 1) * pageSize + 1}</span>
            {'–'}
            <span className="text-white font-medium">{Math.min(page * pageSize, total)}</span> of{' '}
            <span className="text-white font-medium">{total}</span> results
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 rounded-md text-sm text-gray-400 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                &larr; Prev
              </button>
              {Array.from({ length: totalPages }).map((_, idx) => {
                const pNum = idx + 1;
                if (totalPages > 6 && Math.abs(pNum - page) > 1 && pNum !== 1 && pNum !== totalPages) {
                  if (pNum === 2 || pNum === totalPages - 1) {
                    return <span key={pNum} className="text-gray-500 text-sm px-1">...</span>;
                  }
                  return null;
                }
                return (
                  <button
                    key={pNum}
                    onClick={() => setPage(pNum)}
                    className={`w-8 h-8 rounded-md text-sm font-medium transition-colors ${
                      page === pNum
                        ? 'bg-cyan-500 text-black'
                        : 'text-gray-400 hover:bg-white/10'
                    }`}
                  >
                    {pNum}
                  </button>
                );
              })}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 rounded-md text-sm text-gray-400 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Next &rarr;
              </button>
            </div>
          )}
        </div>
      )}

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
