import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ChartLineUp, ChartBar, ChartPie, ChartDonut, Download,
  Users, Receipt, CurrencyEur, ArrowsClockwise, TrendUp, TrendDown,
  Sparkle, CheckCircle, X,
} from '@phosphor-icons/react';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { useAuth } from '@/contexts/AuthContext';
import { useDashboardSummary } from '@/shared/hooks/useDashboardSummary';
import client from '@/shared/api/client';
import ReportsDownloadSection from '@/shared/components/ReportsDownloadSection';
import AsesorasPanel from '@/shared/components/AsesorasPanel';

const REPORT_CATEGORIES = [
  {
    title: 'Prospectos',
    description: 'Volumen, canales, conversiones y tiempo de respuesta.',
    icon: Users,
    accent: 'sky',
    reports: [
      { label: 'Nuevos prospectos por canal', icon: ChartBar },
      { label: 'Tasa de conversión por gestor', icon: ChartLineUp },
      { label: 'Tiempo medio hasta primer contacto', icon: ChartPie },
    ],
  },
  {
    title: 'Ventas',
    description: 'Ingresos, productos top y desempeño temporal.',
    icon: Receipt,
    accent: 'emerald',
    reports: [
      { label: 'Ingresos por producto', icon: ChartBar },
      { label: 'Ventas mes a mes', icon: ChartLineUp },
      { label: 'Distribución por método de pago', icon: ChartDonut },
    ],
  },
  {
    title: 'Comisiones',
    description: 'A pagar, pagadas y comparativa entre gestores.',
    icon: CurrencyEur,
    accent: 'violet',
    reports: [
      { label: 'Comisiones del mes', icon: ChartBar },
      { label: 'Ranking de gestores', icon: ChartLineUp },
    ],
  },
];

const ACCENT = {
  sky:     { bg: 'bg-sky-50 dark:bg-sky-950/30',         text: 'text-sky-600 dark:text-sky-400' },
  emerald: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-600 dark:text-emerald-400' },
  violet:  { bg: 'bg-violet-50 dark:bg-violet-950/30',   text: 'text-violet-600 dark:text-violet-400' },
  amber:   { bg: 'bg-amber-50 dark:bg-amber-950/30',     text: 'text-amber-600 dark:text-amber-400' },
};

// Rango de fechas del panel. Los presets solo rellenan las dos fechas, para que
// se pueda afinar a mano sin perder los atajos.
function rangoDePreset(key) {
  const hoy = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const haceDias = (n) => iso(new Date(hoy.getTime() - n * 86400000));
  if (key === 'ytd') return { from: `${hoy.getFullYear()}-01-01`, to: iso(hoy) };
  if (key === 'all') return { from: '2026-01-01', to: iso(hoy) };
  const dias = { '7d': 7, '30d': 30, '90d': 90 }[key] || 30;
  return { from: haceDias(dias), to: iso(hoy) };
}

const PERIODS = {
  '7d':  { label: 'Últimos 7 días',   days: 7 },
  '30d': { label: 'Últimos 30 días',  days: 30 },
  '90d': { label: 'Últimos 90 días',  days: 90 },
  'ytd': { label: 'Año en curso',     days: Math.max(1, Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86400000)) },
  'all': { label: 'Todo',             days: 730 },
};

function fmt(n) {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(Number(n || 0));
}
function fmtMoney(n) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n || 0));
}

