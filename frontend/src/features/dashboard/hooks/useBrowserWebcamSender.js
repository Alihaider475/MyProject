import { useCallback, useRef } from 'react';
import { api } from '../../../services/api/client.js';

const CAPTURE_INTERVAL_MS = 250; // ~4 fps — enough for PPE detection, light on bandwidth/CPU
const JPEG_QUALITY = 0.7;

/**
 * Captures the user's own webcam (getUserMedia) and pushes JPEG frames to the
 * backend over a WebSocket — the "Browser Webcam" camera source. Needed
 * because the backend often runs on a server (e.g. AWS EC2) with no physical
 * camera attached to it; only the user's own browser can see their laptop's
 * webcam, so the frames have to be captured client-side and sent in, instead
 * of the backend opening a local device with cv2.VideoCapture.
 *
 * Manages its own offscreen <video>/<canvas> pair (not rendered in the
 * component tree) so callers don't need any extra JSX — just start()/stop().
 * The backend treats the resulting camera exactly like any other source, so
 * the existing MJPEG/WebRTC live view and detection-counts WebSocket already
 * display its annotated output with no changes needed there.
 */
export function useBrowserWebcamSender(onError) {
  const mediaStreamRef = useRef(null);
  const videoElRef = useRef(null);
  const wsRef = useRef(null);
  const intervalRef = useRef(null);
  const encodingRef = useRef(false); // guards against overlapping toBlob calls

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (videoElRef.current) {
      videoElRef.current.srcObject = null;
      videoElRef.current.remove();
      videoElRef.current = null;
    }
    encodingRef.current = false;
  }, []);

  const start = useCallback(async (cameraId) => {
    stop();

    if (!window.isSecureContext) {
      onError?.('HTTPS required for browser camera (insecure context)');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      onError?.('This browser does not support camera access (getUserMedia unavailable)');
      return;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        onError?.('Camera permission denied — allow camera access and try again');
      } else {
        onError?.(`Could not access camera: ${err.message}`);
      }
      return;
    }
    mediaStreamRef.current = stream;

    // Off-screen but attached to the DOM — some browsers won't reliably
    // decode frames into a fully detached <video> element.
    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.style.position = 'fixed';
    video.style.left = '-9999px';
    video.srcObject = stream;
    document.body.appendChild(video);
    videoElRef.current = video;
    await video.play().catch(() => {});

    const canvas = document.createElement('canvas');
    const ws = new WebSocket(api.browserPushWsUrl(cameraId));
    ws.onerror = () => onError?.('Browser webcam connection error');
    wsRef.current = ws;

    intervalRef.current = setInterval(() => {
      if (encodingRef.current) return; // previous frame still encoding/sending — skip this tick
      if (ws.readyState !== WebSocket.OPEN) return;
      const v = videoElRef.current;
      if (!v || v.videoWidth === 0) return; // not ready yet
      encodingRef.current = true;
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        encodingRef.current = false;
        if (blob && ws.readyState === WebSocket.OPEN) ws.send(blob);
      }, 'image/jpeg', JPEG_QUALITY);
    }, CAPTURE_INTERVAL_MS);
  }, [stop, onError]);

  return { start, stop };
}
