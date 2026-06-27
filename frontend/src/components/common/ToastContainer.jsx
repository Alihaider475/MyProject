import { useToast } from '../../store/ToastContext.jsx';

const LEVEL_STYLES = {
  info:    'bg-blue-600',
  success: 'bg-green-700',
  warning: 'bg-yellow-600',
  danger:  'bg-red-700',
};

export default function ToastContainer() {
  const { toasts, dismiss } = useToast();

  return (
    <div aria-live="polite" className="fixed top-16 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id}
             className="bg-surface-2 border border-border-strong rounded-lg overflow-hidden shadow-xl pointer-events-auto animate-fade-up">
          <div className={`flex items-center gap-2 px-3 py-2 text-white text-sm font-medium ${LEVEL_STYLES[t.level] || LEVEL_STYLES.info}`}>
            <span className="flex-1">{t.title}</span>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-white/80 hover:text-white text-lg leading-none">&times;</button>
          </div>
          {t.onClick ? (
            <button
              type="button"
              className="block w-full text-left px-3 py-2 text-text-base text-xs leading-relaxed cursor-pointer hover:bg-surface-3"
              onClick={() => { t.onClick(); dismiss(t.id); }}
            >
              {t.message}
            </button>
          ) : (
            <div className="px-3 py-2 text-text-base text-xs leading-relaxed">
              {t.message}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
