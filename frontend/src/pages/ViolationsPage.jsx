import FilterBar from '../components/FilterBar.jsx';
import ViolationsTable from '../components/ViolationsTable.jsx';
import { useState } from 'react';

export default function ViolationsPage() {
  const [filters, setFilters] = useState({
    time: '24h',
    camera_id: '',
    violation_type: '',
    resolved: '',
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
