import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  Users, Receipt, CurrencyEur, ChartLineUp, TrendUp, TrendDown,
  Plus, ArrowUpRight, ClockClockwise,
} from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { useDashboardSummary } from '@/shared/hooks/useDashboardSummary';

const PERIOD_OPTIONS = [
  { value: 7,   label: 'Últimos 7 días' },
  { value: 30,  label: 'Últimos 30 días' },
  { value: 90,  label: 'Últimos 90 días' },
  { value: 365, label: 'Últimos 12 meses' },
];

function formatMoney(n, currency = 'EUR') {
  const value = Number(n || 0);
  try {
    return new Intl.NumberFormat('es-ES', {
      style: 'currency', currency, maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${Math.round(value)} ${currency}`;
  }
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 6)  return 'Buenas noches';
  if (h < 13) return 'Buenos días';
  if (h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

function Sparkline({ data, color = 'currentColor' }) {
  const w = 100;
  const h = 28;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const step = w / (data.length - 1);
  const points = data.map((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return [x, y];
  });
  const path = points.reduce((acc, [x, y], i) => {
    if (i === 0) return `M ${x} ${y}`;
    const [px, py] = points[i - 1];
    const cx = (px + x) / 2;
    return `${acc} Q ${cx} ${py} ${cx} ${(py + y) / 2} T ${x} ${y}`;
  }, '');
  const area = `${path} L ${w} ${h} L 0 ${h} Z`;
  const gradId = `spark-${color.replace(/[^a-z0-9]/gi, '')}-${data.join('')}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-7 overflow-visible">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function KpiCard({ label, value, trend, icon: Icon, spark, loading }) {
  const TrendIcon = trend >= 0 ? TrendUp : TrendDown;
  const trendClass = trend >= 0
    ? 'text-[hsl(var(--iseie-green))] bg-[hsl(var(--iseie-green))]/10'
    : 'text-rose-600 bg-rose-50 dark:text-rose-400 dark:bg-rose-950/30';
  return (
    <div className="rounded-2xl bg-card border border-border p-5 hover:border-foreground/20 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="w-10 h-10 rounded-xl bg-muted text-muted-foreground flex items-center justify-center">
          <Icon size={18} weight="duotone" />
        </div>
        {!loading && trend != null && (
          <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold px-2 py-0.5 rounded-full ${trendClass}`}>
            <TrendIcon size={11} weight="bold" />
            {Math.abs(trend)}%
          </span>
        )}
      </div>
      <div className="mt-5">
        <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">{label}</div>
        {loading ? (
          <div className="h-8 w-24 bg-muted rounded animate-pulse" />
        ) : (
          <div className="text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
        )}
      </div>
      {spark && (
        <div className="mt-3 -mx-1 text-muted-foreground/40">
          <Sparkline data={spark} color="currentColor" />
        </div>
      )}
    </div>
  );
}

function ConversionRing({ value = 0 }) {
  const r = 38;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  const offset = circ - (pct / 100) * circ;
  return (
    <div className="relative w-24 h-24 flex-shrink-0">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
        <circle
          cx="50" cy="50" r={r} fill="none"
          stroke="hsl(var(--primary))" strokeWidth="8" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-xl font-semibold tabular-nums tracking-tight">{pct}%</div>
        <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">conv.</div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, activeProject } = useAuth();
  const [days, setDays] = useState(30);
  const { data: summary, loading } = useDashboardSummary(activeProject?.id, days);

  const firstName = user?.nombre?.split(' ')[0] || '';
  const initials = (user?.nombre || '?')
    .split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase();

  const leads        = summary?.leads        || { value: 0, trend: null, spark: [0,0,0,0,0,0,0,0] };
  const conversiones = summary?.conversiones || { value: 0, trend: null, spark: [0,0,0,0,0,0,0,0] };
  const ingresos     = summary?.ingresos     || { value: 0, trend: null, spark: [0,0,0,0,0,0,0,0] };
  const tasa         = summary?.tasa         || { value: 0, trend: null, spark: [0,0,0,0,0,0,0,0] };
  const conversionPct = Math.round(Number(tasa.value || 0));

  return (
    <div className="space-y-6">
      {/* HERO — saludo */}
      <section className="relative overflow-hidden rounded-2xl border border-border bg-card">
        {/* Decoracion sutil: patron de puntos solo, sin orbs de color */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.04] dark:opacity-[0.06]"
          style={{
            backgroundImage: 'radial-gradient(hsl(var(--foreground)) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
          }}
        />

        <div className="relative p-5 sm:p-6 lg:p-8 flex flex-col lg:flex-row lg:items-center gap-5 lg:gap-6">
          <div className="flex-1 min-w-0">
            <div className="inline-flex items-center px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[10px] font-semibold uppercase tracking-wider mb-3 ring-1 ring-primary/20">
              {activeProject?.nombre || 'Sin proyecto'}
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              {getGreeting()}{firstName ? `, ${firstName}` : ''}
            </h1>
            <p className="text-sm text-muted-foreground mt-2 max-w-lg">
              Aquí tienes un resumen de la actividad de los últimos {days} días en tu CRM.
            </p>

            <div className="flex flex-wrap items-center gap-2 mt-5">
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="h-9 px-3 pr-8 rounded-md bg-background border border-input text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
              >
                {PERIOD_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <Link
                to="/leads"
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <Plus size={14} weight="bold" />
                Nuevo prospecto
              </Link>
            </div>
          </div>

          {/* Lado derecho: ring de conversion + avatar neutro */}
          <div className="flex items-center gap-4 sm:gap-5 flex-shrink-0 self-start lg:self-auto">
            <ConversionRing value={conversionPct} />
            <div className="hidden sm:flex flex-col items-center">
              <div className="w-14 h-14 rounded-full bg-muted text-foreground font-semibold text-base flex items-center justify-center border border-border">
                {initials}
              </div>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mt-2">
                {user?.role || 'usuario'}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* KPIs — bento con sparklines, cableados a /leads/dashboard-summary */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Prospectos nuevos"
          value={String(leads.value)}
          trend={leads.trend}
          icon={Users} loading={loading}
          spark={leads.spark}
        />
        <KpiCard
          label="Ventas cerradas"
          value={String(conversiones.value)}
          trend={conversiones.trend}
          icon={Receipt} loading={loading}
          spark={conversiones.spark}
        />
        <KpiCard
          label="Ingresos"
          value={formatMoney(ingresos.value)}
          trend={ingresos.trend}
          icon={CurrencyEur} loading={loading}
          spark={ingresos.spark}
        />
        <KpiCard
          label="Tasa conversión"
          value={`${conversionPct} %`}
          trend={tasa.trend}
          icon={ChartLineUp} loading={loading}
          spark={tasa.spark}
        />
      </section>

      {/* Bento principal: actividad (8) + columna derecha (4) */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Actividad reciente */}
        <div className="lg:col-span-8 rounded-2xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border">
            <div>
              <h3 className="font-semibold tracking-tight">Actividad reciente</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Últimos prospectos, interacciones y ventas.</p>
            </div>
            <Link to="/leads" className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1">
              Ver todo <ArrowUpRight size={12} weight="bold" />
            </Link>
          </div>
          <div className="p-6">
            <div className="flex flex-col items-center justify-center text-center py-10">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
                <ClockClockwise size={22} className="text-muted-foreground" weight="duotone" />
              </div>
              <div className="font-medium text-sm mb-1">Sin actividad reciente</div>
              <div className="text-xs text-muted-foreground max-w-xs">
                Cuando lleguen prospectos o se registren ventas aparecerán aquí en orden cronológico.
              </div>
            </div>
          </div>
        </div>

        {/* Columna derecha: accesos + ayuda */}
        <div className="lg:col-span-4 space-y-4">
          {/* Accesos rápidos */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="font-semibold tracking-tight mb-4">Accesos rápidos</h3>
            <div className="space-y-0.5">
              {[
                { to: '/leads',       label: 'Ver prospectos',     icon: Users },
                { to: '/products',    label: 'Catálogo productos', icon: Receipt },
                { to: '/commissions', label: 'Comisiones',         icon: CurrencyEur },
              ].map((q) => (
                <Link
                  key={q.to}
                  to={q.to}
                  className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-muted text-sm transition-colors group"
                >
                  <div className="w-8 h-8 rounded-md bg-muted text-muted-foreground group-hover:text-foreground flex items-center justify-center flex-shrink-0 transition-colors">
                    <q.icon size={16} weight="duotone" />
                  </div>
                  <span className="flex-1 font-medium">{q.label}</span>
                  <ArrowUpRight size={13} weight="bold" className="text-muted-foreground/40 group-hover:text-foreground transition-colors" />
                </Link>
              ))}
            </div>
          </div>

          {/* Card de ayuda — neutra */}
          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="font-semibold tracking-tight">¿Necesitas ayuda?</h3>
            <p className="text-xs text-muted-foreground mt-1.5 mb-3 leading-relaxed">
              Consulta el manual del CRM o contacta con el equipo.
            </p>
            <Link to="/manual" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              Abrir documentación
              <ArrowUpRight size={12} weight="bold" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
