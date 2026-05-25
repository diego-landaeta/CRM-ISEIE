import { useEffect, useMemo, useState } from 'react';
import {
  Pulse, MagnifyingGlass, Pencil, Trash, SignIn,
  Plus, ArrowsClockwise, Calendar,
} from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';

const ACTION_TYPES = [
  { id: 'all',    label: 'Todas',         icon: Pulse,   prefix: null },
  { id: 'auth',   label: 'Sesiones',      icon: SignIn,  prefix: ['login', 'logout', 'auth.'] },
  { id: 'create', label: 'Creaciones',    icon: Plus,    prefix: ['.create', '.created', 'create.'] },
  { id: 'update', label: 'Cambios',       icon: Pencil,  prefix: ['.update', '.updated', '.change', 'update.'] },
  { id: 'delete', label: 'Eliminaciones', icon: Trash,   prefix: ['.delete', '.deleted', 'delete.'] },
];

function matchKind(action, kind) {
  if (kind === 'all') return true;
  const def = ACTION_TYPES.find((t) => t.id === kind);
  if (!def?.prefix) return false;
  const a = String(action || '').toLowerCase();
  return def.prefix.some((p) => a.includes(p));
}

function iconForAction(action) {
  const a = (action || '').toLowerCase();
  if (a.includes('login') || a.includes('logout') || a.startsWith('auth')) return SignIn;
  if (a.includes('create')) return Plus;
  if (a.includes('delete')) return Trash;
  if (a.includes('update') || a.includes('change')) return Pencil;
  return Pulse;
}

function colorForAction(action) {
  const a = (action || '').toLowerCase();
  if (a.includes('login') || a.includes('logout') || a.startsWith('auth')) return 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40';
  if (a.includes('create')) return 'text-[hsl(var(--iseie-green))] bg-[hsl(var(--iseie-green))]/10';
  if (a.includes('delete')) return 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40';
  if (a.includes('update') || a.includes('change')) return 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40';
  return 'text-muted-foreground bg-muted';
}

function formatRelative(d) {
  if (!d) return '—';
  const diffMs = Date.now() - new Date(d).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  try { return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }); }
  catch { return String(d).slice(0, 10); }
}

function formatExact(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return String(d); }
}

export default function ActivityPage() {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    client.get('/users/activity-log', { params: { limit: 200, search: search || undefined } })
      .then((r) => { if (!cancelled) setItems(Array.isArray(r?.data) ? r.data : (r?.data?.items || [])); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [search, refreshKey]);

  const filtered = useMemo(
    () => items.filter((it) => matchKind(it.action, filter)),
    [items, filter]
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Actividad</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Registro de auditoría: quién hizo qué y cuándo.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRefreshKey((k) => k + 1)}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-card border border-border text-sm font-medium hover:bg-muted transition-colors text-foreground"
        >
          <ArrowsClockwise size={14} weight="bold" className={loading ? 'animate-spin' : ''} />
          Actualizar
        </button>
      </header>

      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por usuario, acción o recurso…"
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-border bg-card text-foreground text-sm placeholder:text-muted-foreground focus:border-primary focus:bg-background focus:ring-2 focus:ring-primary/20 outline-none transition-all"
          />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {ACTION_TYPES.map((t) => (
            <button
              key={t.id}
              onClick={() => setFilter(t.id)}
              className={`flex-shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-sm font-medium transition-colors ${
                filter === t.id
                  ? 'bg-foreground text-background'
                  : 'bg-card border border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              <t.icon size={14} weight={filter === t.id ? 'fill' : 'regular'} />
              {t.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => toast({ title: 'Filtro por rango', description: 'Usa el selector "Tipo" para filtrar. Soporte de rangos personalizados llegará en próxima entrega.' })}
            className="flex-shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-card border border-border text-muted-foreground hover:text-foreground transition-colors text-sm"
          >
            <Calendar size={14} />
            Rango
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="hidden md:grid grid-cols-[1.2fr_1fr_1.5fr_0.8fr_0.7fr] gap-4 px-5 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <div>Usuario</div>
          <div>Acción</div>
          <div>Detalle</div>
          <div>IP</div>
          <div className="text-right">Cuándo</div>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground">Cargando…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-16 px-6">
            <div className="w-14 h-14 rounded-xl bg-muted flex items-center justify-center mb-4">
              <Pulse size={26} weight="duotone" className="text-muted-foreground" />
            </div>
            <h3 className="font-semibold text-foreground mb-1.5">
              {items.length === 0 ? 'Sin actividad reciente' : 'Sin resultados para este filtro'}
            </h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              {items.length === 0
                ? 'Las acciones de los usuarios aparecerán aquí conforme las realicen.'
                : 'Cambia el filtro o la búsqueda para ver el resto.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((it) => {
              const Icon = iconForAction(it.action);
              const colorClass = colorForAction(it.action);
              const details = it.details && typeof it.details === 'object'
                ? Object.entries(it.details).slice(0, 3)
                    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                    .join(' · ')
                : '';
              return (
                <div key={it.id} className="px-4 md:px-5 py-3 md:grid md:grid-cols-[1.2fr_1fr_1.5fr_0.8fr_0.7fr] md:gap-4 md:items-center text-sm">
                  {/* Fila 1 mobile (usuario + cuándo) ; col 1+5 desktop */}
                  <div className="flex items-center justify-between gap-3 md:contents">
                    <div className="flex items-center gap-2 min-w-0 md:flex-1">
                      <div className="w-7 h-7 rounded-full bg-muted text-foreground flex items-center justify-center text-[10px] font-semibold flex-shrink-0">
                        {(it.user_nombre || it.user_email || '?').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium truncate">{it.user_nombre || 'Desconocido'}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{it.user_email || '—'}</div>
                      </div>
                    </div>
                    <div className="text-right text-xs text-muted-foreground tabular-nums flex-shrink-0 md:order-5" title={formatExact(it.created_at)}>
                      {formatRelative(it.created_at)}
                    </div>
                  </div>
                  {/* Fila 2 mobile (acción) ; col 2 desktop */}
                  <div className="flex items-center gap-2 min-w-0 mt-2 md:mt-0 md:order-2">
                    <div className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${colorClass}`}>
                      <Icon size={14} weight="duotone" />
                    </div>
                    <code className="text-[11px] font-mono truncate">{it.action}</code>
                  </div>
                  {/* Fila 3 mobile (detalles) ; col 3 desktop */}
                  <div className="text-xs text-muted-foreground truncate mt-1 md:mt-0 md:order-3" title={details}>{details || '—'}</div>
                  {/* IP solo desktop ; col 4 */}
                  <div className="hidden md:block text-xs text-muted-foreground tabular-nums md:order-4">{it.ip_address || '—'}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
