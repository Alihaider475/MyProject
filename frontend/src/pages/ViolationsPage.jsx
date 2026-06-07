import FilterBar from '../components/FilterBar.jsx';
import ViolationsTable from '../components/ViolationsTable.jsx';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

const SUMMARY_CARDS = [
  { key: 'total', label: 'Total Violations', tone: 'border-cyan-400/50' },
  { key: 'unassigned', label: 'Unassigned Violations', tone: 'border-violet-400/50' },
  { key: 'pendingFines', label: 'Pending Fines', tone: 'border-amber-400/50' },
  { key: 'resolved', label: 'Resolved Violations', tone: 'border-emerald-400/50' },
];

function getSummary(items = []) {
  return {
    total: items.length,
    unassigned: items.filter((v) => v.worker_id == null && !v.is_false_positive).length,
    pendingFines: items.filter((v) => v.fine_amount != null && !v.is_resolved && !v.is_false_positive).length,
    resolved: items.filter((v) => v.is_resolved && !v.is_false_positive).length,
  };
}

function SummaryCards({ items, loading }) {
  const summary = getSummary(items);

  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 px-4 sm:px-5 py-4 border-b border-border-soft bg-surface-1">
      {SUMMARY_CARDS.map((card) => (
        <div
          key={card.key}
          className={`rounded-lg border ${card.tone} bg-surface-2/60 px-4 py-3 shadow-sm`}
        >
          <p className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
            {card.label}
          </p>
          {loading ? (
            <span className="skel-line mt-3 h-7 w-16" />
          ) : (
            <p className="mt-2 text-2xl font-semibold leading-none text-text-base tabular-nums">
              {summary[card.key]}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

export default function ViolationsPage() {
  const [searchParams] = useSearchParams();
  const [visibleViolations, setVisibleViolations] = useState([]);
  const [isLoadingViolations, setIsLoadingViolations] = useState(true);
  const [filters, setFilters] = useState({
    search: '',
    time: searchParams.get('time') || '24h',
    camera_id: searchParams.get('camera_id') || '',
    violation_type: '',
    resolved: '',
    track_id: searchParams.get('track_id') || '',
    worker_id: searchParams.get('worker_id') || '',
  });

  return (
    <div className="card">
      <div className="flex flex-col gap-4 border-b border-border-soft bg-surface-2 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-text-base">Violation History</h1>
          <p className="mt-1 text-sm text-text-muted">
            Review detected PPE violations, assign workers, and manage fine status.
          </p>
        </div>
        <a href="/api/v1/violations/export"
           className="btn-brand inline-flex min-h-10 items-center justify-center px-4 py-2 text-xs">
          Export CSV
        </a>
      </div>
      <SummaryCards items={visibleViolations} loading={isLoadingViolations} />
      <FilterBar filters={filters} onChange={setFilters} />
      <ViolationsTable
        filters={filters}
        onVisibleItemsChange={setVisibleViolations}
        onLoadingChange={setIsLoadingViolations}
      />
    </div>
  );
}
