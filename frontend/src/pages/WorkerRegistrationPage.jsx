import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';

export default function WorkerRegistrationPage() {
  const { showToast } = useToast();
  const [workers, setWorkers] = useState(null);
  const [form, setForm] = useState({ employee_id: '', name: '', department: '' });
  const [facePhoto, setFacePhoto] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef(null);
  const facePhotoInputRef = useRef(null);
  const enrollingIdRef = useRef(null);
  const [enrollingId, setEnrollingId] = useState(null);

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

      setForm({ employee_id: '', name: '', department: '' });
      setFacePhoto(null);
      if (facePhotoInputRef.current) facePhotoInputRef.current.value = '';
      loadWorkers();
    } catch (err) {
      showToast({ title: 'Failed', message: err.message, level: 'danger' });
    } finally {
      setSubmitting(false);
    }
  }

  function handleEnrollClick(workerId) {
    enrollingIdRef.current = workerId;
    setEnrollingId(workerId);
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    const wid = enrollingIdRef.current;
    if (!file || !wid) {
      setEnrollingId(null);
      return;
    }

    try {
      await api.enrollFace(wid, file);
      showToast({ title: 'Face enrolled', level: 'success', duration: 3000 });
      loadWorkers();
    } catch (err) {
      showToast({ title: 'Enrollment failed', message: err.message, level: 'danger' });
    } finally {
      enrollingIdRef.current = null;
      setEnrollingId(null);
    }
  }

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
          <div className="flex-1 min-w-[180px]">
            <label className="block text-[11px] text-text-muted mb-1">Face Photo (optional)</label>
            <input
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
                <th className="px-4 py-2 text-center text-text-muted font-semibold uppercase tracking-wider">Face</th>
                <th className="px-4 py-2 text-right text-text-muted font-semibold uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {workers === null ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-b border-border-soft">
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j} className="px-4 py-3"><span className="skel-line" /></td>
                    ))}
                  </tr>
                ))
              ) : workers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-text-subtle text-xs">
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
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => handleEnrollClick(w.id)}
                      disabled={enrollingId === w.id}
                      className="text-[11px] px-2.5 py-1 rounded-md bg-surface-3 text-text-muted hover:text-brand hover:bg-brand/10 transition-colors border border-border-soft disabled:opacity-50"
                    >
                      {enrollingId === w.id ? 'Uploading...' : w.has_face_enrolled ? 'Re-enroll Face' : 'Enroll Face'}
                    </button>
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
    </div>
  );
}
