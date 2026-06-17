import { lazy, Suspense, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useDashboard } from '@/shared/hooks/useDashboard';
import { useStripeMonitor } from '@/modules/ia-dashboard/hooks/useStripeMonitor';

const LeadDrawer = lazy(() => import('@/modules/leads/components/LeadDrawer'));
import {
  Users,
  Sparkle,
  CheckCircle,
  ChartLineUp,
  ArrowRight,
  WarningCircle,
  ArrowClockwise,
  CurrencyEur,
  TrendDown,
  ArrowUp as ArrowUpIcon,
  ArrowDown as ArrowDownIcon,
  CreditCard,
} from '@phosphor-icons/react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell,
} from 'recharts';
import StatusBadge from '@/shared/components/ui/StatusBadge';
import ChannelBadge, { CHANNEL_LABELS } from '@/shared/components/ui/ChannelBadge';
import EmptyState from '@/shared/components/ui/EmptyState';
import KpiCard from '@/shared/components/ui/KpiCard';
import PageHeader from '@/shared/components/ui/PageHeader';
import SkeletonTable, { SkeletonCard } from '@/shared/components/ui/SkeletonTable';
import ConversionFunnel from '@/shared/components/dashboard/ConversionFunnel';
import PerformanceInsights from '@/shared/components/dashboard/PerformanceInsights';
const TopProductsCard = lazy(() => import('@/modules/sales/components/TopProductsCard'));

const STATUS_BAR_COLORS = {
  nuevo: '#3b82f6',
  por_contactar: '#ea580c',
  contactado: '#059669',
  en_seguimiento: '#d97706',
  convertido: '#7c3aed',
  no_interesado: '#dc2626',
};

const CHANNEL_BAR_COLORS = {
  meta_ads: '#3b82f6',
  google_ads: '#eab308',
  tiktok_ads: '#ec4899',
  organico: '#10b981',
  chatgpt_ia: '#8b5cf6',
  directo: '#0ea5e9',
  referido: '#14b8a6',
  otro: '#64748b',
};

function CustomTooltip({ active, payload, label, suffix = 'leads' }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900 text-white text-xs font-semibold px-3 py-2 rounded-lg">
      {label}: <span className="text-blue-300">{payload[0].value} {suffix}</span>
    </div>
  );
}

function fmtMoney(n) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n || 0));
}
function fmtNum(n) { return new Intl.NumberFormat('es-ES').format(Number(n || 0)); }
function fmtPct(n) { return `${(Number(n) || 0).toFixed(2)}%`; }

