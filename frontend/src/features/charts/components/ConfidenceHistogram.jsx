import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

const TOOLTIP_STYLE = {
  backgroundColor: '#111218',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8,
  color: '#f8fafc',
  fontSize: 12,
  padding: '8px 12px',
};

function binColor(bin) {
  const low = bin.startsWith('<') ? 0 : parseFloat(bin.split('-')[0]);
  if (low < 0.6) return '#ef4444';
  if (low < 0.8) return '#f59e0b';
  return '#22c55e';
}

export default function ConfidenceHistogram({ data, meanConfidence }) {
  const bins = data || [];
  const hasData = bins.some((d) => d.count > 0);

  return (
    <div className="card">
      <div className="card-header">
        <span className="font-medium text-text-base">📊 Detection confidence distribution</span>
        {hasData && (
          <span className="text-xs text-text-muted">
            Mean: <span className="font-semibold text-text-base">{(meanConfidence * 100).toFixed(1)}%</span>
          </span>
        )}
      </div>
      <div className="p-4" style={{ height: 220 }}>
        {!hasData ? (
          <div className="flex items-center justify-center h-full text-text-subtle text-xs">
            No data
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bins} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <XAxis
                dataKey="bin"
                tick={{ fill: '#64748b', fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                angle={-30}
                textAnchor="end"
                height={40}
              />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                width={28}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v} detections`, 'Count']} />
              <Bar dataKey="count" radius={[3, 3, 0, 0]} animationDuration={900}>
                {bins.map((entry) => (
                  <Cell key={entry.bin} fill={binColor(entry.bin)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {hasData && meanConfidence < 0.65 && (
        <div className="px-4 pb-4">
          <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-amber-400 text-xs">
            <span>⚠️</span>
            <span>
              Mean confidence is <strong>{(meanConfidence * 100).toFixed(1)}%</strong> — detections are
              clustering near the decision boundary. Consider reviewing camera lighting/angle or the
              detection confidence threshold.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
