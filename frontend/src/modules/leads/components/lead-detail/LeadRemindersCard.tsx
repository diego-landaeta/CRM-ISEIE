import { useState } from 'react';
import { CalendarCheck, Check } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import { toast } from '@/shared/hooks/useToast';
import type { Reminder } from '@/shared/types';

interface LeadRemindersCardProps {
  reminders: Reminder[];
  onOpen: () => void;
  onComplete: (remId: number) => Promise<void> | void;
}

export default function LeadRemindersCard({ reminders, onOpen, onComplete }: LeadRemindersCardProps) {
  async function handleComplete(remId: number) {
    try {
      await onComplete(remId);
      toast({ title: 'Recordatorio completado' });
    } catch (err: unknown) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
  }

  return (
    <div className="bg-card p-5 rounded-lg border border-border">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold flex items-center gap-2">
          <CalendarCheck size={16} weight="regular" /> Recordatorios ({reminders.length})
        </h3>
        <button onClick={onOpen} className="text-xs font-semibold text-primary hover:underline">
          + Nuevo recordatorio
        </button>
      </div>
      {reminders.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No hay recordatorios programados</p>
      ) : (
        <div className="space-y-3">
          {reminders.map((rem) => (
            <div
              key={rem.id}
              className={`p-4 rounded-md border ${
                rem.completado
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800'
                  : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800'
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className={`text-[11px] font-medium ${rem.completado ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
                  {rem.completado ? 'Completado' : 'Pendiente'}
                </span>
                <span className="text-[11px] text-muted-foreground font-semibold">
                  {rem.fecha_recordatorio ? new Date(rem.fecha_recordatorio).toLocaleDateString('es-ES') : ''}
                </span>
              </div>
              {rem.nota && <p className="text-[13px]">{rem.nota}</p>}
              {rem.created_by_nombre && <p className="text-[11px] text-muted-foreground mt-1">Por {rem.created_by_nombre}</p>}
              {!rem.completado && (
                <button
                  onClick={() => handleComplete(rem.id)}
                  className="mt-2 text-xs font-semibold text-emerald-600 hover:underline flex items-center gap-1"
                >
                  <Check size={12} weight="bold" /> Marcar como completado
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface ReminderDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (fecha: string, nota: string) => Promise<void> | void;
}

export function ReminderDialog({ open, onClose, onSubmit }: ReminderDialogProps) {
  const [fecha, setFecha] = useState('');
  const [nota, setNota] = useState('');
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!fecha) return;
    setLoading(true);
    try {
      await onSubmit(fecha.slice(0, 10), nota);
      toast({ title: 'Recordatorio programado' });
      setFecha('');
      setNota('');
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
          <h2 className="text-lg font-semibold mb-1">Programar recordatorio</h2>
          <p className="text-muted-foreground text-sm mb-5">Establece una fecha y nota para el recordatorio</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Fecha *</label>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-border bg-muted/50 text-sm outline-none transition-all focus:border-primary focus:ring-4 focus:ring-primary/10 focus:bg-card"
                required
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Nota</label>
              <textarea
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder="Qué hay que recordar…"
                rows={2}
                className="w-full px-4 py-3 rounded-md border border-border bg-muted/50 text-sm outline-none resize-none transition-all focus:border-primary focus:ring-4 focus:ring-primary/10 focus:bg-card placeholder:text-muted-foreground"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted transition-colors">
                Cancelar
              </button>
              <button type="submit" disabled={loading} className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40">
                {loading ? 'Guardando…' : 'Programar'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}
