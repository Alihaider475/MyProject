import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

export default function FilterBar({ filters, onChange }) {
  const [cameras, setCameras] = useState([]);

  useEffect(() => {
    api.listCameras().then(setCameras).catch(() => {});
  }, []);

  function set(key, value) {
    onChange((prev) => ({ ...prev, [key]: value }));
  }

  function clearAll() {
    onChange({ time: '24h', camera_id: '', violation_type: '', resolved: '' });
  }

  return (
    <div className="bg-surface-2 border-b border-border-soft px-4 py-2">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-center">
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
