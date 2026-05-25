import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';

const VIOLATION_BADGES = {
  'NO-Hardhat':     { badge: 'badge-hardhat' },
  'NO-Mask':        { badge: 'badge-mask' },
  'NO-Safety Vest': { badge: 'badge-vest' },
};

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
function formatRelativeTime(iso) {
  if (!iso) return 'never';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

function downloadImage(src, filename) {
  const a = document.createElement('a');
  a.href = src;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function SnapshotModal({ violation, onClose, onUpdate }) {
  const { showToast } = useToast();
  const v = violation;
  if (!v) return null;

  const meta = VIOLATION_BADGES[v.violation_type] || {};

  async function handleResolve() {
    try {
      const updated = v.is_resolved
        ? await api.unresolveViolation(v.id)
        : await api.resolveViolation(v.id);
      showToast({
        title: updated.is_resolved ? 'Resolved' : 'Reopened',
        message: `Violation #${v.id}`,
        level: 'success',
      });
      onUpdate(updated);
    } catch (err) {
      showToast({ title: 'Action failed', message: err.message, level: 'danger' });
    }
  }

  async function handleFlag() {
    try {
      const updated = v.is_false_positive
        ? await api.unflagFalsePositive(v.id)
        : await api.flagFalsePositive(v.id);
      showToast({
        title: updated.is_false_positive ? 'Flagged as false alarm' : 'Flag removed',
        message: `Violation #${v.id}`,
        level: 'info',
      });
      onUpdate(updated);
    } catch (err) {
      showToast({ title: 'Action failed', message: err.message, level: 'danger' });
    }
  }

  function handleDownload() {
    if (!v.frame_url) return;
    const ts = new Date(v.timestamp).toISOString().replace(/[:.]/g, '-');
    downloadImage(v.frame_url, `violation_${v.id}_camera${v.camera_id}_${ts}.jpg`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)' }} onClick={onClose}>
      <div className="bg-surface-1 border border-border-strong rounded-xl shadow-2xl w-full max-w-2xl mx-2 sm:mx-4" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-soft">
          <h6 className="font-semibold text-sm flex items-center gap-2">
            ⚠️ Violation Details
            <span className="text-text-muted text-xs">#{v.id}</span>
          </h6>
          <button onClick={onClose} className="text-text-muted hover:text-text-base text-lg leading-none">&times;</button>
        </div>

        {/* Body */}
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Frame */}
          <div>
            {v.frame_url ? (
              <img src={v.frame_url} alt="Violation frame"
                   className="w-full rounded-lg object-contain bg-black" style={{ maxHeight: 320 }} />
            ) : (
              <div className="flex flex-col items-center justify-center bg-surface-2 rounded-lg p-8 gap-2 text-text-subtle text-sm" style={{ minHeight: 200 }}>
                🖼️<br />No frame available
              </div>
            )}
          </div>

          {/* Metadata */}
          <dl className="space-y-2 text-sm">
            <div className="flex gap-2">
              <dt className="text-text-muted w-24 shrink-0">Type</dt>
              <dd><span className={meta.badge || 'badge-default'}>{v.violation_type}</span></dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-text-muted w-24 shrink-0">Camera</dt>
              <dd>{v.camera_id}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-text-muted w-24 shrink-0">Confidence</dt>
              <dd className="tabular-nums">{(v.confidence * 100).toFixed(1)}%</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-text-muted w-24 shrink-0">Time</dt>
              <dd>{formatDateTime(v.timestamp)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-text-muted w-24 shrink-0">Relative</dt>
              <dd>{formatRelativeTime(v.timestamp)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-text-muted w-24 shrink-0">Status</dt>
              <dd>
                {v.is_resolved ? (
                  <span className="bg-green-700 text-white text-xs px-2 py-0.5 rounded">Resolved</span>
                ) : (
                  <span className="bg-yellow-600 text-white text-xs px-2 py-0.5 rounded">Open</span>
                )}
              </dd>
            </div>
            {v.worker_name && (
              <div className="flex gap-2">
                <dt className="text-text-muted w-24 shrink-0">Worker</dt>
                <dd className="text-text-base">{v.worker_name}</dd>
              </div>
            )}
            {v.fine_amount != null && (
              <div className="flex gap-2">
                <dt className="text-text-muted w-24 shrink-0">Fine</dt>
                <dd>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-400/10 text-amber-400 border border-amber-400/30">
                    PKR {v.fine_amount}
                  </span>
                </dd>
              </div>
            )}
            {v.track_id != null && (
              <div className="flex gap-2">
                <dt className="text-text-muted w-24 shrink-0">Tracked</dt>
                <dd>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                    Person #{v.track_id}
                  </span>
                </dd>
              </div>
            )}
            {v.is_false_positive && (
              <div className="flex gap-2">
                <dt className="text-text-muted w-24 shrink-0">Feedback</dt>
                <dd><span className="bg-surface-3 text-text-muted text-xs px-2 py-0.5 rounded">False alarm</span></dd>
              </div>
            )}
          </dl>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end flex-wrap gap-2 px-5 py-3 border-t border-border-soft">
          <button onClick={onClose} className="btn-outline text-xs">Close</button>
          <button onClick={handleFlag} className="btn-outline text-xs">
            {v.is_false_positive ? '👍 Unflag' : '👎 False alarm'}
          </button>
          {v.frame_url && (
            <button onClick={handleDownload} className="btn-outline text-xs">⬇ Download</button>
          )}
          <button
            onClick={handleResolve}
            className={v.is_resolved ? 'btn-outline text-xs' : 'btn-success text-xs'}
          >
            {v.is_resolved ? '↩ Reopen' : '✓ Mark Resolved'}
          </button>
        </div>
      </div>
    </div>
  );
}
