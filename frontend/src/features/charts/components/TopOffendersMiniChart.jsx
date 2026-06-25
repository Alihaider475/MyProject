import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import { api } from '../../../api/client.js';

const TOOLTIP_STYLE = {
  backgroundColor: '#111218',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8,
  color: '#f8fafc',
  fontSize: 12,
  padding: '8px 12px',
};

export default function TopOffendersMiniChart({ from }) {
  const { data, isLoading } = useQuery({
    queryKey: ['topOffendersMini', from],
    queryFn: () => api.topOffenders({ from, limit: 5 }),
    staleTime: 15000,
    gcTime: 300000,
  });

  const items = (data?.items || []).map((it) => ({
    name: it.display_name,
    count: it.total_violations,
  }));

  return (
    <div className="card">
      <div className="card-header">
        <span className="font-medium text-text-base">🏷️ Top offenders</span>
        <Link to="/top-offenders" className="text-xs text-brand hover:underline">
          View all →
        </Link>
      </div>
      <div className="p-4" style={{ height: 200 }}>
        {isLoading ? (
          <div className="skel-box w-full h-full" />
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-subtle text-xs">
            No data
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={items} layout="vertical" margin={{ top: 0, right: 50, left: 10, bottom: 0 }}>
              <XAxis
                type="number"
                tick={{ fill: '#64748b', fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <YAxis
                dataKey="name"
                type="category"
                tick={{ fill: '#cbd5e1', fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={90}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v} violations`, 'Total']} />
              <Bar dataKey="count" fill="#ef4444" radius={[0, 4, 4, 0]} animationDuration={900}>
                <LabelList
                  dataKey="count"
                  position="right"
                  style={{ fill: '#94a3b8', fontSize: 11, fontWeight: 500 }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
