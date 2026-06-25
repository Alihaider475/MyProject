import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);

    const message = String(error?.message || error || '');
    const isStaleChunk = /Failed to fetch dynamically imported module|Loading chunk|ChunkLoadError/i.test(message);
    const reloadKey = `ppe-stale-chunk-reloaded:${window.location.pathname}`;

    if (isStaleChunk && sessionStorage.getItem(reloadKey) !== '1') {
      sessionStorage.setItem(reloadKey, '1');
      window.location.reload();
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-surface-0 flex flex-col items-center justify-center gap-4 px-4">
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-text-base mb-2">Something went wrong</h1>
            <p className="text-text-muted text-sm mb-6">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <button
              className="px-4 py-2 bg-brand-500 text-white text-sm rounded hover:bg-brand-600 transition-colors"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
