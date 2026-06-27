import { useEffect } from 'react';

/** Calls onEscape when the user presses Escape while active is true. Used to
 * close modals/dropdowns/panels without disturbing their existing backdrop-click logic. */
export function useEscapeKey(onEscape, active = true) {
  useEffect(() => {
    if (!active) return;
    function handleKeyDown(e) {
      if (e.key === 'Escape') onEscape();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onEscape, active]);
}