function Sparkline({ data, color = 'hsl(var(--primary))', height = 32 }) {
  const series = useMemo(
    () => (data || []).map((v, i) => ({ i, v: Number(v || 0) })),
    [data],
  );
  if (series.length < 2) {
    return <div style={{ height }} className="w-full bg-muted/30 rounded" />;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={series} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
        <Line
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function HeroTooltip({ active, payload, label, fmt, color, prevValue }) {
  if (!active || !payload?.length) return null;
  const v = payload[0]?.value ?? 0;
  const delta = prevValue > 0 ? Math.round(((v - prevValue) / prevValue) * 100) : null;
  return (
    <div className="rounded-lg border border-border bg-card/95 backdrop-blur shadow-lg px-3 py-2 min-w-[140px]">
      <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">{label}</div>
      <div className="flex items-baseline gap-2">
        <span className="text-base font-semibold tabular-nums tracking-tight" style={{ color }}>{fmt(v)}</span>
        {delta != null && delta !== 0 && (
          <span className={`text-[10px] font-bold tabular-nums ${delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {delta >= 0 ? '+' : ''}{delta}%
          </span>
        )}
      </div>
    </div>
  );
}

function HeroChart({ heroActive, heroSerie, setHeroSerie, HERO_SERIES, heroData, heroHasData, heroTotal, heroLast, heroDelta, heroAvg, heroMax, unidad = 'periodo', heroRango = 0, trendRango = null, etiquetaRango = 'periodo' }) {
  const TrendIcon = (trendRango ?? 0) >= 0 ? TrendUp : TrendDown;
  const deltaCls = (trendRango ?? 0) >= 0
    ? 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-900/60'
    : 'text-rose-700 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300 border-rose-200/60 dark:border-rose-900/60';

  return (
    <div className="relative rounded-2xl border border-border bg-gradient-to-br from-card via-card to-muted/20 overflow-hidden">
      {/* Header con KPI grande + delta + serie toggle */}
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: heroActive.color, boxShadow: `0 0 12px ${heroActive.color}` }}
            />
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              {heroActive.label} · {etiquetaRango}
            </span>
          </div>
          <div className="flex items-baseline gap-3 flex-wrap">
            {/* Manda lo filtrado, no el ultimo punto de la serie. */}
            <span
              className="text-3xl sm:text-4xl font-bold tabular-nums tracking-tight"
              style={{ color: heroActive.color }}
            >
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
                heroSerie === key
                  ? 'shadow-sm text-white'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              style={heroSerie === key ? { background: s.color } : undefined}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="h-56 sm:h-64 w-full px-2 pb-2">
        {heroHasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={heroData} margin={{ top: 16, right: 24, bottom: 4, left: 8 }}>
              <CartesianGrid
                strokeDasharray="2 4"
                stroke="hsl(var(--border))"
                vertical={false}
                strokeOpacity={0.6}
              />
              <XAxis
                dataKey="label"
                stroke="hsl(var(--muted-foreground))"
                tick={{ fontSize: 10, fontWeight: 500 }}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                interval="preserveStartEnd"
                minTickGap={28}
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={44}
                tickFormatter={(v) => {
                  if (heroSerie === 'ingresos') {
                    if (v >= 1000) return `${Math.round(v / 1000)}k €`;
                    return `${v} €`;
                  }
                  if (heroSerie === 'tasa') return `${v}%`;
                  return v;
                }}
              />
              <Tooltip
                cursor={{ stroke: heroActive.color, strokeWidth: 1, strokeDasharray: '4 4', strokeOpacity: 0.5 }}
                content={(props) => (
                  <HeroTooltip
                    {...props}
                    fmt={heroActive.fmt}
                    color={heroActive.color}
                    prevValue={(() => {
                      const idx = heroData.findIndex((d) => d.label === props.label);
                      return idx > 0 ? heroData[idx - 1].value : 0;
                    })()}
                  />
                )}
                wrapperStyle={{ outline: 'none' }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={heroActive.color}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                isAnimationActive
                animationDuration={500}
                animationEasing="ease-out"
                dot={{ r: 3.5, stroke: heroActive.color, strokeWidth: 2, fill: 'hsl(var(--card))' }}
                activeDot={{ r: 6, stroke: heroActive.color, strokeWidth: 2.5, fill: 'hsl(var(--card))' }}
              />
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

export default function ReportsPage() {
  const { activeProject, user } = useAuth();
  const [periodKey, setPeriodKey] = useState('30d');
  const [rango, setRango] = useState(() => rangoDePreset('30d'));
  const [panel, setPanel] = useState(null);

  // El resumen sale de /reports/panel: KPIs comparados con el periodo
  // anterior y la serie de la grafica, todo con el rango de arriba.
  useEffect(() => {
    let vivo = true;
    const q = new URLSearchParams();
    if (activeProject?.id) q.set('projectId', String(activeProject.id));
    if (rango.from) q.set('from', rango.from);
    if (rango.to) q.set('to', rango.to);
    client.get(`/reports/panel?${q.toString()}`)
      .then((r) => { if (vivo) setPanel(r.success ? r.data : null); })
      .catch(() => { if (vivo) setPanel(null); });
    return () => { vivo = false; };
  }, [activeProject?.id, rango.from, rango.to]);
  const days = PERIODS[periodKey].days;
  const { data: summary, loading } = useDashboardSummary(activeProject?.id, days);
  const [iaModal, setIaModal] = useState(false);
  const [claudeConfigured, setClaudeConfigured] = useState(false);
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  useEffect(() => {
    if (!isAdmin) return;
    client.get('/credentials')
      .then((res) => {
        const list = res?.data || [];
        setClaudeConfigured(list.some((c) => c.service === 'claude'));
      })
      .catch(() => {});
  }, [isAdmin]);

  // La serie del panel alimenta tanto los KPI como la grafica.
  const serie = panel?.serie || [];
  const chispa = (k) => serie.map((x) => Number(x[k] || 0));
  const kpi = (k, campo) => ({
    value: Number(panel?.kpis?.[k]?.value || 0),
    trend: panel?.kpis?.[k]?.trend ?? null,
    spark: chispa(campo),
  });
  const leads        = kpi('prospectos', 'prospectos');
  const conversiones = kpi('ventas', 'ventas');
  const ingresos     = kpi('ingresos', 'ingresos');
  const tasa         = kpi('tasa', 'tasa');

  const [heroSerie, setHeroSerie] = useState('ingresos');
  const HERO_SERIES = {
    leads:        { label: 'Prospectos', campo: 'prospectos', spark: leads.spark,        color: 'hsl(199 89% 48%)',  fmt: (v) => fmt(v) },
    conversiones: { label: 'Ventas',     campo: 'ventas',     spark: conversiones.spark, color: 'hsl(160 84% 39%)',  fmt: (v) => fmt(v) },
    ingresos:     { label: 'Ingresos',   campo: 'ingresos',   spark: ingresos.spark,     color: 'hsl(258 90% 66%)',  fmt: (v) => fmtMoney(v) },
    tasa:         { label: 'Tasa conv.', campo: 'tasa',       spark: tasa.spark,         color: 'hsl(43 96% 56%)',   fmt: (v) => `${Math.round(v)}%` },
  };
  const heroActive = HERO_SERIES[heroSerie] || HERO_SERIES.ingresos;
  const heroCampo = heroActive.campo;
  // Como se llama cada punto de la serie, para no decir 'semana' cuando es un mes.
  const unidad = { day: 'día', week: 'semana', month: 'mes' }[panel?.rango?.grano || 'day'];
  // Lo que se ve en grande es lo del rango filtrado; para la tasa no se suma,
  // se usa el porcentaje del periodo que ya calcula el backend.
  const heroKpiKey = { leads: 'prospectos', conversiones: 'ventas', ingresos: 'ingresos', tasa: 'tasa' }[heroSerie] || 'ingresos';
  const heroRango = Number(panel?.kpis?.[heroKpiKey]?.value || 0);
  const trendRango = panel?.kpis?.[heroKpiKey]?.trend ?? null;
  const etiquetaRango = rango.from && rango.to
    ? `${new Date(`${rango.from}T00:00:00`).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })} – ${new Date(`${rango.to}T00:00:00`).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: '2-digit' })}`
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
  const heroPrev = heroData[heroData.length - 2]?.value ?? 0;
  const heroDelta = heroPrev > 0 ? Math.round(((heroLast - heroPrev) / heroPrev) * 100) : heroLast > 0 ? 100 : 0;
  const heroMax = Math.max(...heroData.map((d) => d.value), 0);
  const heroAvg = heroData.length > 0 ? heroTotal / heroData.length : 0;


  // Se baja en Excel exactamente lo que se ve arriba: el resumen comparado, la
  // serie de la grafica y el detalle por asesora. Tres hojas en un solo archivo.
  const [bajando, setBajando] = useState(false);
  const [bajandoPdf, setBajandoPdf] = useState(false);
  // El PDF se descarga directo, sin diálogo de impresión. Lleva lo mismo que
  // el Excel: resumen, evolución y asesoras.
  async function descargarPdf() {
    if (!panel) return;
    setBajandoPdf(true);
    try {
      const q = new URLSearchParams();
      if (activeProject?.id) q.set('projectId', String(activeProject.id));
      if (rango.from) q.set('from', rango.from);
      if (rango.to) q.set('to', rango.to);
      const ase = await client.get(`/reports/asesoras-mes?${q.toString()}`).catch(() => null);
      const { exportPanelPDF } = await import('@/shared/lib/exportPanelPdf');
      const nombre = await exportPanelPDF({
        panel, asesoras: ase?.data || [], proyecto: activeProject?.nombre, rango,
      });
      toast({ title: 'PDF descargado', description: nombre });
    } catch (err) {
      console.error('descargarPdf', err);
      toast({ title: 'No se pudo generar el PDF', description: String(err?.message || err), variant: 'destructive' });
    } finally { setBajandoPdf(false); }
  }

  async function descargarPanel() {
    if (!panel) return;
    setBajando(true);
    try {
      const q = new URLSearchParams();
      if (activeProject?.id) q.set('projectId', String(activeProject.id));
      if (rango.from) q.set('from', rango.from);
      if (rango.to) q.set('to', rango.to);
      const ase = await client.get(`/reports/asesoras-mes?${q.toString()}`).catch(() => null);

      const writeXlsxFile = (await import('write-excel-file/browser')).default;
      const cab = (t) => ({ value: t, fontWeight: 'bold' });

      const hojaResumen = [
        [cab('Metrica'), cab('Periodo actual'), cab('Periodo anterior'), cab('Variacion %')],
        ...Object.entries(panel.kpis).map(([k, v]) => [
          { value: k }, { value: Number(v.value) },
          { value: Number(v.prev) }, { value: v.trend == null ? null : Number(v.trend) },
        ]),
      ];
      const hojaSerie = [
        [cab('Periodo'), cab('Prospectos'), cab('Ventas'), cab('Vendido EUR'), cab('Ingresos EUR'), cab('Tasa %')],
        ...(panel.serie || []).map((x) => [
          { value: x.periodo }, { value: Number(x.prospectos) }, { value: Number(x.ventas) },
          { value: Number(x.vendido) }, { value: Number(x.ingresos) }, { value: Number(x.tasa) },
        ]),
      ];
      const filasAse = (ase?.data || []);
      const hojaAsesoras = [
        [cab('Mes'), cab('Asesora'), cab('Leads'), cab('Ventas'), cab('Clientes'),
         cab('Tasa %'), cab('Vendido EUR'), cab('Cobrado EUR'), cab('Ticket medio EUR')],
        ...filasAse.map((r) => [
          { value: r.mes }, { value: r.asesora }, { value: Number(r.leads) },
          { value: Number(r.ventas) }, { value: Number(r.clientes) }, { value: Number(r.tasa_conversion) },
          { value: Number(r.vendido) }, { value: Number(r.cobrado) }, { value: Number(r.ticket_medio) },
        ]),
      ];

      const nombre = `reportes-${activeProject?.nombre || 'crm'}-${rango.from}_${rango.to}.xlsx`
        .replace(/\s+/g, '-');
      // Multi-hoja: la libreria espera [{ sheet, data }], no [data] con {sheets}.
      await writeXlsxFile([
        { sheet: 'Resumen', data: hojaResumen },
        { sheet: 'Evolucion', data: hojaSerie },
        { sheet: 'Asesoras', data: hojaAsesoras },
      ]).toFile(nombre);
      toast({ title: 'Excel descargado', description: `${(panel.serie || []).length} periodos y ${filasAse.length} filas de asesoras.` });
    } catch (err) {
      console.error('descargarPanel', err);
      toast({ title: 'No se pudo generar el Excel', description: String(err?.message || err), variant: 'destructive' });
    } finally { setBajando(false); }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Reportes</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Métricas de negocio del CRM. Genera, descarga y comparte.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={periodKey}
            onChange={(e) => { setPeriodKey(e.target.value); setRango(rangoDePreset(e.target.value)); }}
            className="h-9 px-3 rounded-md bg-card border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            {Object.entries(PERIODS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
          </select>
          {/* Las fechas mandan: los presets solo las rellenan. */}
          <input
            type="date"
            value={rango.from}
            max={rango.to || undefined}
            onChange={(e) => setRango((v) => ({ ...v, from: e.target.value }))}
            className="h-9 px-2 rounded-md bg-card border border-border text-sm"
            aria-label="Desde"
          />
          <input
            type="date"
            value={rango.to}
            min={rango.from || undefined}
            onChange={(e) => setRango((v) => ({ ...v, to: e.target.value }))}
            className="h-9 px-2 rounded-md bg-card border border-border text-sm"
            aria-label="Hasta"
          />
          <button
            type="button"
            onClick={descargarPanel}
            disabled={bajando || !panel}
            title="Descarga en Excel el resumen, la evolucion y el detalle por asesora"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40"
          >
            <Download size={14} weight="bold" />
            {bajando ? 'Generando…' : 'Descargar Excel'}
          </button>
          <button
            type="button"
            onClick={descargarPdf}
            disabled={bajandoPdf || !panel}
            title="Descarga el resumen, la evolución y las asesoras en PDF"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-card border border-border text-sm font-medium hover:bg-muted transition-colors text-foreground"
          >
            <Download size={14} weight="bold" />
            {bajandoPdf ? 'Generando…' : 'Descargar PDF'}
          </button>
        </div>
      </header>

      {/* Hero — Resumen del periodo cableado a /leads/dashboard-summary */}
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-semibold tracking-tight">Resumen del periodo</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {PERIODS[periodKey].label}
              {activeProject?.nombre ? ` · ${activeProject.nombre}` : ''}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-32 rounded-xl bg-muted/40 animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <Kpi icon={Users}       label="Prospectos"  value={fmt(leads.value)}        trend={leads.trend}        spark={leads.spark}        accent="sky" />
              <Kpi icon={Receipt}     label="Ventas"      value={fmt(conversiones.value)} trend={conversiones.trend} spark={conversiones.spark} accent="emerald" />
              <Kpi icon={CurrencyEur} label="Ingresos"    value={fmtMoney(ingresos.value)} trend={ingresos.trend}    spark={ingresos.spark}     accent="violet" />
              <Kpi icon={ChartLineUp} label="Tasa conv."  value={`${Math.round(Number(tasa.value || 0))}%`} trend={tasa.trend} spark={tasa.spark} accent="amber" />
            </div>

            <HeroChart
              heroActive={heroActive}
              heroSerie={heroSerie}
              setHeroSerie={setHeroSerie}
              HERO_SERIES={HERO_SERIES}
              heroData={heroData}
              heroHasData={heroHasData}
              heroTotal={heroTotal}
              heroLast={heroLast}
              heroDelta={heroDelta}
              heroAvg={heroAvg}
              heroMax={heroMax}
            unidad={unidad}
            heroRango={heroRango}
            trendRango={trendRango}
            etiquetaRango={etiquetaRango}
          />
          </>
        )}
      </div>

      {/* Reportes descargables (varios, con rango de fechas) */}
      {isAdmin && (
        <>
          {/* Los numeros por asesora. El detalle se baja en la seccion de abajo. */}
          <AsesorasPanel from={rango.from} to={rango.to} />

          <ReportsDownloadSection projectId={activeProject?.id} projectName={activeProject?.nombre} from={rango.from} to={rango.to} />
        </>
      )}

      {/* Categorías de reportes */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold tracking-tight">Reportes disponibles</h2>
          <button
            type="button"
            onClick={() => window.location.reload()}
            title="Refrescar todos los datos del reporte"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <ArrowsClockwise size={12} />
            Actualizar
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {REPORT_CATEGORIES.map((cat) => {
            const c = ACCENT[cat.accent];
            return (
              <div key={cat.title} className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="p-5 border-b border-border">
                  <div className={`w-10 h-10 rounded-lg ${c.bg} ${c.text} flex items-center justify-center mb-3`}>
                    <cat.icon size={20} weight="duotone" />
                  </div>
                  <h3 className="font-semibold text-foreground">{cat.title}</h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{cat.description}</p>
                </div>
                <div className="p-2">
                  {cat.reports.map((r) => (
                    <button
                      key={r.label}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted text-sm text-left transition-colors group"
                    >
                      <r.icon size={15} weight="duotone" className="text-muted-foreground group-hover:text-primary transition-colors" />
                      <span className="flex-1 text-foreground">{r.label}</span>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 opacity-0 group-hover:opacity-100 transition-opacity">
                        Ver
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
            <Sparkle size={20} weight="duotone" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold tracking-tight flex items-center gap-2">
              Reportes IA
              {claudeConfigured && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  <CheckCircle size={10} weight="fill" /> Conectado
                </span>
              )}
            </h3>
            <p className="text-xs text-muted-foreground mt-1 mb-3 max-w-lg leading-relaxed">
              Genera reportes ejecutivos mensuales analizados con Claude AI — qué funcionó, qué bajó, qué requiere atención.
              {!claudeConfigured && ' Requiere configurar API key de Anthropic.'}
            </p>
            <button
              onClick={() => setIaModal(true)}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-card border border-primary/30 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
            >
              <Sparkle size={12} weight="duotone" />
              {claudeConfigured ? 'Generar reporte' : 'Activar reportes IA'}
            </button>
          </div>
        </div>
      </div>

      {iaModal && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setIaModal(false)}
        >
          <div
            className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                  <Sparkle size={20} weight="duotone" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">Reportes con IA</h3>
                  <p className="text-xs text-muted-foreground mt-1">Análisis ejecutivo automático con Claude.</p>
                </div>
              </div>
              <button onClick={() => setIaModal(false)} className="text-muted-foreground hover:text-foreground" aria-label="Cerrar">
                <X size={16} weight="bold" />
              </button>
            </div>

            {claudeConfigured ? (
              <>
                <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                  Tienes la API key de Claude configurada. La generación de reportes ejecutivos
                  mensuales con IA estará activa en la próxima entrega (Q3 2026). Mientras tanto,
                  los KPIs y gráficos de esta página ya son productivos.
                </p>
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                  <CheckCircle size={12} weight="fill" />
                  Anthropic Claude conectado y verificado.
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
                  Para activar los reportes con IA necesitas una <strong className="text-foreground">API key de Anthropic</strong> (Claude).
                  Se cifra con AES-256-GCM en la base de datos y nunca sale del servidor.
                </p>
                <ol className="text-xs text-muted-foreground space-y-1.5 mb-5 list-decimal pl-5">
                  <li>Crea una key en <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-primary hover:underline">console.anthropic.com</a>.</li>
                  <li>Cópiala (empieza por <code className="text-[10px] bg-muted px-1 py-0.5 rounded">sk-ant-…</code>).</li>
                  <li>Pégala en Configuración → APIs globales → Anthropic Claude.</li>
                </ol>
                {isAdmin ? (
                  <Link
                    to="/settings"
                    onClick={() => setIaModal(false)}
                    className="inline-flex items-center justify-center w-full gap-1.5 h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
                  >
                    Ir a Configuración
                  </Link>
                ) : (
                  <p className="text-xs text-amber-700 dark:text-amber-400 italic">Pídele a un admin que configure la API key.</p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
