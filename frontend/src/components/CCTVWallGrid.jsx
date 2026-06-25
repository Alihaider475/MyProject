import { memo, useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';

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

/** Single CCTV wall tile — 16:9 live feed + per-tile start/stop */
const CCTVTile = memo(function CCTVTile({ cam, onToggle, busy }) {
  const [imgError, setImgError] = useState(false);
  const isRunning = cam.is_running;

  useEffect(() => {
    if (isRunning) setImgError(false);
  }, [isRunning]);

  const handleToggle = useCallback(() => onToggle(cam), [onToggle, cam]);
  const showFeed = isRunning && !imgError;

  return (
    <div className={`flex flex-col rounded-xl border transition-all duration-300 overflow-hidden ${
      isRunning
        ? 'border-cyan-500/50 bg-cyan-500/5 shadow-[0_0_16px_rgba(6,182,212,0.2)] ring-1 ring-cyan-500/20'
        : 'border-border-strong bg-surface-2/40'
    }`}>
      {/* 16:9 media area */}
      <div className="relative bg-slate-950 overflow-hidden" style={{ aspectRatio: '16 / 9' }}>
        {showFeed ? (
          <>
            <img
              src={api.streamUrl(cam.id)}
              alt={cam.name}
              onError={() => setImgError(true)}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
            <div className="absolute top-2 left-2 pointer-events-none">
              <StatusBadge running />
            </div>
          </>
        ) : (
          <div
            className="w-full h-full flex flex-col items-center justify-center gap-2"
            style={OFFLINE_PREVIEW_STYLE}
          >
            <svg width="28" height="28" viewBox="0 0 22 22" fill="none" stroke="#334155" strokeWidth="1.5">
              <rect x="1" y="4" width="14" height="14" rx="2"/>
              <path d="M15 9l6-3v10l-6-3V9z"/>
            </svg>
            <span className="text-xs text-text-subtle">
              {isRunning && imgError ? 'Camera unavailable' : 'Stopped'}
            </span>
            <div className="absolute top-2 left-2">
              <StatusBadge running={false} />
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 p-3">
        <p className="text-sm font-semibold text-text-base truncate" title={cam.name}>{cam.name}</p>
        <button
          onClick={handleToggle}
          disabled={busy}
          className={`flex-shrink-0 text-xs px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed ${isRunning ? 'btn-danger' : 'btn-success'}`}
        >
          {busy ? 'Wait…' : isRunning ? 'Stop' : 'Start'}
        </button>
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
        className="bg-surface-1 border border-border-soft rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-base">Add IP Camera</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-base text-lg leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <input
              className={`form-input w-full ${errors.name ? 'border-red-500 focus:border-red-500' : ''}`}
              placeholder="Camera name (e.g. Front Gate)"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              autoFocus
            />
            {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
          </div>

          <div>
            <input
              className={`form-input w-full ${errors.source_uri ? 'border-red-500 focus:border-red-500' : ''}`}
              placeholder="rtsp://user:pass@192.168.1.50:554/stream1"
              value={form.source_uri}
              onChange={(e) => setForm((f) => ({ ...f, source_uri: e.target.value }))}
            />
            {errors.source_uri && <p className="text-red-400 text-xs mt-1">{errors.source_uri}</p>}
          </div>

          <div className="flex items-center gap-3">
            <label className="text-xs text-text-muted whitespace-nowrap">Confidence</label>
            <input
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
              <label className="text-xs text-text-muted whitespace-nowrap">Copies</label>
              <input
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

export default function CCTVWallGrid() {
  const { showToast } = useToast();
  const [cameras, setCameras] = useState(null);
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api.listCameras();
      setCameras(data.filter((c) => c.source_type === 'rtsp'));
    } catch { /* silent */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleToggle = useCallback(async (cam) => {
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
  }, [showToast]);

  const handleBulk = useCallback(async (action) => {
    if (!cameras) return;
    setBulkBusy(true);
    const targets = cameras.filter((c) => action === 'start' ? !c.is_running : c.is_running);
    if (targets.length === 0) {
      setBulkBusy(false);
      showToast({ title: action === 'start' ? 'Start All' : 'Stop All', message: action === 'start' ? 'All cameras already running.' : 'All cameras already stopped.', level: 'info' });
      return;
    }
    const results = await Promise.allSettled(
      targets.map((c) => (action === 'start' ? api.startCamera(c.id) : api.stopCamera(c.id)))
    );
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    await refresh();
    showToast({
      title: action === 'start' ? 'Start All complete' : 'Stop All complete',
      message: `${action === 'start' ? 'Started' : 'Stopped'} ${succeeded}/${targets.length} cameras`,
      level: succeeded === targets.length ? 'success' : 'warning',
      duration: 6000,
    });
    setBulkBusy(false);
  }, [cameras, refresh, showToast]);

  const handleStartAll = useCallback(() => handleBulk('start'), [handleBulk]);
  const handleStopAll = useCallback(() => handleBulk('stop'), [handleBulk]);
  const handleCreated = useCallback(() => { refresh(); }, [refresh]);

  const hasStopped = cameras?.some((c) => !c.is_running) ?? false;
  const hasRunning = cameras?.some((c) => c.is_running) ?? false;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-base">CCTV Wall</h1>
          <p className="text-xs text-text-muted mt-1">Monitor multiple IP camera feeds in real time</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setModalOpen(true)} className="btn-brand text-sm px-4 py-2">
            Add IP Camera
          </button>
          <button onClick={handleStartAll} disabled={bulkBusy || !hasStopped} className="btn-success text-sm px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed">
            Start All
          </button>
          <button onClick={handleStopAll} disabled={bulkBusy || !hasRunning} className="btn-danger text-sm px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed">
            Stop All
          </button>
          <button onClick={refresh} className="btn-outline text-sm px-4 py-2">
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
            <CCTVTile key={cam.id} cam={cam} onToggle={handleToggle} busy={busyIds.has(cam.id)} />
          ))}
        </div>
      )}

      <AddCameraModal open={modalOpen} onClose={() => setModalOpen(false)} onCreated={handleCreated} />
    </div>
  );
}
