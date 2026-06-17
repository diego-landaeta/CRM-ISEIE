import { useProjectContext } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import { useStripeMonitor } from '../hooks/useStripeMonitor';
import MetricLabel from '@/shared/components/ui/MetricLabel';
import useCountUp from '@/shared/hooks/useCountUp';
import {
  CurrencyEur, Users, TrendDown, ArrowUp, ArrowDown,
  WarningCircle, CreditCard, Robot, type Icon,
} from '@phosphor-icons/react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';

type Numeric = number | null | undefined;

function fmtMoney(n: Numeric): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n || 0));
}
function fmtMoney2(n: Numeric): string {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(Number(n || 0));
}
function fmtNum(n: Numeric): string {
  return new Intl.NumberFormat('es-ES').format(Number(n || 0));
}
function fmtPct(n: Numeric): string {
  return `${(Number(n) || 0).toFixed(2)}%`;
}
function fmtMes(s: string | null | undefined): string {
  const [y, m] = (s || '').split('-');
  if (!y) return String(s ?? '');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' });
}

export default function IADashboardPage() {
  const { user } = useAuth();
  const { activeProject } = useProjectContext();
  const { metrics, mrrDelta, subsDelta, churnTrend, loading, error } = useStripeMonitor(activeProject?.id);

  // Solo SA/A (por si alguien navega directo)
  if (user && user.role !== 'superadmin' && user.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  const isIaProject = activeProject?.type === 'ia';
  const hasData = metrics && metrics.mrr > 0;

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="Dashboard IA"
        subtitle={activeProject ? `${activeProject.nombre} — Stripe SaaS Monitor` : 'Selecciona un proyecto IA'}
      />

      {!activeProject ? (
        <div className="bg-card border border-border rounded-lg">
          <EmptyState icon={Robot} title="Sin proyecto" description="Elige un proyecto IA del selector lateral" />
        </div>
      ) : !isIaProject && !loading ? (
        <div className="bg-card border border-border rounded-lg">
          <EmptyState
            icon={Robot}
            title="Proyecto no IA"
            description={`${activeProject.nombre} es un proyecto CRM. El dashboard IA solo aplica a proyectos tipo "ia" (Psicologo IA, Nutricionista IA, Tarot IA).`}
          />
        </div>
      ) : error ? (
        <div className="p-8 text-center text-sm bg-card border border-border rounded-lg">
          <WarningCircle size={28} className="text-red-500 mx-auto mb-2" weight="regular" />
          <p className="text-red-600 font-semibold mb-1">No se pudieron cargar las metricas</p>
          <p className="text-xs text-muted-foreground">{error}</p>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-32 bg-muted/50 rounded-lg animate-pulse" />)}
        </div>
      ) : !hasData ? (
        <div className="bg-card border border-border rounded-lg">
          <EmptyState
            icon={CreditCard}
            title="Sin datos de Stripe"
            description={`Aun no hay suscripciones registradas en Stripe para ${activeProject.nombre}, o las credenciales no estan configuradas.`}
          />
        </div>
      ) : (
        <>
          {/* KPI cards principales */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            <KpiHero
              icon={CurrencyEur}
              label="MRR actual"
              term="MRR"
              numericValue={metrics.mrr}
              format={fmtMoney}
              delta={mrrDelta}
              tone="primary"
            />
            <KpiHero
              icon={Users}
              label="Suscripciones activas"
              numericValue={metrics.activeSubs}
              format={fmtNum}
              delta={subsDelta}
              tone="success"
            />
            <KpiHero
              icon={TrendDown}
              label="Churn rate mensual"
              term="Churn"
              numericValue={metrics.churnRate}
              format={fmtPct}
              delta={churnTrend ? { pct: churnTrend.delta, growing: !churnTrend.improving, suffix: 'pp' } : null}
              tone={metrics.churnRate > 5 ? 'destructive' : 'default'}
            />
            <KpiHero
              icon={WarningCircle}
              label="Cobros fallidos"
              numericValue={metrics.failedPayments}
              format={fmtNum}
              tone={metrics.failedPayments > 0 ? 'warning' : 'default'}
            />
          </div>

          {/* Movimientos del mes (cards secundarias) */}
          <div className="grid grid-cols-2 md:grid-cols-2 gap-3 sm:gap-4">
            <div className="bg-card p-5 rounded-lg border border-border">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-9 h-9 rounded-md bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 flex items-center justify-center">
                  <ArrowUp size={18} weight="bold" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Nuevas suscripciones (mes)</p>
                  <p className="text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">+{metrics.newSubs}</p>
                </div>
              </div>
            </div>
            <div className="bg-card p-5 rounded-lg border border-border">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-9 h-9 rounded-md bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 flex items-center justify-center">
                  <ArrowDown size={18} weight="bold" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Cancelaciones (mes)</p>
                  <p className="text-2xl font-semibold tabular-nums text-red-700 dark:text-red-400">−{metrics.cancelledSubs}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Charts: MRR + Churn */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* MRR evolution */}
            <div className="bg-card border border-border rounded-lg p-5">
              <div className="flex items-baseline justify-between mb-1 gap-3">
                <h3 className="font-semibold">Evolucion MRR</h3>
                {mrrDelta && (
                  <span className={`text-xs font-semibold ${mrrDelta.growing ? 'text-emerald-600' : 'text-red-600'}`}>
                    {mrrDelta.growing ? '↑' : '↓'} {Math.abs(mrrDelta.pct)}% vs mes anterior
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mb-4">Ultimos 12 meses</p>
              <ResponsiveContainer width="100%" height={220} minHeight={200}>
                <LineChart data={metrics.evolution12Months} margin={{ top: 5, right: 12, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#f3f4f6" />
                  <XAxis dataKey="mes" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} tickFormatter={fmtMes} />
                  <YAxis stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => v >= 1000 ? `${Math.round(v/1000)}k` : v} />
                  <Tooltip
                    contentStyle={{ borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 12 }}
                    formatter={(v) => fmtMoney2(Number(v))}
                    labelFormatter={(v) => fmtMes(String(v))}
                  />
                  <Line type="monotone" dataKey="mrr" name="MRR" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6', r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Churn rate evolution */}
            <div className="bg-card border border-border rounded-lg p-5">
              <div className="flex items-baseline justify-between mb-1 gap-3">
                <h3 className="font-semibold"><MetricLabel term="Churn">Churn rate mensual</MetricLabel></h3>
                {churnTrend && (
                  <span className={`text-xs font-semibold ${churnTrend.improving ? 'text-emerald-600' : 'text-red-600'}`}>
                    {churnTrend.improving ? '↓' : '↑'} {Math.abs(churnTrend.delta)} pp vs mes ant.
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mb-4">Tendencia de cancelaciones</p>
              <ResponsiveContainer width="100%" height={220} minHeight={200}>
                <BarChart data={metrics.evolution12Months} margin={{ top: 5, right: 12, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="#f3f4f6" />
                  <XAxis dataKey="mes" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} tickFormatter={fmtMes} />
                  <YAxis stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                  <Tooltip
                    cursor={{ fill: '#f9fafb' }}
                    contentStyle={{ borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 12 }}
                    formatter={(v) => fmtPct(Number(v))}
                    labelFormatter={(v) => fmtMes(String(v))}
                  />
                  <ReferenceLine y={5} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'Alerta 5%', position: 'right', fill: '#ef4444', fontSize: 10 }} />
                  <Bar dataKey="churnRate" name="Churn" fill="#ef4444" radius={[3, 3, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart Subs activas evolution */}
          <div className="bg-card border border-border rounded-lg p-5">
            <h3 className="font-semibold mb-1">Suscripciones activas</h3>
            <p className="text-xs text-muted-foreground mb-4">Acumulado mensual de subs activas</p>
            <ResponsiveContainer width="100%" height={200} minHeight={180}>
              <LineChart data={metrics.evolution12Months} margin={{ top: 5, right: 12, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="#f3f4f6" />
                <XAxis dataKey="mes" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} tickFormatter={fmtMes} />
                <YAxis stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 12 }}
                  formatter={(v) => fmtNum(Number(v))}
                  labelFormatter={(v) => fmtMes(String(v))}
                />
                <Line type="monotone" dataKey="activeSubs" name="Subs activas" stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981', r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}

type Tone = 'primary' | 'success' | 'warning' | 'destructive' | 'default';

interface KpiHeroProps {
  icon: Icon;
  label: string;
  term?: string;
  value?: string | number;
  numericValue?: number;
  format?: (n: number) => string;
  delta?: { pct: number; growing: boolean; suffix?: string } | null;
  tone?: Tone;
}

function KpiHero({ icon: Icon, label, term, value, numericValue, format, delta, tone = 'default' }: KpiHeroProps) {
  const iconBg = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
    destructive: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400',
    default: 'bg-muted text-muted-foreground',
  }[tone] || 'bg-muted text-muted-foreground';

  const useAnimation = typeof numericValue === 'number' && Number.isFinite(numericValue);
  const animated = useCountUp(useAnimation ? numericValue : 0);
  const display = useAnimation
    ? (format ? format(animated) : Math.round(animated))
    : value;

  return (
    <div className="bg-card p-5 rounded-lg border border-border">
      <div className="flex items-center justify-between mb-3">
        <div className={`w-9 h-9 rounded-md flex items-center justify-center ${iconBg}`}>
          <Icon size={18} weight="regular" />
        </div>
        {delta && (
          <span className={`text-xs font-semibold inline-flex items-center gap-0.5 ${delta.growing ? 'text-emerald-600' : 'text-red-600'}`}>
            {delta.growing ? <ArrowUp size={11} weight="bold" /> : <ArrowDown size={11} weight="bold" />}
            {Math.abs(delta.pct)}{delta.suffix || '%'}
          </span>
        )}
      </div>
      <p className="text-muted-foreground text-sm">
        {term ? <MetricLabel term={term}>{label}</MetricLabel> : label}
      </p>
      <h3 className="text-2xl font-semibold mt-1 tabular-nums">{display}</h3>
    </div>
  );
}
