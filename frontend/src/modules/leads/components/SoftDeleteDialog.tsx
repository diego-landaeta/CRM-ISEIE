import { useEffect, useState } from 'react';
import { Trash, Warning } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';

interface LeadLite {
  id: number;
  nombre?: string;
  email?: string;
}

interface Props {
  open: boolean;
  lead: LeadLite | null;
  onClose: () => void;
  onDeleted?: () => void;
}

const REASONS: Array<{ value: string; label: string; desc: string }> = [
  { value: 'spam',              label: 'Spam',              desc: 'Si este mismo email vuelve a escribir, se filtrará automáticamente sin gastar slot de round-robin.' },
  { value: 'test',              label: 'Prueba / test',     desc: 'Lead creado para probar el sistema.' },
  { value: 'duplicado_manual',  label: 'Duplicado',         desc: 'Misma persona que ya existe en otro registro.' },
  { value: 'otro',              label: 'Otro',              desc: 'Especifica el motivo abajo.' },
];

// Soft delete (superadmin). Permite recuperar el lead luego desde DB si hace falta.
export default function SoftDeleteDialog({ open, lead, onClose, onDeleted }: Props) {
  const [reason, setReason] = useState<string>('spam');
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('spam');
      setMotivo('');
    }
  }, [open]);

  if (!open || !lead) return null;

  async function handleDelete() {
    if (!lead) return;
    setSaving(true);
    try {
      const res = await client.delete(`/leads/${lead.id}`, { data: { reason, motivo: motivo || null } } as any);
      if (res.success) {
        toast({ title: 'Lead eliminado', description: `${lead.nombre} (${REASONS.find((r) => r.value === reason)?.label})` });
        onDeleted?.();
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  const selected = REASONS.find((r) => r.value === reason);

  return (
    <div className="fixed inset-0 !m-0 z-[80] flex items-center justify-center sm:p-4">
      <div className="fixed inset-0 !m-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" className="relative bg-card sm:rounded-lg border border-border w-full max-w-md flex flex-col">
        <div className="px-5 py-4 border-b border-border flex items-start gap-3">
          <div className="w-9 h-9 rounded-md bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 flex items-center justify-center flex-shrink-0">
            <Trash size={18} weight="regular" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-base">Eliminar lead</h3>
            <p className="text-xs text-muted-foreground truncate">{lead.nombre} {lead.email ? `· ${lead.email}` : ''}</p>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-foreground mb-1.5 block">Motivo</label>
            <div className="grid grid-cols-2 gap-1.5">
              {REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setReason(r.value)}
                  className={`h-9 rounded-md border text-xs font-medium ${reason === r.value ? 'bg-red-600 text-white border-red-600' : 'border-border bg-card hover:bg-muted'}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">{selected?.desc}</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-foreground mb-1.5 block">Nota adicional (opcional)</label>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              placeholder="Detalle libre del motivo..."
              className="w-full px-3 py-2 rounded-md border border-border bg-card text-sm resize-none"
            />
          </div>

          <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
            <Warning size={16} className="text-amber-600 flex-shrink-0 mt-0.5" weight="duotone" />
            <p className="text-[11px] text-amber-800 dark:text-amber-300">
              Soft delete: el lead se oculta de las listas y stats pero queda en la base de datos para auditoría. Se puede restaurar.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-border bg-muted/20">
          <button onClick={onClose} disabled={saving}
            className="inline-flex items-center h-9 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={handleDelete} disabled={saving}
            className="inline-flex items-center h-9 px-4 rounded-md bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50">
            {saving ? 'Eliminando...' : 'Eliminar'}
          </button>
        </div>
      </div>
    </div>
  );
}
