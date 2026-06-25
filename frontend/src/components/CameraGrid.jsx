import { memo, useCallback, useEffect, useMemo, useState } from 'react';
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
const CameraCard = memo(function CameraCard({ cam, violCount, onDelete, onEdit }) {
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
      <div className="relative bg-slate-950 overflow-hidden h-24">
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
      <div className="flex flex-col gap-3 p-4">
        {/* Top row: icon + name */}
        <div className="flex items-start gap-2">
          <div className="w-7 h-7 rounded-lg bg-surface-3 border border-border-strong flex items-center justify-center flex-shrink-0">
            <SourceIcon type={cam.source_type} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-text-base truncate leading-tight">{cam.name}</p>
            <p className="text-[10px] text-text-subtle truncate mt-0.5" title={cam.source_uri}>{cam.source_uri || '—'}</p>
          </div>
        </div>

        {/* Badges row */}
        <div className="flex items-center gap-2 flex-wrap">
          <TypeBadge type={cam.source_type} />
          <StatusBadge running={isRunning} />
        </div>

        {/* Action buttons — start/stop lives on the Dashboard's Live Feed, not here */}
        <div className="flex gap-2 pt-0.5">
          <button onClick={handleEdit} className="btn-icon flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold" title="Edit camera">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.5 1.5l2 2L4 11 1 12l1-3 7.5-7.5z"/>
            </svg>
            Edit
          </button>
          <button
            onClick={handleDelete}
            className="btn-icon flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold hover:!border-red-500/50 hover:!text-red-400 hover:!bg-red-500/10"
            title="Delete camera"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 3h10M4 3V1.5h4V3M5 5.5v4M7 5.5v4M2 3l.667 7.5h6.666L10 3"/>
            </svg>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
});

/** Unified Add / Edit camera modal — owns its own form state, validation, API call and toast,
 * matching the AddCameraModal pattern already established in CCTVWallGrid.jsx. `camera` is
 * null in add mode, or the camera being edited. */
