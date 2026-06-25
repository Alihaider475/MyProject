import { useNavigate } from 'react-router-dom';

const VIOLATION_BADGES = {
  'NO-Hardhat':     'badge-hardhat',
  'NO-Mask':        'badge-mask',
  'NO-Safety Vest': 'badge-vest',
};

function timeAgo(iso) {
  if (!iso) return '';
  const raw = iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z';
  const diff = Date.now() - new Date(raw).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function OffenderCardSkeleton() {
  return (
    <div className="card p-4 space-y-3 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-lg bg-surface-3 skel-shimmer" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-32 rounded bg-surface-3 skel-shimmer" />
          <div className="h-3 w-20 rounded bg-surface-3 skel-shimmer" />
        </div>
      </div>
      <div className="flex gap-2">
        <div className="h-5 w-24 rounded bg-surface-3 skel-shimmer" />
        <div className="h-5 w-20 rounded bg-surface-3 skel-shimmer" />
      </div>
      <div className="h-3 w-40 rounded bg-surface-3 skel-shimmer" />
    </div>
  );
}

export default function OffenderCard({ offender }) {
  const navigate = useNavigate();

  function handleClick() {
    if (offender.worker_id) {
      navigate(`/violations?worker_id=${offender.worker_id}`);
    } else if (offender.track_id != null) {
      navigate(`/violations?track_id=${offender.track_id}&camera_id=${offender.camera_id}`);
    }
  }

  return (
    <div
      className="card p-4 cursor-pointer transition-all duration-200 hover:shadow-lg hover:shadow-black/10 hover:border-brand/30 hover:-translate-y-0.5"
      onClick={handleClick}
    >
      {/* Header: thumbnail + name + count */}
      <div className="flex items-center gap-3 mb-3">
        {offender.latest_frame_url ? (
          <img
            src={offender.latest_frame_url}
            alt=""
            className="w-12 h-12 rounded-lg object-cover border border-border-soft flex-shrink-0"
          />
        ) : (
          <div className="w-12 h-12 rounded-lg bg-surface-3 border border-border-soft flex items-center justify-center text-text-subtle text-lg flex-shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="8" r="4" />
              <path d="M6 21v-2a4 4 0 014-4h4a4 4 0 014 4v2" />
            </svg>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-text-base truncate">{offender.display_name}</h3>
          {offender.camera_id && !offender.worker_id && (
            <p className="text-[10px] text-text-subtle">Camera {offender.camera_id}</p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <span className="text-xl font-bold text-accent-red">{offender.total_violations}</span>
          <p className="text-[10px] text-text-subtle">violations</p>
        </div>
      </div>

      {/* Violation type badges */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {offender.violation_types.map((vt) => (
          <span key={vt.violation_type} className={`${VIOLATION_BADGES[vt.violation_type] || 'badge-default'} text-[10px]`}>
            {vt.violation_type} &times;{vt.count}
          </span>
        ))}
      </div>

      {/* Footer: cameras + timestamps */}
      <div className="flex items-center justify-between text-[10px] text-text-muted">
        <span>
          {offender.cameras_seen.length > 0
            ? `Camera${offender.cameras_seen.length > 1 ? 's' : ''}: ${offender.cameras_seen.join(', ')}`
            : ''}
        </span>
        <span>
          First: {timeAgo(offender.first_seen)} | Last: {timeAgo(offender.last_seen)}
        </span>
      </div>
    </div>
  );
}
