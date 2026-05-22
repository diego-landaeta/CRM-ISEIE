import { useState } from 'react';
import { X, CheckCircle, Trash, UserSwitch, Tag } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';

export interface BulkActionBarProps {
  selected: number[];
  onClear: () => void;
  onRefresh: () => void;
  canDelete?: boolean;
}

const STATUS_OPTIONS = [
  { value: 'nuevo',          label: 'Nuevo' },
  { value: 'por_contactar',  label: 'Por contactar' },
  { value: 'contactado',     label: 'Contactado' },
  { value: 'en_seguimiento', label: 'En seguimiento' },
  { value: 'no_interesado',  label: 'No interesado' },
];

export default function BulkActionBar({ selected, onClear, onRefresh, canDelete = false }: BulkActionBarProps) {
  const [working, setWorking] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);

  if (selected.length === 0) return null;

  async function applyStatus(status: string) {
    setStatusMenuOpen(false);
    setWorking(true);
    let ok = 0, fail = 0;
    for (const id of selected) {
      try { await client.patch(`/leads/${id}/status`, { status }); ok++; }
      catch { fail++; }
    }
    setWorking(false);
    toast({
      title: `${ok} prospecto${ok === 1 ? '' : 's'} actualizado${ok === 1 ? '' : 's'}`,
      description: fail > 0 ? `${fail} fallaron` : '',
    });
    onClear();
    onRefresh();
  }

  async function applyDelete() {
    if (!window.confirm(`¿Eliminar ${selected.length} prospecto${selected.length === 1 ? '' : 's'}? Se moverán a la papelera.`)) return;
    setWorking(true);
    let ok = 0, fail = 0;
    for (const id of selected) {
      try { await client.delete(`/leads/${id}`); ok++; }
      catch { fail++; }
    }
    setWorking(false);
    toast({
      title: `${ok} prospecto${ok === 1 ? '' : 's'} a papelera`,
      description: fail > 0 ? `${fail} fallaron` : '',
    });
    onClear();
    onRefresh();
  }

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[75] w-[min(640px,calc(100%-2rem))]">
      <div className="bg-card border border-border rounded-2xl shadow-2xl px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold tabular-nums">
            {selected.length}
          </span>
          <span className="text-sm font-medium hidden sm:inline">seleccionado{selected.length === 1 ? '' : 's'}</span>
        </div>

        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          <div className="relative">
            <button
              type="button"
              onClick={() => setStatusMenuOpen((v) => !v)}
              disabled={working}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-muted hover:bg-muted/70 text-xs font-semibold transition-colors disabled:opacity-50"
            >
              <Tag size={12} weight="bold" /> Cambiar estado
            </button>
            {statusMenuOpen && (
              <div className="absolute bottom-full right-0 mb-1 bg-card border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
                {STATUS_OPTIONS.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => applyStatus(s.value)}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted/60 transition-colors"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => applyStatus('contactado')}
            disabled={working}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-muted hover:bg-muted/70 text-xs font-semibold transition-colors disabled:opacity-50"
          >
            <CheckCircle size={12} weight="bold" /> Contactado
          </button>

          {canDelete && (
            <button
              type="button"
              onClick={applyDelete}
              disabled={working}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-200 dark:hover:bg-rose-950/60 text-xs font-semibold transition-colors disabled:opacity-50"
            >
              <Trash size={12} weight="bold" /> Eliminar
            </button>
          )}

          <button
            type="button"
            onClick={onClear}
            disabled={working}
            title="Limpiar selección (Esc)"
            aria-label="Limpiar selección"
            className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            <X size={13} weight="bold" />
          </button>
        </div>
      </div>
    </div>
  );
}
