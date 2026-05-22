import { useState } from 'react';
import { Phone, EnvelopeSimple, WhatsappLogo, Note } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import Select from '@/shared/components/ui/Select';
import { toast } from '@/shared/hooks/useToast';
import type { Interaction } from '@/shared/types';

type InteractionTipo = Interaction['tipo'];

const ICONS: Record<InteractionTipo, typeof Phone> = { llamada: Phone, email: EnvelopeSimple, whatsapp: WhatsappLogo, nota: Note };
const COLORS: Record<InteractionTipo, string> = {
  llamada: 'text-blue-600 bg-blue-50 dark:bg-blue-950/30',
  email: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30',
  whatsapp: 'text-green-600 bg-green-50 dark:bg-green-950/30',
  nota: 'text-amber-600 bg-amber-50 dark:bg-amber-950/30',
};

function defaultDateTimeLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function LeadInteractionsCard({ interacciones, onOpen }: { interacciones: Interaction[]; onOpen: () => void }) {
  return (
    <div className="bg-card p-5 rounded-lg border border-border">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">Interacciones ({interacciones.length})</h3>
        <button onClick={onOpen} className="text-xs font-semibold text-primary hover:underline">
          + Nueva interacción
        </button>
      </div>
      {interacciones.length === 0 ? (
        <div className="text-center py-8">
          <Phone size={32} className="text-muted-foreground/30 mx-auto mb-2" weight="regular" />
          <p className="text-sm text-muted-foreground">No hay interacciones registradas</p>
          <button onClick={onOpen} className="text-xs font-semibold text-primary hover:underline mt-2">
            Registrar la primera interacción
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {interacciones.map((inter, idx) => {
            const Icon = ICONS[inter.tipo] || Note;
            const colorClass = COLORS[inter.tipo] || 'text-muted-foreground bg-muted';
            return (
              <div key={inter.id || idx} className="flex items-start gap-3 p-3.5 rounded-md bg-muted/50">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${colorClass}`}>
                  <Icon size={16} weight="regular" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[11px] font-medium text-muted-foreground">{inter.tipo}</span>
                    <span className="text-[11px] text-muted-foreground">&bull; {inter.fecha ? new Date(inter.fecha).toLocaleString('es-ES') : ''}</span>
                  </div>
                  <p className="text-[13px]">{inter.nota || <span className="text-muted-foreground italic">Sin nota</span>}</p>
                  {inter.created_by_nombre && <p className="text-[11px] text-muted-foreground mt-1">Por {inter.created_by_nombre}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface InteractionDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (tipo: InteractionTipo, nota: string, fechaIso?: string) => Promise<void> | void;
}

export function InteractionDialog({ open, onClose, onSubmit }: InteractionDialogProps) {
  const [tipo, setTipo] = useState<InteractionTipo>('llamada');
  const [nota, setNota] = useState('');
  const [fecha, setFecha] = useState<string>(defaultDateTimeLocal);
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nota.trim() && tipo !== 'llamada') return;
    setLoading(true);
    try {
      const fechaIso = fecha ? new Date(fecha).toISOString() : undefined;
      await onSubmit(tipo, nota, fechaIso);
      toast({ title: 'Interacción registrada' });
      setNota('');
      setTipo('llamada');
      setFecha(defaultDateTimeLocal());
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
          <h2 className="text-lg font-semibold mb-1">Nueva interacción</h2>
          <p className="text-muted-foreground text-sm mb-5">Registra un contacto con este lead</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Tipo</label>
              <Select<InteractionTipo>
                value={tipo}
                onChange={setTipo}
                options={[
                  { value: 'llamada', label: 'Llamada' },
                  { value: 'email', label: 'Email' },
                  { value: 'whatsapp', label: 'WhatsApp' },
                  { value: 'nota', label: 'Nota' },
                ]}
                ariaLabel="Tipo de interacción"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Fecha y hora</label>
              <input
                type="datetime-local"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-border bg-muted/50 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 focus:bg-card"
              />
              <p className="text-[10px] text-muted-foreground mt-1">Por defecto es ahora. Edítala si la interacción ocurrió antes.</p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Nota</label>
              <textarea
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder="Describe la interacción…"
                rows={3}
                className="w-full px-4 py-3 rounded-md border border-border bg-muted/50 text-sm outline-none resize-none transition-all focus:border-primary focus:ring-4 focus:ring-primary/10 focus:bg-card placeholder:text-muted-foreground"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted transition-colors">
                Cancelar
              </button>
              <button type="submit" disabled={loading} className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40">
                {loading ? 'Guardando…' : 'Registrar'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}
