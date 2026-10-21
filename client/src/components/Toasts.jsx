import Icon from './Icon';
import { useApp } from '../context/AppContext';

const STYLES = {
  success: { icon: 'check', tone: 'bg-deal-500' },
  info: { icon: 'info', tone: 'bg-brand-500' },
  error: { icon: 'alert', tone: 'bg-rose-500' },
};

export default function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end sm:px-6"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const style = STYLES[t.type] || STYLES.info;
        return (
          <div
            key={t.id}
            className="pointer-events-auto flex w-full max-w-sm animate-slide-up items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 text-sm shadow-lift backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
            role="status"
          >
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white ${style.tone}`}>
              <Icon name={style.icon} className="h-3.5 w-3.5" strokeWidth={3} />
            </span>
            <span className="flex-1 font-medium text-slate-700 dark:text-slate-200">{t.message}</span>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              aria-label="Dismiss"
            >
              <Icon name="x" className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
