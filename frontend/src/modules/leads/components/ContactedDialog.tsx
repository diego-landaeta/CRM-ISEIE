import { useEffect, useState } from 'react';
import { CheckCircle } from '@phosphor-icons/react';
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
  onSaved?: () => void;
}

// Marca el lead como "contactado" registrando nota de la interacción
// y, opcionalmente, programando un próximo contacto en un solo paso.
export default function ContactedDialog({ open, lead, onClose, onSaved }: Props) {
  const [nota, setNota] = useState('');
  const [tipo, setTipo] = useState<'llamada' | 'whatsapp' | 'email' | 'nota'>('llamada');
  const [programar, setProgramar] = useState(true);
  const [fecha, setFecha] = useState('');
  const [hora, setHora] = useState('10:00');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      const tomorrow = new Date(Date.now() + 86400000);
      setFecha(tomorrow.toISOString().slice(0, 10));
      setHora('10:00');
      setNota('');
      setTipo('llamada');
      setProgramar(true);
    }
  }, [open]);

  if (!open || !lead) return null;

  async function handleSave() {
    if (!lead) return;
    setSaving(true);
    try {
      // 1) Registrar interacción si hay nota
      if (nota.trim()) {
        await client.post(`/leads/${lead.id}/interactions`, {
          tipo,
          nota: nota.trim(),
          fecha: new Date().toISOString(),
        });
      }
      // 2) Cambiar estado a contactado
      await client.patch(`/leads/${lead.id}/status`, {
        status: 'contactado',
        motivo: nota.trim() || 'Marcado contactado desde lista',
      });
      // 3) Programar próximo contacto
      if (programar && fecha) {
        await client.post(`/leads/${lead.id}/reminders`, {
          fecha_recordatorio: fecha,
          nota: `Siguiente contacto programado (${hora})`,
        });
      }
      toast({ title: 'Marcado como contactado', description: lead.nombre });
      onSaved?.();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 !m-0 z-[80] flex items-center justify-center sm:p-4">
      <div className="fixed inset-0 !m-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" className="relative bg-card sm:rounded-lg border border-border w-full max-w-md flex flex-col">
        <div className="px-5 py-4 border-b border-border flex items-start gap-3">
          <div className="w-9 h-9 rounded-md bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
            <CheckCircle size={18} weight="regular" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-base">Marcar como contactado</h3>
            <p className="text-xs text-muted-foreground truncate">{lead.nombre}</p>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Tipo de contacto</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {(['llamada', 'whatsapp', 'email', 'nota'] as const).map((t) => (
                <button key={t} type="button" onClick={() => setTipo(t)}
                  className={`h-9 rounded-md border text-xs font-medium capitalize ${tipo === t ? 'bg-primary text-white border-primary' : 'border-border bg-card hover:bg-muted'}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Nota de este contacto</label>
            <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={3}
              placeholder="¿Qué se habló? ¿Próximos pasos?"
              className="w-full px-3 py-2 rounded-md border border-border bg-card text-sm resize-none" />
          </div>
          <div className="border-t border-border pt-3">
            <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={programar} onChange={(e) => setProgramar(e.target.checked)}
                className="rounded border-border" />
              Programar siguiente contacto
            </label>
            {programar && (
              <div className="grid grid-cols-2 gap-3 mt-3">
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
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-border bg-muted/20">
          <button onClick={onClose} disabled={saving}
            className="inline-flex items-center h-9 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="inline-flex items-center h-9 px-4 rounded-md bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
            {saving ? 'Guardando...' : 'Marcar contactado'}
          </button>
        </div>
      </div>
    </div>
  );
}
