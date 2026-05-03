import StatsCard from '../components/StatsCard.jsx';
import LiveFeed from '../components/LiveFeed.jsx';
import CameraGrid from '../components/CameraGrid.jsx';

export default function Dashboard() {
  return (
    <div className="space-y-4">
      <StatsCard />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LiveFeed />
        <CameraGrid />
      </div>
    </div>
  );
}
