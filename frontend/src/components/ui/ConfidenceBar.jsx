export default function ConfidenceBar({ pct, danger }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <span className="inline-flex items-center gap-2">
      <span className="w-16 h-[5px] rounded-full bg-surface-3 overflow-hidden shrink-0">
        <span
          className={`block h-full rounded-full ${danger ? 'bg-red-500' : 'bg-emerald-500'}`}
          style={{ width: `${clamped}%` }}
        />
      </span>
      <span className="tabular-nums text-text-muted">{clamped.toFixed(1)}%</span>
    </span>
  );
}
