import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { useSearchParams } from 'react-router-dom';
import FilterBar from '../components/FilterBar.jsx';
import ViolationsTable from '../components/ViolationsTable.jsx';
import { initFilters } from '../features/violations/violationsSlice.js';

export default function ViolationsPage() {
  const dispatch = useDispatch();
  const [searchParams] = useSearchParams();

  // Seed filters from the URL once on mount (e.g. links from OffenderCard with
  // ?worker_id= or ?track_id=&camera_id=).
  useEffect(() => {
    dispatch(initFilters({
      time: searchParams.get('time') || '7d',
      camera_id: searchParams.get('camera_id') || '',
      track_id: searchParams.get('track_id') || '',
      worker_id: searchParams.get('worker_id') || '',
    }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="card">
      <div className="card-header">
        <span className="font-semibold">Recent Violations</span>
        <a href="/api/v1/violations/export"
           className="btn-outline text-xs px-2 py-1">
          Export CSV
        </a>
      </div>
      <FilterBar />
      <ViolationsTable />
    </div>
  );
}
