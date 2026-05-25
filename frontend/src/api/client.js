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

// ─── Client-side cache ────────────────────────────────────────────────────────
// Each entry: { data: any, expiresAt: number }
const _cache = new Map();

/** Write a value into the cache with a TTL in milliseconds. */
function _cacheSet(key, data, ttlMs) {
  _cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

/** Read from cache. Returns undefined on miss or expiry. */
function _cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    _cache.delete(key);
    return undefined;
  }
  return entry.data;
}

/** Explicitly invalidate one or more cache keys. */
export function invalidateCache(...keys) {
  keys.forEach((k) => _cache.delete(k));
}

// ─── In-flight request deduplication ─────────────────────────────────────────
// Maps cache key → Promise so concurrent callers share a single in-flight fetch.
const _inflight = new Map();

/**
 * Deduplicated, cached fetch wrapper.
 *
 * @param {string} key        - Cache key (should be unique per logical request).
 * @param {() => Promise<any>} fetcher - Function that performs the actual HTTP call.
 * @param {number} [ttlMs=0]  - How long to cache the result (0 = no caching).
 */
async function _cachedFetch(key, fetcher, ttlMs = 0) {
  // Cache hit
  if (ttlMs > 0) {
    const cached = _cacheGet(key);
    if (cached !== undefined) return cached;
  }

  // Already in-flight — return the same promise to avoid duplicate requests
  if (_inflight.has(key)) return _inflight.get(key);

  const promise = fetcher().then(
    (data) => {
      _inflight.delete(key);
      if (ttlMs > 0) _cacheSet(key, data, ttlMs);
      return data;
    },
    (err) => {
      _inflight.delete(key);
      throw err;
    }
  );

  _inflight.set(key, promise);
  return promise;
}

// ─── Dashboard summary TTL (ms) ───────────────────────────────────────────────
const DASHBOARD_TTL_MS = 5_000; // 5 s — short cache; StatsCard invalidates before every 3 s poll anyway

export const api = {
  // ── Health ────────────────────────────────────────────────────────────────
  health: () => http.get('/health').then((r) => r.data),

  // ── Dashboard (unified) ───────────────────────────────────────────────────
  /**
   * Fetch all dashboard summary data in a single request.
   *
   * Results are cached for DASHBOARD_TTL_MS and deduplicated so concurrent
   * callers share one in-flight request. Pass `signal` (AbortSignal) to
   * cancel when a component unmounts.
   *
   * @param {{ signal?: AbortSignal }} [opts]
   */
  fetchDashboardSummary: ({ signal } = {}) =>
    _cachedFetch(
      'dashboard:summary',
      () => http.get('/dashboard/summary', { signal }).then((r) => r.data),
      DASHBOARD_TTL_MS
    ),

  // ── Cameras ───────────────────────────────────────────────────────────────
  listCameras: () =>
    _cachedFetch('cameras:list', () => http.get('/cameras').then((r) => r.data), 3_000),
  getCamera: (id) => http.get(`/cameras/${id}`).then((r) => r.data),
  createCamera: (body) => http.post('/cameras', body, { timeout: 10000 }).then((r) => { invalidateCache('cameras:list'); return r.data; }),
  updateCamera: (id, body) => http.put(`/cameras/${id}`, body).then((r) => { invalidateCache('cameras:list'); return r.data; }),
  deleteCamera: (id) => http.delete(`/cameras/${id}`).then((r) => { invalidateCache('cameras:list'); return r.data; }),
  startCamera: (id) => http.post(`/cameras/${id}/start`, null, { timeout: 15000 }).then((r) => { invalidateCache('cameras:list'); return r.data; }),
  stopCamera: (id) => http.post(`/cameras/${id}/stop`, null, { timeout: 10000 }).then((r) => { invalidateCache('cameras:list'); return r.data; }),

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
    _cachedFetch('violations:counts-by-camera', () => http.get('/violations/counts-by-camera').then((r) => r.data), 10_000),
  topOffenders: (params = {}) => {
    const filtered = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    );
    return _cachedFetch(
      `violations:top-offenders:${JSON.stringify(filtered)}`,
      () => http.get('/violations/top-offenders', { params: filtered }).then((r) => r.data),
      30_000
    );
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

  // ── Settings ─────────────────────────────────────────────────────────────
  getSettings: () => http.get('/settings').then((r) => r.data),
  toggleEmailAlerts: (enabled) => http.put('/settings/email-alerts', { enabled }).then((r) => r.data),

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
