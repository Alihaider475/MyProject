import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Toggle({ enabled, onChange, disabled }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-brand/50 ${
        enabled ? 'bg-brand' : 'bg-surface-3 border border-border-soft'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
          enabled ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-text-muted">
        {label}
        {hint && <span className="ml-1 text-text-subtle font-normal">({hint})</span>}
      </label>
      {children}
    </div>
  );
}

function SkelCard() {
  return (
    <div className="bg-surface-1 border border-border-soft rounded-xl p-5 space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <div className="h-4 w-32 bg-surface-3 rounded" />
          <div className="h-3 w-52 bg-surface-3 rounded" />
        </div>
        <div className="h-6 w-11 bg-surface-3 rounded-full" />
      </div>
      {[1, 2, 3].map((i) => (
        <div key={i} className="space-y-1">
          <div className="h-3 w-24 bg-surface-3 rounded" />
          <div className="h-8 w-full bg-surface-3 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

// ─── Card wrapper ─────────────────────────────────────────────────────────────

function ConfigCard({ title, description, enabled, onToggle, toggleDisabled, children, onSave, saving, onTest, testing }) {
  return (
    <div className="bg-surface-1 border border-border-soft rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border-soft flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-text-base">{title}</p>
          <p className="text-xs text-text-muted mt-0.5">{description}</p>
        </div>
        <Toggle enabled={enabled} onChange={onToggle} disabled={toggleDisabled} />
      </div>
      <div className="px-5 py-4 space-y-4">
        {children}
        <div className="flex items-center gap-2 pt-2">
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="btn-primary text-xs px-4 py-1.5 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {onTest && (
            <button
              type="button"
              onClick={onTest}
              disabled={testing || saving}
              className="btn-outline text-xs px-4 py-1.5 disabled:opacity-50"
            >
              {testing ? 'Testing…' : 'Test Alert'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AlertConfigPage() {
  const { showToast } = useToast();

  const [loadError, setLoadError] = useState(false);
  const [serverConfig, setServerConfig] = useState(null);

  // SMTP form
  const [smtp, setSmtp] = useState({
    enabled: false,
    host: 'smtp.gmail.com',
    port: 587,
    sender_email: '',
    receiver_email: '',
    password: '',
    use_tls: true,
  });
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [testingSmtp, setTestingSmtp] = useState(false);

  // MQTT form
  const [mqtt, setMqtt] = useState({
    enabled: false,
    broker: '',
    port: 1883,
    topic: 'ppe/alerts',
    username: '',
    password: '',
  });
  const [savingMqtt, setSavingMqtt] = useState(false);
  const [testingMqtt, setTestingMqtt] = useState(false);

  // Webhook form
  const [webhook, setWebhook] = useState({ enabled: false, url: '' });
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);

  const loadConfig = useCallback(async () => {
    setLoadError(false);
    try {
      const data = await api.getAlertConfig();
      setServerConfig(data);
      setSmtp({
        enabled: data.smtp.enabled,
        host: data.smtp.host,
        port: data.smtp.port,
        sender_email: data.smtp.sender_email,
        receiver_email: data.smtp.receiver_email,
        password: '',
        use_tls: data.smtp.use_tls,
      });
      setMqtt({
        enabled: data.mqtt.enabled,
        broker: data.mqtt.broker,
        port: data.mqtt.port,
        topic: data.mqtt.topic,
        username: data.mqtt.username,
        password: '',
      });
      setWebhook({ enabled: data.webhook.enabled, url: data.webhook.url });
    } catch (err) {
      setLoadError(true);
      showToast({ title: 'Failed to load alert config', message: err.message, level: 'error' });
    }
  }, [showToast]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  // ── Validation helpers ───────────────────────────────────────────────────

  function validateSmtp() {
    if (!smtp.enabled) return null;
    if (!smtp.host.trim()) return 'SMTP host is required';
    if (!smtp.port || smtp.port < 1 || smtp.port > 65535) return 'SMTP port must be 1–65535';
    if (!smtp.sender_email.trim() || !smtp.sender_email.includes('@')) return 'Valid sender email required';
    if (!smtp.receiver_email.trim() || !smtp.receiver_email.includes('@')) return 'Valid receiver email required';
    if (!smtp.password && !serverConfig?.smtp?.password_set) return 'SMTP password is required';
    return null;
  }

  function validateMqtt() {
    if (!mqtt.enabled) return null;
    if (!mqtt.broker.trim()) return 'MQTT broker host is required';
    if (!mqtt.port || mqtt.port < 1 || mqtt.port > 65535) return 'MQTT port must be 1–65535';
    return null;
  }

  function validateWebhook() {
    if (!webhook.enabled) return null;
    if (!webhook.url.trim()) return 'Webhook URL is required';
    if (!webhook.url.startsWith('http://') && !webhook.url.startsWith('https://')) {
      return 'Webhook URL must start with http:// or https://';
    }
    return null;
  }

  // ── Save handlers ────────────────────────────────────────────────────────

  async function saveSmtp() {
    const err = validateSmtp();
    if (err) { showToast({ title: 'Validation Error', message: err, level: 'error' }); return; }
    setSavingSmtp(true);
    try {
      await api.updateAlertConfig('smtp', smtp);
      await loadConfig();
      showToast({ title: 'SMTP settings saved', level: 'success' });
    } catch (err) {
      showToast({ title: 'Failed to save SMTP settings', message: err.message, level: 'error' });
    } finally {
      setSavingSmtp(false);
    }
  }

  async function saveMqtt() {
    const err = validateMqtt();
    if (err) { showToast({ title: 'Validation Error', message: err, level: 'error' }); return; }
    setSavingMqtt(true);
    try {
      await api.updateAlertConfig('mqtt', mqtt);
      await loadConfig();
      showToast({ title: 'MQTT settings saved', level: 'success' });
    } catch (err) {
      showToast({ title: 'Failed to save MQTT settings', message: err.message, level: 'error' });
    } finally {
      setSavingMqtt(false);
    }
  }

  async function saveWebhook() {
    const err = validateWebhook();
    if (err) { showToast({ title: 'Validation Error', message: err, level: 'error' }); return; }
    setSavingWebhook(true);
    try {
      await api.updateAlertConfig('webhook', webhook);
      await loadConfig();
      showToast({ title: 'Webhook settings saved', level: 'success' });
    } catch (err) {
      showToast({ title: 'Failed to save webhook settings', message: err.message, level: 'error' });
    } finally {
      setSavingWebhook(false);
    }
  }

  // ── Test handlers ────────────────────────────────────────────────────────

  async function testChannel(channel, setTesting) {
    setTesting(true);
    try {
      const result = await api.testAlertChannel(channel);
      if (result.success) {
        showToast({ title: `${channel.toUpperCase()} test passed`, message: result.message, level: 'success' });
      } else {
        showToast({ title: `${channel.toUpperCase()} test failed`, message: result.message, level: 'error' });
      }
    } catch (err) {
      showToast({ title: 'Test failed', message: err.message, level: 'error' });
    } finally {
      setTesting(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (loadError && serverConfig === null) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-xl font-semibold text-text-base">Alert Configuration</h1>
        <div className="bg-surface-1 border border-border-soft rounded-xl p-8 text-center space-y-3">
          <p className="text-sm text-text-muted">Could not load alert configuration.</p>
          <button onClick={loadConfig} className="btn-outline text-xs px-4 py-1.5">Retry</button>
        </div>
      </div>
    );
  }

  if (serverConfig === null) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-xl font-semibold text-text-base">Alert Configuration</h1>
        <SkelCard />
        <SkelCard />
        <SkelCard />
      </div>
    );
  }

  const pwPlaceholder = (isSet) => isSet ? 'Leave empty to keep current password' : 'Enter password';

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-text-base">Alert Configuration</h1>
        <p className="text-xs text-text-muted mt-1">
          Configure connection details for each alert channel. Settings are saved to the database and survive restarts.
        </p>
      </div>

      {/* SMTP Email */}
      <ConfigCard
        title="SMTP Email"
        description="Send violation alerts via email using your SMTP server."
        enabled={smtp.enabled}
        onToggle={(v) => setSmtp((s) => ({ ...s, enabled: v }))}
        onSave={saveSmtp}
        saving={savingSmtp}
        onTest={() => testChannel('smtp', setTestingSmtp)}
        testing={testingSmtp}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="SMTP Host">
            <input
              type="text"
              value={smtp.host}
              onChange={(e) => setSmtp((s) => ({ ...s, host: e.target.value }))}
              placeholder="smtp.gmail.com"
              className="form-input w-full"
            />
          </Field>
          <Field label="SMTP Port">
            <input
              type="number"
              value={smtp.port}
              onChange={(e) => setSmtp((s) => ({ ...s, port: Number(e.target.value) }))}
              min={1}
              max={65535}
              className="form-input w-full"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Sender Email" hint="also used as username">
            <input
              type="email"
              value={smtp.sender_email}
              onChange={(e) => setSmtp((s) => ({ ...s, sender_email: e.target.value }))}
              placeholder="alerts@example.com"
              className="form-input w-full"
            />
          </Field>
          <Field label="Receiver Email">
            <input
              type="email"
              value={smtp.receiver_email}
              onChange={(e) => setSmtp((s) => ({ ...s, receiver_email: e.target.value }))}
              placeholder="admin@example.com"
              className="form-input w-full"
            />
          </Field>
        </div>
        <Field label="App Password / SMTP Password">
          <input
            type="password"
            value={smtp.password}
            onChange={(e) => setSmtp((s) => ({ ...s, password: e.target.value }))}
            placeholder={pwPlaceholder(serverConfig.smtp.password_set)}
            autoComplete="new-password"
            className="form-input w-full"
          />
          {serverConfig.smtp.password_set && (
            <p className="text-[11px] text-text-subtle mt-1">A password is currently saved. Leave empty to keep it.</p>
          )}
        </Field>
        <Field label="TLS / STARTTLS">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={smtp.use_tls}
              onChange={(e) => setSmtp((s) => ({ ...s, use_tls: e.target.checked }))}
              className="rounded border-border-soft accent-brand"
            />
            <span className="text-xs text-text-base">Use STARTTLS (recommended for port 587)</span>
          </label>
        </Field>
      </ConfigCard>

      {/* MQTT Broker */}
      <ConfigCard
        title="MQTT Broker"
        description="Publish violation events to an MQTT broker for IoT integrations."
        enabled={mqtt.enabled}
        onToggle={(v) => setMqtt((s) => ({ ...s, enabled: v }))}
        onSave={saveMqtt}
        saving={savingMqtt}
        onTest={() => testChannel('mqtt', setTestingMqtt)}
        testing={testingMqtt}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Broker Host">
            <input
              type="text"
              value={mqtt.broker}
              onChange={(e) => setMqtt((s) => ({ ...s, broker: e.target.value }))}
              placeholder="mqtt.example.com"
              className="form-input w-full"
            />
          </Field>
          <Field label="Port">
            <input
              type="number"
              value={mqtt.port}
              onChange={(e) => setMqtt((s) => ({ ...s, port: Number(e.target.value) }))}
              min={1}
              max={65535}
              className="form-input w-full"
            />
          </Field>
        </div>
        <Field label="Topic">
          <input
            type="text"
            value={mqtt.topic}
            onChange={(e) => setMqtt((s) => ({ ...s, topic: e.target.value }))}
            placeholder="ppe/alerts"
            className="form-input w-full"
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Username" hint="optional">
            <input
              type="text"
              value={mqtt.username}
              onChange={(e) => setMqtt((s) => ({ ...s, username: e.target.value }))}
              placeholder="mqtt_user"
              autoComplete="off"
              className="form-input w-full"
            />
          </Field>
          <Field label="Password" hint="optional">
            <input
              type="password"
              value={mqtt.password}
              onChange={(e) => setMqtt((s) => ({ ...s, password: e.target.value }))}
              placeholder={pwPlaceholder(serverConfig.mqtt.password_set)}
              autoComplete="new-password"
              className="form-input w-full"
            />
          </Field>
        </div>
        {serverConfig.mqtt.password_set && (
          <p className="text-[11px] text-text-subtle">An MQTT password is currently saved. Leave empty to keep it.</p>
        )}
      </ConfigCard>

      {/* Webhook */}
      <ConfigCard
        title="Webhook"
        description="POST violation payloads to an HTTP endpoint for custom integrations."
        enabled={webhook.enabled}
        onToggle={(v) => setWebhook((s) => ({ ...s, enabled: v }))}
        onSave={saveWebhook}
        saving={savingWebhook}
        onTest={() => testChannel('webhook', setTestingWebhook)}
        testing={testingWebhook}
      >
        <Field label="Webhook URL">
          <input
            type="url"
            value={webhook.url}
            onChange={(e) => setWebhook((s) => ({ ...s, url: e.target.value }))}
            placeholder="https://hooks.example.com/ppe-alerts"
            className="form-input w-full"
          />
        </Field>
      </ConfigCard>
    </div>
  );
}
