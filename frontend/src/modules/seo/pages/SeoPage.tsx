import { useProjectContext } from '@/contexts/ProjectContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import KpiCard from '@/shared/components/ui/KpiCard';
import EmptyState from '@/shared/components/ui/EmptyState';
import { useOrganicTraffic, PRESET_PERIODS, type Preset } from '../hooks/useOrganicTraffic';
import {
  MagnifyingGlass, MouseSimple, ChartLineUp, Ranking, Info, Globe, WarningCircle,
} from '@phosphor-icons/react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

function fmtNum(n: number | null | undefined): string {
  return new Intl.NumberFormat('es-ES').format(Number(n || 0));
}
function fmtPct(n: number | null | undefined): string {
  return `${(Number(n) || 0).toFixed(2)}%`;
}
function fmtPos(n: number | null | undefined): string {
  return Number(n || 0).toFixed(1);
}
function fmtDate(s: string | null | undefined): string {
  if (!s) return '';
  const d = new Date(s);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtMes(s: string | null | undefined): string {
  // "2026-04" -> "abr 26"
  const [y, m] = (s || '').split('-');
  if (!y) return String(s ?? '');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' });
}

export default function SeoPage() {
  const { activeProject } = useProjectContext();
  const seo = useOrganicTraffic(activeProject?.id);

  if (!activeProject) {
    return (
      <div className="space-y-6">
        <PageHeader title="Tráfico orgánico" subtitle="Selecciona un proyecto para ver datos de Google Search Console" />
        <EmptyState icon={Globe} title="Sin proyecto" description="Elige un proyecto del selector lateral" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="Tráfico orgánico"
        subtitle={`${activeProject.nombre} — Google Search Console`}
      />

      {/* Banner: retraso GSC + ultima actualizacion */}
      <div className="flex items-start gap-3 px-4 py-3 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900">
        <Info size={16} weight="regular" className="text-amber-600 mt-0.5 flex-shrink-0" />
        <div className="text-sm">
          <p className="text-amber-800 dark:text-amber-300">
            Datos con retraso de 2-3 dias respecto a la actividad real (limitacion de Google Search Console).
          </p>
          {seo.metrics.lastUpdate && (
            <p className="text-xs text-amber-700/80 dark:text-amber-400/80 mt-0.5">
              Ultima actualizacion: <span className="font-semibold">{fmtDate(seo.metrics.lastUpdate)}</span>
            </p>
          )}
        </div>
      </div>

      {/* Filtro de periodo */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <span className="text-xs text-muted-foreground flex-shrink-0">Periodo</span>
        {Object.entries(PRESET_PERIODS).map(([k, v]) => (
          <button
            key={k}
            onClick={() => { seo.setCustomRange(null); seo.setPreset(k as Preset); }}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              seo.preset === k && !seo.customRange ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {v.label}
          </button>
        ))}
        <div className="flex items-center gap-1 ml-auto flex-shrink-0">
          <input type="date" value={seo.range.fechaDesde}
            onChange={e => seo.setCustomRange({ ...seo.range, fechaDesde: e.target.value })}
            className="h-8 px-2 rounded-md border border-border bg-card text-xs" />
          <span className="text-xs text-muted-foreground">→</span>
          <input type="date" value={seo.range.fechaHasta}
            onChange={e => seo.setCustomRange({ ...seo.range, fechaHasta: e.target.value })}
            className="h-8 px-2 rounded-md border border-border bg-card text-xs" />
        </div>
      </div>

      {seo.error ? (
        <div className="p-8 text-center text-sm bg-card border border-border rounded-lg">
          <WarningCircle size={28} className="text-red-500 mx-auto mb-2" weight="regular" />
          <p className="text-red-600 font-semibold mb-1">No se pudieron cargar las metricas</p>
          <p className="text-xs text-muted-foreground">{seo.error}</p>
        </div>
      ) : seo.loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-28 bg-muted/50 rounded-lg animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* KPIs GSC */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            <KpiCard icon={MouseSimple} label="Clicks" value={fmtNum(seo.metrics.totals?.clicks)} />
            <KpiCard icon={MagnifyingGlass} label="Impresiones" value={fmtNum(seo.metrics.totals?.impressions)} />
            <KpiCard icon={ChartLineUp} label="CTR medio" value={fmtPct(seo.metrics.totals?.ctr)} />
            <KpiCard icon={Ranking} label="Posicion media" value={fmtPos(seo.metrics.totals?.position)} />
          </div>

          {/* Grafica consolidada: organico + pagado + leads */}
          <div className="bg-card border border-border rounded-lg p-5">
            <div className="flex items-center justify-between mb-1 gap-3">
              <h3 className="font-semibold">Tráfico orgánico vs pagado vs leads</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-4">Evolución mensual últimos 12 meses (organic GSC + paid Meta+Google)</p>
            {seo.consolidated.months.length === 0 ? (
              <EmptyState icon={ChartLineUp} title="Sin datos consolidados" description="Aún no hay histórico mensual" />
            ) : (
              <ResponsiveContainer width="100%" height={260} minHeight={220}>
                <LineChart data={seo.consolidated.months} margin={{ top: 5, right: 12, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#f3f4f6" />
                  <XAxis dataKey="mes" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} tickFormatter={fmtMes} />
                  <YAxis yAxisId="left" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => v >= 1000 ? `${v/1000}k` : v} />
                  <YAxis yAxisId="right" orientation="right" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 12 }}
                    formatter={(v, name) => [fmtNum(Number(v)), String(name)]} labelFormatter={(v) => fmtMes(String(v))} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  <Line yAxisId="left" type="monotone" dataKey="organicTraffic" name="Orgánico" stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981', r: 3 }} />
                  <Line yAxisId="left" type="monotone" dataKey="paidTraffic" name="Pagado (Meta+Google)" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6', r: 3 }} />
                  <Line yAxisId="right" type="monotone" dataKey="totalLeads" name="Prospectos CRM" stroke="#8b5cf6" strokeWidth={2} dot={{ fill: '#8b5cf6', r: 3 }} strokeDasharray="4 3" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Top 20 keywords */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold">Top 20 keywords</h3>
              <span className="text-xs text-muted-foreground">{seo.metrics.rows.length} totales</span>
            </div>

            {seo.metrics.rows.length === 0 ? (
              <EmptyState icon={MagnifyingGlass} title="Sin keywords" description="No hay datos de busqueda en este periodo" />
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-[11px] text-muted-foreground">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-bold">Keyword</th>
                        <th className="text-right px-4 py-2.5 font-bold">Clicks</th>
                        <th className="text-right px-4 py-2.5 font-bold">Impresiones</th>
                        <th className="text-right px-4 py-2.5 font-bold">CTR</th>
                        <th className="text-right px-4 py-2.5 font-bold">Posicion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {seo.metrics.rows.slice(0, 20).map((r, i) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-3 font-medium truncate max-w-[320px]">{r.key}</td>
                          <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmtNum(r.clicks)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{fmtNum(r.impressions)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{fmtPct(r.ctr)}</td>
                          <td className="px-4 py-3 text-right">
                            <PositionBadge value={r.position} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="md:hidden divide-y divide-border">
                  {seo.metrics.rows.slice(0, 20).map((r, i) => (
                    <div key={i} className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-sm break-words">{r.key}</div>
                        <PositionBadge value={r.position} />
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <div className="text-muted-foreground">Clicks</div>
                          <div className="tabular-nums font-semibold">{fmtNum(r.clicks)}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Impresiones</div>
                          <div className="tabular-nums">{fmtNum(r.impressions)}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">CTR</div>
                          <div className="tabular-nums">{fmtPct(r.ctr)}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function PositionBadge({ value }: { value: number | null | undefined }) {
  const v = Number(value || 0);
  let color = 'bg-muted text-muted-foreground';
  if (v > 0 && v <= 3) color = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400';
  else if (v <= 10) color = 'bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400';
  else if (v <= 20) color = 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400';
  else color = 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400';
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold tabular-nums ${color}`}>
      {fmtPos(value)}
    </span>
  );
}
