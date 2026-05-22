import { useState } from 'react';
import Portal from '@/shared/components/ui/portal';
import Select from '@/shared/components/ui/Select';

interface LeadLossDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  loading?: boolean;
}

export default function LeadLossDialog({ open, onClose, onConfirm, loading }: LeadLossDialogProps) {
  const [reason, setReason] = useState('');
  if (!open) return null;
  return (
    <Portal>
      <div className="fixed inset-0 !m-0 z-[70] flex items-center justify-center sm:p-4">
        <div className="fixed inset-0 !m-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
        <div className="relative bg-card rounded-lg border border-border shadow-[0_20px_25px_-5px_rgb(0_0_0/0.1)] w-full max-w-sm p-6">
          <h2 className="text-lg font-semibold mb-1">Motivo de pérdida</h2>
          <p className="text-muted-foreground text-sm mb-5">Este campo es obligatorio al marcar un lead como no interesado.</p>
          <Select<string>
            value={reason}
            onChange={setReason}
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
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={onClose} className="px-4 py-2 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted transition-colors">
              Cancelar
            </button>
            <button
              onClick={() => onConfirm(reason)}
              disabled={!reason || loading}
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
