import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import ConfidenceBar from './ConfidenceBar.jsx';

const COMPLIANCE_META = {
  violation:    { label: 'VIOLATION',    cls: 'badge-violation' },
  compliant:    { label: 'OK',           cls: 'badge-ok' },
  not_assessed: { label: 'NOT ASSESSED', cls: 'badge-default' },
};

// Backend timestamps are naive UTC — append 'Z' so the browser renders them in
// local time (matches ViolationsTable / AlertLogsPage).
function fmtLocal(iso) {
  if (!iso) return '';
  const raw = iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z';
  return new Date(raw).toLocaleString();
}

function downloadImage(src, filename) {
  const a = document.createElement('a');
  a.href = src;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function RecentDetections() {
  const [items, setItems] = useState(null);

  useEffect(() => {
    // Scope to the dedicated "Image Upload" camera (source_uri "upload") so this
    // widget only shows violations from this page's own uploads — not live
    // cameras or video uploads, which write to their own camera rows.
    api.listCameras()
      .then((cams) => cams.find((c) => c.source_uri === 'upload')?.id)
      .then((camera_id) => {
        if (!camera_id) return { items: [] };
        return api.listViolations({ page_size: 5, camera_id });
      })
      .then((d) => setItems(d.items ?? []))
      .catch(() => setItems([]));
  }, []);

  if (!items || items.length === 0) return null;

  return (
    <div className="card">
      <div className="card-header">
        <span className="font-semibold text-sm">Recent Detections</span>
        <span className="text-xs text-text-muted">{items.length} latest violations</span>
      </div>
      <div className="divide-y divide-border-soft">
        {items.map((v) => (
          <div key={v.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/40 transition-colors">
            {v.frame_url ? (
              <img src={v.frame_url} alt="" className="w-14 h-9 object-cover rounded shrink-0 border border-border-soft" />
            ) : (
              <div className="w-14 h-9 rounded bg-surface-2 border border-border-soft shrink-0 flex items-center justify-center">
                <span className="text-text-subtle text-[10px]">No snap</span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${v.violation_type?.startsWith('NO-') ? 'bg-red-700 text-white' : 'bg-emerald-700 text-white'}`}>
                  {v.violation_type}
                </span>
                <span className="text-text-muted text-xs">Cam {v.camera_id}</span>
              </div>
              <div className="text-[10px] text-text-subtle mt-0.5 truncate">
                {fmtLocal(v.timestamp)}
              </div>
            </div>
            <span className="text-xs tabular-nums text-text-muted shrink-0">{(v.confidence * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ImageDetect() {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [classes, setClasses] = useState(null);
  const [showClasses, setShowClasses] = useState(false);

  function handleFile(f) {
    if (!f || !f.type.startsWith('image/')) return;
    setFile(f);
    setResult(null);
  }

  function handleDragOver(e) { e.preventDefault(); setDragging(true); }
  function handleDragLeave() { setDragging(false); }
  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file) return;
    setLoading(true);
    try {
      const data = await api.detectImage(file);
      setResult(data);
      if (data.saved_violation_ids?.length > 0) {
        // Mark the shared violations cache stale so the Violations table refetches and
        // picks up the worker/fine assigned by the background auto-identify task.
        queryClient.invalidateQueries({ queryKey: ['violations'] });
        showToast({
          title: `${data.saved_violation_ids.length} violation(s) saved`,
          message: 'Now visible in the Violations page',
          level: 'warning',
          duration: 6000,
        });
      }
    } catch (err) {
      showToast({ title: 'Detection failed', message: err.message, level: 'danger' });
    } finally {
      setLoading(false);
    }
  }

  async function toggleClasses() {
    if (showClasses) { setShowClasses(false); return; }
    if (!classes) {
      try {
        const data = await api.detectClasses();
        setClasses(data);
      } catch (err) {
        showToast({ title: 'Could not load classes', message: err.message, level: 'danger' });
        return;
      }
    }
    setShowClasses(true);
  }

  function handleDownload() {
    if (!result) return;
    const base = (result.filename || 'detection').replace(/\.[^/.]+$/, '');
    downloadImage(`data:image/jpeg;base64,${result.annotated_image_base64}`, `${base}_annotated.jpg`);
  }

  return (
    <>
    <div className="card">
      {/* Header */}
      <div className="card-header">
        <span className="font-semibold">Image Detection</span>
        <div className="flex items-center gap-2">
          {result && (
            <button onClick={handleDownload} className="btn-outline text-xs px-2 py-1">
              Save
            </button>
          )}
          <button onClick={toggleClasses} className="btn-outline text-xs px-2 py-1">
            {showClasses ? 'Hide' : 'Show'} classes
          </button>
        </div>
      </div>

      <div className="card-body space-y-3">
        {/* Drag-and-drop upload zone */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <label
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-6 px-4 text-center cursor-pointer transition-all duration-200 ${
              dragging
                ? 'border-brand bg-brand/10 scale-[1.01]'
                : file
                ? 'border-brand/40 bg-brand/5'
                : 'border-border-strong hover:border-brand/40 hover:bg-surface-2/50'
            }`}
          >
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => handleFile(e.target.files[0])}
            />
            {dragging ? (
              <>
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-brand">
                  <path d="M14 4v16M6 12l8 8 8-8"/>
                  <path d="M4 22h20" strokeOpacity="0.4"/>
                </svg>
                <span className="text-brand font-semibold text-sm">Drop to detect</span>
              </>
            ) : file ? (
              <>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-brand">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <path d="M21 15l-5-5L5 21"/>
                </svg>
                <span className="text-text-base font-medium text-sm truncate max-w-full px-4">{file.name}</span>
                <span className="text-text-muted text-xs">{(file.size / 1024).toFixed(0)} KB · Click to change</span>
              </>
            ) : (
              <>
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-text-subtle">
                  <path d="M14 18V6M8 12l6-6 6 6"/>
                  <path d="M4 22h20" strokeOpacity="0.4"/>
                </svg>
                <span className="text-text-base font-medium text-sm">
                  Drop image here or <span className="text-brand">browse</span>
                </span>
                <span className="text-text-muted text-xs">PNG, JPG, WEBP, BMP</span>
              </>
            )}
          </label>
          <button type="submit" disabled={loading || !file} className="btn-brand w-full text-xs py-2 disabled:opacity-50">
            {loading ? 'Detecting…' : 'Detect PPE'}
          </button>
        </form>

        {/* Classes list */}
        {showClasses && classes && (
          <div className="text-xs text-text-muted">
            <strong className="text-text-base">
              Model can detect {classes.classes.length} classes
            </strong>{' '}
            <span>(threshold: {(classes.confidence_threshold * 100).toFixed(0)}%)</span>
            <div className="flex flex-wrap gap-1 mt-1">
              {classes.classes.map((c) => (
                <span key={c.class_id} className="border border-border-strong text-text-muted rounded px-1.5 py-0.5 text-xs">
                  {c.class_id}: {c.class_name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="space-y-3">
            {/* Annotated image */}
            <img
              src={`data:image/jpeg;base64,${result.annotated_image_base64}`}
              alt="Detection result"
              className="w-full rounded-lg object-contain bg-black"
              style={{ maxHeight: 480 }}
            />

            {/* Summary */}
            {result.total_detections === 0 ? (
              <div className="text-yellow-400 text-xs">
                ⚠ No objects detected — try another image or lower the threshold.
              </div>
            ) : (
              <div className="text-xs">
                Detected <strong>{result.total_detections}</strong> object{result.total_detections !== 1 ? 's' : ''}{' '}
                ({result.image_size.width}×{result.image_size.height}):{' '}
                {Object.entries(result.class_counts).map(([k, v]) => (
                  <span
                    key={k}
                    className={`text-xs px-1.5 py-0.5 rounded mr-1 ${k.startsWith('NO-') ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'}`}
                  >
                    {k}: {v}
                  </span>
                ))}
              </div>
            )}

            {/* Compliance banner */}
            {result.person_count === 0 ? (
              <div className="bg-surface-3 border border-border-soft rounded p-2 text-xs">
                ℹ No persons detected — PPE compliance not applicable.
              </div>
            ) : result.violation_total === 0 ? (
              <div className="bg-green-900/40 border border-green-700 rounded p-2 text-xs text-green-400">
                ✅ Compliant — no PPE violations across {result.person_count} person{result.person_count !== 1 ? 's' : ''}.
              </div>
            ) : (
              <div className="bg-red-900/40 border border-red-700 rounded p-2 text-xs text-red-400">
                ⚠ {result.violation_total} PPE violation{result.violation_total !== 1 ? 's' : ''} detected across {result.person_count} person{result.person_count !== 1 ? 's' : ''}.
              </div>
            )}

            {/* PPE compliance table */}
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border-soft">
                  <th className="px-2 py-1 text-left text-text-muted uppercase tracking-wider">PPE Item</th>
                  <th className="px-2 py-1 text-left text-text-muted uppercase tracking-wider">Status</th>
                  <th className="px-2 py-1 text-left text-text-muted uppercase tracking-wider">Detected</th>
                  <th className="px-2 py-1 text-left text-text-muted uppercase tracking-wider">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {result.violations.map((row, i) => {
                  const meta = COMPLIANCE_META[row.status] || COMPLIANCE_META.not_assessed;
                  let detected;
                  if (row.status === 'violation') {
                    detected = (
                      <span className="text-red-400">
                        {row.violation_count}× {row.violation_class}
                        {row.compliant_count > 0 && (
                          <span className="text-text-muted"> (+{row.compliant_count}× {row.ppe_item})</span>
                        )}
                      </span>
                    );
                  } else if (row.status === 'compliant') {
                    detected = <span className="text-green-400">{row.compliant_count}× {row.ppe_item}</span>;
                  } else {
                    detected = <span className="text-text-subtle">—</span>;
                  }
                  return (
                    <tr key={i} className="border-b border-border-soft">
                      <td className="px-2 py-1 font-medium">{row.ppe_item}</td>
                      <td className="px-2 py-1">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>
                      </td>
                      <td className="px-2 py-1">{detected}</td>
                      <td className="px-2 py-1">
                        {row.max_confidence != null ? (
                          <ConfidenceBar pct={row.max_confidence * 100} danger={row.status === 'violation'} />
                        ) : (
                          <span className="text-text-subtle">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Raw detections (collapsible) */}
            <details className="text-xs">
              <summary className="text-text-muted cursor-pointer hover:text-brand mb-2 select-none">
                All raw detections
              </summary>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border-soft">
                    <th className="px-2 py-1 text-left text-text-muted uppercase tracking-wider">Class</th>
                    <th className="px-2 py-1 text-left text-text-muted uppercase tracking-wider">Confidence</th>
                    <th className="px-2 py-1 text-left text-text-muted uppercase tracking-wider">BBox</th>
                  </tr>
                </thead>
                <tbody>
                  {result.detections.length === 0 ? (
                    <tr><td colSpan={3} className="px-2 py-2 text-center text-text-subtle">—</td></tr>
                  ) : result.detections.map((d, i) => (
                    <tr key={i} className="border-b border-border-soft">
                      <td className="px-2 py-1">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${d.class_name.startsWith('NO-') ? 'bg-red-700 text-white' : 'bg-emerald-700 text-white'}`}>
                          {d.class_name}
                        </span>
                      </td>
                      <td className="px-2 py-1 tabular-nums">{(d.confidence * 100).toFixed(1)}%</td>
                      <td className="px-2 py-1 text-text-muted font-mono">[{d.bbox.join(', ')}]</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </div>
        )}
      </div>
    </div>
    <RecentDetections />
    </>
  );
}
