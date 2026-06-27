import { useEffect, useMemo, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '../../../services/api/client.js';

const HANDLER_BADGES = {
  email:   { label: 'Email',   cls: 'badge-webcam' },
  mqtt:    { label: 'MQTT',    cls: 'badge-rtsp' },
  webhook: { label: 'Webhook', cls: 'badge-file' },
};

const STATUS_BADGES = {
  sent:    { label: 'Sent',    cls: 'badge-running' },
  skipped: { label: 'Skipped', cls: 'badge-default' },
  failed:  { label: 'Failed',  cls: 'badge-hardhat' },
};

const TIME_RANGE_MS = {
  '24h': 24 * 3600_000,
  '7d':  7  * 86400_000,
  '30d': 30 * 86400_000,
  'all': null,
};

const CACHE_TIME_BUCKET_MS = 5 * 60 * 1000;

function bucketedNowMs() {
  return Math.floor(Date.now() / CACHE_TIME_BUCKET_MS) * CACHE_TIME_BUCKET_MS;
}

function formatDateTime(iso) {
  if (!iso) return '';
  const raw = iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z';
  const d = new Date(raw);
  const day = d.getDate();
  const mon = d.toLocaleString('en-US', { month: 'short' });
  const year = d.getFullYear();
  const time = d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const now = new Date();
  if (d.getFullYear() === now.getFullYear()) {
    return `${day} ${mon}, ${time}`;
  }
  return `${day} ${mon} ${year}, ${time}`;
}

// Fallback for older API responses without a derived `status` field.
function deriveStatus(log) {
  if (log.status) return log.status;
  if (!log.success) return 'failed';
  if (log.error_msg && log.error_msg.startsWith('skipped:')) return 'skipped';
  return 'sent';
}

function detailText(log) {
  if (!log.error_msg) return '';
  return log.error_msg.replace(/^skipped:\s*/, '');
}

const DEFAULT_FILTERS = { time: '24h', handler_type: '', status: '', violation_id: '' };

function buildParams(filters, page, pageSize, referenceTimeMs) {
  const params = { page, page_size: pageSize };
  const ms = TIME_RANGE_MS[filters.time];
  if (ms) params.from = new Date(referenceTimeMs - ms).toISOString();
  if (filters.handler_type) params.handler_type = filters.handler_type;
  if (filters.status) params.status = filters.status;
  if (filters.violation_id) params.violation_id = filters.violation_id;
  return params;
}

export default function AlertLogsPage() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const referenceTimeMs = useMemo(() => bucketedNowMs(), [filters.time]);
  const queryParams = useMemo(
    () => buildParams(filters, page, pageSize, referenceTimeMs),
    [filters, page, pageSize, referenceTimeMs]
  );

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['alertLogs', queryParams],
    queryFn: () => api.listAlertLogs(queryParams),
    staleTime: 5000,
    gcTime: 300000,
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    setPage(1);
  }, [filters]);

  function set(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  const items = data?.items ?? null;
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="card">
      <div className="card-header">
        <span className="font-semibold">Alert Logs</span>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="btn-outline text-xs px-2 py-1 disabled:opacity-50"
        >
          {isFetching ? 'Refreshing…' : '⟳ Refresh'}
        </button>
      </div>

      {/* Filters */}
      <div className="bg-surface-2 border-b border-border-soft px-4 py-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2 items-center">
          <select
            aria-label="Time range"
            className="form-select text-xs py-1"
            value={filters.time}
            onChange={(e) => set('time', e.target.value)}
          >
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="all">All time</option>
          </select>

          <select
            aria-label="Channel"
            className="form-select text-xs py-1"
            value={filters.handler_type}
            onChange={(e) => set('handler_type', e.target.value)}
          >
            <option value="">All channels</option>
            <option value="email">Email</option>
            <option value="mqtt">MQTT</option>
            <option value="webhook">Webhook</option>
          </select>

          <select
            aria-label="Status"
            className="form-select text-xs py-1"
            value={filters.status}
            onChange={(e) => set('status', e.target.value)}
          >
            <option value="">All status</option>
            <option value="sent">Sent</option>
            <option value="skipped">Skipped</option>
            <option value="failed">Failed</option>
          </select>

          <input
            type="number"
            min="1"
            placeholder="Violation ID"
            aria-label="Violation ID"
            className="form-select text-xs py-1"
            value={filters.violation_id}
            onChange={(e) => set('violation_id', e.target.value)}
          />

          <button onClick={() => setFilters(DEFAULT_FILTERS)} className="btn-outline text-xs py-1">
            ✕ Clear
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 680 }}>
        <table className="w-full min-w-[600px] text-xs">
          <thead className="sticky top-0 bg-surface-1 z-10">
            <tr className="border-b border-border-soft">
              <th className="px-3 py-2 text-left uppercase tracking-wider text-text-muted font-semibold">Time</th>
              <th className="px-3 py-2 text-left uppercase tracking-wider text-text-muted font-semibold">Channel</th>
              <th className="px-3 py-2 text-left uppercase tracking-wider text-text-muted font-semibold">Status</th>
              <th className="px-3 py-2 text-left uppercase tracking-wider text-text-muted font-semibold">Violation</th>
              <th className="px-3 py-2 text-left uppercase tracking-wider text-text-muted font-semibold">Detail</th>
            </tr>
          </thead>
          <tbody>
            {error ? (
              <tr>
                <td colSpan={5} className="py-8 text-center">
                  <p className="text-red-400 text-xs mb-2">⚠ {error.message || 'Failed to load alert logs'}</p>
                  <button onClick={() => refetch()} className="text-xs px-3 py-1 rounded-lg bg-brand/10 text-brand border border-brand/30 hover:bg-brand/20 transition-colors">Retry</button>
                </td>
              </tr>
            ) : items === null ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-border-soft">
                  {Array.from({ length: 5 }).map((__, j) => (
                    <td key={j} className="px-3 py-2"><span className="skel-line" /></td>
                  ))}
                </tr>
              ))
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-text-subtle text-xs">
                  No alert logs matching your filters.
                </td>
              </tr>
            ) : items.map((log) => {
              const handler = HANDLER_BADGES[log.handler_type] || { label: log.handler_type, cls: 'badge-default' };
              const status = STATUS_BADGES[deriveStatus(log)] || STATUS_BADGES.sent;
              const detail = detailText(log);
              return (
                <tr key={log.id} className="border-b border-border-soft transition-colors duration-100 hover:bg-cyan-500/5">
                  <td className="px-3 py-2 text-nowrap text-text-muted">{formatDateTime(log.sent_at)}</td>
                  <td className="px-3 py-2">
                    <span className={handler.cls}>{handler.label}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={status.cls}>{status.label}</span>
                  </td>
                  <td className="px-3 py-2 text-nowrap">
                    <span className="text-text-muted">#{log.violation_id}</span>
                    {log.violation_type && (
                      <span className="ml-1.5 text-[10px] text-text-subtle">{log.violation_type}</span>
                    )}
                    {log.camera_id != null && (
                      <span className="ml-1.5 text-[10px] text-text-subtle">📹 {log.camera_id}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 max-w-[320px]">
                    {detail ? (
                      <span className="block truncate text-text-muted" title={detail}>{detail}</span>
                    ) : (
                      <span className="text-text-subtle">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      {!isLoading && !error && totalPages > 1 && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-border-soft bg-surface-1/30">
          <div className="text-[11px] text-text-muted">
            Showing <span className="font-medium text-text-base">{(page - 1) * pageSize + 1}</span> to{' '}
            <span className="font-medium text-text-base">{Math.min(page * pageSize, total)}</span> of{' '}
            <span className="font-medium text-text-base">{total}</span> results
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="text-[11px] px-2 py-1 rounded bg-surface-3 text-text-muted hover:text-text-base border border-border-soft hover:bg-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              &larr; Prev
            </button>
            {Array.from({ length: totalPages }).map((_, idx) => {
              const pNum = idx + 1;
              if (totalPages > 6 && Math.abs(pNum - page) > 1 && pNum !== 1 && pNum !== totalPages) {
                if (pNum === 2 || pNum === totalPages - 1) {
                  return <span key={pNum} className="text-text-subtle text-[11px] px-1">...</span>;
                }
                return null;
              }
              return (
                <button
                  key={pNum}
                  onClick={() => setPage(pNum)}
                  className={`text-[11px] w-6 h-6 rounded flex items-center justify-center transition-colors ${
                    page === pNum
                      ? 'bg-brand text-gray-900 font-bold'
                      : 'bg-surface-2 text-text-muted hover:bg-surface-3 border border-border-soft'
                  }`}
                >
                  {pNum}
                </button>
              );
            })}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="text-[11px] px-2 py-1 rounded bg-surface-3 text-text-muted hover:text-text-base border border-border-soft hover:bg-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next &rarr;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
