import { useCallback, useEffect, useState } from 'react';
import { api, invalidateCache } from '../api/client.js';
import OffenderCard, { OffenderCardSkeleton } from '../components/OffenderCard.jsx';

const TIME_RANGE_MS = {
  '24h': 24 * 3600_000,
  '7d':  7  * 86400_000,
  '30d': 30 * 86400_000,
};

export default function TopOffendersPage() {
  const [cameras, setCameras] = useState([]);
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState({
    time: '24h',
    camera_id: '',
    sort: 'desc',
    min_violations: 1,
  });

  useEffect(() => {
    api.listCameras().then(setCameras).catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    const params = {};
    const ms = TIME_RANGE_MS[filters.time];
    if (ms) params.from = new Date(Date.now() - ms).toISOString();
    if (filters.camera_id) params.camera_id = filters.camera_id;
    if (filters.sort) params.sort = filters.sort;
    if (filters.min_violations > 1) params.min_violations = filters.min_violations;

    try {
      // Invalidate cache so we get fresh data
      invalidateCache(`violations:top-offenders:${JSON.stringify(params)}`);
      const result = await api.topOffenders(params);
      setData(result);
    } catch {
      /* silent */
    }
  }, [filters]);

  useEffect(() => {
    setData(null);
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  function set(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-text-base">Top Offenders</h1>
        <span className="text-xs text-text-muted">
          {data ? `${data.total} offender${data.total !== 1 ? 's' : ''}` : ''}
        </span>
      </div>

      {/* Filters */}
      <div className="card px-4 py-2">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-center">
          <select
            className="form-select text-xs py-1"
            value={filters.time}
            onChange={(e) => set('time', e.target.value)}
          >
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>

          <select
            className="form-select text-xs py-1"
            value={filters.camera_id}
            onChange={(e) => set('camera_id', e.target.value)}
          >
            <option value="">All cameras</option>
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <select
            className="form-select text-xs py-1"
            value={filters.sort}
            onChange={(e) => set('sort', e.target.value)}
          >
            <option value="desc">Most violations first</option>
            <option value="asc">Fewest violations first</option>
          </select>

          <div className="flex items-center gap-2">
            <label className="text-[10px] text-text-muted whitespace-nowrap">Min:</label>
            <input
              type="number"
              min="1"
              max="100"
              className="form-select text-xs py-1 w-16"
              value={filters.min_violations}
              onChange={(e) => set('min_violations', Math.max(1, parseInt(e.target.value) || 1))}
            />
          </div>
        </div>
      </div>

      {/* Grid */}
      {data === null ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <OffenderCardSkeleton key={i} />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <div className="card py-16 flex flex-col items-center justify-center gap-3">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-text-subtle">
            <circle cx="12" cy="8" r="4" />
            <path d="M6 21v-2a4 4 0 014-4h4a4 4 0 014 4v2" />
            <line x1="2" y1="2" x2="22" y2="22" />
          </svg>
          <p className="text-sm text-text-subtle">No offenders found for the selected filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {data.items.map((offender, i) => (
            <OffenderCard key={offender.worker_id ?? `t-${offender.track_id}-${offender.camera_id}`} offender={offender} />
          ))}
        </div>
      )}
    </div>
  );
}
