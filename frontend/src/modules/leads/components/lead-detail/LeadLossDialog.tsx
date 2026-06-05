import { useState } from 'react';
import Portal from '@/shared/components/ui/portal';
import Select from '@/shared/components/ui/Select';

interface LeadLossDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  loading?: boolean;
}

const REASON_LABELS: Record<string, string> = {
  precio: 'Precio',
  falta_interes: 'Falta de interés',
  sin_respuesta: 'Sin respuesta',
  competencia: 'Competencia',
  timing: 'Timing (no es el momento)',
  otro: 'Otro',
};

export default function LeadLossDialog({ open, onClose, onConfirm, loading }: LeadLossDialogProps) {
  const [reason, setReason] = useState('');
  const [detalle, setDetalle] = useState('');
  if (!open) return null;

  // Cuando reason='otro' el texto libre es obligatorio (mín 3 chars).
  // Para los demás motivos el detalle es opcional y se concatena si existe.
  const needsDetail = reason === 'otro';
  const canConfirm = reason && (!needsDetail || detalle.trim().length >= 3);

  function buildMotivo() {
    const base = REASON_LABELS[reason] || reason;
    return detalle.trim() ? `${base}: ${detalle.trim()}` : base;
  }

  return (
    <Portal>
      <div className="fixed inset-0 !m-0 z-[70] flex items-center justify-center sm:p-4">
        <div className="fixed inset-0 !m-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
        <div className="relative bg-card rounded-lg border border-border shadow-[0_20px_25px_-5px_rgb(0_0_0/0.1)] w-full max-w-sm p-6">
          <h2 className="text-lg font-semibold mb-1">Motivo de pérdida</h2>
          <p className="text-muted-foreground text-sm mb-5">
            Obligatorio al marcar como no interesado. El motivo se guarda en el historial
            y aparece como nota en el feed del lead.
          </p>
          <Select<string>
            value={reason}
            onChange={(v) => { setReason(v); if (v !== 'otro') setDetalle(''); }}
            options={[
              { value: '', label: 'Selecciona un motivo' },
              { value: 'precio', label: 'Precio' },
              { value: 'falta_interes', label: 'Falta de interés' },
              { value: 'sin_respuesta', label: 'Sin respuesta' },
              { value: 'competencia', label: 'Competencia' },
              { value: 'timing', label: 'Timing (no es el momento)' },
              { value: 'otro', label: 'Otro' },
            ]}
            ariaLabel="Motivo de pérdida"
          />

          {reason && (
            <div className="mt-3">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                Detalle {needsDetail ? <span className="text-red-600 normal-case font-semibold">(obligatorio)</span> : <span className="text-muted-foreground normal-case font-normal">(opcional)</span>}
              </label>
              <textarea
                rows={3}
                value={detalle}
                onChange={(e) => setDetalle(e.target.value)}
                placeholder={needsDetail ? 'Describe el motivo…' : 'Comentario opcional para el historial'}
                className="w-full px-3 py-2 rounded-md border border-border bg-card text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none"
                maxLength={500}
              />
              <p className="text-[10px] text-muted-foreground mt-1 text-right tabular-nums">{detalle.length} / 500</p>
            </div>
          )}

          <div className="flex justify-end gap-2 mt-4">
            <button onClick={onClose} className="px-4 py-2 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted transition-colors">
              Cancelar
            </button>
            <button
              onClick={() => onConfirm(buildMotivo())}
              disabled={!canConfirm || loading}
              className="px-4 py-2 rounded-md bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-40"
            >
              {loading ? 'Guardando…' : 'Confirmar'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
