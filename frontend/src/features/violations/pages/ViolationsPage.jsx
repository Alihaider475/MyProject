import FilterBar from '../components/FilterBar.jsx';
import ViolationsTable from '../components/ViolationsTable.jsx';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export default function ViolationsPage() {
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState({
    time: searchParams.get('time') || '24h',
    camera_id: searchParams.get('camera_id') || '',
    violation_type: '',
    resolved: '',
    track_id: searchParams.get('track_id') || '',
    worker_id: searchParams.get('worker_id') || '',
  });

  return (
    <div className="card">
      <div className="card-header">
        <span className="font-semibold">Recent Violations</span>
        <a href="/api/v1/violations/export"
           className="btn-outline text-xs px-2 py-1">
          Export CSV
        </a>
      </div>
      <FilterBar filters={filters} onChange={setFilters} />
      <ViolationsTable filters={filters} />
    </div>
  );
}
