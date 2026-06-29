import { memo } from 'react';

const CountTile = memo(function CountTile({ icon, label, value }) {
  return (
    <div className="stat-tile">
      <div className="text-brand text-xl mb-1">{icon}</div>
      <div className="text-xs uppercase tracking-widest text-text-muted mb-0.5">{label}</div>
      <div className="text-2xl font-bold tabular-nums text-text-base leading-none">
        {value ?? '—'}
      </div>
    </div>
  );
});

const DetectionCounts = memo(function DetectionCounts({ counts }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 p-3 border-t border-border-soft">
      <CountTile icon="⛑️" label="Hardhats" value={counts?.hardhat_count} />
      <CountTile icon="😷" label="Masks" value={counts?.mask_count} />
      <CountTile icon="🦺" label="Safety Vests" value={counts?.vest_count} />
      <CountTile icon="👥" label="People" value={counts?.person_count} />
      <CountTile icon="⚠️" label="Violations" value={counts?.violation_count} />
    </div>
  );
});

export default DetectionCounts;
