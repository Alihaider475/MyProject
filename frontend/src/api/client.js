import axios from 'axios';
import { supabase } from '../lib/supabase.js';

const BASE = '/api/v1';

const http = axios.create({ baseURL: BASE });

// Inject Supabase access token directly from the client (handles auto-refresh, no race condition)
http.interceptors.request.use(async (config) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`;
  }
  return config;
});

// Normalise axios errors so callers can read err.message reliably
// On 401 redirect to /login and clear stored token
http.interceptors.response.use(
  (res) => res,
  (err) => {
    const detail = err.response?.data?.detail || err.message || 'Request failed';
    err.message = detail;
    if (err.response?.status === 401) {
      window.location.href = '/login';
    }
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

  // ── Fines ─────────────────────────────────────────────────────────────────
  listFines: (params = {}) =>
    http.get('/fines', { params: Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== '')) }).then((r) => r.data),
  listFineConfigs: () => http.get('/fines/config').then((r) => r.data),
  updateFineConfig: (type, body) => http.put(`/fines/config/${encodeURIComponent(type)}`, body).then((r) => r.data),
  monthlyFineReport: (month) => http.get('/fines/monthly-report', { params: { month } }).then((r) => r.data),
  waiveFine: (id, reason) => http.put(`/fines/${id}/waive`, reason ? { reason } : {}).then((r) => r.data),
  deductFine: (id, deduction_month) => http.put(`/fines/${id}/deduct`, null, { params: { deduction_month } }).then((r) => r.data),

  // ── Workers ───────────────────────────────────────────────────────────────
  listWorkers: () => http.get('/workers').then((r) => r.data),
  createWorker: (body) => http.post('/workers', body).then((r) => r.data),
  enrollFace: (workerId, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return http.post(`/workers/${workerId}/enroll-face`, fd).then((r) => r.data);
  },
  assignViolationWorker: (violationId, workerId) =>
    http.post(`/violations/${violationId}/assign-worker`, { worker_id: workerId }).then((r) => r.data),
  autoIdentifyViolations: () =>
    http.post('/violations/auto-identify').then((r) => r.data),

  // ── URL builders (non-fetch use) ──────────────────────────────────────────
  streamUrl: (cameraId) => {
    const token = sessionStorage.getItem('ppe-token');
    return `${BASE}/stream/${cameraId}${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  },
  wsUrl: (cameraId) => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const token = sessionStorage.getItem('ppe-token');
    const base = `${proto}://${window.location.host}${BASE}/ws/${cameraId}`;
    return token ? `${base}?token=${encodeURIComponent(token)}` : base;
  },
  challanUrl: (fineId) => {
    const token = sessionStorage.getItem('ppe-token');
    return `${BASE}/fines/${fineId}/challan${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  },
  violationChallanUrl: (violationId) => {
    const token = sessionStorage.getItem('ppe-token');
    return `${BASE}/fines/violation/${violationId}/challan${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  },
};
