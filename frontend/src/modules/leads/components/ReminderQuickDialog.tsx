import { useEffect, useState } from 'react';
import { CalendarPlus } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';
import Portal from '@/shared/components/ui/portal';

interface LeadLite {
  id: number;
  nombre?: string;
  email?: string;
}

interface Props {
  open: boolean;
  lead: LeadLite | null;
  onClose: () => void;
  onSaved?: () => void;
}

/**
 * Mini-dialog inline para crear un recordatorio rápido sobre un lead.
 * Pre-rellena fecha = mañana 10:00 al abrirse.
 */
export default function ReminderQuickDialog({ open, lead, onClose, onSaved }: Props) {
  const [fecha, setFecha] = useState('');
  const [hora, setHora] = useState('10:00');
  const [nota, setNota] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      const tomorrow = new Date(Date.now() + 86400000);
      setFecha(tomorrow.toISOString().slice(0, 10));
      setHora('10:00');
      setNota('');
    }
  }, [open]);

  if (!open || !lead) return null;

  async function handleSave() {
    if (!fecha) return;
    setSaving(true);
    try {
      // Backend espera fecha_recordatorio en YYYY-MM-DD estricto.
      // La hora va en la nota para preservar el dato.
      const horaTxt = hora ? ` a las ${hora}` : '';
      await client.post(`/leads/${lead.id}/reminders`, {
        fecha_recordatorio: fecha,
        nota: (nota || 'Contacto programado') + horaTxt,
      });
      toast({
        title: 'Recordatorio creado',
        description: `${lead.nombre} — ${fecha}${horaTxt}`,
      });
      onSaved?.();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  const presets = [
    { label: 'En 2 horas', delta: 2 * 3600000 },
    { label: 'Mañana 10am', getDate: () => { const t = new Date(Date.now() + 86400000); t.setHours(10, 0, 0, 0); return t; } },
    { label: 'En 3 días', delta: 3 * 86400000 },
    { label: 'En 1 semana', delta: 7 * 86400000 },
  ];

  return (
    <Portal>
    <div className="fixed inset-0 !m-0 z-[80] flex items-center justify-center sm:p-4">
      <div className="fixed inset-0 !m-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" className="relative bg-card sm:rounded-lg border border-border w-full max-w-md flex flex-col">
        <div className="px-5 py-4 border-b border-border flex items-start gap-3">
          <div className="w-9 h-9 rounded-md bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
            <CalendarPlus size={18} weight="regular" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-base">Programar siguiente contacto</h3>
            <p className="text-xs text-muted-foreground truncate">{lead.nombre}</p>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Fecha</label>
              <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
                className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Hora</label>
              <input type="time" value={hora} onChange={(e) => setHora(e.target.value)}
                className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Nota (opcional)</label>
            <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2}
              placeholder="Ej. Llamar para cerrar venta del Master"
              className="w-full px-3 py-2 rounded-md border border-border bg-card text-sm resize-none" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {presets.map((p) => (
              <button key={p.label} type="button"
                onClick={() => {
                  const d = p.getDate ? p.getDate() : new Date(Date.now() + p.delta);
                  setFecha(d.toISOString().slice(0, 10));
                  setHora(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
                }}
                className="px-2.5 py-1 rounded-md border border-border bg-card text-xs hover:bg-muted">
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-border bg-muted/20">
          <button onClick={onClose} disabled={saving}
            className="inline-flex items-center h-9 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving || !fecha}
            className="inline-flex items-center h-9 px-4 rounded-md bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
            {saving ? 'Guardando...' : 'Crear recordatorio'}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}
