import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../services/api/client.js';
import { useToast } from '../../../store/ToastContext.jsx';
import { useWebRTC } from '../hooks/useWebRTC.js';
import { useDetectionCanvas } from '../hooks/useDetectionCanvas.js';
import { useBrowserWebcamSender } from '../hooks/useBrowserWebcamSender.js';
import DetectionCounts from './DetectionCounts.jsx';

/** Camera-type icon — pure string, no memo needed */
function sourceIcon(type) {
  if (type === 'webcam') return '🎥';
  if (type === 'rtsp')   return '📡';
  if (type === 'file')   return '🎞️';
  return '📷';
}

/** Custom dropdown showing per-option status dots */
const CameraDropdown = memo(function CameraDropdown({ cameras, selectedId, onSelect, selectedRunning = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = useMemo(
    () => cameras.find((c) => String(c.id) === String(selectedId)),
    [cameras, selectedId]
  );

  useEffect(() => {
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const handleToggle = useCallback(() => setOpen((v) => !v), []);
  const handleClear = useCallback(() => { onSelect(''); setOpen(false); }, [onSelect]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={handleToggle}
        className="form-select text-xs py-1.5 px-3 w-auto min-w-[180px] flex items-center gap-2 cursor-pointer"
      >
        {selected ? (
          <>
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${selectedRunning ? 'bg-emerald-400' : 'bg-slate-500'}`} />
            <span className="truncate">{sourceIcon(selected.source_type)} {selected.name}</span>
          </>
        ) : (
          <span className="text-text-muted">— Select camera —</span>
        )}
        <svg
          aria-hidden="true" focusable="false"
          width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"
          className={`ml-auto flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <path d="M2 4l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-full min-w-[200px] bg-slate-900 border border-slate-700 rounded-lg shadow-xl z-50 overflow-hidden animate-slide-down">
          <button
            type="button"
            className="w-full text-left px-3 py-2 text-xs text-text-muted hover:bg-slate-800 transition-colors"
            onClick={handleClear}
          >
            — Select camera —
          </button>
          {cameras.map((c) => (
            <DropdownItem key={c.id} camera={c} onSelect={onSelect} setOpen={setOpen} />
          ))}
        </div>
      )}
    </div>
  );
});

/** Individual dropdown option — memoised so the list doesn't fully re-render on parent state change */
const DropdownItem = memo(function DropdownItem({ camera: c, onSelect, setOpen }) {
  const handleClick = useCallback(() => {
    onSelect(String(c.id));
    setOpen(false);
  }, [c.id, onSelect, setOpen]);

  return (
    <button
      type="button"
      className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-slate-800 transition-colors"
      onClick={handleClick}
    >
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.is_running ? 'bg-emerald-400' : 'bg-slate-500'}`} />
      <span className="text-base leading-none">{sourceIcon(c.source_type)}</span>
      <span className="font-medium text-text-base truncate">{c.name}</span>
      <span className="text-text-muted ml-auto pl-2">{c.source_type}</span>
    </button>
  );
});

// Stable style objects — defined outside the component so they are never recreated.
// The stream area is a fixed 16:9 box and the video / canvas / img all fill it
// absolutely, so the canvas coordinate box exactly matches the rendered video box
// (otherwise the overlay's bitmap, sized to the video rect, gets stretched to a
// differently-sized container box and boxes render shifted down).
const STREAM_AREA_STYLE = { position: 'relative', aspectRatio: '16 / 9', maxHeight: 480 };
const STREAM_IMG_STYLE = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' };
const STREAM_VIDEO_STYLE = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', background: '#000' };
const CANVAS_OVERLAY_STYLE = { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' };
const LIVE_FEED_CARD_STYLE = { background: '#0b0f1a' };
const HEADER_STYLE = { background: '#0b0f1a', borderColor: 'rgba(6,182,212,0.12)' };
const SCAN_GRID_STYLE = {
  backgroundImage: 'linear-gradient(rgba(6,182,212,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.07) 1px, transparent 1px)',
  backgroundSize: '40px 40px',
};

export default function LiveFeed() {
  const { showToast } = useToast();
  const [cameras, setCameras]       = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [streaming, setStreaming]   = useState(false);
  const [streamMode, setStreamMode] = useState('mjpeg'); // 'webrtc' | 'mjpeg'
  const [counts, setCounts]         = useState(null);
  const [detections, setDetections] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [aiReady, setAiReady]       = useState(false);
  const [streamStatus, setStreamStatus] = useState('Offline');
  const [sirenMuted, setSirenMuted]     = useState(false);
  const imgRef       = useRef(null);
  const videoRef     = useRef(null);
  const canvasRef    = useRef(null);
  const wsRef        = useRef(null);
  const wrapRef      = useRef(null); // for fullscreen
  // Siren — Web Audio API tone, no audio asset needed. AudioContext is
  // created/resumed inside handleStart (a user gesture) so the later,
  // websocket-driven start/stop of the oscillator is never blocked by the
  // browser's autoplay policy.
  const audioCtxRef     = useRef(null);
  const sirenOscRef     = useRef(null);
  const sirenGainRef    = useRef(null);
  const sirenIntervalRef = useRef(null);
  // Keep latest selectedId accessible inside stable callbacks without stale closures
  const selectedIdRef = useRef(selectedId);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  const { start: startBrowserWebcam, stop: stopBrowserWebcam } = useBrowserWebcamSender(
    useCallback((errMsg) => {
      showToast({ title: 'Browser webcam error', message: errMsg, level: 'danger', duration: 8000 });
    }, [showToast]),
  );

  const { start: startWebRTC, stop: stopWebRTC } = useWebRTC(
    videoRef,
    useCallback((errMsg) => {
      // WebRTC connection dropped after it was live — fall back to annotated MJPEG
      const id = selectedIdRef.current;
      setStreamMode('mjpeg');
      if (id) {
        const img = imgRef.current;
        if (img) {
          const base = api.streamUrl(id);
          img.src = base + (base.includes('?') ? '&' : '?') + 't=' + Date.now();
        }
        setStreaming(true);
      }
      showToast({ title: 'WebRTC unavailable', message: `Falling back to MJPEG. (${errMsg})`, level: 'warning', duration: 6000 });
    }, [showToast]),
  );

  useDetectionCanvas(canvasRef, videoRef, streamMode === 'webrtc' ? detections : []);

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

  // ── Fetch cameras on mount and auto-connect ──────────────────────────────
  useEffect(() => {
    let cancelled = false;
    api.listCameras()
      .then((cams) => {
        if (cancelled) return;
        setCameras(cams);
        const running = cams.find((c) => c.is_running);
        if (running) {
          setSelectedId(String(running.id));
          startStream(running.id);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedCam = useMemo(
    () => cameras.find((c) => String(c.id) === String(selectedId)),
    [cameras, selectedId]
  );
  const selectedIsRunning = Boolean(selectedCam?.is_running || streaming);

  // ── Siren (Web Audio API two-tone alarm) ─────────────────────────────────
  const ensureAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtxRef.current = new Ctx();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  }, []);

  const startSiren = useCallback(() => {
    if (sirenOscRef.current) return; // already running
    const ctx = ensureAudioContext();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 700;
    gain.gain.value = 0.12; // audible but not deafening
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    sirenOscRef.current = osc;
    sirenGainRef.current = gain;
    let high = false;
    sirenIntervalRef.current = setInterval(() => {
      high = !high;
      osc.frequency.setTargetAtTime(high ? 1000 : 700, ctx.currentTime, 0.05);
    }, 600);
  }, [ensureAudioContext]);

  const stopSiren = useCallback(() => {
    if (sirenIntervalRef.current) {
      clearInterval(sirenIntervalRef.current);
      sirenIntervalRef.current = null;
    }
    if (sirenOscRef.current) {
      try { sirenOscRef.current.stop(); } catch { /* already stopped */ }
      sirenOscRef.current.disconnect();
      sirenOscRef.current = null;
    }
    if (sirenGainRef.current) {
      sirenGainRef.current.disconnect();
      sirenGainRef.current = null;
    }
  }, []);

  const sirenActive = Boolean(counts?.siren_active);
  useEffect(() => {
    if (sirenActive && !sirenMuted) startSiren(); else stopSiren();
  }, [sirenActive, sirenMuted, startSiren, stopSiren]);

  // Muting silences the *current* alarm only — once it clears (resolved on
  // the Violations page), the mute resets so a future, genuinely new
  // violation is never silently suppressed by a stale mute.
  useEffect(() => {
    if (!sirenActive) setSirenMuted(false);
  }, [sirenActive]);

  useEffect(() => () => stopSiren(), [stopSiren]); // stop on unmount

  const handleToggleMute = useCallback(() => setSirenMuted((m) => !m), []);

  // ── WebSocket helpers ────────────────────────────────────────────────────
  function openWebSocket(cameraId) {
    closeWebSocket();
    const ws = new WebSocket(api.wsUrl(cameraId));
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (!d.ping) setCounts(d);
        if (d.detections) setDetections(d.detections);
        // When the backend confirms a violation was saved to DB, tell other
        // components (StatsCard, ViolationsTable) to refresh immediately.
        if (d.type === 'violation_saved') {
          window.dispatchEvent(new CustomEvent('ppe:violation_saved'));
        }
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
    stopWebRTC();
    stopBrowserWebcam(); // no-op if this camera isn't a browser source
    if (imgRef.current) {
      // Detach the error handler before clearing src — setting src='' itself
      // fires a browser "error" event, which would otherwise re-trigger the
      // disconnect handler below and pop a spurious "Stream disconnected"
      // toast right after an intentional stop.
      imgRef.current.onerror = null;
      imgRef.current.src = '';
    }
    setStreaming(false);
    setStreamStatus('Offline');
    setCounts(null);
    setDetections([]);
  }

  function startMjpeg(cameraId) {
    const img = imgRef.current;
    if (!img) return;
    img.onerror = null;
    const base = api.streamUrl(cameraId);
    img.src = base + (base.includes('?') ? '&' : '?') + 't=' + Date.now();
    img.onerror = () => {
      img.onerror = null;
      stopStream();
      setStreamStatus('Offline/Error');
      showToast({ title: 'Stream disconnected', message: 'Camera feed lost. Click Start to reconnect.', level: 'warning', duration: 6000 });
    };
    setStreamMode('mjpeg');
    setStreaming(true);
    setStreamStatus('Starting');
  }

  async function startStream(cameraId) {
    // Start MJPEG immediately so there is always something visible
    startMjpeg(cameraId);
    openWebSocket(cameraId);
    // Then attempt to upgrade to WebRTC (lower latency + canvas overlay)
    try {
      await startWebRTC(cameraId);
      // WebRTC connected — switch display mode
      setStreamMode('webrtc');
      setStreamStatus('Live');
    } catch {
      setStreamStatus('Live');
      // WebRTC unavailable — stay on MJPEG silently
    }
  }

  // ── Camera control ───────────────────────────────────────────────────────
  const [actionLoading, setActionLoading] = useState(false);

  async function handleStart() {
    if (!selectedId || actionLoading) return;
    if (selectedIsRunning) return;
    if (!aiReady) {
      showToast({ title: 'AI loading', message: 'AI model loading, please wait before starting cameras.', level: 'info', duration: 5000 });
      return;
    }
    setActionLoading(true);
    ensureAudioContext(); // unlock audio on this user gesture for the later, websocket-driven siren
    try {
      await api.startCamera(selectedId);
      setCameras((prev) => prev.map((c) => String(c.id) === String(selectedId) ? { ...c, is_running: true } : c));
      window.dispatchEvent(new CustomEvent('ppe:camera_state_changed'));
      if (selectedCam?.source_type === 'browser') {
        await startBrowserWebcam(selectedId); // prompts for camera permission, pushes frames in
      }
      await startStream(selectedId);
      showToast({ title: 'Camera started', message: `Camera ${selectedId} is now streaming.`, level: 'success' });
    } catch (err) {
      setStreamStatus('Offline/Error');
      showToast({ title: 'Failed to start camera', message: err.message, level: 'danger', duration: 8000 });
    }
    setActionLoading(false);
  }

  async function handleStop() {
    if (!selectedId || actionLoading) return;
    if (!selectedIsRunning) return;
    setActionLoading(true);
    try {
      await api.stopCamera(selectedId);
      stopStream();
      setCameras((prev) => prev.map((c) => String(c.id) === String(selectedId) ? { ...c, is_running: false } : c));
      window.dispatchEvent(new CustomEvent('ppe:camera_state_changed'));
      showToast({ title: 'Camera stopped', message: `Camera ${selectedId} stopped.`, level: 'info' });
    } catch (err) {
      showToast({ title: 'Failed to stop camera', message: err.message, level: 'danger' });
    }
    setActionLoading(false);
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

  // ── Stable onSelect handler (stops stream before switching) ─────────────
  const handleSelect = useCallback((id) => {
    setSelectedId(id);
    stopStream();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cleanup WebSocket on unmount ─────────────────────────────────────────
  useEffect(() => () => closeWebSocket(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const displayCounts = useMemo(() => {
    if (!counts) return null;

    const visibleViolationCount = detections.filter((d) => {
      const label = String(d.label || d.class_name || '').toUpperCase();
      return label.startsWith('NO-');
    }).length;

    return {
      ...counts,
      violation_count: Math.max(Number(counts.violation_count ?? 0), visibleViolationCount),
    };
  }, [counts, detections]);

  // Detection badge counts — memoised to prevent new array on every render
  const detBadges = useMemo(() => {
    if (!displayCounts) return null;
    return [
      { label: 'Persons',    value: displayCounts.person_count,      color: 'bg-sky-100 text-sky-700 border-sky-200 shadow-sm' },
      { label: 'Hardhats',   value: displayCounts.hardhat_count,     color: 'bg-emerald-100 text-emerald-700 border-emerald-200 shadow-sm' },
      { label: 'Violations', value: displayCounts.violation_count,   color: 'bg-red-100 text-red-700 border-red-200 shadow-sm' },
    ];
  }, [displayCounts]);

  return (
    <div className="card flex flex-col" style={LIVE_FEED_CARD_STYLE}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="card-header gap-3 flex-wrap" style={HEADER_STYLE}>
        <div className="flex items-center gap-2 flex-shrink-0">
          {streaming && <span className="rec-dot" title="Recording" />}
          <span className="font-semibold text-text-base">Live Feed</span>
          {streaming && (
            <span className="text-xs font-bold tracking-widest text-red-400 select-none">REC</span>
          )}
          <span className="text-[10px] font-semibold text-text-muted border border-border-soft rounded px-1.5 py-0.5">
            {streamStatus}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Camera selector with per-option status dots */}
          <CameraDropdown
            cameras={cameras}
            selectedId={selectedId}
            onSelect={handleSelect}
            selectedRunning={selectedIsRunning}
          />

          {/* Start / Stop */}
          <button
            id="livefeed-start-btn"
            onClick={handleStart}
            disabled={!selectedId || selectedIsRunning || actionLoading || !aiReady}
            className="btn-success text-xs px-3 py-1.5 flex items-center gap-1"
            title={aiReady ? 'Start stream (S)' : 'AI model loading, please wait'}
          >
            <svg aria-hidden="true" focusable="false" width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <polygon points="1,1 9,5 1,9"/>
            </svg>
            {actionLoading ? 'Wait...' : !aiReady ? 'AI loading...' : 'Start'}
          </button>
          <button
            id="livefeed-stop-btn"
            onClick={handleStop}
            disabled={!selectedId || !selectedIsRunning || actionLoading}
            className="btn-danger text-xs px-3 py-1.5 flex items-center gap-1"
            title="Stop stream (X)"
          >
            <svg aria-hidden="true" focusable="false" width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <rect x="1" y="1" width="8" height="8" rx="1"/>
            </svg>
            {actionLoading ? 'Wait...' : 'Stop'}
          </button>

          {/* Fullscreen button */}
          <button
            id="livefeed-fullscreen-btn"
            onClick={handleFullscreen}
            className="btn-icon"
            title="Toggle fullscreen (F)"
            aria-label="Toggle fullscreen"
          >
            <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── Stream area ──────────────────────────────────────────────────── */}
      <div ref={wrapRef} className="relative bg-black group" style={STREAM_AREA_STYLE}>
        {/* WebRTC video + canvas bbox overlay */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ ...STREAM_VIDEO_STYLE, display: streaming && streamMode === 'webrtc' ? 'block' : 'none' }}
        />
        <canvas
          ref={canvasRef}
          style={{ ...CANVAS_OVERLAY_STYLE, display: streaming && streamMode === 'webrtc' ? 'block' : 'none' }}
        />

        {/* MJPEG fallback */}
        <img
          ref={imgRef}
          alt="Live camera stream"
          className="w-full"
          style={{ ...STREAM_IMG_STYLE, display: streaming && streamMode === 'mjpeg' ? 'block' : 'none' }}
        />

        {/* Camera name overlay (top-left) */}
        {streaming && selectedCam && (
          <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-lg px-2.5 py-1 pointer-events-none">
            <span className="text-base">{sourceIcon(selectedCam.source_type)}</span>
            <span className="text-xs font-semibold text-white">{selectedCam.name}</span>
          </div>
        )}

        {/* Sustained alert banner — visible until the violation is resolved on the Violations page */}
        {streaming && sirenActive && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-red-600/90 backdrop-blur-sm rounded-lg px-3 py-1.5 shadow-lg animate-pulse">
            <span className="text-sm">🚨</span>
            <span className="text-xs font-bold tracking-widest text-white">ALERT ACTIVE — UNRESOLVED VIOLATION</span>
            <button
              type="button"
              onClick={handleToggleMute}
              className="pointer-events-auto ml-1 flex items-center justify-center w-5 h-5 rounded bg-white/20 hover:bg-white/30 transition-colors"
              title={sirenMuted ? 'Unmute siren' : 'Mute siren'}
              aria-label={sirenMuted ? 'Unmute siren' : 'Mute siren'}
            >
              <span className="text-xs leading-none">{sirenMuted ? '🔇' : '🔊'}</span>
            </button>
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

        {/* No-camera placeholder — dark scan grid */}
        {!streaming && (
          <div className="absolute inset-0 bg-slate-950 overflow-hidden flex flex-col items-center justify-center gap-4 select-none">
            {/* Grid lines */}
            <div className="absolute inset-0" style={SCAN_GRID_STYLE} />
            {/* Animated scan line */}
            <div className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent animate-scan-line" />
            {/* Corner brackets */}
            <div className="absolute top-4 left-4 w-8 h-8 border-t-2 border-l-2 border-cyan-500/30" />
            <div className="absolute top-4 right-4 w-8 h-8 border-t-2 border-r-2 border-cyan-500/30" />
            <div className="absolute bottom-4 left-4 w-8 h-8 border-b-2 border-l-2 border-cyan-500/30" />
            <div className="absolute bottom-4 right-4 w-8 h-8 border-b-2 border-r-2 border-cyan-500/30" />
            {/* Center icon + text */}
            <div className="relative z-10 flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-cyan-500/20 flex items-center justify-center shadow-[0_0_24px_rgba(6,182,212,0.15)]">
                <svg aria-hidden="true" focusable="false" width="32" height="32" viewBox="0 0 36 36" fill="none" className="text-cyan-500/40">
                  <rect x="2" y="8" width="24" height="20" rx="4" stroke="currentColor" strokeWidth="2.5"/>
                  <path d="M26 14l8-5v18l-8-5V14z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"/>
                  <circle cx="14" cy="18" r="5" stroke="currentColor" strokeWidth="2.5"/>
                </svg>
              </div>
              <p className="text-slate-400 font-semibold text-sm tracking-wide">AWAITING FEED</p>
              <p className="text-slate-600 text-xs">Select camera above to begin monitoring</p>
              {loading && <div className="w-24 h-1 bg-slate-800 rounded-full overflow-hidden mt-1">
                <div className="h-full bg-cyan-500/30 animate-shimmer" style={{ backgroundSize: '200% 100%' }} />
              </div>}
            </div>
          </div>
        )}
      </div>

      {/* ── Detection counts ─────────────────────────────────────────────── */}
      <DetectionCounts counts={displayCounts} />
    </div>
  );
}
