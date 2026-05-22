import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, MagnifyingGlass, Funnel, Users, ArrowsClockwise,
  UserPlus, ArrowRight, Trash,
} from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';

const LeadFormDialog = lazy(() => import('../components/LeadFormDialog'));
const CsvImportDialog = lazy(() => import('../components/CsvImportDialog'));
const BulkActionBar = lazy(() => import('../components/BulkActionBar'));

const STATUS_DEF = [
  { id: 'all',            label: 'Todos',         badge: '' },
  { id: 'nuevo',          label: 'Nuevo',         badge: 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300' },
  { id: 'por_contactar',  label: 'Por contactar', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' },
  { id: 'contactado',     label: 'Contactado',    badge: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300' },
  { id: 'en_seguimiento', label: 'En seguimiento', badge: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300' },
  { id: 'convertido',     label: 'Convertido',    badge: 'bg-[hsl(var(--iseie-green))]/10 text-[hsl(var(--iseie-green))]' },
  { id: 'no_interesado',  label: 'No interesado', badge: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' },
];

const STATS_MAP: Record<string, string> = {
  all:            'total',
  nuevo:          'nuevos',
  por_contactar:  'por_contactar',
  contactado:     'contactados',
  en_seguimiento: 'en_seguimiento',
  convertido:     'convertidos',
  no_interesado:  'no_interesados',
};

function formatDate(d: string | null | undefined) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  } catch { return String(d).slice(0, 10); }
}

export default function LeadsPage() {
  const { activeProject, user } = useAuth();
  const projectId = activeProject?.id;
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  const [activeStatus, setActiveStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [leads, setLeads] = useState<any[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);

  function toggleSelected(id: number) {
    setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  }
  function selectAll(ids: number[]) {
    setSelected(ids);
  }
  function clearSelection() {
    setSelected([]);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && selected.length > 0) clearSelection();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected.length]);

  async function handleCreateLead(data: any) {
    if (!projectId) {
      toast({ title: 'Selecciona un proyecto', variant: 'destructive' });
      return;
    }
    try {
      const res: any = await client.post('/leads', {
        project_id: projectId,
        nombre: data.nombre,
        email: data.email,
        telefono: data.telefono || '',
        canal: data.origen || 'directo',
        notas: data.notas || '',
        custom_fields: data.custom_fields || undefined,
      });
      if (res?.success) {
        toast({ title: 'Prospecto creado', description: data.nombre });
        setFormOpen(false);
        setReloadKey((k) => k + 1);
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || err?.message || String(err), variant: 'destructive' });
    }
  }

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      client.get('/leads', { params: { projectId, limit: 200, status: activeStatus === 'all' ? undefined : activeStatus, search: search.trim() || undefined } })
        .then((r) => r.data?.data || [])
        .catch(() => []),
      client.get('/leads/stats', { params: { projectId } })
        .then((r) => r.data?.data || {})
        .catch(() => ({})),
    ]).then(([list, st]) => {
      if (cancelled) return;
      setLeads(list);
      setStats(st);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, activeStatus, search, reloadKey]);

  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const s of STATUS_DEF) {
      const key = STATS_MAP[s.id];
      result[s.id] = Number(stats[key] || 0);
    }
    return result;
  }, [stats]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Prospectos</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {activeProject?.nombre ? `${activeProject.nombre} · ` : ''}Captura, gestiona y convierte leads.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <Link
            to="/leads/archived"
            className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-card border border-border text-sm font-medium hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="Ver leads eliminados"
          >
            <Trash size={14} />
            Papelera
          </Link>
          <button
            type="button"
            onClick={() => setCsvOpen(true)}
            className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-card border border-border text-sm font-medium hover:bg-muted transition-colors"
          >
            <ArrowsClockwise size={14} />
            Importar CSV
          </button>
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Plus size={14} weight="bold" />
            Nuevo
          </button>
        </div>
      </header>

      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, email, teléfono…"
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-border bg-card text-sm placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1">
          {STATUS_DEF.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveStatus(s.id)}
              className={`flex-shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-sm font-medium transition-colors ${
                activeStatus === s.id
                  ? 'bg-foreground text-background'
                  : 'bg-card border border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {s.label}
              <span className={`inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-full text-[10px] font-semibold tabular-nums ${
                activeStatus === s.id ? 'bg-background/15' : 'bg-muted'
              }`}>
                {counts[s.id] || 0}
              </span>
            </button>
          ))}
          <button className="flex-shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-md bg-card border border-border text-muted-foreground hover:text-foreground transition-colors" title="Más filtros">
            <Funnel size={14} />
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="hidden md:grid grid-cols-[28px_1.5fr_1fr_0.8fr_1fr_0.8fr_0.6fr] gap-4 px-5 py-3 border-b border-border bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground items-center">
          <div>
            <input
              type="checkbox"
              checked={leads.length > 0 && selected.length === leads.length}
              onChange={(e) => e.target.checked ? selectAll(leads.map((l) => l.id)) : clearSelection()}
              aria-label="Seleccionar todos"
              className="w-4 h-4 rounded border-border"
            />
          </div>
          <div>Prospecto</div>
          <div>Producto</div>
          <div>Canal</div>
          <div>Responsable</div>
          <div>Estado</div>
          <div className="text-right">Fecha</div>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground">Cargando…</div>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-16 px-6">
            <div className="w-14 h-14 rounded-xl bg-muted flex items-center justify-center mb-4">
              <Users size={26} weight="duotone" className="text-muted-foreground" />
            </div>
            <h3 className="font-semibold text-foreground mb-1.5">
              {(counts.all || 0) === 0 ? 'No hay prospectos todavía' : 'Sin resultados para este filtro'}
            </h3>
            <p className="text-sm text-muted-foreground max-w-sm mb-6">
              {(counts.all || 0) === 0
                ? 'Cuando lleguen leads desde tu web, formularios o integraciones, aparecerán aquí en orden cronológico con asignación automática.'
                : 'Limpia el filtro o la búsqueda para ver el resto.'}
            </p>
            {(counts.all || 0) === 0 && (
              <button
                type="button"
                onClick={() => setFormOpen(true)}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <UserPlus size={14} weight="bold" />
                Añadir prospecto manualmente
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {leads.map((l) => {
              const statusDef = STATUS_DEF.find((s) => s.id === l.status);
              const isSelected = selected.includes(l.id);
              return (
                <div
                  key={l.id}
                  className={`px-4 md:px-5 py-3 transition-colors md:grid md:grid-cols-[28px_1.5fr_1fr_0.8fr_1fr_0.8fr_0.6fr] md:gap-4 md:items-center text-sm ${
                    isSelected ? 'bg-primary/5' : 'hover:bg-muted/40'
                  }`}
                >
                  <div className="hidden md:flex items-center">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelected(l.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Seleccionar ${l.nombre}`}
                      className="w-4 h-4 rounded border-border cursor-pointer"
                    />
                  </div>
                  <Link
                    to={`/leads/${l.id}`}
                    className="contents"
                  >
                    <div className="flex items-start justify-between gap-3 md:block min-w-0">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{l.nombre || '—'}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{l.email || l.telefono || '—'}</div>
                      </div>
                      {statusDef && (
                        <span className={`md:hidden inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${statusDef.badge}`}>
                          {statusDef.label}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-1 md:mt-0">{l.producto_interes || '—'}</div>
                    <div className="text-xs text-muted-foreground truncate">{l.canal_detectado || '—'}</div>
                    <div className="text-xs text-muted-foreground truncate">{l.responsable_nombre || 'Sin asignar'}</div>
                    <div className="hidden md:block">
                      {statusDef && (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${statusDef.badge}`}>
                          {statusDef.label}
                        </span>
                      )}
                    </div>
                    <div className="text-right text-xs text-muted-foreground tabular-nums flex items-center justify-end gap-1">
                      <span>{formatDate(l.fecha_solicitud || l.created_at)}</span>
                      <ArrowRight size={12} weight="bold" className="hidden md:inline text-muted-foreground/40" />
                    </div>
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Suspense fallback={null}>
        <LeadFormDialog open={formOpen} onClose={() => setFormOpen(false)} onSubmit={handleCreateLead} lead={null} />
        <CsvImportDialog
          open={csvOpen}
          onClose={() => setCsvOpen(false)}
          projectId={projectId}
          onImported={() => { setCsvOpen(false); setReloadKey((k) => k + 1); }}
        />
        <BulkActionBar
          selected={selected}
          onClear={clearSelection}
          onRefresh={() => setReloadKey((k) => k + 1)}
          canDelete={isAdmin}
        />
      </Suspense>
    </div>
  );
}
