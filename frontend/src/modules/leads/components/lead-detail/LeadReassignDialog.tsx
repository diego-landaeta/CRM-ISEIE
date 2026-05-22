import { useState } from 'react';
import { X } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import Select from '@/shared/components/ui/Select';
import { toast } from '@/shared/hooks/useToast';

export interface ReassignGestor {
  id: number;
  nombre: string;
  role: string;
}

interface LeadReassignDialogProps {
  open: boolean;
  gestores: ReassignGestor[];
  onClose: () => void;
  onSubmit: (id: number) => Promise<void> | void;
}

export default function LeadReassignDialog({ open, gestores, onClose, onSubmit }: LeadReassignDialogProps) {
  const [reassignId, setReassignId] = useState('');
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  async function handleSubmit() {
    if (!reassignId) return;
    setLoading(true);
    try {
      await onSubmit(Number(reassignId));
      toast({ title: 'Lead reasignado correctamente' });
      setReassignId('');
      onClose();
    } catch (err: unknown) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Portal>
      <div className="fixed inset-0 !m-0 z-[70] flex items-center justify-center sm:p-4">
        <div className="fixed inset-0 !m-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
        <div className="relative bg-card rounded-lg border border-border shadow-[0_20px_25px_-5px_rgb(0_0_0/0.1)] w-full max-w-md p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-semibold">Reasignar lead</h2>
              <p className="text-muted-foreground text-sm mt-0.5">Selecciona un nuevo responsable para este lead</p>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-muted">
              <X size={18} weight="bold" />
            </button>
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Nuevo responsable</label>
              <Select<string>
                value={reassignId}
                onChange={setReassignId}
                options={[
                  { value: '', label: 'Seleccionar responsable' },
                  ...gestores
                    .filter((g) => g.role === 'admin' || g.role === 'gestor' || g.role === 'superadmin')
                    .map((g) => ({ value: String(g.id), label: `${g.nombre} (${g.role})` })),
                ]}
                ariaLabel="Nuevo responsable"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={onClose} className="px-4 py-2 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted transition-colors">
                Cancelar
              </button>
              <button
                onClick={handleSubmit}
                disabled={!reassignId || loading}
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40"
              >
                {loading ? 'Guardando…' : 'Reasignar'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}
