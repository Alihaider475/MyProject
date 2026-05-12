import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';

const COMPLIANCE_META = {
  violation:    { label: 'VIOLATION',    cls: 'bg-red-600 text-white shadow-sm' },
  compliant:    { label: 'OK',           cls: 'bg-emerald-600 text-white shadow-sm' },
  not_assessed: { label: 'NOT ASSESSED', cls: 'bg-slate-100 text-slate-500 border border-slate-200' },
};

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function ProgressRing({ pct }) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const dash = circ * (pct / 100);
  return (
    <svg width={90} height={90} className="rotate-[-90deg]">
      <circle cx={45} cy={45} r={r} fill="none" stroke="#f1f5f9" strokeWidth={8} />
      <circle
        cx={45} cy={45} r={r} fill="none"
        stroke="url(#vg)" strokeWidth={8}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.3s ease' }}
      />
      <defs>
        <linearGradient id="vg" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#0ea5e9" />
          <stop offset="100%" stopColor="#0284c7" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export default function VideoDetect() {
  const { showToast } = useToast();
  const fileRef = useRef(null);
  const [loading, setLoading]         = useState(false);
  const [uploadPct, setUploadPct]     = useState(0);
  const [processing, setProcessing]   = useState(false);
  const [result, setResult]           = useState(null);
  const [selectedFrame, setSelectedFrame] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [dragging, setDragging]       = useState(false);
  const [droppedFile, setDroppedFile] = useState(null);

  const handleFileChange = useCallback(() => {
    const f = fileRef.current?.files[0];
    if (f) {
      setPreviewFile(URL.createObjectURL(f));
      setResult(null);
      setSelectedFrame(null);
      setUploadPct(0);
    }
  }, []);

  function handleDragOver(e) { e.preventDefault(); setDragging(true); }
  function handleDragLeave() { setDragging(false); }
  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) {
      setDroppedFile(f);
      setPreviewFile(URL.createObjectURL(f));
      setResult(null);
      setSelectedFrame(null);
      setUploadPct(0);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const file = droppedFile || fileRef.current?.files[0];
    if (!file) return;
    setLoading(true);
    setUploadPct(0);
    setResult(null);
    setSelectedFrame(null);
    setProcessing(false);

    try {
      const data = await api.detectVideo(file, (pct) => {
        setUploadPct(pct);
        if (pct >= 100) setProcessing(true);
      });
      setResult(data);
      setSelectedFrame(
        data.frame_results?.find(f => f.violation_total > 0) ?? data.frame_results?.[0] ?? null
      );
      if (data.total_violations > 0) {
        showToast({
          title: `${data.total_violations} violation(s) detected`,
          message: `Across ${data.sampled_frames} sampled frames. Check Violations page.`,
          level: 'warning',
          duration: 7000,
        });
      } else {
        showToast({
          title: 'Video analysis complete',
          message: `No violations found in ${data.sampled_frames} sampled frames.`,
          level: 'success',
          duration: 5000,
        });
      }
    } catch (err) {
      showToast({ title: 'Video detection failed', message: err.message, level: 'danger' });
    } finally {
      setLoading(false);
      setProcessing(false);
    }
  }

  function handleReset() {
    setResult(null);
    setSelectedFrame(null);
    setPreviewFile(null);
    setDroppedFile(null);
    setUploadPct(0);
    if (fileRef.current) fileRef.current.value = '';
  }

  const fr = selectedFrame;

  return (
    <div className="space-y-4 fade-up">
      {/* ── Upload card ─────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="card-header">
          <span className="font-semibold flex items-center gap-2">
            <span className="text-brand">🎬</span> Video PPE Detection
          </span>
          {result && (
            <button onClick={handleReset} className="btn-outline text-xs px-2 py-1">
              ↺ Reset
            </button>
          )}
        </div>

        <div className="card-body space-y-4">
          {/* File picker with drag-and-drop */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <label
              className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-7 px-4 text-center cursor-pointer transition-all duration-200 ${
                dragging
                  ? 'border-brand bg-brand/10 scale-[1.01]'
                  : previewFile
                  ? 'border-brand/40 bg-brand/5'
                  : 'border-border-strong hover:border-brand/40 hover:bg-surface-2/50'
              }`}
              onDragOver={handleDragOver}
              onDragEnter={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input
                ref={fileRef}
                type="file"
                accept="video/mp4,video/avi,video/quicktime,video/x-matroska,video/webm,video/mpeg"
                className="sr-only"
                onChange={handleFileChange}
              />
              {dragging ? (
                <>
                  <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-brand">
                    <path d="M14 4v16M6 12l8 8 8-8"/>
                    <path d="M4 22h20" strokeOpacity="0.4"/>
                  </svg>
                  <span className="text-brand font-semibold text-sm">Drop video to analyse</span>
                </>
              ) : previewFile ? (
                <>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-brand">
                    <rect x="2" y="3" width="20" height="18" rx="2"/>
                    <path d="M10 8l6 4-6 4V8z" fill="currentColor" strokeLinejoin="round"/>
                  </svg>
                  <span className="text-text-base font-medium text-sm truncate max-w-xs">
                    {droppedFile?.name || fileRef.current?.files[0]?.name || 'Video ready'}
                  </span>
                  <span className="text-brand text-xs font-semibold">Ready · Click to change</span>
                </>
              ) : (
                <>
                  <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-text-subtle">
                    <path d="M14 18V6M8 12l6-6 6 6"/>
                    <path d="M4 22h20" strokeOpacity="0.4"/>
                  </svg>
                  <span className="text-text-base font-medium text-sm">
                    Drop video here or <span className="text-brand">browse</span>
                  </span>
                  <span className="text-text-muted text-xs">MP4, AVI, MOV, MKV, WebM · Max 200 MB</span>
                </>
              )}
            </label>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading || !previewFile}
                className="btn-brand flex-1 text-sm py-2 disabled:opacity-50"
              >
                {loading ? (processing ? 'Analysing…' : 'Uploading…') : 'Detect PPE'}
              </button>
            </div>
          </form>

          {/* Supported formats note */}
          <p className="text-text-subtle text-xs">
            Detection runs on 1 frame/sec · Large files may take a minute
          </p>

          {/* Upload / processing progress */}
          {loading && (
            <div className="flex items-center gap-5 py-3 fade-up">
              <div className="relative flex items-center justify-center shrink-0">
                <ProgressRing pct={processing ? 100 : uploadPct} />
                <span className="absolute text-xs font-bold text-brand tabular-nums">
                  {processing ? '⚙️' : `${uploadPct}%`}
                </span>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-text-base">
                  {processing ? 'Running detection on frames…' : 'Uploading video…'}
                </p>
                <p className="text-xs text-text-muted">
                  {processing
                    ? 'This may take a minute depending on video length.'
                    : `${uploadPct}% of file transferred`}
                </p>
                {/* Animated processing bar */}
                {processing && (
                  <div className="h-1.5 w-48 rounded-full bg-slate-100 overflow-hidden shadow-inner">
                    <div
                      className="h-full rounded-full bg-brand shadow-[0_0_10px_rgba(14,165,233,0.3)]"
                      style={{ animation: 'proc-bar 1.4s ease-in-out infinite' }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Video preview (before detection) */}
          {previewFile && !result && !loading && (
            <div className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-50 shadow-inner fade-up">
              <video
                src={previewFile}
                controls
                className="w-full"
                style={{ maxHeight: 320 }}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Results ─────────────────────────────────────────────────────────── */}
      {result && (
        <div className="space-y-4 fade-up">
          {/* Global summary banner */}
          <div className={`card border-l-4 ${result.total_violations > 0 ? 'border-l-red-500' : 'border-l-emerald-500'}`}>
            <div className="card-body">
              <div className="flex flex-wrap gap-4 items-center justify-between">
                {/* Metric tiles */}
                <div className="flex flex-wrap gap-3">
                  <MetricTile label="Duration" value={fmtTime(result.video_info.duration_sec)} icon="⏱" />
                  <MetricTile label="Resolution" value={`${result.video_info.width}×${result.video_info.height}`} icon="📐" />
                  <MetricTile label="FPS" value={result.video_info.fps} icon="🎞" />
                  <MetricTile label="Frames Analysed" value={result.sampled_frames} icon="🔬" />
                  <MetricTile
                    label="Violations"
                    value={result.total_violations}
                    icon="⚠"
                    accent={result.total_violations > 0 ? 'red' : 'green'}
                  />
                </div>

                {/* Overall compliance pill */}
                {result.total_violations > 0 ? (
                  <div className="bg-red-50 border border-red-100 text-red-600 rounded-xl px-5 py-2.5 text-sm font-bold shadow-sm">
                    ⚠ {result.total_violations} PPE violation{result.total_violations !== 1 ? 's' : ''} detected
                  </div>
                ) : (
                  <div className="bg-emerald-50 border border-emerald-100 text-emerald-600 rounded-xl px-5 py-2.5 text-sm font-bold shadow-sm">
                    ✅ No violations found
                  </div>
                )}
              </div>

              {/* Peak per-frame counts (max number of each class visible at once,
                  not summed across frames — avoids "2 people × 21 frames = 42") */}
              {Object.keys(result.peak_class_counts ?? result.global_class_counts).length > 0 && (
                <div className="mt-3 pt-3 border-t border-border-soft">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs text-text-muted font-medium">
                      Peak per frame
                    </span>
                    <span
                      className="text-[10px] text-text-subtle"
                      title="Highest count of each class seen in any single sampled frame. This is closer to 'how many objects were in the scene' than a cumulative sum."
                    >
                      ⓘ max in any one frame
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(result.peak_class_counts ?? result.global_class_counts).map(([cls, cnt]) => (
                      <span
                        key={cls}
                        className={`text-xs px-2.5 py-1 rounded-md font-bold shadow-sm ${
                          cls.startsWith('NO-') ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
                        }`}
                      >
                        {cls}: {cnt}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Frame timeline + inspector */}
          {result.frame_results?.length > 0 && (
            <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-4">
              {/* Timeline sidebar */}
              <div className="card">
                <div className="card-header">
                  <span className="font-semibold text-sm">📊 Frame Timeline</span>
                  <span className="text-text-muted text-xs">{result.frame_results.length} frames</span>
                </div>
                <div className="overflow-y-auto" style={{ maxHeight: 520 }}>
                  {result.frame_results.map((fr) => {
                    const isActive = selectedFrame?.frame_index === fr.frame_index;
                    const hasViol  = fr.violation_total > 0;
                    return (
                      <button
                        key={fr.frame_index}
                        onClick={() => setSelectedFrame(fr)}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-all duration-200 border-l-4 ${
                          isActive
                            ? 'bg-sky-50/50 border-l-brand'
                            : hasViol
                            ? 'border-l-red-500/40 hover:bg-red-50/50'
                            : 'border-l-transparent hover:bg-slate-50'
                        }`}
                      >
                        {/* Mini thumbnail */}
                        <img
                          src={`data:image/jpeg;base64,${fr.annotated_frame_base64}`}
                          alt={`Frame ${fr.frame_index}`}
                          className="w-16 h-10 object-cover rounded shrink-0 border border-border-soft"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-mono text-text-muted">{fmtTime(fr.timestamp_sec)}</span>
                            {hasViol && (
                              <span className="text-xs bg-red-700 text-white px-1.5 py-0.5 rounded font-semibold shrink-0">
                                ⚠ {fr.violation_total}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-text-subtle mt-0.5 truncate">
                            {fr.total_detections} detection{fr.total_detections !== 1 ? 's' : ''}
                            {fr.person_count > 0 && ` · ${fr.person_count} person${fr.person_count !== 1 ? 's' : ''}`}
                          </div>
                          {/* Mini violation bar */}
                          {hasViol && (
                            <div className="h-1 w-full rounded-full bg-slate-100 mt-2 overflow-hidden shadow-inner">
                              <div
                                className="h-full rounded-full bg-red-500"
                                style={{ width: `${Math.min(100, (fr.violation_total / 5) * 100)}%` }}
                              />
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Frame inspector */}
              {fr && (
                <div className="card">
                  <div className="card-header">
                    <span className="font-semibold text-sm">
                      🔍 Frame @ {fmtTime(fr.timestamp_sec)}
                      <span className="text-text-muted font-normal ml-2 text-xs">
                        (frame #{fr.frame_index})
                      </span>
                    </span>
                    {fr.violation_total > 0 ? (
                      <span className="bg-red-700 text-white text-xs px-2 py-0.5 rounded font-semibold">
                        ⚠ {fr.violation_total} violation{fr.violation_total !== 1 ? 's' : ''}
                      </span>
                    ) : (
                      <span className="bg-green-700 text-white text-xs px-2 py-0.5 rounded font-semibold">
                        ✅ Clean
                      </span>
                    )}
                  </div>
                  <div className="card-body space-y-4">
                    {/* Annotated frame */}
                    <img
                      src={`data:image/jpeg;base64,${fr.annotated_frame_base64}`}
                      alt={`Annotated frame at ${fmtTime(fr.timestamp_sec)}`}
                      className="w-full rounded-2xl object-contain bg-slate-900 border border-slate-200 shadow-lg"
                      style={{ maxHeight: 400 }}
                    />

                    {/* Detection summary */}
                    {fr.total_detections === 0 ? (
                      <div className="text-yellow-400 text-xs">
                        ⚠ No objects detected in this frame.
                      </div>
                    ) : (
                      <div className="text-xs flex flex-wrap gap-1.5 items-center">
                        <span className="text-text-muted">Detected:</span>
                        {Object.entries(fr.class_counts).map(([cls, cnt]) => (
                          <span
                            key={cls}
                            className={`text-xs px-2.5 py-1 rounded-md font-bold shadow-sm ${
                              cls.startsWith('NO-') ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
                            }`}
                          >
                            {cls}: {cnt}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Compliance banner */}
                    {fr.person_count === 0 ? (
                      <div className="bg-slate-100 border border-slate-200 rounded-xl p-3 text-xs text-slate-600 font-medium">
                        ℹ No persons detected — PPE compliance not applicable.
                      </div>
                    ) : fr.violation_total === 0 ? (
                      <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-xs text-emerald-700 font-bold shadow-sm">
                        ✅ Compliant — no PPE violations across {fr.person_count} person{fr.person_count !== 1 ? 's' : ''}.
                      </div>
                    ) : (
                      <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-xs text-red-700 font-bold shadow-sm">
                        ⚠ {fr.violation_total} PPE violation{fr.violation_total !== 1 ? 's' : ''} detected across {fr.person_count} person{fr.person_count !== 1 ? 's' : ''}.
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
                        {fr.violations.map((row, i) => {
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
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Recent violations — shown when no video result */}
      {!result && <RecentViolations />}

      {/* Inline keyframe for the processing animation */}
      <style>{`
        @keyframes proc-bar {
          0%   { transform: translateX(-100%); width: 60%; }
          50%  { transform: translateX(80%);   width: 60%; }
          100% { transform: translateX(-100%); width: 60%; }
        }
      `}</style>
    </div>
  );
}

function RecentViolations() {
  const [items, setItems] = useState(null);

  useEffect(() => {
    api.listViolations({ page_size: 5 })
      .then((d) => setItems(d.items ?? []))
      .catch(() => setItems([]));
  }, []);

  if (!items || items.length === 0) return null;

  return (
    <div className="card fade-up">
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
              <div className="text-[10px] text-text-subtle mt-0.5">{new Date(v.timestamp).toLocaleString()}</div>
            </div>
            <span className="text-xs tabular-nums text-text-muted shrink-0">{(v.confidence * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetricTile({ label, value, icon, accent }) {
  const accentCls =
    accent === 'red'
      ? 'text-red-700 border-red-100 bg-red-50 shadow-sm'
      : accent === 'green'
      ? 'text-emerald-700 border-emerald-100 bg-emerald-50 shadow-sm'
      : 'text-sky-700 border-sky-100 bg-sky-50 shadow-sm';

  return (
    <div className={`flex items-center gap-3 border rounded-xl px-4 py-2.5 ${accentCls}`}>
      <span className="text-base shrink-0">{icon}</span>
      <div>
        <div className="text-xs text-text-muted leading-none mb-0.5">{label}</div>
        <div className="text-sm font-bold tabular-nums leading-none">{value}</div>
      </div>
    </div>
  );
}
