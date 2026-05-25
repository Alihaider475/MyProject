import { useCallback, useEffect } from 'react';

const LABEL_COLORS = {
  'NO-Hardhat':     '#ef4444',
  'NO-Mask':        '#06b6d4',
  'NO-Safety Vest': '#eab308',
  'Hardhat':        '#22c55e',
  'Mask':           '#3b82f6',
  'Safety Vest':    '#a855f7',
  'Person':         '#64748b',
  'Vehicle':        '#94a3b8',
  'Machinery':      '#f97316',
};

export function useDetectionCanvas(canvasRef, videoRef, detections) {
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    // Use intrinsic video dimensions when available; fall back to layout rect
    const vW = video.videoWidth;
    const vH = video.videoHeight;
    const rect = video.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // If video metadata not yet loaded, skip — 'loadedmetadata' will re-trigger
    if (!vW || !vH) return;

    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!detections?.length) return;

    // Letterbox math for object-fit: contain
    const scale = Math.min(rect.width / vW, rect.height / vH);
    const offX = (rect.width - vW * scale) / 2;
    const offY = (rect.height - vH * scale) / 2;

    for (const det of detections) {
      const [x1, y1, x2, y2] = det.bbox;
      const color = det.color || LABEL_COLORS[det.label] || '#94a3b8';
      const cx1 = x1 * scale + offX;
      const cy1 = y1 * scale + offY;
      const cw = (x2 - x1) * scale;
      const ch = (y2 - y1) * scale;

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(cx1, cy1, cw, ch);

      const label = `${det.label} ${(det.confidence * 100).toFixed(0)}%`;
      ctx.font = '11px monospace';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = color + 'cc';
      ctx.fillRect(cx1, cy1 - 18, tw + 8, 18);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, cx1 + 4, cy1 - 4);
    }
  }, [canvasRef, videoRef, detections]);

  // Redraw whenever detections change
  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // ResizeObserver handles layout size changes
    const ro = new ResizeObserver(() => draw());
    ro.observe(video);

    // These events fire once video stream metadata / first frame arrives —
    // at that point videoWidth/Height become non-zero, so we must redraw.
    video.addEventListener('loadedmetadata', draw);
    video.addEventListener('play', draw);

    return () => {
      ro.disconnect();
      video.removeEventListener('loadedmetadata', draw);
      video.removeEventListener('play', draw);
    };
  }, [videoRef, draw]);
}
