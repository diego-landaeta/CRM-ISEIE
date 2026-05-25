import { useState } from 'react';
import { X, WarningOctagon } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';

export interface SpamReportDialogProps {
  open: boolean;
  onClose: () => void;
  leadId?: number | null;
  leadNombre?: string | null;
  onReported?: () => void;
}

export default function SpamReportDialog({ open, onClose, leadId, leadNombre, onReported }: SpamReportDialogProps) {
  const [motivo, setMotivo] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  async function handleSubmit() {
    if (!leadId) return;
    setSubmitting(true);
    try {
      await client.post(`/leads/${leadId}/report-spam`, { motivo: motivo.trim() || null });
      toast({
        title: 'Reporte enviado',
        description: 'Un superadmin revisará el caso y decidirá si confirma el spam o lo descarta.',
      });
      setMotivo('');
      if (onReported) onReported();
      onClose();
    } catch (err: any) {
      const code = err?.data?.code;
      if (code === 'REPORT_ALREADY_PENDING') {
        toast({ title: 'Ya reportado', description: 'Este lead ya tiene un reporte pendiente.', variant: 'destructive' });
      } else {
        toast({ title: 'No se pudo enviar', description: err?.message || 'Error', variant: 'destructive' });
      }
    } finally { setSubmitting(false); }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => !submitting && onClose()}>
      <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 py-4 border-b border-border">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center flex-shrink-0">
              <WarningOctagon size={20} weight="duotone" />
            </div>
            <div>
              <h2 className="font-semibold text-lg">Reportar como spam</h2>
              <p className="text-xs text-muted-foreground mt-1">
                {leadNombre ? <>"{leadNombre}"</> : 'Este lead'} se marcará para revisión.
              </p>
            </div>
          </div>
          <button onClick={() => !submitting && onClose()} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground">
            <X size={16} weight="bold" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Levanta un reporte si el lead parece fraudulento o automatizado (mismo nombre repetido, email descartable, contenido obviamente bot).
            Un <strong className="text-foreground">superadmin</strong> revisa los reportes y decide si confirma (soft-delete) o descarta.
          </p>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
              Motivo (opcional)
            </label>
            <textarea
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Email descartable / contenido bot / duplicado de otro spam reciente…"
              className="w-full px-3 py-2 rounded-md border border-border bg-card text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 resize-none"
              maxLength={500}
            />
            <p className="text-[10px] text-muted-foreground mt-1 text-right tabular-nums">{motivo.length} / 500</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            className="h-9 px-4 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors"
          >Cancelar</button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !leadId}
            className="h-9 px-4 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {submitting ? 'Enviando…' : 'Reportar spam'}
          </button>
        </div>
      </div>
    </div>
  );
}
