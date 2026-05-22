import { useEffect } from 'react';
import { useToast } from '@/shared/hooks/useToast';
import { X, CheckCircle, WarningCircle } from '@phosphor-icons/react';

export default function Toaster() {
  const { toasts, addListener, dismiss } = useToast();

  useEffect(() => {
    return addListener();
  }, [addListener]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-[380px] w-full pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-start gap-3 p-4 rounded-lg border animate-in slide-in-from-bottom-4 fade-in-0 ${
            t.variant === 'destructive'
              ? 'bg-red-50 border-red-200 text-red-900 dark:bg-red-950 dark:border-red-800 dark:text-red-100'
              : 'bg-card border-border text-foreground'
          }`}
        >
          <div className="flex-shrink-0 mt-0.5">
            {t.variant === 'destructive'
              ? <WarningCircle size={18} weight="regular" className="text-red-500" />
              : <CheckCircle size={18} weight="regular" className="text-emerald-500" />
            }
          </div>
          <div className="flex-1 min-w-0">
            {t.title && <p className="text-sm font-semibold">{t.title}</p>}
            {t.description && <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>}
          </div>
          <button onClick={() => dismiss(t.id)} className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors">
            <X size={14} weight="bold" />
          </button>
        </div>
      ))}
    </div>
  );
}
