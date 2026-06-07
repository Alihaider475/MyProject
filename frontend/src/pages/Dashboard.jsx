import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, invalidateCache } from '../api/client.js';
import StatsCard from '../components/StatsCard.jsx';
import LiveFeed from '../components/LiveFeed.jsx';
import CameraGrid from '../components/CameraGrid.jsx';

function formatActivityTime(iso) {
  if (!iso) return 'Unknown time';
  const raw = iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getStatusMeta(value, positiveLabel = 'Online', negativeLabel = 'Offline') {
  if (value === true) return { label: positiveLabel, className: 'health-pill health-pill-ok' };
  if (value === false) return { label: negativeLabel, className: 'health-pill health-pill-bad' };
  return { label: 'Unknown', className: 'health-pill health-pill-unknown' };
}

function SystemHealthStrip({ summary, loading, error }) {
  const totalCameras = summary?.cameras?.length;
  const activeCameras = summary?.active_cameras ?? summary?.health?.cameras_active;
  const dbKnown = Boolean(summary) && !summary.errors?.violation_counts && !summary.errors?.recent_violations && !summary.errors?.cameras;
  const backendState = loading || !summary || error ? null : summary.health?.status === 'ok';
  const backend = getStatusMeta(backendState, 'Online', 'Offline');
  const model = getStatusMeta(
    typeof summary?.health?.model_loaded === 'boolean' ? summary.health.model_loaded : null,
    'Loaded',
    'Not loaded'
  );
  const databaseState = loading || !summary || error ? null : dbKnown;
  const database = databaseState === true
    ? { label: 'Connected', className: 'health-pill health-pill-ok' }
    : { label: 'Unknown', className: 'health-pill health-pill-unknown' };
  const cameras = loading || activeCameras == null
    ? { label: 'Unknown', className: 'health-pill health-pill-unknown' }
    : {
        label: totalCameras == null ? `${activeCameras} active` : `${activeCameras} / ${totalCameras} active`,
        className: activeCameras > 0 ? 'health-pill health-pill-ok' : 'health-pill health-pill-unknown',
      };

  const items = [
    ['Backend Online', backend],
    ['Model Loaded', model],
    ['Database Connected', database],
    ['Cameras Active', cameras],
  ];

  return (
    <section className="dashboard-panel p-3">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
        {items.map(([label, state]) => (
          <div key={label} className="flex items-center justify-between gap-3 rounded-lg border border-border-soft bg-surface-2/50 px-3 py-2">
            <span className="text-xs font-medium text-text-muted">{label}</span>
            <span className={state.className}>{state.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function activityStatus(v) {
  if (v.is_false_positive) return { label: 'False positive', className: 'bg-surface-3 text-text-muted border-border-soft' };
  if (v.is_resolved) return { label: 'Resolved', className: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' };
  return { label: 'Open', className: 'bg-red-500/10 text-red-300 border-red-500/30' };
}

function RecentActivity({ violations, camerasById, loading, error }) {
  const items = (violations ?? []).slice(0, 5);

  return (
    <section className="dashboard-panel flex min-h-[240px] flex-col">
      <div className="dashboard-panel-header">
        <div>
          <h2 className="text-sm font-semibold text-text-base">Recent Activity</h2>
          <p className="text-xs text-text-muted">Latest PPE violation records</p>
        </div>
        <span className="text-xs text-text-subtle">{items.length} latest</span>
      </div>

      <div className="flex-1 p-4">
        {loading && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-lg border border-border-soft bg-surface-2/40 p-3">
                <div className="skel-line h-4 w-32 mb-2" />
                <div className="skel-line h-3 w-48" />
              </div>
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="dashboard-empty">
            <p className="font-semibold text-text-base">Activity unavailable</p>
            <p>Recent violations could not be loaded. Check the API connection and try again.</p>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="dashboard-empty">
            <p className="font-semibold text-text-base">No recent activity</p>
            <p>Violation records will appear here as cameras detect PPE issues.</p>
          </div>
        )}

        {!loading && !error && items.length > 0 && (
          <div className="space-y-2">
            {items.map((v) => {
              const status = activityStatus(v);
              const cameraName = camerasById.get(String(v.camera_id))?.name ?? `Camera ${v.camera_id}`;
              return (
                <div key={v.id} className="activity-row">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-text-base">{v.violation_type}</span>
                      <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${status.className}`}>
                        {status.label}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-text-muted">{cameraName}</p>
                  </div>
                  <span className="shrink-0 text-right text-xs text-text-subtle">{formatActivityTime(v.timestamp)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshSummary = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      invalidateCache('dashboard:summary');
      const data = await api.fetchDashboardSummary();
      setSummary(data);
      setError('');
    } catch (err) {
      setError(err.message || 'Unable to load dashboard data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSummary();
    const interval = setInterval(() => refreshSummary({ silent: true }), 5000);
    const onViolationSaved = () => refreshSummary({ silent: true });
    window.addEventListener('ppe:violation_saved', onViolationSaved);
    return () => {
      clearInterval(interval);
      window.removeEventListener('ppe:violation_saved', onViolationSaved);
    };
  }, [refreshSummary]);

  const camerasById = useMemo(() => {
    return new Map((summary?.cameras ?? []).map((camera) => [String(camera.id), camera]));
  }, [summary?.cameras]);

  return (
    <div
      className="relative min-h-[calc(100vh-4rem)] space-y-5"
      style={{
        backgroundImage: 'radial-gradient(circle, rgba(148,163,184,0.13) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    >
      <header className="animate-fade-in-up flex flex-col gap-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-brand">SafeSite Command Center</p>
            <h1 className="mt-1 text-2xl font-bold tracking-normal text-text-base sm:text-3xl">Dashboard</h1>
            <p className="mt-1 text-sm text-text-muted">
              Monitor live PPE detection, camera status, and violation activity.
            </p>
          </div>
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}
        </div>
      </header>

      <div className="animate-fade-in-up" style={{ animationDelay: '50ms' }}>
        <StatsCard summary={summary} loading={loading} error={error} />
      </div>

      <div className="animate-fade-in-up" style={{ animationDelay: '100ms' }}>
        <SystemHealthStrip summary={summary} loading={loading} error={error} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.75fr)]">
        <div className="animate-fade-in-up" style={{ animationDelay: '150ms' }}>
          <LiveFeed onCameraChange={() => refreshSummary({ silent: true })} />
        </div>
        <div className="animate-fade-in-up space-y-4" style={{ animationDelay: '200ms' }}>
          <CameraGrid onCameraChange={() => refreshSummary({ silent: true })} />
          <RecentActivity
            violations={summary?.recent_violations}
            camerasById={camerasById}
            loading={loading}
            error={error}
          />
        </div>
      </div>
    </div>
  );
}
