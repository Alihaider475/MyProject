import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';

export default function WorkerRegistrationPage() {
  const { showToast } = useToast();
  const [workers, setWorkers] = useState(null);
  const [form, setForm] = useState({ employee_id: '', name: '', department: '' });
  const [submitting, setSubmitting] = useState(false);

  // Edit modal
  const [editModal, setEditModal] = useState(null); // { worker } | null
  const [editForm, setEditForm] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const editFileInputRef = useRef(null);
  const [editFaceUploading, setEditFaceUploading] = useState(false);

  // Delete / deactivate modal
  const [deleteModal, setDeleteModal] = useState(null); // { worker } | null
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Activate / deactivate toggle from the table row
  const [statusUpdatingId, setStatusUpdatingId] = useState(null);

  const loadWorkers = useCallback(async () => {
    try {
      const data = await api.listWorkers();
      setWorkers(data);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { loadWorkers(); }, [loadWorkers]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.employee_id.trim() || !form.name.trim()) {
      showToast({ title: 'Employee ID and Name are required', level: 'warning' });
      return;
    }
    setSubmitting(true);
    try {
      await api.createWorker({
        employee_id: form.employee_id.trim(),
        name: form.name.trim(),
        department: form.department.trim() || null,
      });
      showToast({ title: 'Worker registered', level: 'success', duration: 3000 });
      setForm({ employee_id: '', name: '', department: '' });
      loadWorkers();
    } catch (err) {
      showToast({ title: 'Failed', message: err.message, level: 'danger' });
    } finally {
      setSubmitting(false);
    }
  }

  // ── Edit ────────────────────────────────────────────────────────────────
  function openEdit(worker) {
    setEditModal({ worker });
    setEditForm({
      employee_id: worker.employee_id,
      name: worker.name,
      department: worker.department || '',
      phone_number: worker.phone_number || '',
      email: worker.email || '',
    });
  }

  async function handleSaveEdit() {
    if (!editForm.employee_id.trim() || !editForm.name.trim()) {
      showToast({ title: 'Employee ID and Name are required', level: 'warning' });
      return;
    }
    setSavingEdit(true);
    try {
      await api.updateWorker(editModal.worker.id, {
        employee_id: editForm.employee_id.trim(),
        name: editForm.name.trim(),
        department: editForm.department.trim() || null,
        phone_number: editForm.phone_number.trim() || null,
        email: editForm.email.trim() || null,
      });
      showToast({ title: 'Worker updated', level: 'success', duration: 3000 });
      setEditModal(null);
      loadWorkers();
    } catch (err) {
      showToast({ title: 'Update failed', message: err.message, level: 'danger' });
    } finally {
      setSavingEdit(false);
    }
  }

  function handleEditFacePhotoClick() {
    editFileInputRef.current?.click();
  }

  async function handleEditFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editModal) return;

    setEditFaceUploading(true);
    try {
      await api.enrollFace(editModal.worker.id, file);
      showToast({ title: 'Face photo updated', level: 'success', duration: 3000 });
      setEditModal((m) => (m ? { ...m, worker: { ...m.worker, has_face_enrolled: true } } : m));
      loadWorkers();
    } catch (err) {
      showToast({ title: 'Face update failed', message: err.message, level: 'danger' });
    } finally {
      setEditFaceUploading(false);
    }
  }

  // ── Activate / Deactivate ──────────────────────────────────────────────
  async function handleToggleStatus(worker) {
    setStatusUpdatingId(worker.id);
    try {
      const updated = await api.setWorkerStatus(worker.id, !worker.is_active);
      setWorkers((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
      showToast({
        title: updated.is_active ? 'Worker activated' : 'Worker deactivated',
        level: 'success',
        duration: 3000,
      });
    } catch (err) {
      showToast({ title: 'Failed', message: err.message, level: 'danger' });
    } finally {
      setStatusUpdatingId(null);
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────
  function openDelete(worker) {
    setDeleteModal({ worker });
  }

  async function handleConfirmDelete() {
    const worker = deleteModal.worker;
    setDeleteBusy(true);
    try {
      await api.deleteWorker(worker.id);
      showToast({ title: 'Worker deleted', level: 'success', duration: 3000 });
      setDeleteModal(null);
      loadWorkers();
    } catch (err) {
      showToast({ title: 'Delete failed', message: err.message, level: 'danger' });
    } finally {
      setDeleteBusy(false);
    }
  }

  async function handleDeactivateFromModal() {
    const worker = deleteModal.worker;
    setDeleteBusy(true);
    try {
      const updated = await api.setWorkerStatus(worker.id, false);
      setWorkers((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
      showToast({ title: 'Worker deactivated', level: 'success', duration: 3000 });
      setDeleteModal(null);
    } catch (err) {
      showToast({ title: 'Failed', message: err.message, level: 'danger' });
    } finally {
      setDeleteBusy(false);
    }
  }

  const hasHistory = deleteModal
    ? deleteModal.worker.violation_count > 0 || deleteModal.worker.total_fines > 0
    : false;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Add Worker Form */}
      <div className="bg-surface-1 border border-border-soft rounded-xl p-5">
        <h2 className="text-sm font-semibold text-text-base mb-4">Register New Worker</h2>
        <form onSubmit={handleSubmit} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[140px]">
            <label className="block text-[11px] text-text-muted mb-1">Employee ID</label>
            <input
              type="text"
              value={form.employee_id}
              onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))}
              className="w-full px-3 py-2 text-sm rounded-lg bg-surface-2 border border-border-soft text-text-base focus:outline-none focus:ring-1 focus:ring-brand"
              placeholder="EMP-001"
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="block text-[11px] text-text-muted mb-1">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 text-sm rounded-lg bg-surface-2 border border-border-soft text-text-base focus:outline-none focus:ring-1 focus:ring-brand"
              placeholder="Full name"
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="block text-[11px] text-text-muted mb-1">Department</label>
            <input
              type="text"
              value={form.department}
              onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
              className="w-full px-3 py-2 text-sm rounded-lg bg-surface-2 border border-border-soft text-text-base focus:outline-none focus:ring-1 focus:ring-brand"
              placeholder="e.g. Electrical"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-brand text-white hover:bg-brand/90 transition-colors disabled:opacity-50"
          >
            {submitting ? 'Adding...' : 'Add Worker'}
          </button>
        </form>
      </div>

      {/* Workers Table */}
      <div className="bg-surface-1 border border-border-soft rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border-soft">
          <h2 className="text-sm font-semibold text-text-base">Registered Workers</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-soft bg-surface-2/50">
                <th className="px-4 py-2 text-left text-text-muted font-semibold uppercase tracking-wider">Name</th>
                <th className="px-4 py-2 text-left text-text-muted font-semibold uppercase tracking-wider">Employee ID</th>
                <th className="px-4 py-2 text-left text-text-muted font-semibold uppercase tracking-wider">Department</th>
                <th className="px-4 py-2 text-center text-text-muted font-semibold uppercase tracking-wider">Face</th>
                <th className="px-4 py-2 text-center text-text-muted font-semibold uppercase tracking-wider">Status</th>
                <th className="px-4 py-2 text-right text-text-muted font-semibold uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {workers === null ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-b border-border-soft">
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-4 py-3"><span className="skel-line" /></td>
                    ))}
                  </tr>
                ))
              ) : workers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-text-subtle text-xs">
                    No workers registered yet.
                  </td>
                </tr>
              ) : workers.map((w) => (
                <tr key={w.id} className="border-b border-border-soft hover:bg-surface-2/30 transition-colors">
                  <td className="px-4 py-2.5 font-medium text-text-base">{w.name}</td>
                  <td className="px-4 py-2.5 text-text-muted">{w.employee_id}</td>
                  <td className="px-4 py-2.5 text-text-muted">{w.department || '—'}</td>
                  <td className="px-4 py-2.5 text-center">
                    {w.has_face_enrolled ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-400/10 text-emerald-400 border border-emerald-400/30">
                        Enrolled
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-3 text-text-subtle border border-border-soft">
                        Not enrolled
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {w.is_active ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-400/10 text-emerald-400 border border-emerald-400/30">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-3 text-text-subtle border border-border-soft">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1.5 flex-wrap">
                      <button
                        onClick={() => openEdit(w)}
                        className="text-[11px] px-2.5 py-1 rounded-md bg-surface-3 text-text-muted hover:text-brand hover:bg-brand/10 transition-colors border border-border-soft"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleToggleStatus(w)}
                        disabled={statusUpdatingId === w.id}
                        className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors disabled:opacity-50 ${
                          w.is_active
                            ? 'bg-amber-400/10 text-amber-400 border-amber-400/30 hover:bg-amber-400/20'
                            : 'bg-emerald-400/10 text-emerald-400 border-emerald-400/30 hover:bg-emerald-400/20'
                        }`}
                      >
                        {statusUpdatingId === w.id ? '...' : w.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        onClick={() => openDelete(w)}
                        className="text-[11px] px-2.5 py-1 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors border border-red-500/30"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Worker Modal */}
      {editModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => !savingEdit && !editFaceUploading && setEditModal(null)}
        >
          <div
            className="bg-surface-1 border border-border-soft rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-text-base">Edit Worker</h2>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-text-muted">Employee ID</label>
                <input
                  type="text"
                  value={editForm.employee_id}
                  onChange={(e) => setEditForm((f) => ({ ...f, employee_id: e.target.value }))}
                  className="form-input w-full"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-text-muted">Name</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  className="form-input w-full"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-text-muted">Department</label>
                <input
                  type="text"
                  value={editForm.department}
                  onChange={(e) => setEditForm((f) => ({ ...f, department: e.target.value }))}
                  className="form-input w-full"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-text-muted">Phone</label>
                <input
                  type="text"
                  value={editForm.phone_number}
                  onChange={(e) => setEditForm((f) => ({ ...f, phone_number: e.target.value }))}
                  className="form-input w-full"
                />
              </div>
              <div className="space-y-1 col-span-2">
                <label className="text-xs text-text-muted">Email</label>
                <input
                  type="email"
                  value={editForm.email}
                  onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                  className="form-input w-full"
                />
              </div>
            </div>

            {/* Face photo re-enrollment */}
            <div className="pt-2 border-t border-border-soft space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-muted">Face Photo</span>
                {editModal.worker.has_face_enrolled ? (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-400/10 text-emerald-400 border border-emerald-400/30">
                    Enrolled
                  </span>
                ) : (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-3 text-text-subtle border border-border-soft">
                    Not enrolled
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={handleEditFacePhotoClick}
                disabled={editFaceUploading}
                className="btn-outline text-xs px-3 py-1.5 w-full disabled:opacity-50"
              >
                {editFaceUploading ? 'Uploading...' : editModal.worker.has_face_enrolled ? 'Re-enroll Face Photo' : 'Upload Face Photo'}
              </button>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <button
                onClick={() => setEditModal(null)}
                disabled={savingEdit || editFaceUploading}
                className="btn-outline text-sm px-4 py-1.5 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={savingEdit || editFaceUploading}
                className="btn-primary text-sm px-4 py-1.5 disabled:opacity-50"
              >
                {savingEdit ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete / Deactivate Worker Modal */}
      {deleteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => !deleteBusy && setDeleteModal(null)}
        >
          <div
            className="bg-surface-1 border border-border-soft rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            {hasHistory ? (
              <>
                <h2 className="text-base font-semibold text-text-base">Cannot Delete Worker</h2>
                <p className="text-xs text-text-muted">
                  <span className="font-medium text-text-base">{deleteModal.worker.name}</span> has{' '}
                  {deleteModal.worker.violation_count} violation(s) and{' '}
                  {Number(deleteModal.worker.total_fines).toLocaleString()} in fines on record.
                  Deleting is disabled to preserve violation and payroll history.
                  Deactivate this worker instead — they will no longer be matched by face
                  recognition or selectable for new violations.
                </p>
                <div className="flex gap-2 justify-end pt-2">
                  <button
                    onClick={() => setDeleteModal(null)}
                    disabled={deleteBusy}
                    className="btn-outline text-sm px-4 py-1.5 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeactivateFromModal}
                    disabled={deleteBusy}
                    className="btn-primary text-sm px-4 py-1.5 disabled:opacity-50"
                  >
                    {deleteBusy ? 'Deactivating…' : 'Deactivate Worker'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-base font-semibold text-text-base">Delete Worker</h2>
                <p className="text-xs text-text-muted">
                  Are you sure you want to permanently delete{' '}
                  <span className="font-medium text-text-base">{deleteModal.worker.name}</span>{' '}
                  ({deleteModal.worker.employee_id})? This cannot be undone.
                </p>
                <div className="flex gap-2 justify-end pt-2">
                  <button
                    onClick={() => setDeleteModal(null)}
                    disabled={deleteBusy}
                    className="btn-outline text-sm px-4 py-1.5 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmDelete}
                    disabled={deleteBusy}
                    className="btn-danger text-sm px-4 py-1.5 disabled:opacity-50"
                  >
                    {deleteBusy ? 'Deleting…' : 'Delete'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Hidden file input for face re-enrollment from the edit modal */}
      <input
        ref={editFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleEditFileSelected}
      />
    </div>
  );
}