function SaasMonitor({ projectId }) {
  const { metrics, mrrDelta, subsDelta, loading } = useStripeMonitor(projectId);
  if (loading) return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {[1,2,3,4].map(i => <div key={i} className="h-28 bg-muted/50 rounded-lg animate-pulse" />)}
    </div>
  );
  if (!metrics || metrics.mrr === 0) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <CreditCard size={16} className="text-violet-600" weight="duotone" />
        <h2 className="font-semibold text-sm">Monitor SaaS — Stripe</h2>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { icon: CurrencyEur, label: 'MRR actual', value: fmtMoney(metrics.mrr), delta: mrrDelta, color: 'text-violet-600 bg-violet-50 dark:bg-violet-950/30' },
          { icon: Users, label: 'Suscripciones activas', value: fmtNum(metrics.activeSubs), delta: subsDelta, color: 'text-blue-600 bg-blue-50 dark:bg-blue-950/30' },
          { icon: TrendDown, label: 'Churn rate', value: fmtPct(metrics.churnRate), tone: metrics.churnRate > 5 ? 'red' : 'emerald', color: metrics.churnRate > 5 ? 'text-red-600 bg-red-50 dark:bg-red-950/30' : 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30' },
          { icon: WarningCircle, label: 'Cobros fallidos', value: fmtNum(metrics.failedPayments), color: metrics.failedPayments > 0 ? 'text-amber-600 bg-amber-50 dark:bg-amber-950/30' : 'text-muted-foreground bg-muted' },
        ].map(({ icon: Icon, label, value, delta, color }) => (
          <div key={label} className="bg-card border border-border rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className={`w-8 h-8 rounded-md flex items-center justify-center ${color}`}>
                <Icon size={16} weight="duotone" />
              </div>
              {delta && (
                <span className={`text-[10px] font-bold flex items-center gap-0.5 ${delta.growing ? 'text-emerald-600' : 'text-red-500'}`}>
                  {delta.growing ? <ArrowUpIcon size={10} /> : <ArrowDownIcon size={10} />}
                  {Math.abs(delta.pct)}%
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-card border border-border rounded-lg p-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
            <ArrowUpIcon size={14} weight="bold" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Nuevas suscripciones (mes)</p>
            <p className="text-lg font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">+{metrics.newSubs}</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 flex items-center justify-center flex-shrink-0">
            <ArrowDownIcon size={14} weight="bold" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Cancelaciones (mes)</p>
            <p className="text-lg font-semibold tabular-nums text-red-700 dark:text-red-400">−{metrics.cancelledSubs}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { activeProject } = useProjectContext();
  const { stats, leadsRecientes, today, loading, error, refetch } = useDashboard();
  const [drawerLeadId, setDrawerLeadId] = useState(null);

  if (loading) {
    return (
      <div className="space-y-8">
        <PageHeader title="Dashboard" subtitle="Cargando datos..." />
        <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <SkeletonCard key={i} />)}
        </div>
        <SkeletonTable rows={5} columns={5} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-8">
        <PageHeader title="Dashboard" subtitle="Resumen de actividad" />
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-8 text-center">
          <WarningCircle size={40} className="text-red-500 mx-auto mb-3" weight="regular" />
          <p className="text-sm text-red-600 dark:text-red-400 font-semibold mb-1">No se pudieron cargar los datos</p>
          <p className="text-xs text-red-500/80 dark:text-red-400/80 mb-4">{error}</p>
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-900/40 hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors px-3 py-1.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:ring-offset-2"
          >
            <ArrowClockwise size={12} weight="bold" /> Reintentar
          </button>
        </div>
      </div>
    );
  }

  const total = stats.total || 0;
  const nuevos = (stats.nuevo || 0) + (stats.por_contactar || 0);
  const convertidos = stats.convertido || 0;
  const tasa = stats.conversionRate || 0;

  const statusBarData = [
    { key: 'nuevo', name: 'Nuevo', value: stats.nuevo || 0 },
    { key: 'por_contactar', name: 'Por contactar', value: stats.por_contactar || 0 },
    { key: 'contactado', name: 'Contactado', value: stats.contactado || 0 },
    { key: 'en_seguimiento', name: 'Seguimiento', value: stats.en_seguimiento || 0 },
    { key: 'convertido', name: 'Convertido', value: stats.convertido || 0 },
    { key: 'no_interesado', name: 'No interes.', value: stats.no_interesado || 0 },
  ];

  // Channel aggregation from recent leads (fallback display)
  const channelMap = {};
  for (const lead of leadsRecientes) {
    const k = lead.origen || 'otro';
    channelMap[k] = (channelMap[k] || 0) + 1;
  }
  const channelBarData = Object.entries(channelMap)
    .map(([k, v]) => ({ key: k, name: CHANNEL_LABELS[k] || k, value: v }))
    .sort((a, b) => b.value - a.value);

  const todayDate = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle={`${todayDate} - ${activeProject?.nombre || 'Sin proyecto'}`}
      />

      {/* SECCION HOY */}
      {today && (
        <div className="bg-gradient-to-br from-blue-50 to-violet-50 dark:from-blue-950/30 dark:to-violet-950/30 border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="font-semibold text-base">Tu dia de hoy</h2>
              <p className="text-xs text-muted-foreground">Seguimientos pendientes y actividad del dia</p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
            <button onClick={() => navigate('/prospectos?qf=urgent')}
              className="bg-card rounded-md p-3 border border-border text-left hover:border-orange-300 hover:bg-orange-50/30 dark:hover:bg-orange-950/10 transition-colors">
              <p className="text-xs font-medium text-muted-foreground">Pendientes</p>
              <p className="text-2xl font-semibold tabular-nums text-orange-600">{today.reminders_pendientes?.length || 0}</p>
              <p className="text-[10px] text-muted-foreground">reminders hoy</p>
            </button>
            <button onClick={() => navigate('/prospectos')}
              className="bg-card rounded-md p-3 border border-border text-left hover:border-blue-300 hover:bg-blue-50/30 dark:hover:bg-blue-950/10 transition-colors">
              <p className="text-xs font-medium text-muted-foreground">Nuevos</p>
              <p className="text-2xl font-semibold tabular-nums text-blue-600">{today.nuevos_hoy || 0}</p>
              <p className="text-[10px] text-muted-foreground">hoy ({today.nuevos_semana || 0} semana)</p>
            </button>
            <button onClick={() => navigate('/prospectos?qf=no-contact')}
              className="bg-card rounded-md p-3 border border-border text-left hover:border-amber-300 hover:bg-amber-50/30 dark:hover:bg-amber-950/10 transition-colors">
              <p className="text-xs font-medium text-muted-foreground">Inactivos</p>
              <p className="text-2xl font-semibold tabular-nums text-amber-600">{today.inactivos || 0}</p>
              <p className="text-[10px] text-muted-foreground">prospectos sin actividad</p>
            </button>
            <button onClick={() => navigate('/finanzas/por-cobrar')}
              className="bg-card rounded-md p-3 border border-border text-left hover:border-red-300 hover:bg-red-50/30 dark:hover:bg-red-950/10 transition-colors">
              <p className="text-xs font-medium text-muted-foreground">Cobros vencidos</p>
              <p className="text-2xl font-semibold tabular-nums text-red-600">{today.cobros_vencidos || 0}</p>
              <p className="text-[10px] text-muted-foreground">pagos atrasados</p>
            </button>
            <button onClick={() => navigate('/finanzas/ingresos')}
              className="bg-card rounded-md p-3 border border-border text-left hover:border-emerald-300 hover:bg-emerald-50/30 dark:hover:bg-emerald-950/10 transition-colors">
              <p className="text-xs font-medium text-muted-foreground">Ingresos hoy</p>
              <p className="text-2xl font-semibold tabular-nums text-emerald-600">{new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(today.ingresos_hoy || 0)}</p>
              <p className="text-[10px] text-muted-foreground">cobrado hoy</p>
            </button>
          </div>

          {/* Reminders pendientes */}
          {today.reminders_pendientes && today.reminders_pendientes.length > 0 ? (
            <div>
              <h3 className="text-xs font-medium text-muted-foreground mb-2">Seguimientos pendientes</h3>
              <div className="space-y-2">
                {today.reminders_pendientes.slice(0, 5).map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setDrawerLeadId(r.lead_id)}
                    className="w-full text-left bg-card border border-border rounded-md p-3 hover:bg-muted/30 transition-colors flex items-center gap-3"
                  >
                    <div className={`w-2 h-10 rounded-full ${r.vencido ? 'bg-red-500' : 'bg-orange-500'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm truncate">{r.lead_nombre}</span>
                        {r.vencido && <span className="text-[9px] font-bold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-1.5 py-0.5 rounded">VENCIDO</span>}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{r.nota || 'Sin nota'}</p>
                    </div>
                    <ArrowRight size={14} className="text-muted-foreground flex-shrink-0" />
                  </button>
                ))}
                {today.reminders_pendientes.length > 5 && (
                  <p className="text-xs text-center text-muted-foreground pt-1">
                    + {today.reminders_pendientes.length - 5} mas pendientes
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-lg p-4 text-center">
              <CheckCircle size={20} className="text-emerald-500 mx-auto mb-1" weight="regular" />
              <p className="text-sm font-semibold">Nada pendiente para hoy</p>
              <p className="text-xs text-muted-foreground">Al dia con los seguimientos</p>
            </div>
          )}
        </div>
      )}

      {/* Top KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={Users}
          iconBg="bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400"
          label="Total prospectos"
          numericValue={Number(total) || 0}
        />
        <KpiCard
          icon={Sparkle}
          iconBg="bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400"
          label="Nuevos"
          numericValue={Number(nuevos) || 0}
        />
        <KpiCard
          icon={CheckCircle}
          iconBg="bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400"
          label="Convertidos"
          numericValue={Number(convertidos) || 0}
          badge={`${tasa}%`}
          badgeColor="bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400"
          trend="up"
        />
        <KpiCard
          icon={ChartLineUp}
          iconBg="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"
          label="Tasa conversión"
          numericValue={Number(tasa) || 0}
          format={(n) => `${Math.round(n)}%`}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-card p-5 rounded-lg border border-border">
          <div className="mb-4">
            <h3 className="font-semibold">Prospectos por estado</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">Distribucion actual del pipeline</p>
          </div>
          {total === 0 ? (
            <div className="h-[220px] flex items-center justify-center">
              <p className="text-xs text-muted-foreground">Sin datos aun</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200} minHeight={180}>
              <BarChart data={statusBarData} barSize={36}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#a1a1aa', fontWeight: 600 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#a1a1aa' }} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
                <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                  {statusBarData.map((entry) => (
                    <Cell key={entry.key} fill={STATUS_BAR_COLORS[entry.key] || '#64748b'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-card p-5 rounded-lg border border-border">
          <div className="mb-4">
            <h3 className="font-semibold">Prospectos por canal</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">Origenes de los prospectos recientes</p>
          </div>
          {channelBarData.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center">
              <p className="text-xs text-muted-foreground">Sin datos aun</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200} minHeight={180}>
              <BarChart data={channelBarData} layout="vertical" barSize={18}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" horizontal={false} />
                <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#a1a1aa' }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} width={90} tick={{ fontSize: 11, fill: '#71717a', fontWeight: 600 }} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {channelBarData.map((entry) => (
                    <Cell key={entry.key} fill={CHANNEL_BAR_COLORS[entry.key] || '#64748b'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Embudo + Insights — content que acompana las graficas */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        <div className="lg:col-span-3">
          <ConversionFunnel stats={stats} total={total} />
        </div>
        <div className="lg:col-span-2">
          <PerformanceInsights stats={stats} today={today} recentLeads={leadsRecientes} />
        </div>
      </div>

      {/* Programas más vendidos */}
      <Suspense fallback={null}>
        <TopProductsCard projectId={activeProject?.id} days={null} limit={5} />
      </Suspense>

      {/* Monitor SaaS — solo proyectos IA */}
      {activeProject?.type === 'ia' && <SaasMonitor projectId={activeProject.id} />}

      {/* Recent Leads */}
      <div className="bg-card rounded-lg border border-border overflow-x-auto">
        <div className="p-4 flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Prospectos recientes</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">Ultimos 10 prospectos registrados</p>
          </div>
          <button
            onClick={() => navigate('/prospectos')}
            aria-label="Ver todos los prospectos"
            className="h-9 text-xs font-semibold text-muted-foreground hover:text-foreground border border-border bg-card px-3 rounded-lg hover:bg-muted transition-all duration-200 flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2"
          >
            <span className="hidden sm:inline">Ver todos</span> <ArrowRight size={12} weight="bold" />
          </button>
        </div>

        {leadsRecientes.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Sin prospectos registrados"
            description="Aun no hay prospectos para este proyecto. Apareceran aqui cuando alguien complete un formulario o llegue via webhook."
            action={
              <button
                onClick={() => navigate('/prospectos')}
                className="text-xs font-semibold text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 rounded"
              >
                Ir a Gestión de Prospectos
              </button>
            }
          />
        ) : (
          <>
            <div className="hidden md:block">
              <table className="w-full text-[13px]">
                <thead className="bg-muted/50 border-y">
                  <tr>
                    <th className="px-5 py-2.5 text-left text-xs text-muted-foreground">Nombre</th>
                    <th className="px-5 py-2.5 text-left text-xs text-muted-foreground">Email</th>
                    <th className="px-5 py-2.5 text-left text-xs text-muted-foreground">Origen</th>
                    <th className="px-5 py-2.5 text-left text-xs text-muted-foreground">Estado</th>
                    <th className="px-5 py-2.5 text-left text-xs text-muted-foreground">Gestor</th>
                  </tr>
                </thead>
                <tbody>
                  {leadsRecientes.map((lead) => (
                    <tr
                      key={lead.id}
                      className="border-b last:border-0 hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => setDrawerLeadId(lead.id)}
                    >
                      <td className="px-5 py-3 font-semibold">{lead.nombre}</td>
                      <td className="px-5 py-3 text-muted-foreground">{lead.email}</td>
                      <td className="px-5 py-3"><ChannelBadge channel={lead.origen} /></td>
                      <td className="px-5 py-3"><StatusBadge status={lead.estado} showIcon /></td>
                      <td className="px-5 py-3 text-muted-foreground">{lead.responsable_nombre || lead.gestor || 'Sin asignar'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden divide-y">
              {leadsRecientes.map((lead) => (
                <div
                  key={lead.id}
                  className="p-4 space-y-2 cursor-pointer active:bg-muted/50 transition-colors"
                  onClick={() => setDrawerLeadId(lead.id)}
                >
                  <p className="text-[13px] font-semibold">{lead.nombre}</p>
                  <p className="text-[13px] text-muted-foreground">{lead.email}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge status={lead.estado} />
                    <ChannelBadge channel={lead.origen} />
                    <span className="text-[12px] text-muted-foreground">{lead.responsable_nombre || lead.gestor || 'Sin asignar'}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <Suspense fallback={null}>
        <LeadDrawer
          leadId={drawerLeadId}
          open={drawerLeadId !== null}
          onClose={() => setDrawerLeadId(null)}
        />
      </Suspense>
    </div>
  );
}
