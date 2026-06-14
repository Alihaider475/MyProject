import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';

const CHANNELS = [
  {
    key: 'email',
    name: 'Email Alerts',
    description: 'Sends violation and challan alerts to the configured receiver email.',
    enabledField: 'email_alerts_enabled',
    configuredField: 'smtp_configured',
    configuredLabel: 'SMTP',
    toggle: (enabled) => api.toggleEmailAlerts(enabled),
  },
  {
    key: 'mqtt',
    name: 'MQTT Alerts',
    description: 'Publishes violation and fine events to the configured MQTT topic.',
    enabledField: 'mqtt_enabled',
    configuredField: 'mqtt_configured',
    configuredLabel: 'MQTT',
    toggle: (enabled) => api.toggleMqttAlerts(enabled),
  },
  {
    key: 'webhook',
    name: 'Webhook Alerts',
    description: 'Posts violation and fine payloads to the configured webhook endpoint.',
    enabledField: 'webhook_enabled',
    configuredField: 'webhook_configured',
    configuredLabel: 'Webhook',
    toggle: (enabled) => api.toggleWebhookAlerts(enabled),
  },
];

export default function SettingsPage() {
  const { showToast } = useToast();
  const [settings, setSettings] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [savingKey, setSavingKey] = useState(null);

  async function loadSettings() {
    setLoadError(false);
    try {
      const s = await api.getSettings();
      setSettings(s);
    } catch {
      setLoadError(true);
      showToast({ title: 'Failed to load settings', level: 'danger' });
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  async function handleToggle(channel) {
    const next = !settings[channel.enabledField];
    setSavingKey(channel.key);
    try {
      const s = await channel.toggle(next);
      setSettings(s);
      showToast({
        title: `${channel.name} ${s[channel.enabledField] ? 'enabled' : 'disabled'}`,
        level: s[channel.enabledField] ? 'success' : 'warning',
        duration: 3000,
      });
    } catch (err) {
      showToast({ title: `Failed to update ${channel.name}`, message: err.message, level: 'danger' });
      // Refetch so the UI reverts to the server's actual state
      loadSettings();
    } finally {
      setSavingKey(null);
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
          {loadError && settings === null ? (
            <div className="py-6 text-center space-y-3">
              <p className="text-sm text-text-muted">Could not load alert settings.</p>
              <button onClick={loadSettings} className="btn-outline text-xs px-3 py-1.5">
                Retry
              </button>
            </div>
          ) : (
            CHANNELS.map((channel) => {
              const loading = settings === null;
              const enabled = settings?.[channel.enabledField];
              const configured = settings?.[channel.configuredField];
              const saving = savingKey === channel.key;
              const isDisabled = saving || !configured;
              return (
                <div
                  key={channel.key}
                  className={`flex items-center justify-between gap-4 py-3 px-4 rounded-lg bg-surface-2 border transition-colors ${
                    !loading && !configured ? 'border-border-soft opacity-70' : 'border-border-soft'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-text-base">{channel.name}</p>
                      {!loading && (
                        <span className={configured ? 'badge-running' : 'badge-default'}>
                          {channel.configuredLabel} {configured ? 'configured' : 'not configured'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-text-muted mt-0.5">{channel.description}</p>
                    {!loading && !configured && (
                      <p className="text-xs text-accent-yellow mt-1">
                        Configure {channel.configuredLabel} in <code className="font-mono bg-surface-3 px-1 rounded">.env</code> to enable this channel.
                      </p>
                    )}
                  </div>
                  {loading ? (
                    <span className="skel-line w-12 h-6 shrink-0" />
                  ) : (
                    <button
                      onClick={() => !isDisabled && handleToggle(channel)}
                      disabled={isDisabled}
                      title={!configured ? `${channel.configuredLabel} is not configured` : undefined}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-brand/50 ${
                        enabled && configured ? 'bg-brand' : 'bg-surface-3 border border-border-soft'
                      } ${isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <span
                        className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                          enabled && configured ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  )}
                </div>
              );
            })
          )}

          <p className="text-[11px] text-text-subtle px-1">
            Changes are saved and remain active after backend restart.
          </p>
        </div>
      </div>
    </div>
  );
}
