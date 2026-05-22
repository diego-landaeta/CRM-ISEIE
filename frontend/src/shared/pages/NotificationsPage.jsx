import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bell, BellSlash, Funnel, Check, Users, Receipt, CalendarPlus,
  WarningCircle, Clock, ArrowsClockwise, ArrowRight,
} from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import client from '@/shared/api/client';

const TONE = {
  primary: 'text-primary bg-primary/10',
  amber:   'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40',
  rose:    'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40',
  green:   'text-[hsl(var(--iseie-green))] bg-[hsl(var(--iseie-green))]/10',
  sky:     'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40',
};

function formatDate(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  } catch { return String(d).slice(0, 10); }
}

function buildFeed(summary) {
  if (!summary) return [];
  const feed = [];

  for (const r of summary.reminders_pendientes || []) {
    feed.push({
      id: `rem-${r.id}`,
      kind: r.vencido ? 'reminds_overdue' : 'reminds',
      icon: r.vencido ? WarningCircle : CalendarPlus,
      tone: r.vencido ? 'rose' : 'amber',
      title: r.vencido ? 'Recordatorio vencido' : 'Recordatorio pendiente',
      detail: `${r.lead_nombre || r.lead_email || `Lead #${r.lead_id}`} — ${r.nota || 'sin nota'}`,
      meta: formatDate(r.fecha_recordatorio),
      link: `/leads/${r.lead_id}`,
    });
  }

  if ((summary.nuevos_hoy || 0) > 0) {
    feed.push({
      id: 'leads-today',
      kind: 'leads',
      icon: Users,
      tone: 'sky',
      title: `${summary.nuevos_hoy} prospecto${summary.nuevos_hoy === 1 ? '' : 's'} nuevo${summary.nuevos_hoy === 1 ? '' : 's'} hoy`,
      detail: 'Recién creados o asignados desde el round-robin',
      meta: 'hoy',
      link: '/leads',
    });
  }

  if ((summary.inactivos || 0) > 0) {
    feed.push({
      id: 'leads-inactive',
      kind: 'leads',
      icon: Clock,
      tone: 'amber',
      title: `${summary.inactivos} lead${summary.inactivos === 1 ? '' : 's'} inactivo${summary.inactivos === 1 ? '' : 's'}`,
      detail: 'Sin interacciones durante el umbral del proyecto',
      meta: 'pendiente',
      link: '/leads',
    });
  }

  if ((summary.cobros_vencidos || 0) > 0) {
    feed.push({
      id: 'sales-overdue',
      kind: 'sales',
      icon: Receipt,
      tone: 'rose',
      title: `${summary.cobros_vencidos} cobro${summary.cobros_vencidos === 1 ? '' : 's'} vencido${summary.cobros_vencidos === 1 ? '' : 's'}`,
      detail: 'Conversiones con fecha de pago comprometida superada',
      meta: 'urgente',
      link: '/sales',
    });
  }

  if ((summary.ingresos_hoy || 0) > 0) {
    feed.push({
      id: 'sales-today',
      kind: 'sales',
      icon: Receipt,
      tone: 'green',
      title: `Cobros del día: ${new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(summary.ingresos_hoy)}`,
      detail: 'Suma de pagos registrados hoy',
      meta: 'hoy',
      link: '/sales',
    });
  }

  return feed;
}

export default function NotificationsPage() {
  const { activeProject } = useAuth();
  const [filter, setFilter] = useState('all');
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = activeProject?.id ? { projectId: activeProject.id } : {};
    client.get('/leads/today', { params })
      .then((r) => { if (!cancelled) setSummary(r.data?.data || null); })
      .catch(() => { if (!cancelled) setSummary(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeProject?.id, refreshKey]);

  const feed = useMemo(() => buildFeed(summary), [summary]);

  const counts = useMemo(() => {
    const acc = { all: feed.length, leads: 0, sales: 0, reminds: 0 };
    for (const item of feed) {
      if (item.kind === 'leads') acc.leads++;
      else if (item.kind === 'sales' || item.kind === 'sales-overdue') acc.sales++;
      else if (item.kind === 'reminds' || item.kind === 'reminds_overdue') acc.reminds++;
    }
    return acc;
  }, [feed]);

  const FILTERS = [
    { id: 'all',     label: 'Todas',         icon: Bell },
    { id: 'reminds', label: 'Recordatorios', icon: CalendarPlus },
    { id: 'leads',   label: 'Prospectos',    icon: Users },
    { id: 'sales',   label: 'Ventas',        icon: Receipt },
  ];

  const filtered = filter === 'all'
    ? feed
    : feed.filter((it) =>
        filter === 'reminds' ? (it.kind === 'reminds' || it.kind === 'reminds_overdue')
        : filter === 'sales' ? (it.kind === 'sales' || it.kind === 'sales-overdue')
        : it.kind === filter
      );

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Notificaciones</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Recordatorios, leads inactivos y cobros vencidos del proyecto activo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-card border border-border text-sm font-medium hover:bg-muted transition-colors text-foreground"
          >
            <ArrowsClockwise size={14} weight="bold" className={loading ? 'animate-spin' : ''} />
            Actualizar
          </button>
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            title="Las notificaciones se calculan en vivo; recargar fuerza un refresh"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-card border border-border text-sm font-medium hover:bg-muted transition-colors text-foreground"
          >
            <Check size={14} weight="bold" />
            Marcar todas vistas
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-5">
        <aside className="rounded-2xl border border-border bg-card p-2 h-fit">
          {FILTERS.map((f) => {
            const c = counts[f.id] || 0;
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
                  filter === f.id
                    ? 'bg-primary/10 text-primary font-semibold'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <f.icon size={15} weight={filter === f.id ? 'duotone' : 'regular'} />
                <span className="flex-1 text-left truncate">{f.label}</span>
                {c > 0 && (
                  <span className={`inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-full text-[10px] font-semibold ${
                    filter === f.id ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                  }`}>
                    {c}
                  </span>
                )}
              </button>
            );
          })}
        </aside>

        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div className="text-sm">
              <span className="font-semibold">{FILTERS.find((f) => f.id === filter)?.label}</span>
              <span className="text-muted-foreground ml-2">· {filtered.length} notificaciones</span>
            </div>
          </div>

          {loading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Cargando…</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-16 px-6">
              <div className="w-14 h-14 rounded-xl bg-muted flex items-center justify-center mb-4">
                <BellSlash size={26} weight="duotone" className="text-muted-foreground" />
              </div>
              <h3 className="font-semibold text-foreground mb-1.5">Sin notificaciones</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                {feed.length === 0
                  ? 'Cuando haya recordatorios pendientes, leads inactivos o cobros vencidos aparecerán aquí.'
                  : 'Cambia el filtro para ver el resto.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((it) => (
                <Link
                  key={it.id}
                  to={it.link}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors group"
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${TONE[it.tone] || TONE.primary}`}>
                    <it.icon size={18} weight="duotone" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{it.title}</div>
                    <div className="text-xs text-muted-foreground truncate">{it.detail}</div>
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex-shrink-0">
                    {it.meta}
                  </div>
                  <ArrowRight size={14} weight="bold" className="text-muted-foreground/40 group-hover:text-foreground group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
