import { useState, useEffect, useRef } from 'react';
import Portal from './portal';
import Select from './Select';
import { X, Question } from '@phosphor-icons/react';

/**
 * Dialog de input reutilizable. Reemplazo accesible/estilable de window.prompt().
 *
 * props:
 *  - open: boolean
 *  - title: string
 *  - message: string | ReactNode (descripción)
 *  - placeholder: string
 *  - defaultValue: string
 *  - confirmLabel: string (default 'Aceptar')
 *  - cancelLabel: string (default 'Cancelar')
 *  - multiline: boolean — usa textarea en lugar de input
 *  - options: string[] — si se pasa, renderiza un <select> en lugar de input libre
 *  - required: boolean — bloquea confirmar con valor vacío
 *  - onConfirm: (value: string) => void
 *  - onCancel: () => void
 *  - loading: boolean
 */
export default function PromptDialog({
  open,
  title,
  message,
  placeholder = '',
  defaultValue = '',
  confirmLabel = 'Aceptar',
  cancelLabel = 'Cancelar',
  multiline = false,
  options = null,
  required = true,
  onConfirm,
  onCancel,
  loading = false,
}) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) setValue(defaultValue || '');
  }, [open, defaultValue]);

  useEffect(() => {
    if (open && inputRef.current) {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!open) return null;

  const trimmed = value.trim();
  const canConfirm = !loading && (!required || trimmed.length > 0);

  function handleSubmit(e) {
    e.preventDefault();
    if (!canConfirm) return;
    onConfirm(trimmed);
  }

  return (
    <Portal>
      <div className="fixed inset-0 !m-0 z-[80] flex items-center justify-center sm:p-4">
        <div className="fixed inset-0 !m-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
        <form
          onSubmit={handleSubmit}
          role="dialog"
          aria-modal="true"
          className="relative bg-card sm:rounded-lg border border-border w-full max-w-md flex flex-col"
        >
          <div className="px-5 pt-5 pb-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0 bg-primary/10 text-primary">
                <Question size={20} weight="regular" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold">{title}</h2>
                {message && <div className="text-sm text-muted-foreground mt-1">{message}</div>}
              </div>
              <button
                type="button"
                onClick={onCancel}
                aria-label="Cerrar"
                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground flex-shrink-0"
              >
                <X size={16} />
              </button>
            </div>
            <div className="mt-3 ml-[52px]">
              {options ? (
                <Select
                  value={value}
                  onChange={setValue}
                  options={[
                    { value: '', label: '— Selecciona —' },
                    ...options.map(opt => (
                      typeof opt === 'object' ? { value: opt.value, label: opt.label } : { value: opt, label: opt }
                    )),
                  ]}
                  ariaLabel={title}
                />
              ) : multiline ? (
                <textarea
                  ref={inputRef}
                  value={value}
                  onChange={e => setValue(e.target.value)}
                  placeholder={placeholder}
                  rows={3}
                  className="w-full px-3 py-2 rounded-md border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              ) : (
                <input
                  ref={inputRef}
                  type="text"
                  value={value}
                  onChange={e => setValue(e.target.value)}
                  placeholder={placeholder}
                  className="w-full h-10 px-3 rounded-md border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 p-4 border-t border-border bg-muted/20">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="inline-flex items-center h-9 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              type="submit"
              disabled={!canConfirm}
              className="inline-flex items-center h-9 px-4 rounded-md text-white text-sm font-semibold bg-primary hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? 'Procesando…' : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </Portal>
  );
}
