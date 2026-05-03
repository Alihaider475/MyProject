import axios from 'axios';

const BASE = '/api/v1';

const http = axios.create({ baseURL: BASE });

// Normalise axios errors so callers can read err.message reliably
http.interceptors.response.use(
  (res) => res,
  (err) => {
    const detail = err.response?.data?.detail || err.message || 'Request failed';
    err.message = detail;
    return Promise.reject(err);
  }
);

export const api = {
  // ── Health ────────────────────────────────────────────────────────────────
  health: () => http.get('/health').then((r) => r.data),

  // ── Cameras ───────────────────────────────────────────────────────────────
  listCameras: () => http.get('/cameras').then((r) => r.data),
  getCamera: (id) => http.get(`/cameras/${id}`).then((r) => r.data),
  createCamera: (body) => http.post('/cameras', body).then((r) => r.data),
  updateCamera: (id, body) => http.put(`/cameras/${id}`, body).then((r) => r.data),
  deleteCamera: (id) => http.delete(`/cameras/${id}`).then((r) => r.data),
  startCamera: (id) => http.post(`/cameras/${id}/start`).then((r) => r.data),
  stopCamera: (id) => http.post(`/cameras/${id}/stop`).then((r) => r.data),

  // ── Violations ────────────────────────────────────────────────────────────
  listViolations: (params = {}) => {
    const filtered = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    );
    return http.get('/violations', { params: filtered }).then((r) => r.data);
  },
  resolveViolation: (id) => http.post(`/violations/${id}/resolve`).then((r) => r.data),
  unresolveViolation: (id) => http.post(`/violations/${id}/unresolve`).then((r) => r.data),
  flagFalsePositive: (id) => http.post(`/violations/${id}/flag-false-positive`).then((r) => r.data),
  unflagFalsePositive: (id) => http.post(`/violations/${id}/unflag-false-positive`).then((r) => r.data),
  violationStats: (params = {}) => {
    const filtered = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    );
    return http.get('/violations/stats', { params: filtered }).then((r) => r.data);
  },

  // ── Image detection ───────────────────────────────────────────────────────
  detectImage: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return http.post('/detect/image', fd).then((r) => r.data);
  },
  detectVideo: (file, onProgress) => {
    const fd = new FormData();
    fd.append('file', file);
    return http.post('/detect/video', fd, {
      timeout: 0, // no timeout — large video can take a while
      onUploadProgress: onProgress
        ? (e) => onProgress(Math.round((e.loaded * 100) / (e.total || 1)))
        : undefined,
    }).then((r) => r.data);
  },
  detectClasses: () => http.get('/detect/classes').then((r) => r.data),

  // ── URL builders (non-fetch use) ──────────────────────────────────────────
  streamUrl: (cameraId) => `${BASE}/stream/${cameraId}`,
  wsUrl: (cameraId) => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}${BASE}/ws/${cameraId}`;
  },
};
