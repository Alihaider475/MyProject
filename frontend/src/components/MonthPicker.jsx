import { useEffect, useMemo, useRef, useState } from 'react';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const FULL_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Parse a "YYYY-MM" value into { year, month } (month is 0-indexed).
function parseValue(value) {
  const [y, m] = (value || '').split('-');
  const year = Number(y);
  const month = Number(m) - 1;
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 0 || month > 11) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  }
  return { year, month };
}

function formatValue(year, month) {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * Click-to-select month picker. Value is a "YYYY-MM" string, matching the
 * native <input type="month"> contract so callers don't need to change.
 */
export default function MonthPicker({ value, onChange, className = '' }) {
  const { year: selYear, month: selMonth } = useMemo(() => parseValue(value), [value]);

  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(selYear);
  const containerRef = useRef(null);

  // Keep the visible year in sync whenever the popover opens.
  useEffect(() => {
    if (open) setViewYear(selYear);
  }, [open, selYear]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function handlePointer(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    function handleKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  function selectMonth(monthIdx) {
    onChange(formatValue(viewYear, monthIdx));
    setOpen(false);
  }

  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth();

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border-soft bg-surface-1 text-text-base text-xs focus:outline-none focus:ring-1 focus:ring-brand hover:bg-surface-2/60 transition-colors"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="text-text-muted">
          <rect x="2" y="3" width="12" height="11" rx="1.5" />
          <line x1="2" y1="6.5" x2="14" y2="6.5" />
          <line x1="5.5" y1="1.5" x2="5.5" y2="4" />
          <line x1="10.5" y1="1.5" x2="10.5" y2="4" />
        </svg>
        <span className="tabular-nums">{FULL_MONTHS[selMonth]} {selYear}</span>
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted">
          <path d="M3 4.5 6 7.5 9 4.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-60 rounded-xl border border-border-soft bg-surface-1 shadow-2xl p-3">
          {/* Year navigation */}
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => setViewYear((y) => y - 1)}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-text-base hover:bg-surface-2 transition-colors"
              aria-label="Previous year"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7.5 3 4.5 6 7.5 9" />
              </svg>
            </button>
            <span className="text-xs font-semibold text-text-base tabular-nums">{viewYear}</span>
            <button
              type="button"
              onClick={() => setViewYear((y) => y + 1)}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-text-muted hover:text-text-base hover:bg-surface-2 transition-colors"
              aria-label="Next year"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4.5 3 7.5 6 4.5 9" />
              </svg>
            </button>
          </div>

          {/* Month grid */}
          <div className="grid grid-cols-3 gap-1.5">
            {MONTHS.map((m, idx) => {
              const isSelected = idx === selMonth && viewYear === selYear;
              const isCurrent = idx === curMonth && viewYear === curYear;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => selectMonth(idx)}
                  className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    isSelected
                      ? 'bg-brand text-white'
                      : isCurrent
                        ? 'bg-brand/10 text-brand border border-brand/30'
                        : 'text-text-muted hover:bg-surface-2 hover:text-text-base'
                  }`}
                >
                  {m}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
