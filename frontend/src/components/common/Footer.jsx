import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="w-full px-4 py-4 border-t border-border-soft text-center text-xs text-text-muted">
      <span>© 2026 SafeSite AI. All rights reserved.</span>
      <span className="mx-2">·</span>
      <Link to="/privacy" className="hover:text-text-base transition-colors">
        Privacy
      </Link>
      <span className="mx-2">·</span>
      <Link to="/terms" className="hover:text-text-base transition-colors">
        Terms
      </Link>
    </footer>
  );
}
