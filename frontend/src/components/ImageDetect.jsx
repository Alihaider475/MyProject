import { useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';

const COMPLIANCE_META = {
  violation:    { label: 'VIOLATION',    cls: 'bg-red-700 text-white' },
  compliant:    { label: 'OK',           cls: 'bg-green-700 text-white' },
  not_assessed: { label: 'NOT ASSESSED', cls: 'bg-surface-3 text-text-muted' },
};

function downloadImage(src, filename) {
  const a = document.createElement('a');
  a.href = src;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function ImageDetect() {
  const { showToast } = useToast();
  const fileRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [classes, setClasses] = useState(null);
  const [showClasses, setShowClasses] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    const file = fileRef.current?.files[0];
    if (!file) return;
    setLoading(true);
    try {
      const data = await api.detectImage(file);
      setResult(data);
      if (data.saved_violation_ids?.length > 0) {
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
    <div className="card">
      {/* Header */}
      <div className="card-header">
        <span className="font-semibold">🖼️ Test Image Detection</span>
        <div className="flex items-center gap-2">
          {result && (
            <button onClick={handleDownload} className="btn-outline text-xs px-2 py-1">
              ⬇ Save
            </button>
          )}
          <button onClick={toggleClasses} className="btn-outline text-xs px-2 py-1">
            🏷️ {showClasses ? 'Hide' : 'Show'} classes
          </button>
        </div>
      </div>

      <div className="card-body space-y-3">
        {/* Upload form */}
        <form onSubmit={handleSubmit} className="flex gap-2 items-center">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            required
            className="form-input text-xs py-1 flex-1"
          />
          <button type="submit" disabled={loading} className="btn-brand text-xs px-3 py-1 whitespace-nowrap">
            {loading ? 'Detecting…' : '🔍 Detect'}
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
                  <span key={k} className="bg-green-700 text-white text-xs px-1.5 py-0.5 rounded mr-1">
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
                      <td className="px-2 py-1 tabular-nums text-text-muted">
                        {row.max_confidence != null ? (row.max_confidence * 100).toFixed(1) + '%' : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Raw detections (collapsible) */}
            <details className="text-xs">
              <summary className="text-text-muted cursor-pointer hover:text-brand mb-2">
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
                        <span className={`text-xs px-1.5 py-0.5 rounded ${d.class_name.startsWith('NO-') ? 'bg-red-700 text-white' : 'bg-green-700 text-white'}`}>
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
  );
}