function CameraFormModal({ open, camera, onClose, onSaved }) {
  const { showToast } = useToast();
  const isEdit = camera != null;
  const [form, setForm] = useState({
    name: '', source_type: 'webcam', source_uri: '0', detection_confidence: 0.5,
  });
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!open) return;
    setForm(
      camera
        ? {
          name: camera.name,
          source_type: camera.source_type,
          source_uri: camera.source_uri ?? '',
          detection_confidence: camera.detection_confidence ?? 0.5,
        }
        : { name: '', source_type: 'webcam', source_uri: '0', detection_confidence: 0.5 }
    );
    setErrors({});
  }, [open, camera]);

  if (!open) return null;

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

  async function handleSubmit(e) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      if (isEdit) {
        const body = {};
        if (form.name !== camera.name) body.name = form.name;
        if (form.source_uri !== camera.source_uri) body.source_uri = form.source_uri;
        if (form.detection_confidence !== camera.detection_confidence) body.detection_confidence = form.detection_confidence;
        if (Object.keys(body).length > 0) {
          await api.updateCamera(camera.id, body);
          showToast({ title: 'Camera updated', message: 'Changes saved.', level: 'success' });
        }
      } else {
        await api.createCamera(form);
        showToast({ title: '✅ Camera added', message: `"${form.name}" saved successfully.`, level: 'success' });
      }
      onSaved();
      onClose();
    } catch (err) {
      showToast({ title: isEdit ? 'Update failed' : 'Failed to add camera', message: err.message, level: 'danger', duration: 8000 });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-surface-1 border border-border-soft rounded-xl shadow-2xl w-full max-w-md p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-base">{isEdit ? `Edit — ${camera.name}` : 'Add Camera'}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-base text-lg leading-none">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <input
              required
              className={`form-input ${errors.name ? 'border-red-500 focus:border-red-500' : ''}`}
              placeholder="Camera name  (e.g. Front Gate)"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              autoFocus
            />
            {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
          </div>

          {/* Source type is fixed once a camera is created — only selectable when adding */}
          {isEdit ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-muted">Source type</span>
              <TypeBadge type={form.source_type} />
            </div>
          ) : (
            <select
              className="form-select w-full"
              value={form.source_type}
              onChange={(e) => setForm((f) => ({ ...f, source_type: e.target.value, source_uri: e.target.value === 'webcam' ? '0' : '' }))}
            >
              <option value="webcam">Webcam</option>
              <option value="rtsp">RTSP Stream</option>
              <option value="file">Video File</option>
            </select>
          )}

          {/* URI field — placeholder depends on source type */}
          <div>
            <input
              className={`form-input ${errors.source_uri ? 'border-red-500' : ''}`}
              placeholder={URI_PLACEHOLDERS[form.source_type]}
              value={form.source_uri}
              onChange={(e) => setForm((f) => ({ ...f, source_uri: e.target.value }))}
            />
            {form.source_type === 'webcam' && !errors.source_uri && (
              <p className="text-text-subtle text-xs mt-1">Device index (0 = default camera)</p>
            )}
            {errors.source_uri && <p className="text-red-400 text-xs mt-1">{errors.source_uri}</p>}
          </div>

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

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} disabled={submitting} className="btn-outline flex-1 text-sm py-2">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="btn-brand flex-1 text-sm py-2 flex items-center justify-center gap-2">
              {submitting ? (isEdit ? 'Saving…' : 'Adding…') : (isEdit ? 'Save Changes' : 'Add Camera')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function CameraGrid() {
  const [cameras, setCameras] = useState(null);
  const [violCounts, setViolCounts] = useState({});
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCamera, setEditingCamera] = useState(null);
  const { showToast } = useToast();

  const refresh = useCallback(async () => {
    try {
      const data = await api.listCameras();
      // Hide the synthetic "Image Upload" / "Video Upload" bookkeeping cameras
      // the backend auto-creates so upload-detection violations have a camera_id —
      // they aren't real, manageable cameras.
      setCameras(data.filter((c) => c.source_uri !== 'upload' && c.source_uri !== 'video_upload'));
    } catch { /* silent */ }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Fetch all violation counts in a single batch request (once on mount)
  useEffect(() => {
    let cancelled = false;
    api.violationCountsByCamera()
      .then((data) => { if (!cancelled) setViolCounts(data || {}); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Delete camera ───────────────────────────────────────────────────────
  const handleDelete = useCallback(async (cam) => {
    if (!window.confirm(`Delete camera "${cam.name}"? Violation history is preserved.`)) return;
    try {
      await api.deleteCamera(cam.id);
      showToast({ title: '🗑️ Camera deleted', message: `"${cam.name}" removed.`, level: 'success' });
      await refresh();
    } catch (err) {
      showToast({ title: 'Delete failed', message: err.message, level: 'danger' });
    }
  }, [refresh, showToast]);

  // ── Modal open/close ────────────────────────────────────────────────────
  const openAddModal = useCallback(() => { setEditingCamera(null); setModalOpen(true); }, []);
  const openEditModal = useCallback((cam) => { setEditingCamera(cam); setModalOpen(true); }, []);
  const closeModal = useCallback(() => { setModalOpen(false); setEditingCamera(null); }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-base flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-brand">
              <circle cx="7.5" cy="7.5" r="6"/>
              <path d="M7.5 4v4l2.5 2"/>
            </svg>
            Manage Cameras
          </h1>
          <p className="text-xs text-text-muted mt-1">Start/stop streaming from the Dashboard's Live Feed</p>
        </div>
        <button onClick={openAddModal} className="btn-brand text-sm px-4 py-2 flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="7" y1="1" x2="7" y2="13"/><line x1="1" y1="7" x2="13" y2="7"/>
          </svg>
          Add Camera
        </button>
      </div>

      {/* Camera cards — skeleton while loading, empty state, or responsive grid */}
      {cameras === null ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : cameras.length === 0 ? (
        <div className="rounded-xl border border-border-soft bg-surface-2/40 p-12 text-center">
          <p className="text-sm text-text-muted">No cameras yet — click "Add Camera" to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {cameras.map((cam) => (
            <CameraCard
              key={cam.id}
              cam={cam}
              violCount={violCounts[cam.id] ?? null}
              onDelete={handleDelete}
              onEdit={openEditModal}
            />
          ))}
        </div>
      )}

      <CameraFormModal open={modalOpen} camera={editingCamera} onClose={closeModal} onSaved={refresh} />
    </div>
  );
}
