// Diálogo de descarga de reportes con rango de fechas (Prospectos). Dos modos:
//  - 'leads'  → Prospectos + Ventas (incluye convertidos)
//  - 'ventas' → Ventas (conversiones)
import { useState } from 'react';
import { X, FileCsv, CalendarBlank } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import { toast } from '@/shared/hooks/useToast';
import { downloadLeadsReport, downloadVentasReport } from '@/shared/lib/leadsReport';

export default function ReportDownloadDialog({ open, onClose, mode, projectId, projectName }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;
  const esVentas = mode === 'ventas';
  const titulo = esVentas ? 'Reporte de ventas' : 'Reporte de prospectos + ventas';

  async function descargar() {
    setBusy(true);
    try {
      const dateFrom = from || undefined;
      const dateTo = to || undefined;
      const sufijo = from || to ? `${from || 'inicio'}_${to || 'hoy'}` : 'todo';
      const base = `${esVentas ? 'ventas' : 'prospectos-ventas'}-${projectName || 'crm'}-${sufijo}`;
      const n = esVentas
        ? await downloadVentasReport({ projectId, dateFrom, dateTo }, { filename: base })
        : await downloadLeadsReport({ projectId, dateFrom, dateTo, includeConverted: true }, { filename: base });
      toast({ title: 'Descarga lista', description: `${n} registro${n === 1 ? '' : 's'} exportado${n === 1 ? '' : 's'}.` });
      onClose();
    } catch (err) {
      toast({ title: 'No se pudo generar el reporte', description: err?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
        <div className="w-full max-w-md rounded-lg border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-foreground">{titulo}</h3>
            <button onClick={onClose} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
          </div>

          <div className="p-4 space-y-4">
            <p className="text-xs text-muted-foreground">
              {esVentas
                ? 'Ventas cerradas del período: cliente, producto, importe, pagado/pendiente, método y fecha.'
                : 'Todos los prospectos del período, incluyendo los que ya son venta (estado “Convertido”).'}
              {' '}Deja las fechas vacías para el histórico completo.
            </p>

            <div className="flex items-end gap-2">
              <label className="flex-1 text-xs font-medium text-foreground">
                Desde
                <div className="mt-1 flex items-center gap-1 rounded-md border border-border bg-card px-2">
                  <CalendarBlank size={14} className="text-muted-foreground" />
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                    className="h-9 w-full bg-transparent text-sm focus:outline-none" />
                </div>
              </label>
              <label className="flex-1 text-xs font-medium text-foreground">
                Hasta
                <div className="mt-1 flex items-center gap-1 rounded-md border border-border bg-card px-2">
                  <CalendarBlank size={14} className="text-muted-foreground" />
                  <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                    className="h-9 w-full bg-transparent text-sm focus:outline-none" />
                </div>
              </label>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button type="button" disabled={busy} onClick={descargar}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40">
                <FileCsv size={14} weight="bold" /> {busy ? 'Generando…' : 'Descargar CSV'}
              </button>
              <span className="ml-auto text-[11px] text-muted-foreground">{projectName || 'Proyecto actual'}</span>
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}
