import StatsCard from '../components/StatsCard.jsx';
import LiveFeed from '../components/LiveFeed.jsx';
import CameraGrid from '../components/CameraGrid.jsx';

export default function Dashboard() {
  return (
    <div
      className="relative space-y-4 min-h-[calc(100vh-4rem)]"
      style={{
        backgroundImage: 'radial-gradient(circle, rgba(148,163,184,0.13) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    >
      <div className="animate-fade-in-up" style={{ animationDelay: '0ms' }}>
        <StatsCard />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4">
        <div className="animate-fade-in-up" style={{ animationDelay: '100ms' }}>
          <LiveFeed />
        </div>
        <div className="animate-fade-in-up" style={{ animationDelay: '200ms' }}>
          <CameraGrid />
        </div>
      </div>
    </div>
  );
}
