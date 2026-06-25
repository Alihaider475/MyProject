import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../api/client.js';

export default function FilterBar({ filters, onChange }) {
  const [cameras, setCameras] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    api.listCameras().then(setCameras).catch(() => {});
  }, []);

  function set(key, value) {
    onChange((prev) => ({ ...prev, [key]: value }));
  }

  function clearAll() {
    onChange({ time: '24h', camera_id: '', violation_type: '', resolved: '', track_id: '', worker_id: '' });
    navigate('/violations', { replace: true });
  }

  function clearPersonFilter() {
    onChange((prev) => ({ ...prev, track_id: '', worker_id: '' }));
    navigate('/violations', { replace: true });
  }

  const hasPersonFilter = filters.track_id || filters.worker_id;
  const personLabel = filters.worker_id
    ? `Worker #${filters.worker_id}`
    : filters.track_id
      ? `Person #${filters.track_id}${filters.camera_id ? ` on Camera ${filters.camera_id}` : ''}`
      : '';

  return (
    <div className="bg-surface-2 border-b border-border-soft px-4 py-2 space-y-2">
      {hasPersonFilter && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            Showing: {personLabel}
            <button
              onClick={clearPersonFilter}
              className="ml-1 hover:text-white transition-colors"
              aria-label="Clear person filter"
            >
              &times;
            </button>
          </span>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2 items-center">
        <select
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
          value={filters.violation_type}
          onChange={(e) => set('violation_type', e.target.value)}
        >
          <option value="">All types</option>
          <option value="NO-Hardhat">NO-Hardhat</option>
          <option value="NO-Mask">NO-Mask</option>
          <option value="NO-Safety Vest">NO-Safety Vest</option>
        </select>

        <select
          className="form-select text-xs py-1"
          value={filters.resolved}
          onChange={(e) => set('resolved', e.target.value)}
        >
          <option value="">All status</option>
          <option value="open">Open only</option>
          <option value="resolved">Resolved only</option>
        </select>

        <button onClick={clearAll} className="btn-outline text-xs py-1">
          ✕ Clear
        </button>
      </div>
    </div>
  );
}
