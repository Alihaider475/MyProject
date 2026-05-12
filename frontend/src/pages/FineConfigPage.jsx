import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';

export default function FineConfigPage() {
  const { showToast } = useToast();
  const [configs, setConfigs] = useState(null);
  const [editModal, setEditModal] = useState(null); // { config } | null
  const [editAmount, setEditAmount] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchConfigs = useCallback(async () => {
    try {
      const data = await api.listFineConfigs();
      setConfigs(data);
    } catch (err) {
      showToast({ title: 'Error', message: err.message, level: 'error' });
    }
  }, [showToast]);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  async function handleToggle(config) {
    try {
      const updated = await api.updateFineConfig(config.violation_type, { is_active: !config.is_active });
      setConfigs((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      showToast({ title: 'Updated', message: `${config.violation_type} ${updated.is_active ? 'activated' : 'deactivated'}`, level: 'success' });
    } catch (err) {
      showToast({ title: 'Error', message: err.message, level: 'error' });
    }
  }

  function openEdit(config) {
    setEditModal({ config });
    setEditAmount(String(config.fine_amount));
  }

  async function handleSave() {
    const amount = parseFloat(editAmount);
    if (isNaN(amount) || amount < 0) {
      showToast({ title: 'Invalid', message: 'Enter a valid amount', level: 'error' });
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateFineConfig(editModal.config.violation_type, { fine_amount: amount });
      setConfigs((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      showToast({ title: 'Saved', message: `Fine amount updated to ${updated.currency} ${updated.fine_amount}`, level: 'success' });
      setEditModal(null);
    } catch (err) {
      showToast({ title: 'Error', message: err.message, level: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <h1 className="text-xl font-semibold text-text-base">Fine Configuration</h1>

      <div className="bg-surface-1 border border-border-soft rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border-soft">
          <p className="text-xs text-text-muted">Configure fine amounts for each violation type.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface-2">
              <tr>
                {['Violation Type', 'Fine Amount', 'Currency', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-text-muted font-semibold uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {configs === null ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-t border-border-soft">
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <span className="skel-line" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : configs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-text-subtle">No fine configs found.</td>
                </tr>
              ) : (
                configs.map((config) => (
                  <tr key={config.id} className="border-t border-border-soft hover:bg-surface-2/40 transition-colors">
                    <td className="px-4 py-3 font-medium text-text-base">{config.violation_type}</td>
                    <td className="px-4 py-3 tabular-nums text-text-base">
                      {Number(config.fine_amount).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-text-muted">{config.currency}</td>
                    <td className="px-4 py-3">
                      {config.is_active ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border text-emerald-400 bg-emerald-400/10 border-emerald-400/30">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border text-text-muted bg-surface-3 border-border-soft">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(config)}
                          className="text-[10px] px-2.5 py-1 rounded bg-brand/10 text-brand border border-brand/30 hover:bg-brand/20 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleToggle(config)}
                          className={`text-[10px] px-2.5 py-1 rounded border transition-colors ${
                            config.is_active
                              ? 'bg-amber-400/10 text-amber-400 border-amber-400/30 hover:bg-amber-400/20'
                              : 'bg-emerald-400/10 text-emerald-400 border-emerald-400/30 hover:bg-emerald-400/20'
                          }`}
                        >
                          {config.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit modal */}
      {editModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setEditModal(null)}
        >
          <div
            className="bg-surface-1 border border-border-soft rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-text-base">Edit Fine Amount</h2>
            <p className="text-xs text-text-muted">{editModal.config.violation_type}</p>
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Amount ({editModal.config.currency})</label>
              <input
                type="number"
                min="0"
                step="50"
                value={editAmount}
                onChange={(e) => setEditAmount(e.target.value)}
                className="form-input w-full"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditModal(null); }}
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => setEditModal(null)}
                className="btn-outline text-sm px-4 py-1.5"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-primary text-sm px-4 py-1.5 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
