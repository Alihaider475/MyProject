import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../services/api/client.js';
import { useToast } from '../../../store/ToastContext.jsx';
import { useEscapeKey } from '../../../hooks/useEscapeKey.js';
import { useFocusTrap } from '../../../hooks/useFocusTrap.js';

// Stable grid-line style for the offline tile preview — defined outside component
const OFFLINE_PREVIEW_STYLE = {
  backgroundImage: 'linear-gradient(rgba(6,182,212,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.04) 1px, transparent 1px)',
  backgroundSize: '16px 16px',
};

const StatusBadge = memo(function StatusBadge({ running }) {
  return running ? (
    <span className="badge-running flex items-center gap-1 w-fit">
      <span className="live-dot" />LIVE
    </span>
  ) : (
    <span className="bg-red-500/10 text-red-500 border border-red-500/20 text-xs font-semibold px-2 py-0.5 rounded-md flex items-center gap-1 w-fit">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500" />OFFLINE
    </span>
  );
});

/** Single CCTV wall tile — 16:9 letterboxed live feed + per-tile start/stop/delete.
 * `reloadNonce` bumps the stream src so a stale-but-"running" feed re-attaches. */
const CCTVTile = memo(function CCTVTile({ cam, onToggle, onDelete, onRetry, busy, reloadNonce, aiReady }) {
  const [imgError, setImgError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const isRunning = cam.is_running;

  // Reset stream state whenever the camera flips running or we force a reload.
  useEffect(() => {
    setImgError(false);
    setLoaded(false);
  }, [isRunning, reloadNonce]);

  const handleToggle = useCallback(() => onToggle(cam), [onToggle, cam]);
  const handleDelete = useCallback(() => onDelete(cam), [onDelete, cam]);

  const showFeed = isRunning && !imgError;
  const starting = busy && !isRunning;          // start request in flight
  const connecting = isRunning && !imgError && !loaded;  // stream not yet showing frames

  return (
    <div className={`flex flex-col rounded-xl border transition-[border-color,background-color,box-shadow] duration-300 overflow-hidden ${
      isRunning
        ? 'border-cyan-500/50 bg-cyan-500/5 shadow-[0_0_16px_rgba(6,182,212,0.2)] ring-1 ring-cyan-500/20'
        : 'border-border-strong bg-surface-2/40'
    }`}>
      {/* 16:9 media area — black background, feed letterboxed (object-contain) */}
      <div className="relative bg-slate-950 overflow-hidden" style={{ aspectRatio: '16 / 9' }}>
        {showFeed ? (
          <>
            <img
              key={reloadNonce}
              src={`${api.streamUrl(cam.id)}&r=${reloadNonce}`}
              alt={cam.name}
              onLoad={() => setLoaded(true)}
              onError={() => setImgError(true)}
              className="w-full h-full object-contain"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
            {loaded && (
              <div className="absolute top-2 left-2 pointer-events-none">
                <StatusBadge running />
              </div>
            )}
            {connecting && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/60">
                <span className="w-6 h-6 rounded-full border-2 border-cyan-500/30 border-t-cyan-400 animate-spin" />
                <span className="text-xs text-text-subtle">Connecting…</span>
              </div>
            )}
          </>
        ) : (
          <div
            className="w-full h-full flex flex-col items-center justify-center gap-2"
            style={OFFLINE_PREVIEW_STYLE}
          >
            {starting ? (
              <>
                <span className="w-6 h-6 rounded-full border-2 border-cyan-500/30 border-t-cyan-400 animate-spin" />
                <span className="text-xs text-text-subtle">Starting…</span>
              </>
            ) : (
              <>
                <svg aria-hidden="true" focusable="false" width="28" height="28" viewBox="0 0 22 22" fill="none" stroke="#334155" strokeWidth="1.5">
                  <rect x="1" y="4" width="14" height="14" rx="2"/>
                  <path d="M15 9l6-3v10l-6-3V9z"/>
                </svg>
                <span className="text-xs text-text-subtle">
                  {isRunning && imgError ? 'Camera unavailable' : 'Stopped'}
                </span>
                {isRunning && imgError && (
                  <button
                    onClick={onRetry}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
                    title="Reconnect this feed"
                  >
                    Retry
                  </button>
                )}
              </>
            )}
            <div className="absolute top-2 left-2">
              <StatusBadge running={isRunning && !imgError} />
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 p-3">
        <p className="text-sm font-semibold text-text-base truncate" title={cam.name}>{cam.name}</p>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={handleToggle}
            disabled={busy || (!isRunning && !aiReady)}
            title={!isRunning && !aiReady ? 'AI model loading, please wait' : undefined}
            className={`text-xs px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed ${isRunning ? 'btn-danger' : 'btn-success'}`}
          >
            {busy ? (isRunning ? 'Wait…' : 'Starting…') : isRunning ? 'Stop' : 'Start'}
          </button>
          <button
            onClick={handleDelete}
            disabled={busy}
            aria-label={`Delete ${cam.name}`}
            title="Delete camera"
            className="btn-icon p-1.5 disabled:opacity-50 disabled:cursor-not-allowed hover:!border-red-500/50 hover:!text-red-400 hover:!bg-red-500/10"
          >
            <svg aria-hidden="true" focusable="false" width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 3h10M4 3V1.5h4V3M5 5.5v4M7 5.5v4M2 3l.667 7.5h6.666L10 3"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
});

/** Skeleton tile shown while the camera list is loading */
const SkeletonTile = memo(function SkeletonTile() {
  return (
    <div className="rounded-xl border border-border-soft bg-surface-2/40 overflow-hidden">
      <div className="skel-box" style={{ aspectRatio: '16 / 9' }} />
      <div className="flex items-center justify-between gap-2 p-3">
        <div className="skel-line flex-1 h-4" />
        <div className="skel-line w-14 h-7 rounded-lg" />
      </div>
    </div>
  );
});

/** "Add IP Camera" modal — supports creating one or duplicating N tiles from one RTSP URL */
function AddCameraModal({ open, onClose, onCreated }) {
  const { showToast } = useToast();
  const [form, setForm] = useState({ name: '', source_uri: '', detection_confidence: 0.25, copies: 1 });
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});
  const panelRef = useRef(null);

  useEscapeKey(onClose, open && !submitting);
  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (open) {
      setForm({ name: '', source_uri: '', detection_confidence: 0.25, copies: 1 });
      setErrors({});
    }
  }, [open]);

  if (!open) return null;

  function validate() {
    const e = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (!form.source_uri.trim()) e.source_uri = 'RTSP URL is required';
    else if (!form.source_uri.toLowerCase().startsWith('rtsp://')) e.source_uri = 'Must start with rtsp://';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const copies = Number(form.copies) || 1;
      if (copies <= 1) {
        await api.createCamera({
          name: form.name,
          source_type: 'rtsp',
          source_uri: form.source_uri,
          detection_confidence: form.detection_confidence,
        });
      } else {
        await api.duplicateCamera({
          name_prefix: form.name,
          source_type: 'rtsp',
          source_uri: form.source_uri,
          copies,
          detection_confidence: form.detection_confidence,
        });
      }
      showToast({ title: '✅ Camera added', message: `"${form.name}" saved successfully.`, level: 'success' });
      onCreated();
      onClose();
    } catch (err) {
      showToast({ title: 'Failed to add camera', message: err.message, level: 'danger', duration: 8000 });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Add IP Camera"
        className="bg-surface-1 border border-border-soft rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-base">Add IP Camera</h2>
          <button onClick={onClose} aria-label="Close" className="text-text-muted hover:text-text-base text-lg leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <input
              aria-label="Camera name"
              className={`form-input w-full ${errors.name ? 'border-red-500 focus:border-red-500' : ''}`}
              placeholder="Camera name (e.g. Front Gate)"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
          </div>

          <div>
            <input
              aria-label="RTSP URL"
              className={`form-input w-full ${errors.source_uri ? 'border-red-500 focus:border-red-500' : ''}`}
              placeholder="rtsp://user:pass@192.168.1.50:554/stream1"
              value={form.source_uri}
              onChange={(e) => setForm((f) => ({ ...f, source_uri: e.target.value }))}
            />
            {errors.source_uri ? (
              <p className="text-red-400 text-xs mt-1">{errors.source_uri}</p>
            ) : (
              <p className="text-text-subtle text-xs mt-1">
                Tip: use the sub-stream for lower latency — e.g. <code>…:554/ch1/sub</code>
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <label htmlFor="cctv-confidence" className="text-xs text-text-muted whitespace-nowrap">Confidence</label>
            <input
              id="cctv-confidence"
              type="range" min="0.1" max="1.0" step="0.05"
              value={form.detection_confidence}
              onChange={(e) => setForm((f) => ({ ...f, detection_confidence: parseFloat(e.target.value) }))}
              className="flex-1 accent-brand"
            />
            <span className="text-xs font-semibold text-brand tabular-nums w-10 text-right">
              {Math.round(form.detection_confidence * 100)}%
            </span>
          </div>

          <div>
            <div className="flex items-center gap-3">
              <label htmlFor="cctv-copies" className="text-xs text-text-muted whitespace-nowrap">Copies</label>
              <input
                id="cctv-copies"
                type="number" min="1" max="20"
                className="form-input w-20"
                value={form.copies}
                onChange={(e) => setForm((f) => ({ ...f, copies: e.target.value }))}
              />
            </div>
            <p className="text-text-subtle text-xs mt-1">Creates N tiles sharing this one RTSP URL (1-20)</p>
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} disabled={submitting} className="btn-outline flex-1 text-sm py-2">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="btn-brand flex-1 text-sm py-2 flex items-center justify-center gap-2">
              {submitting ? 'Adding…' : 'Add Camera'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Small await-able delay so sequential RTSP starts don't pile up on the backend.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function CCTVWallGrid() {
  const { showToast } = useToast();
  const [cameras, setCameras] = useState(null);
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [aiReady, setAiReady] = useState(false);
  // Bumped on manual Refresh / per-tile Retry to force a feed to re-attach
  // (recovers frozen/stale tiles). Not bumped on the auto-poll, so healthy
  // live feeds aren't reconnected — and flickered — every 10s.
  const [reloadNonce, setReloadNonce] = useState(0);

  // Reconcile the camera list / is_running from the backend. Does NOT bump the
  // reload nonce, so healthy live feeds aren't force-reconnected on every poll.
  const refresh = useCallback(async () => {
    try {
      const data = await api.listCameras();
      setCameras(data.filter((c) => c.source_type === 'rtsp'));
    } catch { /* silent */ }
  }, []);

  // Manual refresh also force-reloads every feed (recovers frozen/stale tiles).
  const manualRefresh = useCallback(() => {
    setReloadNonce((n) => n + 1);
    refresh();
  }, [refresh]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    const checkReady = async () => {
      try {
        const data = await api.ready();
        if (!cancelled) setAiReady(Boolean(data.ready));
      } catch {
        if (!cancelled) setAiReady(false);
      }
    };
    checkReady();
    const timer = setInterval(checkReady, aiReady ? 15000 : 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [aiReady]);

  // Light auto-poll: reconcile is_running and reload stale feeds every ~10s.
  // Pause while a bulk op or any per-tile toggle is in flight so we don't clobber
  // optimistic state mid-action.
  const busyCount = busyIds.size;
  useEffect(() => {
    if (bulkBusy || busyCount > 0) return undefined;
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [refresh, bulkBusy, busyCount]);

  const handleToggle = useCallback(async (cam) => {
    if (!cam.is_running && !aiReady) {
      showToast({ title: 'AI loading', message: 'AI model loading, please wait before starting cameras.', level: 'info', duration: 5000 });
      return;
    }
    setBusyIds((prev) => new Set(prev).add(cam.id));
    try {
      if (cam.is_running) {
        await api.stopCamera(cam.id);
        setCameras((prev) => prev?.map((c) => c.id === cam.id ? { ...c, is_running: false } : c));
        showToast({ title: '■ Camera stopped', message: `"${cam.name}" stopped.`, level: 'info' });
      } else {
        await api.startCamera(cam.id);
        setCameras((prev) => prev?.map((c) => c.id === cam.id ? { ...c, is_running: true } : c));
        showToast({ title: '▶ Camera started', message: `"${cam.name}" is now streaming.`, level: 'success' });
      }
    } catch (err) {
      showToast({ title: cam.is_running ? 'Failed to stop' : 'Failed to start', message: err.message, level: 'danger', duration: 8000 });
    } finally {
      setBusyIds((prev) => { const next = new Set(prev); next.delete(cam.id); return next; });
    }
  }, [aiReady, showToast]);

  const handleDelete = useCallback(async (cam) => {
    if (!window.confirm(`Delete camera "${cam.name}"? Violation history is preserved.`)) return;
    setBusyIds((prev) => new Set(prev).add(cam.id));
    try {
      await api.deleteCamera(cam.id);
      setCameras((prev) => prev?.filter((c) => c.id !== cam.id));
      showToast({ title: '🗑️ Camera removed', message: `"${cam.name}" deleted.`, level: 'success' });
    } catch (err) {
      showToast({ title: 'Delete failed', message: err.message, level: 'danger', duration: 8000 });
    } finally {
      setBusyIds((prev) => { const next = new Set(prev); next.delete(cam.id); return next; });
    }
  }, [showToast]);

  // Start/Stop All — sequential with a small gap between RTSP starts so blocking
  // cv2.VideoCapture opens don't saturate the backend executor. Failed cameras are
  // named in the result toast instead of being hidden behind a bare count.
  const handleBulk = useCallback(async (action) => {
    if (!cameras) return;
    if (action === 'start' && !aiReady) {
      showToast({ title: 'AI loading', message: 'AI model loading, please wait before starting cameras.', level: 'info', duration: 5000 });
      return;
    }
    setBulkBusy(true);
    const targets = cameras.filter((c) => action === 'start' ? !c.is_running : c.is_running);
    if (targets.length === 0) {
      setBulkBusy(false);
      showToast({ title: action === 'start' ? 'Start All' : 'Stop All', message: action === 'start' ? 'All cameras already running.' : 'All cameras already stopped.', level: 'info' });
      return;
    }
    const failed = [];
    for (let i = 0; i < targets.length; i++) {
      const c = targets[i];
      setBusyIds((prev) => new Set(prev).add(c.id));
      try {
        if (action === 'start') {
          await api.startCamera(c.id);
          setCameras((prev) => prev?.map((x) => x.id === c.id ? { ...x, is_running: true } : x));
        } else {
          await api.stopCamera(c.id);
          setCameras((prev) => prev?.map((x) => x.id === c.id ? { ...x, is_running: false } : x));
        }
      } catch {
        failed.push(c.name);
      } finally {
        setBusyIds((prev) => { const next = new Set(prev); next.delete(c.id); return next; });
      }
      // Throttle between starts only (stops are cheap).
      if (action === 'start' && i < targets.length - 1) await sleep(400);
    }
    const succeeded = targets.length - failed.length;
    const verb = action === 'start' ? 'Started' : 'Stopped';
    showToast({
      title: action === 'start' ? 'Start All complete' : 'Stop All complete',
      message: failed.length
        ? `${verb} ${succeeded}/${targets.length} — failed: ${failed.join(', ')}`
        : `${verb} ${succeeded}/${targets.length} cameras`,
      level: failed.length ? 'warning' : 'success',
      duration: 6000,
    });
    setBulkBusy(false);
  }, [aiReady, cameras, showToast]);

  const handleStartAll = useCallback(() => handleBulk('start'), [handleBulk]);
  const handleStopAll = useCallback(() => handleBulk('stop'), [handleBulk]);
  const handleCreated = useCallback(() => { refresh(); }, [refresh]);

  const hasStopped = (cameras?.some((c) => !c.is_running) ?? false) && aiReady;
  const hasRunning = cameras?.some((c) => c.is_running) ?? false;
  const liveCount = cameras?.filter((c) => c.is_running).length ?? 0;
  const total = cameras?.length ?? 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-semibold text-text-base">CCTV Wall</h1>
            {cameras !== null && total > 0 && (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-md flex items-center gap-1.5 ${
                liveCount > 0
                  ? 'bg-green-500/10 text-green-400 border border-green-500/20'
                  : 'bg-surface-3 text-text-muted border border-border-strong'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${liveCount > 0 ? 'bg-green-400' : 'bg-text-muted'}`} />
                {liveCount} / {total} live
              </span>
            )}
          </div>
          <p className="text-xs text-text-muted mt-1">Monitor multiple IP camera feeds in real time</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setModalOpen(true)} className="btn-brand text-sm px-4 py-2">
            Add IP Camera
          </button>
          <button
            onClick={handleStartAll}
            disabled={bulkBusy || !hasStopped}
            title={aiReady ? 'Start all stopped cameras' : 'AI model loading, please wait'}
            className="btn-success text-sm px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {aiReady ? 'Start All' : 'AI loading...'}
          </button>
          <button onClick={handleStopAll} disabled={bulkBusy || !hasRunning} className="btn-danger text-sm px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed">
            Stop All
          </button>
          <button onClick={manualRefresh} className="btn-outline text-sm px-4 py-2">
            Refresh
          </button>
        </div>
      </div>

      {/* Grid */}
      {cameras === null ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => <SkeletonTile key={i} />)}
        </div>
      ) : cameras.length === 0 ? (
        <div className="rounded-xl border border-border-soft bg-surface-2/40 p-12 text-center">
          <p className="text-sm text-text-muted">No IP cameras yet — click "Add IP Camera" to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {cameras.map((cam) => (
            <CCTVTile
              key={cam.id}
              cam={cam}
              onToggle={handleToggle}
              onDelete={handleDelete}
              onRetry={manualRefresh}
              busy={busyIds.has(cam.id)}
              reloadNonce={reloadNonce}
              aiReady={aiReady}
            />
          ))}
        </div>
      )}

      <AddCameraModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={handleCreated} />
    </div>
  );
}
