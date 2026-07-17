// Tarjeta "Prospectos + Ventas (descargable)" en Análisis › Reportes.
// Combina en un solo CSV todos los prospectos INCLUYENDO los que ya son venta
// (convertidos). Es el destino del atajo que hay en Prospectos.
import { useState } from 'react';
import { FileCsv, UsersThree, DownloadSimple } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import { downloadLeadsReport } from '@/shared/lib/leadsReport';

// Calcula un rango [desde, hasta] a partir de un nº de días hacia atrás.
function rangeFromDays(days) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (Number(days) || 30));
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

export default function LeadsVentasDownload({ projectId, projectName, days = 30 }) {
  const [includeConverted, setIncludeConverted] = useState(true);
  const [byPeriod, setByPeriod] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handle() {
    setBusy(true);
    try {
      const r = byPeriod ? rangeFromDays(days) : null;
      const n = await downloadLeadsReport(
        {
          projectId,
          dateFrom: r ? r.from : undefined,
          dateTo: r ? r.to : undefined,
          includeConverted,
        },
        { filename: `prospectos-ventas-${projectName || 'crm'}-${byPeriod ? `${r.from}_${r.to}` : 'todo'}` },
      );
      toast({ title: 'Descarga lista', description: `${n} registro${n === 1 ? '' : 's'} exportado${n === 1 ? '' : 's'}.` });
    } catch (err) {
      toast({ title: 'No se pudo generar el archivo', description: err?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <UsersThree size={18} weight="bold" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-foreground">Prospectos + Ventas (descargable)</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Un solo archivo con todos los prospectos {byPeriod ? 'del período' : '(histórico completo)'}
            {includeConverted ? ', incluyendo los que ya son venta' : ''}. Para análisis, sin sobrecargar Prospectos.
          </p>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer select-none">
              <input type="checkbox" checked={includeConverted} onChange={(e) => setIncludeConverted(e.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/40" />
              Incluir ventas (convertidos)
            </label>
            <label className="inline-flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer select-none">
              <input type="checkbox" checked={byPeriod} onChange={(e) => setByPeriod(e.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/40" />
              Limitar al período seleccionado
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button type="button" disabled={busy} onClick={handle}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40">
              <FileCsv size={14} weight="bold" /> {busy ? 'Generando…' : 'Descargar CSV'}
            </button>
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <DownloadSimple size={12} /> {projectName || 'Proyecto actual'}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
