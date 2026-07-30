// Resumen del periodo: los cuatro KPI comparados con el periodo anterior y la
// gráfica grande con su selector de serie.
//
// Vive aquí y no dentro de una página porque los dos CRMs tienen que enseñar
// exactamente el mismo panel. Se alimenta solo de /reports/panel, así que lo
// único que necesita de fuera es el rango de fechas.
import { useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Users, Receipt, CurrencyEur, ChartLineUp, TrendUp, TrendDown } from '@phosphor-icons/react';
import client from '@/shared/api/client';

const ACCENT = {
  sky: { bg: 'bg-sky-50 dark:bg-sky-950/40', text: 'text-sky-600 dark:text-sky-400' },
  emerald: { bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-600 dark:text-emerald-400' },
  violet: { bg: 'bg-violet-50 dark:bg-violet-950/40', text: 'text-violet-600 dark:text-violet-400' },
  amber: { bg: 'bg-amber-50 dark:bg-amber-950/40', text: 'text-amber-600 dark:text-amber-400' },
};

const fmt = (n) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(Number(n || 0));
const fmtMoney = (n) => new Intl.NumberFormat('es-ES', {
  style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
}).format(Number(n || 0));

function Sparkline({ data, color = 'currentColor', height = 28 }) {
  const series = useMemo(() => (data || []).map((v, i) => ({ i, v: Number(v || 0) })), [data]);
  if (series.length < 2) return <div style={{ height }} className="w-full bg-muted/30 rounded" />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={series} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function Kpi({ icon: Icon, label, value, trend, spark, accent = 'sky' }) {
  const c = ACCENT[accent];
  const TrendIcon = trend >= 0 ? TrendUp : TrendDown;
  const trendCls = trend >= 0
    ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400'
    : 'text-rose-600 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-400';
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className={`w-8 h-8 rounded-md ${c.bg} ${c.text} flex items-center justify-center`}>
          <Icon size={15} weight="duotone" />
        </div>
        {trend != null && (
          <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${trendCls}`}>
            <TrendIcon size={9} weight="bold" />
            {Math.abs(trend)}%
          </span>
        )}
      </div>
      <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">{label}</div>
      <div className="text-xl font-semibold tabular-nums tracking-tight">{value}</div>
      {spark?.length > 0 && (
        <div className="mt-2 -mx-1 text-primary">
          <Sparkline data={spark} color="currentColor" height={28} />
        </div>
      )}
    </div>
  );
}

function HeroTooltip({ active, payload, label, formatea, color, prevValue }) {
  if (!active || !payload?.length) return null;
  const v = payload[0]?.value ?? 0;
  const delta = prevValue > 0 ? Math.round(((v - prevValue) / prevValue) * 100) : null;
  return (
    <div className="rounded-lg border border-border bg-card/95 backdrop-blur shadow-lg px-3 py-2 min-w-[140px]">
      <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-base font-semibold tabular-nums tracking-tight" style={{ color }}>{formatea(v)}</span>
        {delta != null && delta !== 0 && (
          <span className={`text-[10px] font-bold tabular-nums ${delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {delta >= 0 ? '+' : ''}{delta}%
          </span>
        )}
      </div>
    </div>
  );
}

export default function PanelResumen({ projectId, projectName, from, to }) {
  const [panel, setPanel] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [heroSerie, setHeroSerie] = useState('ingresos');

  // Los KPI comparados con el periodo anterior y la serie de la gráfica salen
  // los dos de /reports/panel, con el rango que manda la cabecera.
  useEffect(() => {
    let vivo = true;
    setCargando(true);
    const q = new URLSearchParams();
    if (projectId) q.set('projectId', String(projectId));
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    client.get(`/reports/panel?${q.toString()}`)
      .then((r) => { if (vivo) setPanel(r?.success ? r.data : null); })
      .catch(() => { if (vivo) setPanel(null); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [projectId, from, to]);

  const serie = panel?.serie || [];
  const chispa = (k) => serie.map((x) => Number(x[k] || 0));
  const kpi = (k, campo) => ({
    value: Number(panel?.kpis?.[k]?.value || 0),
    trend: panel?.kpis?.[k]?.trend ?? null,
    spark: chispa(campo),
  });
  const leads = kpi('prospectos', 'prospectos');
  const ventas = kpi('ventas', 'ventas');
  const ingresos = kpi('ingresos', 'ingresos');
  const tasa = kpi('tasa', 'tasa');

  const HERO_SERIES = {
    leads: { label: 'Prospectos', campo: 'prospectos', color: 'hsl(199 89% 48%)', fmt },
    ventas: { label: 'Ventas', campo: 'ventas', color: 'hsl(160 84% 39%)', fmt },
    ingresos: { label: 'Ingresos', campo: 'ingresos', color: 'hsl(258 90% 66%)', fmt: fmtMoney },
    tasa: { label: 'Tasa conv.', campo: 'tasa', color: 'hsl(43 96% 56%)', fmt: (v) => `${Math.round(v)}%` },
  };
  const heroActive = HERO_SERIES[heroSerie] || HERO_SERIES.ingresos;
  const heroCampo = heroActive.campo;
  // Cómo se llama cada punto de la serie, para no decir 'semana' cuando es un mes.
  const unidad = { day: 'día', week: 'semana', month: 'mes' }[panel?.rango?.grano || 'day'];
  // Lo que se ve en grande es lo del rango filtrado; la tasa no se suma, se usa
  // el porcentaje del periodo que ya calcula el backend.
  const heroKpiKey = { leads: 'prospectos', ventas: 'ventas', ingresos: 'ingresos', tasa: 'tasa' }[heroSerie] || 'ingresos';
  const heroRango = Number(panel?.kpis?.[heroKpiKey]?.value || 0);
  const trendRango = panel?.kpis?.[heroKpiKey]?.trend ?? null;
  const etiquetaRango = from && to
    ? `${new Date(`${from}T00:00:00`).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })} – ${new Date(`${to}T00:00:00`).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' })}`
    : 'periodo';

  // Cada punto trae su fecha real y su granularidad: no se inventan semanas.
  const heroData = useMemo(() => {
    const grano = panel?.rango?.grano || 'day';
    return serie.map((x) => {
      const d = new Date(`${x.periodo}T00:00:00`);
      const label = grano === 'month'
        ? d.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' })
        : d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
      return { label, value: Number(x[heroCampo] || 0) };
    });
  }, [serie, heroCampo, panel?.rango?.grano]);

  const heroTotal = heroData.reduce((s, d) => s + d.value, 0);
  const heroHasData = heroData.some((d) => d.value > 0);
  const heroLast = heroData[heroData.length - 1]?.value ?? 0;
  const heroMax = Math.max(...heroData.map((d) => d.value), 0);
  const heroAvg = heroData.length > 0 ? heroTotal / heroData.length : 0;

  const TrendIcon = (trendRango ?? 0) >= 0 ? TrendUp : TrendDown;
  const deltaCls = (trendRango ?? 0) >= 0
    ? 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-900/60'
    : 'text-rose-700 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300 border-rose-200/60 dark:border-rose-900/60';

  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="font-semibold tracking-tight">Resumen del periodo</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {etiquetaRango}
            {projectName ? ` · ${projectName}` : ''}
            {panel?.rango?.comparable === false && ' · sin periodo anterior con el que comparar'}
          </p>
        </div>
      </div>

      {cargando ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-32 rounded-xl bg-muted/40 animate-pulse" />)}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <Kpi icon={Users} label="Prospectos" value={fmt(leads.value)} trend={leads.trend} spark={leads.spark} accent="sky" />
            <Kpi icon={Receipt} label="Ventas" value={fmt(ventas.value)} trend={ventas.trend} spark={ventas.spark} accent="emerald" />
            <Kpi icon={CurrencyEur} label="Ingresos" value={fmtMoney(ingresos.value)} trend={ingresos.trend} spark={ingresos.spark} accent="violet" />
            <Kpi icon={ChartLineUp} label="Tasa conv." value={`${Math.round(Number(tasa.value || 0))}%`} trend={tasa.trend} spark={tasa.spark} accent="amber" />
          </div>

          <div className="relative rounded-2xl border border-border bg-gradient-to-br from-card via-card to-muted/20 overflow-hidden">
            <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 flex-wrap">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full"
                    style={{ background: heroActive.color, boxShadow: `0 0 12px ${heroActive.color}` }} />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    {heroActive.label} · {etiquetaRango}
                  </span>
                </div>
                <div className="flex items-baseline gap-3 flex-wrap">
                  {/* Manda lo filtrado, no el último punto de la serie. */}
                  <span className="text-3xl sm:text-4xl font-bold tabular-nums tracking-tight"
                    style={{ color: heroActive.color }}>
                    {heroActive.fmt(heroRango)}
                  </span>
                  {trendRango != null && (
                    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${deltaCls}`}>
                      <TrendIcon size={11} weight="bold" />
                      {trendRango >= 0 ? '+' : ''}{trendRango}%
                      <span className="opacity-60 ml-1">vs periodo anterior</span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
                  <span>Último {unidad}: <strong className="text-foreground tabular-nums">{heroActive.fmt(heroLast)}</strong></span>
                  <span className="opacity-40">·</span>
                  <span>Media por {unidad}: <strong className="text-foreground tabular-nums">{heroActive.fmt(Math.round(heroAvg))}</strong></span>
                  <span className="opacity-40">·</span>
                  <span>Pico: <strong className="text-foreground tabular-nums">{heroActive.fmt(heroMax)}</strong></span>
                </div>
              </div>

              <div className="inline-flex rounded-lg border border-border bg-card p-1 shadow-sm flex-shrink-0">
                {Object.entries(HERO_SERIES).map(([key, s]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setHeroSerie(key)}
                    className={`inline-flex items-center gap-1 px-3 h-7 rounded-md text-[11px] font-semibold transition-all ${
                      heroSerie === key ? 'shadow-sm text-white' : 'text-muted-foreground hover:text-foreground'
                    }`}
                    style={heroSerie === key ? { background: s.color } : undefined}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-56 sm:h-64 w-full px-2 pb-2">
              {heroHasData ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={heroData} margin={{ top: 16, right: 24, bottom: 4, left: 8 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke="hsl(var(--border))" vertical={false} strokeOpacity={0.6} />
                    <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))"
                      tick={{ fontSize: 10, fontWeight: 500 }} tickLine={false} axisLine={false}
                      tickMargin={8} interval="preserveStartEnd" minTickGap={28} />
                    <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 10 }}
                      tickLine={false} axisLine={false} width={44}
                      tickFormatter={(v) => {
                        if (heroSerie === 'ingresos') return v >= 1000 ? `${Math.round(v / 1000)}k €` : `${v} €`;
                        if (heroSerie === 'tasa') return `${v}%`;
                        return v;
                      }} />
                    <Tooltip
                      cursor={{ stroke: heroActive.color, strokeWidth: 1, strokeDasharray: '4 4', strokeOpacity: 0.5 }}
                      content={(props) => (
                        <HeroTooltip
                          {...props}
                          formatea={heroActive.fmt}
                          color={heroActive.color}
                          prevValue={(() => {
                            const idx = heroData.findIndex((d) => d.label === props.label);
                            return idx > 0 ? heroData[idx - 1].value : 0;
                          })()}
                        />
                      )}
                      wrapperStyle={{ outline: 'none' }}
                    />
                    <Line type="monotone" dataKey="value" stroke={heroActive.color} strokeWidth={2.5}
                      strokeLinecap="round" strokeLinejoin="round" isAnimationActive animationDuration={500}
                      animationEasing="ease-out"
                      dot={{ r: 3.5, stroke: heroActive.color, strokeWidth: 2, fill: 'hsl(var(--card))' }}
                      activeDot={{ r: 6, stroke: heroActive.color, strokeWidth: 2.5, fill: 'hsl(var(--card))' }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center px-6">
                  <ChartLineUp size={32} weight="duotone" className="text-muted-foreground/40 mb-2" />
                  <div className="font-medium text-sm">Sin datos para el periodo</div>
                  <p className="text-xs text-muted-foreground max-w-xs mt-1">
                    El gráfico se rellenará cuando haya actividad en {heroActive.label.toLowerCase()}.
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
