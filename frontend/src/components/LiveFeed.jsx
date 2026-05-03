import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import DetectionCounts from './DetectionCounts.jsx';

/** Camera-type icon */
function sourceIcon(type) {
  if (type === 'webcam') return '🎥';
  if (type === 'rtsp')   return '📡';
  if (type === 'file')   return '🎞️';
  return '📷';
}

export default function LiveFeed() {
  const { showToast } = useToast();
  const [cameras, setCameras]     = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [streaming, setStreaming]  = useState(false);
  const [counts, setCounts]        = useState(null);
  const [loading, setLoading]      = useState(true);
  const imgRef  = useRef(null);
  const wsRef   = useRef(null);
  const wrapRef = useRef(null); // for fullscreen

  // ── Fetch cameras on mount and auto-connect ──────────────────────────────
  useEffect(() => {
    api.listCameras()
      .then((cams) => {
        setCameras(cams);
        const running = cams.find((c) => c.is_running);
        if (running) {
          setSelectedId(String(running.id));
          startMjpeg(running.id);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedCam = cameras.find((c) => String(c.id) === String(selectedId));

  // ── WebSocket helpers ────────────────────────────────────────────────────
  function openWebSocket(cameraId) {
    closeWebSocket();
    const ws = new WebSocket(api.wsUrl(cameraId));
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (!d.ping) setCounts(d);
      } catch { /* ignore */ }
    };
    ws.onerror = () => {};
    ws.onclose = (event) => {
      wsRef.current = null;
      if (event.code === 1008) stopStream();
    };
    wsRef.current = ws;
  }

  function closeWebSocket() {
    wsRef.current?.close();
    wsRef.current = null;
  }

  function stopStream() {
    closeWebSocket();
    if (imgRef.current) imgRef.current.src = '';
    setStreaming(false);
    setCounts(null);
  }

  function startMjpeg(cameraId) {
    const img = imgRef.current;
    if (!img) return;
    img.onerror = null;
    img.src = api.streamUrl(cameraId) + '?t=' + Date.now();
    img.onerror = () => {
      img.onerror = null;
      stopStream();
      showToast({ title: 'Stream disconnected', message: 'Camera feed lost. Click Start to reconnect.', level: 'warning', duration: 6000 });
    };
    openWebSocket(cameraId);
    setStreaming(true);
  }

  // ── Camera control ───────────────────────────────────────────────────────
  async function handleStart() {
    if (!selectedId) return;
    try {
      await api.startCamera(selectedId);
      const updated = await api.listCameras();
      setCameras(updated);
      startMjpeg(selectedId);
      showToast({ title: 'Camera started', message: `Camera ${selectedId} is now streaming.`, level: 'success' });
    } catch (err) {
      showToast({ title: 'Failed to start camera', message: err.message, level: 'danger', duration: 8000 });
    }
  }

  async function handleStop() {
    if (!selectedId) return;
    try {
      await api.stopCamera(selectedId);
      stopStream();
      const updated = await api.listCameras();
      setCameras(updated);
      showToast({ title: 'Camera stopped', message: `Camera ${selectedId} stopped.`, level: 'info' });
    } catch (err) {
      showToast({ title: 'Failed to stop camera', message: err.message, level: 'danger' });
    }
  }

  // ── Fullscreen ───────────────────────────────────────────────────────────
  const handleFullscreen = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.();
    } else {
      document.exitFullscreen?.() ?? document.webkitExitFullscreen?.();
    }
  }, []);

  // ── Cleanup ──────────────────────────────────────────────────────────────
  useEffect(() => () => closeWebSocket(), []);

  // Detection badge counts
  const detBadges = counts
    ? [
        { label: 'Persons',   value: counts.person_count,  color: 'bg-sky-100 text-sky-700 border-sky-200 shadow-sm' },
        { label: 'Hardhats',  value: counts.hardhat_count, color: 'bg-emerald-100 text-emerald-700 border-emerald-200 shadow-sm' },
        { label: 'Violations',value: counts.violation_count ?? 0, color: 'bg-red-100 text-red-700 border-red-200 shadow-sm' },
      ]
    : null;

  return (
    <div className="card flex flex-col">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="card-header gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-shrink-0">
          {streaming && <span className="rec-dot" title="Recording" />}
          <span className="font-semibold text-text-base">Live Feed</span>
          {streaming && (
            <span className="text-xs font-bold tracking-widest text-red-400 select-none">REC</span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Camera selector with status dot */}
          <div className="relative">
            <select
              id="livefeed-camera-select"
              value={selectedId}
              onChange={(e) => { setSelectedId(e.target.value); stopStream(); }}
              className="form-select text-xs py-1.5 pl-7 pr-3 w-auto min-w-[160px] appearance-none"
            >
              <option value="">— Select camera —</option>
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {sourceIcon(c.source_type)} {c.name} ({c.source_type})
                </option>
              ))}
            </select>
            {/* Status dot overlay in select */}
            {selectedCam && (
              <span
                className={`absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${
                  selectedCam.is_running ? 'status-dot-green' : 'status-dot-red'
                }`}
              />
            )}
            {!selectedCam && (
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none w-2 h-2 rounded-full bg-surface-3" />
            )}
          </div>

          {/* Start / Stop */}
          <button
            id="livefeed-start-btn"
            onClick={handleStart}
            disabled={!selectedId || selectedCam?.is_running}
            className="btn-success text-xs px-3 py-1.5 flex items-center gap-1"
            title="Start stream (S)"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <polygon points="1,1 9,5 1,9"/>
            </svg>
            Start
          </button>
          <button
            id="livefeed-stop-btn"
            onClick={handleStop}
            disabled={!selectedId || !selectedCam?.is_running}
            className="btn-danger text-xs px-3 py-1.5 flex items-center gap-1"
            title="Stop stream (X)"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <rect x="1" y="1" width="8" height="8" rx="1"/>
            </svg>
            Stop
          </button>

          {/* Fullscreen button */}
          <button
            id="livefeed-fullscreen-btn"
            onClick={handleFullscreen}
            className="btn-icon"
            title="Toggle fullscreen (F)"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── Stream area ──────────────────────────────────────────────────── */}
      <div ref={wrapRef} className="relative bg-black group" style={{ minHeight: 360 }}>
        <img
          ref={imgRef}
          alt="Live camera stream"
          className="w-full"
          style={{ maxHeight: 480, objectFit: 'contain', display: streaming ? 'block' : 'none' }}
        />

        {/* Camera name overlay (top-left) */}
        {streaming && selectedCam && (
          <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-lg px-2.5 py-1 pointer-events-none">
            <span className="text-base">{sourceIcon(selectedCam.source_type)}</span>
            <span className="text-xs font-semibold text-white">{selectedCam.name}</span>
          </div>
        )}

        {/* Detection badges overlay (top-right) */}
        {streaming && detBadges && (
          <div className="absolute top-3 right-3 flex flex-col gap-1 pointer-events-none">
            {detBadges.map((b) => (
              <div
                key={b.label}
                className={`flex items-center justify-between gap-2 border rounded-lg px-2.5 py-1 text-xs font-bold backdrop-blur-md ${b.color}`}
              >
                <span className="opacity-70 font-medium">{b.label}</span>
                <span className="tabular-nums">{b.value ?? 0}</span>
              </div>
            ))}
          </div>
        )}

        {/* No-camera placeholder */}
        {!streaming && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 select-none bg-slate-50/80 backdrop-blur-[2px]">
            <div className="relative">
              <div className="w-24 h-24 rounded-3xl bg-white border border-slate-200 flex items-center justify-center shadow-sm">
                <svg width="40" height="40" viewBox="0 0 36 36" fill="none" className="text-slate-300">
                  <rect x="2" y="8" width="24" height="20" rx="4" stroke="currentColor" strokeWidth="2.5"/>
                  <path d="M26 14l8-5v18l-8-5V14z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"/>
                  <circle cx="14" cy="18" r="5" stroke="currentColor" strokeWidth="2.5"/>
                </svg>
              </div>
              <div className="absolute -bottom-1 -right-1 w-7 h-7 bg-white border border-slate-200 rounded-full flex items-center justify-center shadow-sm text-slate-400">
                <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="1" y1="5" x2="9" y2="5"/>
                  <line x1="5" y1="1" x2="5" y2="9"/>
                </svg>
              </div>
            </div>
            <div className="text-center">
              <p className="font-bold text-slate-800 text-base">No camera selected</p>
              <p className="text-xs text-slate-500 mt-1.5 max-w-[240px] leading-relaxed">
                Choose a camera from the dropdown, then press <kbd className="px-2 py-0.5 text-[10px] bg-slate-100 border border-slate-200 rounded-md font-mono font-bold text-slate-600">Start</kbd> to begin monitoring.
              </p>
            </div>
            {loading && <div className="w-32 h-1.5 skel-box rounded-full" />}
          </div>
        )}
      </div>

      {/* ── Detection counts ─────────────────────────────────────────────── */}
      <DetectionCounts counts={counts} />
    </div>
  );
}
