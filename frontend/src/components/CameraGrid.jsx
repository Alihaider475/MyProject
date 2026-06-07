import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';

const URI_PLACEHOLDERS = {
  webcam: '0  (or 1, 2 for additional cameras)',
  rtsp: 'rtsp://user:pass@192.168.1.50:554/stream1',
  file: 'C:/path/to/video.mp4',
};

/** Icon per source type — pure, no props that change often */
const SourceIcon = memo(function SourceIcon({ type }) {
  if (type === 'webcam') return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400">
      <rect x="1" y="3" width="10" height="10" rx="2"/>
      <path d="M11 6l4-2v8l-4-2V6z"/>
      <circle cx="6" cy="8" r="2"/>
    </svg>
  );
  if (type === 'rtsp') return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400">
      <circle cx="8" cy="8" r="6"/>
      <path d="M8 4v4l3 2"/>
      <path d="M4 2l8 0M4 14l8 0" strokeOpacity="0.4"/>
    </svg>
  );
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
      <path d="M2 4h12v8H2z" rx="1"/>
      <circle cx="8" cy="8" r="2.5"/>
      <path d="M5 4V2M11 4V2"/>
    </svg>
  );
});

const TypeBadge = memo(function TypeBadge({ type }) {
  const cls = type === 'webcam' ? 'badge-webcam' : type === 'rtsp' ? 'badge-rtsp' : 'badge-file';
  return <span className={cls}>{type}</span>;
});

const StatusBadge = memo(function StatusBadge({ running }) {
  return running ? (
    <span className="badge-running flex items-center gap-1 w-fit">
      <span className="live-dot" />Running
    </span>
  ) : (
    <span className="badge-stopped">Stopped</span>
  );
});

/** Confidence bar + percentage */
const ConfidenceBar = memo(function ConfidenceBar({ value }) {
  const pct = Math.round((value ?? 0.5) * 100);
  const barStyle = useMemo(() => ({ width: `${pct}%` }), [pct]);
  const pctStyle = useMemo(
    () => ({ color: `hsl(${pct + 60}, 80%, 60%)` }),
    [pct]
  );
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between items-center">
        <span className="text-[10px] text-text-muted uppercase tracking-wider">Confidence</span>
        <span className="text-xs font-semibold tabular-nums" style={pctStyle}>{pct}%</span>
      </div>
      <div className="w-full h-1 bg-surface-3 rounded-full overflow-hidden">
        <div className="conf-bar h-1" style={barStyle} />
      </div>
    </div>
  );
});

/** Skeleton camera card */
const SkeletonCard = memo(function SkeletonCard() {
  return (
    <div className="rounded-xl p-4 border border-border-soft bg-surface-2/40 space-y-3">
      <div className="flex items-center gap-2">
        <div className="skel-box w-7 h-7 rounded-lg" />
        <div className="skel-line flex-1 h-4" />
      </div>
      <div className="flex gap-2">
        <div className="skel-line w-14 h-4" />
        <div className="skel-line w-16 h-4" />
      </div>
      <div className="skel-box w-full h-1.5 rounded-full" />
      <div className="flex gap-2 pt-1">
        <div className="skel-line flex-1 h-7 rounded-lg" />
        <div className="skel-line w-8 h-7 rounded-lg" />
      </div>
    </div>
  );
});

// Stable grid-line style for the offline camera preview — defined outside component
const OFFLINE_PREVIEW_STYLE = {
  backgroundImage: 'linear-gradient(rgba(6,182,212,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.04) 1px, transparent 1px)',
  backgroundSize: '16px 16px',
};

