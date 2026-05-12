import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import SnapshotModal from './SnapshotModal.jsx';

const VIOLATION_BADGES = {
  'NO-Hardhat':     'badge-hardhat',
  'NO-Mask':        'badge-mask',
  'NO-Safety Vest': 'badge-vest',
};

const TIME_RANGE_MS = {
  '24h': 24 * 3600_000,
  '7d':  7  * 86400_000,
  '30d': 30 * 86400_000,
  'all': null,
};

function formatDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString();
}

function buildParams(filters) {
  const params = { page_size: 50 };
  const ms = TIME_RANGE_MS[filters.time];
  if (ms) params.from = new Date(Date.now() - ms).toISOString();
  if (filters.camera_id) params.camera_id = filters.camera_id;
  if (filters.violation_type) params.violation_type = filters.violation_type;
  if (filters.resolved === 'open') params.is_resolved = false;
  if (filters.resolved === 'resolved') params.is_resolved = true;
  return params;
}

export default function ViolationsTable({ filters }) {
  const { showToast } = useToast();
  const [items, setItems] = useState(null);
  const [selected, setSelected] = useState(null);
  const lastSeenIdRef = useRef(0);
  const firstLoadRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api.listViolations(buildParams(filters));
      setItems((prev) => {
        // New violation toast notifications
        if (firstLoadRef.current && data.items.length > 0) {
          const fresh = data.items.filter((v) => v.id > lastSeenIdRef.current);
          fresh.slice(0, 3).forEach((v) => {
            showToast({
              title: `${v.violation_type} detected`,
              message: `Camera ${v.camera_id} · ${(v.confidence * 100).toFixed(0)}% confidence`,
              level: 'danger',
              duration: 7000,
            });
          });
          if (fresh.length > 3) {
            showToast({ title: `${fresh.length - 3} more violations`, level: 'warning', duration: 5000 });
          }
        }
        if (data.items.length > 0) lastSeenIdRef.current = data.items[0].id;
        firstLoadRef.current = true;
        return data.items;
      });
    } catch { /* silent */ }
  }, [filters, showToast]);

  useEffect(() => {
    firstLoadRef.current = false;
    setItems(null);
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  function handleUpdate(updated) {
    setItems((prev) => prev?.map((v) => (v.id === updated.id ? updated : v)));
    setSelected(updated);
  }

  async function handleQuickResolve(e, v) {
    e.stopPropagation();
    try {
      const updated = await api.resolveViolation(v.id);
      handleUpdate(updated);
      showToast({ title: 'Resolved', message: `Violation #${v.id}`, level: 'success', duration: 3000 });
    } catch (err) {
      showToast({ title: 'Failed to resolve', message: err.message, level: 'danger' });
    }
  }

  return (
    <>
      <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 680 }}>
        <table className="w-full min-w-[600px] text-xs">
          <thead className="sticky top-0 bg-surface-1 z-10">
            <tr className="border-b border-border-soft">
              <th className="px-3 py-2 text-left uppercase tracking-wider text-text-muted font-semibold">Time</th>
              <th className="px-3 py-2 text-left uppercase tracking-wider text-text-muted font-semibold">Camera</th>
              <th className="px-3 py-2 text-left uppercase tracking-wider text-text-muted font-semibold">Type</th>
              <th className="px-3 py-2 text-left uppercase tracking-wider text-text-muted font-semibold">Conf</th>
              <th className="px-3 py-2 text-center uppercase tracking-wider text-text-muted font-semibold">Status</th>
              <th className="px-3 py-2 text-left uppercase tracking-wider text-text-muted font-semibold">Fine</th>
              <th className="px-1 py-2 w-12"></th>
              <th className="px-3 py-2 text-right uppercase tracking-wider text-text-muted font-semibold w-28">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items === null ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-border-soft">
                  {Array.from({ length: 8 }).map((__, j) => (
                    <td key={j} className="px-3 py-2"><span className="skel-line" /></td>
                  ))}
                </tr>
              ))
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-text-subtle text-xs">
                  No violations matching your filters.
                </td>
              </tr>
            ) : items.map((v) => {
              const badgeCls = VIOLATION_BADGES[v.violation_type] || 'badge-default';
              const statusIcon = v.is_false_positive
                ? '🚩'
                : v.is_resolved ? '✅' : '🟡';
              return (
                <tr
                  key={v.id}
                  className={`group violation-row border-b border-border-soft cursor-pointer transition-colors duration-100 hover:bg-cyan-500/5 ${v.is_false_positive ? 'opacity-50' : ''}`}
                  onClick={() => setSelected(v)}
                >
                  <td className="px-3 py-2 text-nowrap text-text-muted">{formatDateTime(v.timestamp)}</td>
                  <td className="px-3 py-2">📹 {v.camera_id}</td>
                  <td className="px-3 py-2"><span className={badgeCls}>{v.violation_type}</span></td>
                  <td className="px-3 py-2 tabular-nums">{(v.confidence * 100).toFixed(0)}%</td>
                  <td className="px-3 py-2 text-center">{statusIcon}</td>
                  <td className="px-3 py-2">
                    {v.worker_id != null && v.fine_amount != null && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-400/10 text-amber-400 border border-amber-400/30">
                        PKR {v.fine_amount}
                      </span>
                    )}
                  </td>
                  <td className="px-1 py-1 w-12">
                    {v.frame_url && (
                      <img
                        src={v.frame_url}
                        alt=""
                        className="w-11 h-7 object-cover rounded border border-border-soft opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                      />
                    )}
                  </td>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      <button
                        className="text-[10px] px-2 py-0.5 rounded bg-surface-3 text-text-muted hover:text-brand hover:bg-brand/10 transition-colors border border-border-soft"
                        onClick={() => setSelected(v)}
                      >
                        View
                      </button>
                      {v.worker_id != null && (
                        <button
                          className="text-[10px] px-2 py-0.5 rounded bg-surface-3 text-text-muted hover:text-amber-400 hover:bg-amber-500/10 transition-colors border border-border-soft"
                          onClick={() => window.open(api.violationChallanUrl(v.id), '_blank')}
                        >
                          Challan
                        </button>
                      )}
                      {!v.is_resolved && !v.is_false_positive && (
                        <button
                          className="text-[10px] px-2 py-0.5 rounded bg-surface-3 text-text-muted hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors border border-border-soft"
                          onClick={(e) => handleQuickResolve(e, v)}
                        >
                          Resolve
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected && (
        <SnapshotModal
          violation={selected}
          onClose={() => setSelected(null)}
          onUpdate={handleUpdate}
        />
      )}
    </>
  );
}
