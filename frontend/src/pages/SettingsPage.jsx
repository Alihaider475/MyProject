import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';

export default function SettingsPage() {
  const { showToast } = useToast();
  const [emailEnabled, setEmailEnabled] = useState(null);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    api.getSettings()
      .then((s) => setEmailEnabled(s.email_alerts_enabled))
      .catch(() => showToast({ title: 'Failed to load settings', level: 'danger' }));
  }, []);

  async function handleToggle() {
    const next = !emailEnabled;
    setToggling(true);
    try {
      const s = await api.toggleEmailAlerts(next);
      setEmailEnabled(s.email_alerts_enabled);
      showToast({
        title: `Email alerts ${s.email_alerts_enabled ? 'enabled' : 'disabled'}`,
        level: s.email_alerts_enabled ? 'success' : 'warning',
        duration: 3000,
      });
    } catch (err) {
      showToast({ title: 'Failed to update', message: err.message, level: 'danger' });
    } finally {
      setToggling(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-lg font-semibold mb-4">Settings</h1>

      <div className="card">
        <div className="card-header">
          <span className="font-semibold text-sm">Alert Configuration</span>
        </div>
        <div className="p-4 space-y-4">
          {/* Email alerts toggle */}
          <div className="flex items-center justify-between py-3 px-4 rounded-lg bg-surface-2 border border-border-soft">
            <div>
              <p className="text-sm font-medium text-text-base">Email Alerts</p>
              <p className="text-xs text-text-muted mt-0.5">
                Send email notifications when violations are detected.
                Disable during testing to avoid inbox flooding.
              </p>
            </div>
            {emailEnabled === null ? (
              <span className="skel-line w-12 h-6" />
            ) : (
              <button
                onClick={handleToggle}
                disabled={toggling}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-brand/50 ${
                  emailEnabled ? 'bg-brand' : 'bg-surface-3 border border-border-soft'
                } ${toggling ? 'opacity-50' : 'cursor-pointer'}`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                    emailEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            )}
          </div>

          <p className="text-[11px] text-text-subtle px-1">
            Changes take effect immediately but do not persist across server restarts.
            To permanently disable, set <code className="text-text-muted">EMAIL_ALERTS_ENABLED=false</code> in your <code className="text-text-muted">.env</code> file.
          </p>
        </div>
      </div>
    </div>
  );
}
