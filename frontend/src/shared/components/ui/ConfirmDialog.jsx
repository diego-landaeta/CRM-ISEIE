import Portal from './portal';
import { X, WarningCircle, Question, Info, CheckCircle } from '@phosphor-icons/react';

const TONE_STYLES = {
  default: { icon: Question, iconBg: 'bg-primary/10 text-primary', confirmBg: 'bg-primary hover:bg-primary/90' },
  destructive: { icon: WarningCircle, iconBg: 'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400', confirmBg: 'bg-red-600 hover:bg-red-700' },
  warning: { icon: WarningCircle, iconBg: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400', confirmBg: 'bg-amber-600 hover:bg-amber-700' },
  success: { icon: CheckCircle, iconBg: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400', confirmBg: 'bg-emerald-600 hover:bg-emerald-700' },
  info: { icon: Info, iconBg: 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400', confirmBg: 'bg-blue-600 hover:bg-blue-700' },
};

/**
 * Dialog de confirmacion reutilizable.
 */
export default function ConfirmDialog({
  open, title, message,
  confirmLabel = 'Confirmar', cancelLabel = 'Cancelar',
  tone = 'default', onConfirm, onCancel, loading = false,
}) {
  if (!open) return null;
  const style = TONE_STYLES[tone] || TONE_STYLES.default;
  const Icon = style.icon;

  return (
    <Portal>
      <div className="fixed inset-0 !m-0 z-[80] flex items-center justify-center sm:p-4">
        <div className="fixed inset-0 !m-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
        <div role="dialog" aria-modal="true" className="relative bg-card sm:rounded-lg border border-border w-full max-w-md flex flex-col">
          <div className="px-5 pt-5 pb-3">
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0 ${style.iconBg}`}>
                <Icon size={20} weight="regular" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold">{title}</h2>
                {message && <div className="text-sm text-muted-foreground mt-1">{message}</div>}
              </div>
              <button onClick={onCancel} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground flex-shrink-0">
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="flex justify-end gap-2 p-4 border-t border-border bg-muted/20">
            <button onClick={onCancel} disabled={loading}
              className="inline-flex items-center h-9 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted disabled:opacity-50">
              {cancelLabel}
            </button>
            <button onClick={onConfirm} disabled={loading}
              className={`inline-flex items-center h-9 px-4 rounded-md text-white text-sm font-semibold disabled:opacity-50 ${style.confirmBg}`}>
              {loading ? 'Procesando…' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
