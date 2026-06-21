import { useCallback, useEffect, useRef } from 'react';

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
  // Remembers the last logged geometry so we log once per dimension change, not per frame.
  const lastDimsRef = useRef('');

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

    // One-time geometry log (only when something actually changes) so overlay
    // alignment can be verified against the live feed without console spam.
    const dimKey = `${vW}x${vH}@${Math.round(rect.width)}x${Math.round(rect.height)}`;
    if (dimKey !== lastDimsRef.current) {
      lastDimsRef.current = dimKey;
      const s = Math.min(rect.width / vW, rect.height / vH);
      console.debug(
        '[OVERLAY] video intrinsic=%dx%d rendered=%dx%d scale=%s',
        vW, vH, Math.round(rect.width), Math.round(rect.height), s.toFixed(4),
      );
    }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!detections?.length) return;

    // Letterbox math for object-fit: contain. The displayed video content
    // occupies (vW*scale x vH*scale), centered, inside the element rect.
    const scale = Math.min(rect.width / vW, rect.height / vH);
    const dispW = vW * scale;
    const dispH = vH * scale;
    const offX = (rect.width - dispW) / 2;
    const offY = (rect.height - dispH) / 2;

    for (const det of detections) {
      const color = det.color || LABEL_COLORS[det.label] || '#94a3b8';
      // Prefer normalized coords (resolution/aspect-independent). The video may
      // be a resized stream whose pixel size differs from the detection frame,
      // so absolute bbox pixels would misalign — nbbox maps to displayed content.
      let cx1, cy1, cw, ch;
      if (det.nbbox) {
        const [nx1, ny1, nx2, ny2] = det.nbbox;
        cx1 = nx1 * dispW + offX;
        cy1 = ny1 * dispH + offY;
        cw = (nx2 - nx1) * dispW;
        ch = (ny2 - ny1) * dispH;
      } else {
        const [x1, y1, x2, y2] = det.bbox;
        cx1 = x1 * scale + offX;
        cy1 = y1 * scale + offY;
        cw = (x2 - x1) * scale;
        ch = (y2 - y1) * scale;
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(cx1, cy1, cw, ch);

      const idSuffix = det.label === 'Person' && det.track_id != null ? ` ID:${det.track_id}` : '';
      const label = `${det.label} ${(det.confidence * 100).toFixed(0)}%${idSuffix}`;
      ctx.font = '11px monospace';
      const tw = ctx.measureText(label).width;
      // Clamp the label box inside the canvas: drop it below the top edge when
      // the box hugs the top, and keep it within the left/right borders.
      const labelX = Math.max(0, Math.min(cx1, canvas.width - tw - 8));
      const labelTop = cy1 - 18 < 0 ? cy1 : cy1 - 18;
      ctx.fillStyle = color + 'cc';
      ctx.fillRect(labelX, labelTop, tw + 8, 18);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, labelX + 4, labelTop + 14);
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
