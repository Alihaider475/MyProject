import axios from 'axios';
import { supabase } from '../supabase.js';

const BASE = '/api/v1';

const http = axios.create({ baseURL: BASE });

// ─── Cached Supabase token ────────────────────────────────────────────────────
// Instead of calling supabase.auth.getSession() on every request (20–80ms each),
// we cache the token and update it reactively via onAuthStateChange.
let _cachedAccessToken = null;

// Seed the cached token once at module load
supabase.auth.getSession().then(({ data: { session } }) => {
  _cachedAccessToken = session?.access_token ?? null;
});

// Keep the cached token up-to-date on auth state changes (login/logout/refresh)
supabase.auth.onAuthStateChange((_event, session) => {
  _cachedAccessToken = session?.access_token ?? null;
});

// Inject cached token — synchronous, zero overhead
http.interceptors.request.use((config) => {
  if (_cachedAccessToken) {
    config.headers.Authorization = `Bearer ${_cachedAccessToken}`;
  }
  // Dev-mode timing: record start time
  if (import.meta.env.DEV) {
    config._startTime = performance.now();
  }
  return config;
});

// Normalise axios errors so callers can read err.message reliably
// On 401 redirect to /login and clear stored token
http.interceptors.response.use(
  (res) => {
    // Dev-mode timing: log response time
    if (import.meta.env.DEV && res.config._startTime) {
      const elapsed = (performance.now() - res.config._startTime).toFixed(0);
      console.debug(`[API] ${res.config.method?.toUpperCase()} ${res.config.url} → ${res.status} (${elapsed}ms)`);
    }
    return res;
  },
  (err) => {
    // Dev-mode timing for errors too
    if (import.meta.env.DEV && err.config?._startTime) {
      const elapsed = (performance.now() - err.config._startTime).toFixed(0);
      console.debug(`[API] ${err.config.method?.toUpperCase()} ${err.config.url} → ${err.response?.status || 'ERR'} (${elapsed}ms)`);
    }
    const detail = err.response?.data?.detail || err.message || 'Request failed';
    err.message = detail;
    if (err.response?.status === 401) {
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// ─── Client-side cache (Backward compatibility placeholders) ──────────────────
export function invalidateCache(...keys) {
  // No-op (handled by React Query invalidations)
}

export const api = {
  // ── Health ────────────────────────────────────────────────────────────────
  health: () => http.get('/health').then((r) => r.data),
  ready: () =>
    http
      .get('/ready', { validateStatus: (s) => s === 200 || s === 503 })
      .then((r) => r.data),

  // ── Dashboard (unified) ───────────────────────────────────────────────────
  fetchDashboardSummary: ({ signal } = {}) =>
    http.get('/dashboard/summary', { signal }).then((r) => r.data),

  // ── Cameras ───────────────────────────────────────────────────────────────
  listCameras: () => http.get('/cameras').then((r) => r.data),
  getCamera: (id) => http.get(`/cameras/${id}`).then((r) => r.data),
  createCamera: (body) => http.post('/cameras', body, { timeout: 10000 }).then((r) => r.data),
  updateCamera: (id, body) => http.put(`/cameras/${id}`, body).then((r) => r.data),
  deleteCamera: (id) => http.delete(`/cameras/${id}`).then((r) => r.data),
  startCamera: (id) => http.post(`/cameras/${id}/start`, null, { timeout: 15000 }).then((r) => r.data),
  stopCamera: (id) => http.post(`/cameras/${id}/stop`, null, { timeout: 10000 }).then((r) => r.data),
  duplicateCamera: (body) => http.post('/cameras/duplicate', body, { timeout: 15000 }).then((r) => r.data),

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
  violationCountsByCamera: () =>
    http.get('/violations/counts-by-camera').then((r) => r.data),
  topOffenders: (params = {}) => {
    const filtered = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    );
    return http.get('/violations/top-offenders', { params: filtered }).then((r) => r.data);
  },

  // ── Alert logs ────────────────────────────────────────────────────────────
  listAlertLogs: (params = {}) => {
    const filtered = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    );
    return http.get('/alert-logs', { params: filtered }).then((r) => r.data);
  },


  // ── Image detection ───────────────────────────────────────────────────────
  detectImage: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return http.post('/detect/image', fd).then((r) => r.data);
  },
  detectVideo: (file, onProgress) => {
    // Returns immediately with { job_id, status, filename } — the backend
    // processes the video in the background. Poll getVideoJob for the result.
    const fd = new FormData();
    fd.append('file', file);
    return http.post('/detect/video', fd, {
      onUploadProgress: onProgress
        ? (e) => onProgress(Math.round((e.loaded * 100) / (e.total || 1)))
        : undefined,
    }).then((r) => r.data);
  },
  getVideoJob: (jobId) => http.get(`/detect/video/${jobId}`).then((r) => r.data),
  detectClasses: () => http.get('/detect/classes').then((r) => r.data),

  // ── Fines ─────────────────────────────────────────────────────────────────
  listFines: (params = {}) =>
    http.get('/fines', { params: Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== '')) }).then((r) => r.data),
  listFineConfigs: () => http.get('/fines/config').then((r) => r.data),
  updateFineConfig: (type, body) => http.put(`/fines/config/${encodeURIComponent(type)}`, body).then((r) => r.data),
  monthlyFineReport: (month) => http.get('/fines/monthly-report', { params: { month } }).then((r) => r.data),
  waiveFine: (id, reason) => http.put(`/fines/${id}/waive`, reason ? { reason } : {}).then((r) => r.data),
  deductFine: (id, deduction_month) => http.put(`/fines/${id}/deduct`, null, { params: { deduction_month } }).then((r) => r.data),
  finalizeMonth: (month) => http.put('/fines/finalize-month', null, { params: { month } }).then((r) => r.data),
  settleFine: (id, body) => http.patch(`/fines/${id}/settle`, body).then((r) => r.data),

  // ── Payroll risk analysis (n8n agent — read-only audit log history) ─────────
  // The n8n agent runs the analysis and writes the audit log. The frontend only
  // READS the latest log(s) here using the existing Supabase JWT — it never sends
  // or handles the server-only agent shared secret.
  payrollRiskHistory: (limit = 1, month) =>
    http
      .get('/admin/payroll/agent/risk-analysis-history', {
        params: { limit, ...(month ? { month } : {}) },
      })
      .then((r) => r.data),

  // Safety corrective actions (admin UI only; the n8n API key is never used here)
  listSafetyActions: (params = {}) =>
    http
      .get('/admin/safety-actions', {
        params: Object.fromEntries(
          Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
        ),
      })
      .then((r) => r.data),
  completeSafetyAction: (id, body = {}) =>
    http.patch(`/admin/safety-actions/${id}/complete`, body).then((r) => r.data),

  // ── Workers ───────────────────────────────────────────────────────────────
  listWorkers: (params = {}) => http.get('/workers', { params }).then((r) => r.data),
  createWorker: (body) => http.post('/workers', body).then((r) => r.data),
  updateWorker: (workerId, body) => http.put(`/workers/${workerId}`, body).then((r) => r.data),
  deleteWorker: (workerId) => http.delete(`/workers/${workerId}`).then((r) => r.data),
  enrollFace: (workerId, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return http.post(`/workers/${workerId}/enroll-face`, fd).then((r) => r.data);
  },
  getWorkerFacePhoto: (workerId) =>
    http.get(`/workers/${workerId}/face-photo`, { responseType: 'blob' }).then((r) => r.data),
  assignViolationWorker: (violationId, workerId) =>
    http.post(`/violations/${violationId}/assign-worker`, { worker_id: workerId }).then((r) => r.data),
  autoIdentifyViolations: () =>
    http.post('/violations/auto-identify').then((r) => r.data),

  // ── Worker self-service (read-only, scoped to the logged-in worker) ───────
  getMyWorkerDashboard: (month) => http.get('/worker/me/dashboard', { params: month ? { month } : {} }).then((r) => r.data),
  getMyViolations: (params = {}) => http.get('/worker/me/violations', { params }).then((r) => r.data),
  getMyFines: (params = {}) =>
    http.get('/worker/me/fines', { params: Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== '')) }).then((r) => r.data),
  trackInviteEvent: (event) => http.post('/worker/me/track-invite', { event }).then((r) => r.data),

  // ── Invite tracker (admin) ────────────────────────────────────────────────
  createInviteLog: (workerId, email, fullName) =>
    http.post(`/admin/worker-invites/${workerId}`, { email, full_name: fullName }).then((r) => r.data),
  getInviteTracker: (params = {}) =>
    http.get('/admin/worker-invites/tracker', {
      params: Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== '')),
    }).then((r) => r.data),

  // ── Settings ─────────────────────────────────────────────────────────────
  getSettings: () => http.get('/settings').then((r) => r.data),
  toggleEmailAlerts: (enabled) => http.put('/settings/email-alerts', { enabled }).then((r) => r.data),
  toggleMqttAlerts: (enabled) => http.put('/settings/mqtt-alerts', { enabled }).then((r) => r.data),
  toggleWebhookAlerts: (enabled) => http.put('/settings/webhook-alerts', { enabled }).then((r) => r.data),

  // ── Alert config ──────────────────────────────────────────────────────────
  getAlertConfig: () => http.get('/alerts/config').then((r) => r.data),
  updateAlertConfig: (channel, data) => http.put(`/alerts/config/${channel}`, data).then((r) => r.data),
  testAlertChannel: (channel) => http.post(`/alerts/config/test/${channel}`).then((r) => r.data),

  // ── WebRTC signalling ─────────────────────────────────────────────────────
  webrtcOffer: (cameraId, sdp, type) =>
    http.post(`/stream/webrtc/${cameraId}/offer`, { sdp, type }).then((r) => r.data),
  webrtcIce: (cameraId, pcId, candidate) =>
    http.post(`/stream/webrtc/${cameraId}/ice`, { pc_id: pcId, candidate }).then((r) => r.data),

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
