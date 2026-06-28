import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../services/api/client.js';
import { useToast } from '../../../store/ToastContext.jsx';
import { supabase } from '../../../services/supabase.js';
import { useEscapeKey } from '../../../hooks/useEscapeKey.js';
import { useFocusTrap } from '../../../hooks/useFocusTrap.js';

const EMPTY_EDIT_FORM = { name: '', department: '', email: '', base_salary: '' };

export default function WorkerRegistrationPage() {
  const { showToast } = useToast();
  const [workers, setWorkers] = useState(null);
  const [form, setForm] = useState({ employee_id: '', name: '', department: '', email: '', base_salary: '' });
  const [facePhoto, setFacePhoto] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef(null);
  const facePhotoInputRef = useRef(null);
  const enrollingIdRef = useRef(null);
  const [enrollingId, setEnrollingId] = useState(null);
  const [invitingId, setInvitingId] = useState(null);
  const [photoModal, setPhotoModal] = useState({ open: false, workerName: '', url: null, loading: false });
  const [editModal, setEditModal] = useState({ open: false, worker: null, form: EMPTY_EDIT_FORM, submitting: false });
  const [deletingId, setDeletingId] = useState(null);
  const photoPanelRef = useRef(null);
  const editPanelRef = useRef(null);

  useEscapeKey(closePhotoModal, photoModal.open);
  useEscapeKey(closeEditModal, editModal.open && !editModal.submitting);
  useFocusTrap(photoPanelRef, photoModal.open);
  useFocusTrap(editPanelRef, editModal.open);

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
      const worker = await api.createWorker({
        employee_id: form.employee_id.trim(),
        name: form.name.trim(),
        department: form.department.trim() || null,
        email: form.email.trim() || null,
        base_salary: form.base_salary === '' ? 0 : Number(form.base_salary),
      });

      if (facePhoto) {
        try {
          await api.enrollFace(worker.id, facePhoto);
          showToast({ title: 'Worker registered and face enrolled', level: 'success', duration: 3000 });
        } catch (err) {
          showToast({ title: 'Worker registered, but face enrollment failed', message: err.message, level: 'warning' });
        }
      } else {
        showToast({ title: 'Worker registered', level: 'success', duration: 3000 });
      }

      setForm({ employee_id: '', name: '', department: '', email: '', base_salary: '' });
      setFacePhoto(null);
      if (facePhotoInputRef.current) facePhotoInputRef.current.value = '';
      loadWorkers();
    } catch (err) {
      showToast({ title: 'Failed', message: err.message, level: 'danger' });
    } finally {
      setSubmitting(false);
    }
  }

  function resetEnrollingState() {
    enrollingIdRef.current = null;
    setEnrollingId(null);
  }

  function handleEnrollClick(workerId) {
    enrollingIdRef.current = workerId;
    setEnrollingId(workerId);
    fileInputRef.current?.click();
  }

  // The file input's change event never fires when the OS file dialog is
  // canceled, so without this the "Uploading..." state would stick forever.
  useEffect(() => {
    const input = fileInputRef.current;
    if (!input) return;
    input.addEventListener('cancel', resetEnrollingState);
    return () => input.removeEventListener('cancel', resetEnrollingState);
  }, []);

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    const wid = enrollingIdRef.current;
    if (!file || !wid) {
      resetEnrollingState();
      return;
    }

    try {
      await api.enrollFace(wid, file);
      showToast({ title: 'Face enrolled', level: 'success', duration: 3000 });
      loadWorkers();
    } catch (err) {
      showToast({ title: 'Enrollment failed', message: err.message, level: 'danger' });
    } finally {
      resetEnrollingState();
    }
  }

  async function handleViewPhoto(worker) {
    setPhotoModal({ open: true, workerName: worker.name, url: null, loading: true });
    try {
      const blob = await api.getWorkerFacePhoto(worker.id);
      const url = URL.createObjectURL(blob);
      setPhotoModal({ open: true, workerName: worker.name, url, loading: false });
    } catch (err) {
      showToast({ title: 'Failed to load photo', message: err.message, level: 'danger' });
      setPhotoModal({ open: false, workerName: '', url: null, loading: false });
    }
  }

  function closePhotoModal() {
    setPhotoModal((p) => {
      if (p.url) URL.revokeObjectURL(p.url);
      return { open: false, workerName: '', url: null, loading: false };
    });
  }

  function openEditModal(worker) {
    setEditModal({
      open: true,
      worker,
      form: {
        name: worker.name || '',
        department: worker.department || '',
        email: worker.email || '',
        base_salary: worker.base_salary != null ? String(worker.base_salary) : '0',
      },
      submitting: false,
    });
  }

  function closeEditModal() {
    setEditModal({ open: false, worker: null, form: EMPTY_EDIT_FORM, submitting: false });
  }

  async function handleEditSubmit(e) {
    e.preventDefault();
    const { worker, form: ef } = editModal;
    if (!ef.name.trim()) {
      showToast({ title: 'Name is required', level: 'warning' });
      return;
    }
    setEditModal((m) => ({ ...m, submitting: true }));
    try {
      await api.updateWorker(worker.id, {
        name: ef.name.trim(),
        department: ef.department.trim() || null,
        email: ef.email.trim() || null,
        base_salary: ef.base_salary === '' ? null : Number(ef.base_salary),
      });
      showToast({ title: 'Worker updated', level: 'success', duration: 3000 });
      closeEditModal();
      loadWorkers();
    } catch (err) {
      showToast({ title: 'Update failed', message: err.message, level: 'danger' });
      setEditModal((m) => ({ ...m, submitting: false }));
    }
  }

  async function handleDelete(worker) {
    if (!window.confirm(`Permanently delete ${worker.name}? This cannot be undone. All fines and safety tasks for this worker will also be deleted.`)) return;
    setDeletingId(worker.id);
    try {
      await api.deleteWorker(worker.id);
      showToast({ title: 'Worker deleted', level: 'success', duration: 3000 });
      loadWorkers();
    } catch (err) {
      showToast({ title: 'Delete failed', message: err.message, level: 'danger' });
    } finally {
      setDeletingId(null);
    }
  }

  async function handleSendInvite(worker) {
    if (!worker.email) return;
    setInvitingId(worker.id);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: worker.email,
        options: {
          shouldCreateUser: true,
          data: { role: 'worker', worker_id: worker.id },
          emailRedirectTo: `${window.location.origin}/worker/set-password`,
        },
      });
      if (error) throw error;
      // Track the invite (fail-safe: tracking failure must not block the invite UX)
      try {
        await api.createInviteLog(worker.id, worker.email, worker.name);
      } catch { /* ignore */ }
      showToast({
        title: 'Invite sent',
        message: `A login link was emailed to ${worker.email}. Note: if this email already has an existing account, its role may not update to "worker" — use a fresh email if so.`,
        level: 'success',
        duration: 6000,
      });
    } catch (err) {
      showToast({ title: 'Failed to send invite', message: err.message, level: 'danger' });
    } finally {
      setInvitingId(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Add Worker Form */}
      <div className="bg-surface-1 border border-border-soft rounded-xl p-5">
        <h2 className="text-sm font-semibold text-text-base mb-4">Register New Worker</h2>
        <form onSubmit={handleSubmit} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[140px]">
            <label htmlFor="worker-employee-id" className="block text-[11px] text-text-muted mb-1">Employee ID</label>
            <input
              id="worker-employee-id"
              type="text"
              value={form.employee_id}
              onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))}
              className="w-full px-3 py-2 text-sm rounded-lg bg-surface-2 border border-border-soft text-text-base focus:outline-none focus:ring-1 focus:ring-brand"
              placeholder="EMP-001"
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label htmlFor="worker-name" className="block text-[11px] text-text-muted mb-1">Name</label>
            <input
              id="worker-name"
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 text-sm rounded-lg bg-surface-2 border border-border-soft text-text-base focus:outline-none focus:ring-1 focus:ring-brand"
              placeholder="Full name"
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label htmlFor="worker-department" className="block text-[11px] text-text-muted mb-1">Department</label>
            <input
              id="worker-department"
              type="text"
              value={form.department}
              onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
              className="w-full px-3 py-2 text-sm rounded-lg bg-surface-2 border border-border-soft text-text-base focus:outline-none focus:ring-1 focus:ring-brand"
              placeholder="e.g. Electrical"
            />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label htmlFor="worker-email" className="block text-[11px] text-text-muted mb-1">Email (for self-service login)</label>
            <input
              id="worker-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full px-3 py-2 text-sm rounded-lg bg-surface-2 border border-border-soft text-text-base focus:outline-none focus:ring-1 focus:ring-brand"
              placeholder="worker@example.com"
            />
          </div>
          <div className="flex-1 min-w-[120px]">
            <label htmlFor="worker-salary" className="block text-[11px] text-text-muted mb-1">Base Salary (PKR)</label>
            <input
              id="worker-salary"
              type="number"
              min="0"
              step="0.01"
              value={form.base_salary}
              onChange={(e) => setForm((f) => ({ ...f, base_salary: e.target.value }))}
              className="w-full px-3 py-2 text-sm rounded-lg bg-surface-2 border border-border-soft text-text-base focus:outline-none focus:ring-1 focus:ring-brand"
              placeholder="0.00"
            />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label htmlFor="worker-face-photo" className="block text-[11px] text-text-muted mb-1">Face Photo (optional)</label>
            <input
              id="worker-face-photo"
              ref={facePhotoInputRef}
              type="file"
              accept="image/*"
              onChange={(e) => setFacePhoto(e.target.files?.[0] || null)}
              className="w-full text-xs text-text-muted file:mr-2 file:px-3 file:py-2 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-surface-3 file:text-text-base hover:file:bg-surface-2 file:cursor-pointer cursor-pointer rounded-lg bg-surface-2 border border-border-soft focus:outline-none focus:ring-1 focus:ring-brand"
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
                <th className="px-4 py-2 text-left text-text-muted font-semibold uppercase tracking-wider">Email</th>
                <th className="px-4 py-2 text-right text-text-muted font-semibold uppercase tracking-wider">Base Salary</th>
                <th className="px-4 py-2 text-center text-text-muted font-semibold uppercase tracking-wider">Status</th>
                <th className="px-4 py-2 text-center text-text-muted font-semibold uppercase tracking-wider">Face</th>
                <th className="px-4 py-2 text-right text-text-muted font-semibold uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {workers === null ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-b border-border-soft">
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td key={j} className="px-4 py-3"><span className="skel-line" /></td>
                    ))}
                  </tr>
                ))
              ) : workers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-text-subtle text-xs">
                    No workers registered yet.
                  </td>
                </tr>
              ) : workers.map((w) => (
                <tr key={w.id} className={`border-b border-border-soft hover:bg-surface-2/30 transition-colors ${w.is_active === false ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-2.5 font-medium text-text-base">{w.name}</td>
                  <td className="px-4 py-2.5 text-text-muted">{w.employee_id}</td>
                  <td className="px-4 py-2.5 text-text-muted">{w.department || '—'}</td>
                  <td className="px-4 py-2.5 text-text-muted">{w.email || '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-text-muted">
                    {w.base_salary ? `PKR ${Number(w.base_salary).toLocaleString()}` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {w.is_active === false ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-400/10 text-red-400 border border-red-400/30">
                        Inactive
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-400/10 text-emerald-400 border border-emerald-400/30">
                        Active
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex flex-col items-center gap-1">
                      {w.has_face_enrolled ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-400/10 text-emerald-400 border border-emerald-400/30">
                          Enrolled
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-surface-3 text-text-subtle border border-border-soft">
                          Not enrolled
                        </span>
                      )}
                      {w.has_face_enrolled && (
                        w.has_face_photo ? (
                          <button
                            onClick={() => handleViewPhoto(w)}
                            className="text-[10px] text-brand hover:underline"
                          >
                            View photo
                          </button>
                        ) : (
                          <span className="text-[10px] text-text-subtle italic">No photo on file</span>
                        )
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1.5 flex-wrap">
                      <button
                        onClick={() => openEditModal(w)}
                        className="text-[11px] px-2.5 py-1 rounded-md bg-surface-3 text-text-muted hover:text-brand hover:bg-brand/10 transition-colors border border-border-soft"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleEnrollClick(w.id)}
                        disabled={enrollingId === w.id}
                        className="text-[11px] px-2.5 py-1 rounded-md bg-surface-3 text-text-muted hover:text-brand hover:bg-brand/10 transition-colors border border-border-soft disabled:opacity-50"
                      >
                        {enrollingId === w.id ? 'Uploading...' : w.has_face_enrolled ? 'Re-enroll Face' : 'Enroll Face'}
                      </button>
                      <button
                        onClick={() => handleSendInvite(w)}
                        disabled={!w.email || invitingId === w.id}
                        title={w.email ? `Send a login invite to ${w.email}` : 'Set an email first'}
                        className="text-[11px] px-2.5 py-1 rounded-md bg-surface-3 text-text-muted hover:text-emerald-400 hover:bg-emerald-400/10 transition-colors border border-border-soft disabled:opacity-40"
                      >
                        {invitingId === w.id ? 'Sending...' : 'Send Invite'}
                      </button>
                      <button
                        onClick={() => handleDelete(w)}
                        disabled={deletingId === w.id}
                        className="text-[11px] px-2.5 py-1 rounded-md bg-surface-3 text-text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors border border-border-soft disabled:opacity-50"
                      >
                        {deletingId === w.id ? '...' : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Hidden file input for face enrollment */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelected}
      />

      {/* Face photo viewer modal */}
      {photoModal.open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={closePhotoModal}
        >
          <div
            ref={photoPanelRef}
            role="dialog"
            aria-modal="true"
            aria-label={`${photoModal.workerName} enrolled face photo`}
            className="bg-surface-1 border border-border-soft rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text-base">{photoModal.workerName}</h2>
              <button onClick={closePhotoModal} aria-label="Close" className="text-text-muted hover:text-text-base text-lg leading-none">&times;</button>
            </div>
            <div className="flex items-center justify-center bg-surface-2 rounded-lg overflow-hidden" style={{ minHeight: 220 }}>
              {photoModal.loading ? (
                <span className="skel-line" style={{ width: '60%', height: 14 }} />
              ) : photoModal.url ? (
                <img src={photoModal.url} alt={`${photoModal.workerName} enrolled face`} className="max-w-full max-h-80 object-contain" />
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Edit worker modal */}
      {editModal.open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={closeEditModal}
        >
          <div
            ref={editPanelRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Edit ${editModal.worker?.name}`}
            className="bg-surface-1 border border-border-soft rounded-2xl shadow-2xl w-full max-w-md mx-4 p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text-base">Edit {editModal.worker?.name}</h2>
              <button onClick={closeEditModal} aria-label="Close" className="text-text-muted hover:text-text-base text-lg leading-none">&times;</button>
            </div>
            <form onSubmit={handleEditSubmit} className="space-y-3">
              <div>
                <label htmlFor="edit-worker-name" className="block text-[11px] text-text-muted mb-1">Name</label>
                <input
                  id="edit-worker-name"
                  type="text"
                  value={editModal.form.name}
                  onChange={(e) => setEditModal((m) => ({ ...m, form: { ...m.form, name: e.target.value } }))}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-surface-2 border border-border-soft text-text-base focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </div>
              <div>
                <label htmlFor="edit-worker-department" className="block text-[11px] text-text-muted mb-1">Department</label>
                <input
                  id="edit-worker-department"
                  type="text"
                  value={editModal.form.department}
                  onChange={(e) => setEditModal((m) => ({ ...m, form: { ...m.form, department: e.target.value } }))}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-surface-2 border border-border-soft text-text-base focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </div>
              <div>
                <label htmlFor="edit-worker-email" className="block text-[11px] text-text-muted mb-1">Email (for self-service login)</label>
                <input
                  id="edit-worker-email"
                  type="email"
                  value={editModal.form.email}
                  onChange={(e) => setEditModal((m) => ({ ...m, form: { ...m.form, email: e.target.value } }))}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-surface-2 border border-border-soft text-text-base focus:outline-none focus:ring-1 focus:ring-brand"
                  placeholder="worker@example.com"
                />
              </div>
              <div>
                <label htmlFor="edit-worker-salary" className="block text-[11px] text-text-muted mb-1">Base Salary (PKR)</label>
                <input
                  id="edit-worker-salary"
                  type="number"
                  min="0"
                  step="0.01"
                  value={editModal.form.base_salary}
                  onChange={(e) => setEditModal((m) => ({ ...m, form: { ...m.form, base_salary: e.target.value } }))}
                  className="w-full px-3 py-2 text-sm rounded-lg bg-surface-2 border border-border-soft text-text-base focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeEditModal}
                  className="px-3 py-2 text-sm rounded-lg border border-border-soft text-text-muted hover:text-text-base transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editModal.submitting}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-brand text-white hover:bg-brand/90 transition-colors disabled:opacity-50"
                >
                  {editModal.submitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
