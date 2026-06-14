/** Shared violation-type color map. Use everywhere: badges, chips, chart palettes. */
export const VIOLATION_COLORS = {
  'NO-Hardhat':     { badge: 'badge-hardhat', hex: '#ef4444', rgb: '239,68,68'   },  // OSHA danger red
  'NO-Mask':        { badge: 'badge-mask',    hex: '#3b82f6', rgb: '59,130,246'  },  // respiratory safety blue
  'NO-Safety Vest': { badge: 'badge-vest',    hex: '#f97316', rgb: '249,115,22'  },  // OSHA caution orange
  'NO-Gloves':      { badge: 'badge-default', hex: '#a855f7', rgb: '168,85,247'  },
};

export const VIOLATION_FALLBACK_HEX = '#6b7280';

export function violationBadgeClass(type) {
  return VIOLATION_COLORS[type]?.badge ?? 'badge-default';
}

export function violationHex(type) {
  return VIOLATION_COLORS[type]?.hex ?? VIOLATION_FALLBACK_HEX;
}
