import { useEffect, useState } from 'react';
import { api } from '../api/client.js';

export default function HealthBadge() {
  const [state, setState] = useState({ text: 'Connecting…', cls: 'bg-surface-3 text-text-muted' });

  async function refresh() {
    try {
      const h = await api.health();
      if (h.status === 'ok') {
        setState({
          text: `Online · ${h.cameras_active} active`,
          cls: 'bg-green-700 text-white',
          dot: true,
        });
      } else {
        setState({ text: 'Degraded', cls: 'bg-yellow-600 text-white' });
      }
    } catch {
      setState({ text: 'Offline', cls: 'bg-red-700 text-white' });
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000); // 30s — matches backend cache TTL
    return () => clearInterval(t);
  }, []);

  return (
    <span className={`text-xs font-medium px-2.5 py-1 rounded-full flex items-center gap-1 ${state.cls}`}>
      {state.dot && <span className="live-dot" />}
      {state.text}
    </span>
  );
}