/** Single camera card — memoised so only the changed cam re-renders */
const CameraCard = memo(function CameraCard({ cam, violCount, onDelete, onStart, onStop, onEdit }) {
  const [busy, setBusy] = useState(false);
  const [uptime, setUptime] = useState(0);
  const isRunning = cam.is_running;

  useEffect(() => {
    if (!isRunning) { setUptime(0); return; }
    const start = Date.now();
    setUptime(0);
    const t = setInterval(() => setUptime(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [isRunning]);

  function fmtUptime(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
  }

  async function toggle() {
    setBusy(true);
    try {
      if (isRunning) await onStop(cam);
      else await onStart(cam);
    } finally {
      setBusy(false);
    }
  }

  // Stable handler references so child buttons don't re-render when parent does
  const handleEdit = useCallback(() => onEdit(cam), [onEdit, cam]);
  const handleDelete = useCallback(() => onDelete(cam), [onDelete, cam]);

  return (
    <div className={`flex flex-col rounded-xl border transition-all duration-300 animate-fade-in overflow-hidden ${
      isRunning
        ? 'border-cyan-500/50 bg-cyan-500/5 shadow-[0_0_16px_rgba(6,182,212,0.2)] ring-1 ring-cyan-500/20'
        : 'border-border-strong bg-surface-2/40'
    }`}>
      {/* Preview thumbnail */}
      <div className="relative bg-slate-950 overflow-hidden" style={{ height: isRunning ? 64 : 42 }}>
        {isRunning ? (
          <>
            <img
              src={api.streamUrl(cam.id)}
              alt="Camera preview"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
            <div className="absolute bottom-1.5 left-2 flex items-center gap-1 pointer-events-none">
              <span className="live-dot" />
              <span className="text-white text-[9px] font-bold tracking-widest">LIVE</span>
            </div>
            {uptime > 0 && (
              <div className="absolute bottom-1.5 right-2 text-[9px] text-white/60 font-mono tabular-nums pointer-events-none">
                {fmtUptime(uptime)}
              </div>
            )}
          </>
        ) : (
          <div
            className="w-full h-full flex items-center justify-center"
            style={OFFLINE_PREVIEW_STYLE}
          >
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="#334155" strokeWidth="1.5">
              <rect x="1" y="4" width="14" height="14" rx="2"/>
              <path d="M15 9l6-3v10l-6-3V9z"/>
            </svg>
          </div>
        )}
        {violCount != null && violCount > 0 && (
          <div className="absolute top-1.5 right-1.5 bg-red-500 text-white text-[9px] font-bold rounded-full px-1.5 py-0.5 leading-none tabular-nums">
            {violCount > 99 ? '99+' : violCount}
          </div>
        )}
      </div>

      {/* Card content */}
      <div className="flex flex-col gap-2.5 p-3">
        {/* Top row: icon + name */}
        <div className="flex items-start gap-2">
          <div className="w-7 h-7 rounded-lg bg-surface-3 border border-border-strong flex items-center justify-center flex-shrink-0">
            <SourceIcon type={cam.source_type} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-text-base truncate leading-tight">{cam.name}</p>
            <p className="text-[10px] text-text-subtle truncate mt-0.5" title={cam.source_uri}>
              {cam.source_type === 'webcam' ? `Index ${cam.source_uri || '0'}` : (cam.source_uri || 'No source set')}
            </p>
          </div>
        </div>

        {/* Badges row */}
        <div className="flex items-center gap-2 flex-wrap">
          <TypeBadge type={cam.source_type} />
          <StatusBadge running={isRunning} />
        </div>

        <ConfidenceBar value={cam.detection_confidence} />

        {/* Action buttons */}
        <div className="flex gap-2 pt-0.5">
          <button
            onClick={toggle}
            disabled={busy}
            className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold rounded-lg py-1.5 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed
              ${isRunning
                ? 'bg-red-600/80 hover:bg-red-600 text-white hover:shadow-[0_0_12px_rgba(239,68,68,0.4)]'
                : 'bg-emerald-600/80 hover:bg-emerald-600 text-white hover:shadow-[0_0_12px_rgba(16,185,129,0.4)]'}`}
            title={isRunning ? 'Stop camera' : 'Start camera'}
          >
            {busy ? (
              <svg className="animate-spin" width="12" height="12" viewBox="0 0 12 12" fill="none">
                <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3"/>
                <path d="M6 1.5A4.5 4.5 0 0 1 10.5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            ) : isRunning ? (
              <>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect x="1" y="1" width="8" height="8" rx="1"/></svg>
                Stop
              </>
            ) : (
              <>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><polygon points="1,1 9,5 1,9"/></svg>
                Start
              </>
            )}
          </button>
          <button onClick={handleEdit} className="btn-icon" title="Edit camera">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.5 1.5l2 2L4 11 1 12l1-3 7.5-7.5z"/>
            </svg>
          </button>
          <button
            onClick={handleDelete}
            className="btn-icon hover:!border-red-500/50 hover:!text-red-400 hover:!bg-red-500/10"
            title="Delete camera"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 3h10M4 3V1.5h4V3M5 5.5v4M7 5.5v4M2 3l.667 7.5h6.666L10 3"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
});

/** Edit panel (slide-down) */
const EditPanel = memo(function EditPanel({ cam, onSave, onCancel }) {
  const [values, setValues] = useState({
    name: cam.name,
    source_uri: cam.source_uri ?? '',
    detection_confidence: cam.detection_confidence ?? 0.5,
  });

  const handleSave = useCallback(() => onSave(cam, values), [onSave, cam, values]);

  return (
    <div className="slide-down bg-surface-2/80 border border-border-strong rounded-xl p-4 space-y-3">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">Edit — {cam.name}</p>
      <input
        className="form-input"
        placeholder="Camera name"
        value={values.name}
        onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
        autoFocus
      />
      <input
        className="form-input"
        placeholder={URI_PLACEHOLDERS[cam.source_type]}
        value={values.source_uri}
        onChange={(e) => setValues((v) => ({ ...v, source_uri: e.target.value }))}
      />
      <div className="flex items-center gap-3">
        <label className="text-xs text-text-muted whitespace-nowrap">Confidence</label>
        <input
          type="range" min="0.1" max="1.0" step="0.05"
          value={values.detection_confidence}
          onChange={(e) => setValues((v) => ({ ...v, detection_confidence: parseFloat(e.target.value) }))}
          className="flex-1 accent-brand"
        />
        <span className="text-xs text-text-muted tabular-nums w-10 text-right">{Math.round(values.detection_confidence * 100)}%</span>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={handleSave} className="btn-success text-xs px-3 py-1.5 flex-1">Save changes</button>
        <button onClick={onCancel} className="btn-outline text-xs px-3 py-1.5">Cancel</button>
      </div>
    </div>
  );
});

/** Add Camera slide-down panel */
function AddCameraPanel({ onAdd }) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: '', source_type: 'webcam', source_uri: '0', detection_confidence: 0.5,
  });
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});

  function validate() {
    const e = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (form.source_type === 'rtsp' && !form.source_uri.toLowerCase().startsWith('rtsp://'))
      e.source_uri = 'Must start with rtsp://';
    if (form.source_type !== 'webcam' && !form.source_uri.trim())
      e.source_uri = 'Source URI is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      await onAdd(form);
      setForm({ name: '', source_type: 'webcam', source_uri: '0', detection_confidence: 0.5 });
      setErrors({});
      setOpen(false);
      showToast({ title: '✅ Camera added', message: `"${form.name}" saved successfully.`, level: 'success' });
    } catch (err) {
      showToast({ title: 'Failed to add camera', message: err.message, level: 'danger', duration: 8000 });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border-t border-border-soft">
      {/* Toggle button */}
      <button
        id="add-camera-toggle-btn"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3 text-sm text-text-muted hover:text-text-base hover:bg-surface-2/50 transition-colors"
      >
        <span className="flex items-center gap-2 font-semibold">
          <span className={`text-base transition-transform duration-200 ${open ? 'rotate-45' : ''}`}>+</span>
          Add New Camera
        </span>
        <svg
          width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round"
          className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <path d="M3 5l4 4 4-4"/>
        </svg>
      </button>

      {/* Slide-down form */}
      {open && (
        <div className="slide-down px-5 pb-5 space-y-3">
          <form id="add-camera-form" onSubmit={handleAdd} className="space-y-3">
            {/* Name + Source type — side-by-side on desktop */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <input
                  id="add-camera-name"
                  required
                  className={`form-input ${errors.name ? 'border-red-500 focus:border-red-500' : ''}`}
                  placeholder="Camera name  (e.g. Front Gate)"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  autoFocus
                />
                {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
              </div>

              {/* Source type */}
              <select
                id="add-camera-type"
                className="form-select w-full"
                value={form.source_type}
                onChange={(e) => setForm((f) => ({ ...f, source_type: e.target.value, source_uri: e.target.value === 'webcam' ? '0' : '' }))}
              >
                <option value="webcam">Webcam</option>
                <option value="rtsp">RTSP Stream</option>
                <option value="file">Video File</option>
              </select>
            </div>

            {/* Webcam index — only when webcam */}
            {form.source_type === 'webcam' && (
              <div className="slide-down">
                <input
                  id="add-camera-webcam-index"
                  className="form-input"
                  placeholder={URI_PLACEHOLDERS.webcam}
                  value={form.source_uri}
                  onChange={(e) => setForm((f) => ({ ...f, source_uri: e.target.value }))}
                />
                <p className="text-text-subtle text-xs mt-1">Device index (0 = default camera)</p>
              </div>
            )}

            {/* RTSP URL — only when rtsp */}
            {form.source_type === 'rtsp' && (
              <div className="slide-down">
                <input
                  id="add-camera-rtsp-url"
                  className={`form-input ${errors.source_uri ? 'border-red-500' : ''}`}
                  placeholder={URI_PLACEHOLDERS.rtsp}
                  value={form.source_uri}
                  onChange={(e) => setForm((f) => ({ ...f, source_uri: e.target.value }))}
                />
                {errors.source_uri && <p className="text-red-400 text-xs mt-1">{errors.source_uri}</p>}
              </div>
            )}

            {/* File path — only when file */}
            {form.source_type === 'file' && (
              <div className="slide-down">
                <input
                  id="add-camera-file-path"
                  className={`form-input ${errors.source_uri ? 'border-red-500' : ''}`}
                  placeholder={URI_PLACEHOLDERS.file}
                  value={form.source_uri}
                  onChange={(e) => setForm((f) => ({ ...f, source_uri: e.target.value }))}
                />
                {errors.source_uri && <p className="text-red-400 text-xs mt-1">{errors.source_uri}</p>}
              </div>
            )}

            {/* Confidence slider */}
            <div className="flex items-center gap-3">
              <label className="text-xs text-text-muted whitespace-nowrap">Confidence threshold</label>
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

            <button
              id="add-camera-submit-btn"
              type="submit"
              disabled={submitting}
              className="btn-brand w-full flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {submitting ? (
                <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3"/>
                  <path d="M7 2A5 5 0 0 1 12 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="7" y1="1" x2="7" y2="13"/><line x1="1" y1="7" x2="13" y2="7"/>
                </svg>
              )}
              {submitting ? 'Adding…' : 'Add Camera'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export default function CameraGrid({ onCameraChange }) {
  const { showToast } = useToast();
  const [cameras, setCameras] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [violCounts, setViolCounts] = useState({});
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const data = await api.listCameras();
      setCameras(data);
      setError('');
    } catch (err) {
      setError(err.message || 'Unable to load cameras.');
      setCameras([]);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Fetch all violation counts in a single batch request
  useEffect(() => {
    let cancelled = false;
    api.violationCountsByCamera()
      .then((data) => { if (!cancelled) setViolCounts(data || {}); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [cameras]);

  // ── Add camera ──────────────────────────────────────────────────────────
  const handleAdd = useCallback(async (form) => {
    await api.createCamera(form);
    await refresh();
    onCameraChange?.();
  }, [onCameraChange, refresh]);

  // ── Edit camera ─────────────────────────────────────────────────────────
  const saveEdit = useCallback(async (cam, values) => {
    const body = {};
    if (values.name !== cam.name) body.name = values.name;
    if (values.source_uri !== cam.source_uri) body.source_uri = values.source_uri;
    if (values.detection_confidence !== cam.detection_confidence) body.detection_confidence = values.detection_confidence;
    if (Object.keys(body).length === 0) { setEditingId(null); return; }
    try {
      await api.updateCamera(cam.id, body);
      showToast({ title: 'Camera updated', message: 'Changes saved.', level: 'success' });
      await refresh();
      onCameraChange?.();
      setEditingId(null);
    } catch (err) {
      showToast({ title: 'Update failed', message: err.message, level: 'danger' });
    }
  }, [onCameraChange, refresh, showToast]);

  // ── Delete camera ───────────────────────────────────────────────────────
  const handleDelete = useCallback(async (cam) => {
    if (!window.confirm(`Delete camera "${cam.name}"? Violation history is preserved.`)) return;
    try {
      await api.deleteCamera(cam.id);
      showToast({ title: '🗑️ Camera deleted', message: `"${cam.name}" removed.`, level: 'success' });
      await refresh();
      onCameraChange?.();
    } catch (err) {
      showToast({ title: 'Delete failed', message: err.message, level: 'danger' });
    }
  }, [onCameraChange, refresh, showToast]);

  // ── Start / Stop from card ──────────────────────────────────────────────
  const handleStart = useCallback(async (cam) => {
    try {
      await api.startCamera(cam.id);
      // Optimistic update — don't wait for refresh which may be slow
      setCameras((prev) => prev?.map((c) => c.id === cam.id ? { ...c, is_running: true } : c));
      showToast({ title: '▶ Camera started', message: `"${cam.name}" is now streaming.`, level: 'success' });
      onCameraChange?.();
    } catch (err) {
      showToast({ title: 'Failed to start', message: err.message, level: 'danger', duration: 8000 });
    }
  }, [onCameraChange, showToast]);

  const handleStop = useCallback(async (cam) => {
    try {
      await api.stopCamera(cam.id);
      setCameras((prev) => prev?.map((c) => c.id === cam.id ? { ...c, is_running: false } : c));
      showToast({ title: '■ Camera stopped', message: `"${cam.name}" stopped.`, level: 'info' });
      onCameraChange?.();
    } catch (err) {
      showToast({ title: 'Failed to stop', message: err.message, level: 'danger' });
    }
  }, [onCameraChange, showToast]);

  const handleCancelEdit = useCallback(() => setEditingId(null), []);
  const handleEdit = useCallback((cam) => setEditingId(cam.id), []);

  return (
    <div className="card flex flex-col">
      {/* Header */}
      <div className="card-header">
        <div className="flex items-center gap-2">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-brand">
            <circle cx="7.5" cy="7.5" r="6"/>
            <path d="M7.5 4v4l2.5 2"/>
          </svg>
          <span className="font-semibold">Manage Cameras</span>
        </div>
      </div>

      {/* Camera cards — only render when loaded */}
      {cameras === null && (
        <div className="p-4 grid grid-cols-1 gap-3">
          {[0, 1, 2].map((i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {error && (
        <div className="p-4">
          <div className="dashboard-empty">
            <p className="font-semibold text-text-base">Could not load cameras</p>
            <p>{error}</p>
          </div>
        </div>
      )}

      {cameras && !error && cameras.length === 0 && (
        <div className="p-4">
          <div className="dashboard-empty">
            <p className="font-semibold text-text-base">No cameras configured</p>
            <p>Add a camera to start monitoring live PPE detection.</p>
          </div>
        </div>
      )}

      {cameras && !error && cameras.length > 0 && (
        <div className="p-3 grid grid-cols-1 gap-3 max-h-[560px] overflow-y-auto">
          {cameras.map((cam) => (
            <div key={cam.id}>
              <CameraCard
                cam={cam}
                violCount={violCounts[cam.id] ?? null}
                onDelete={handleDelete}
                onStart={handleStart}
                onStop={handleStop}
                onEdit={handleEdit}
              />
              {editingId === cam.id && (
                <div className="mt-2">
                  <EditPanel cam={cam} onSave={saveEdit} onCancel={handleCancelEdit} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add Camera slide-down panel */}
      <AddCameraPanel onAdd={handleAdd} />
    </div>
  );
}
