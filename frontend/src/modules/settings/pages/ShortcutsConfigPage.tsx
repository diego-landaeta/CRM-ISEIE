import { useEffect, useMemo, useState } from 'react';
import {
  Lightning, Check, FloppyDisk, ShieldWarning,
  UserPlus, Buildings, Package, FileText, PlugsConnected,
  EnvelopeSimple, Bell, NotePencil, ArrowsClockwise, ChartBar,
  type Icon,
} from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import client from '@/shared/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/shared/hooks/useToast';
import type { ApiResponse } from '@/shared/types';

interface ShortcutCatalogItem {
  id: string;
  label: string;
  icon: string;
  route?: string;
  action?: string;
  // CRM-147: roles autorizados. Vacio = todos.
  roles?: string[];
}

interface ProjectWithShortcuts {
  id: number;
  nombre: string;
  shortcuts?: ShortcutCatalogItem[] | null;
}

// CRM-147: roles disponibles para el filtrado por proyecto.
const ROLES = [
  { id: 'superadmin', label: 'Sup', full: 'Superadmin' },
  { id: 'admin',      label: 'Adm', full: 'Admin'      },
  { id: 'gestor',     label: 'Ges', full: 'Gestor'     },
  { id: 'soporte',    label: 'Sop', full: 'Soporte'    },
] as const;

// Mapa de string-de-backend → componente Icon de phosphor.
// El backend devuelve nombres de icono como strings (e.g. 'Webhook'); los
// mapeamos al componente correspondiente de phosphor. Los nombres deben
// coincidir con los del catálogo en backend/src/modules/projects/shortcuts.controller.js
const ICON_MAP: Record<string, Icon> = {
  UserPlus,
  Building: Buildings,
  Package,
  FileText,
  Webhook: PlugsConnected,
  Envelope: EnvelopeSimple,
  Bell,
  NotePencil,
  ArrowsClockwise,
  ChartBar,
};

function iconFor(name: string): Icon {
  return ICON_MAP[name] || Lightning;
}

export default function ShortcutsConfigPage() {
  const { user, projects } = useAuth();
  const role = (user as { role?: string } | null)?.role;
  const isAdmin = role === 'superadmin' || role === 'admin';

  const [catalog, setCatalog] = useState<ShortcutCatalogItem[] | null>(null);
  // CRM-147: ahora la estructura es projectId -> (shortcutId -> roles[]).
  // Si un shortcutId esta presente en el inner map, esta activo. Sus `roles`
  // pueden estar vacias (= todos los roles) o contener una lista explicita.
  const [projectShortcuts, setProjectShortcuts] = useState<Map<number, Map<string, string[]>>>(new Map());
  const [dirty, setDirty] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const projectList = (projects || []) as ProjectWithShortcuts[];

  useEffect(() => {
    if (!isAdmin) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [catRes, projRes] = await Promise.all([
          client.get('/projects/shortcuts/catalog') as Promise<ApiResponse<ShortcutCatalogItem[]>>,
          client.get('/projects') as Promise<ApiResponse<ProjectWithShortcuts[]>>,
        ]);
        if (cancelled) return;
        if (catRes.success) setCatalog(Array.isArray(catRes.data) ? catRes.data : []);
        if (projRes.success && projRes.data) {
          const map = new Map<number, Map<string, string[]>>();
          for (const p of projRes.data) {
            const inner = new Map<string, string[]>();
            for (const s of p.shortcuts || []) {
              inner.set(s.id, Array.isArray(s.roles) ? s.roles : []);
            }
            map.set(p.id, inner);
          }
          setProjectShortcuts(map);
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Error de red');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin]);

  function toggle(projectId: number, shortcutId: string): void {
    setProjectShortcuts(prev => {
      const next = new Map(prev);
      const inner = new Map(next.get(projectId) || []);
      if (inner.has(shortcutId)) inner.delete(shortcutId);
      else inner.set(shortcutId, []); // por defecto: todos los roles
      next.set(projectId, inner);
      return next;
    });
    setDirty(prev => new Set(prev).add(projectId));
  }

  // CRM-147: toggle de un rol especifico para un shortcut activo.
  // Si el shortcut no esta activo, lo activamos primero con solo ese rol.
  function toggleRole(projectId: number, shortcutId: string, role: string): void {
    setProjectShortcuts(prev => {
      const next = new Map(prev);
      const inner = new Map(next.get(projectId) || []);
      const current = inner.get(shortcutId);
      if (!current) {
        inner.set(shortcutId, [role]);
      } else if (current.includes(role)) {
        const filtered = current.filter(r => r !== role);
        inner.set(shortcutId, filtered);
      } else {
        inner.set(shortcutId, [...current, role]);
      }
      next.set(projectId, inner);
      return next;
    });
    setDirty(prev => new Set(prev).add(projectId));
  }

  async function save(projectId: number): Promise<void> {
    if (!catalog) return;
    setSaving(projectId);
    try {
      const inner = projectShortcuts.get(projectId) || new Map<string, string[]>();
      // Mantenemos el orden del catálogo y enviamos el item completo (label/icon/route + roles)
      const payload = catalog
        .filter(c => inner.has(c.id))
        .map(c => {
          const roles = inner.get(c.id) || [];
          return {
            id: c.id, label: c.label, icon: c.icon, route: c.route, action: c.action,
            ...(roles.length > 0 ? { roles } : {}),
          };
        });
      const res = await client.put(`/projects/${projectId}/shortcuts`, { shortcuts: payload });
      if ((res as ApiResponse<unknown>).success) {
        setDirty(prev => {
          const next = new Set(prev);
          next.delete(projectId);
          return next;
        });
        const proj = projectList.find(p => p.id === projectId);
        toast({ title: 'Atajos guardados', description: proj?.nombre || `Proyecto #${projectId}` });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'No se pudo guardar';
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    } finally { setSaving(null); }
  }

  const adminProjects = useMemo(
    () => projectList.filter(p => p.id != null),
    [projectList]
  );

  if (!isAdmin) {
    return (
      <div className="space-y-6 pb-8">
        <PageHeader title="Atajos rápidos" subtitle="Acciones rápidas configurables por proyecto" />
        <div className="bg-card border border-border rounded-xl p-8 flex items-start gap-4">
          <ShieldWarning size={28} className="text-amber-500 shrink-0" />
          <div>
            <h2 className="font-semibold">Acceso restringido</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Solo Administradores y Superadmin pueden gestionar los atajos por proyecto.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="Atajos rápidos"
        subtitle="Selecciona qué acciones rápidas estarán disponibles en cada proyecto"
      />

      {error && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-xl p-4 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {loading && (
        <div className="grid gap-3 md:grid-cols-2">
          {[1, 2].map(i => <div key={i} className="h-72 bg-muted/30 rounded-xl animate-pulse" />)}
        </div>
      )}

      {!loading && catalog && (
        <div className="grid gap-4 md:grid-cols-2">
          {adminProjects.map(p => {
            const inner = projectShortcuts.get(p.id) || new Map<string, string[]>();
            const isDirty = dirty.has(p.id);
            const isSaving = saving === p.id;
            return (
              <article key={p.id} className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between gap-3">
                  <h3 className="font-semibold text-sm truncate">{p.nombre}</h3>
                  <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                    {inner.size} / {catalog.length} activos
                  </span>
                </div>
                <ul className="divide-y divide-border">
                  {catalog.map(item => {
                    const Icon = iconFor(item.icon);
                    const itemRoles = inner.get(item.id);
                    const isOn = itemRoles !== undefined;
                    const showAll = isOn && (!itemRoles || itemRoles.length === 0);
                    return (
                      <li key={item.id} className="px-4 py-2.5 hover:bg-muted/30 transition-colors">
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            aria-label={`${item.label} en ${p.nombre}`}
                            checked={isOn}
                            onChange={() => toggle(p.id, item.id)}
                            className="h-4 w-4 cursor-pointer accent-primary shrink-0"
                          />
                          <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                            isOn ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                          }`}>
                            <Icon size={14} weight="duotone" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium truncate">{item.label}</div>
                            <div className="text-[11px] text-muted-foreground truncate">
                              {item.route || item.action || ''}
                            </div>
                          </div>
                        </div>
                        {isOn && (
                          <div className="mt-2 ml-7 pl-3 flex items-center flex-wrap gap-1.5 border-l border-border/60">
                            <span className="text-[10px] text-muted-foreground mr-0.5">Visible para:</span>
                            {ROLES.map(r => {
                              const checked = showAll || (itemRoles?.includes(r.id) ?? false);
                              return (
                                <button
                                  key={r.id}
                                  type="button"
                                  onClick={() => toggleRole(p.id, item.id, r.id)}
                                  title={`${r.full}${showAll ? ' (todos seleccionados — clic restringe solo a este)' : ''}`}
                                  className={`text-[10px] font-semibold h-5 px-1.5 rounded border transition-all ${
                                    checked
                                      ? 'bg-primary/15 border-primary/40 text-primary'
                                      : 'bg-muted border-border text-muted-foreground hover:border-primary/40'
                                  }`}
                                >
                                  {r.label}
                                </button>
                              );
                            })}
                            {showAll && (
                              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 ml-1">todos</span>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <div className="px-4 py-3 border-t border-border bg-muted/20 flex items-center justify-end gap-2">
                  {isDirty && !isSaving && (
                    <span className="text-[11px] text-amber-600 dark:text-amber-400">Cambios sin guardar</span>
                  )}
                  <button
                    type="button"
                    onClick={() => save(p.id)}
                    disabled={!isDirty || isSaving}
                    className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    {isSaving ? <ArrowsClockwise size={12} className="animate-spin" /> : <FloppyDisk size={12} />}
                    {isSaving ? 'Guardando…' : 'Guardar'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {!loading && catalog && adminProjects.length === 0 && (
        <div className="bg-muted/40 border border-border rounded-xl p-8 text-center text-sm text-muted-foreground">
          <Lightning size={28} weight="duotone" className="mx-auto mb-2 text-muted-foreground/50" />
          No hay proyectos disponibles para gestionar atajos.
        </div>
      )}

      <section className="bg-muted/40 border border-border rounded-xl p-5 flex items-start gap-3">
        <Check size={18} weight="regular" className="text-emerald-500 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-muted-foreground space-y-1.5">
          <p className="font-semibold text-foreground">Cómo aparecen</p>
          <p>
            Los atajos activos se mostrarán en el botón flotante (FAB) de cada proyecto y en el
            panel lateral. Los cambios surten efecto al cambiar de proyecto activo o tras un
            refresh de la página.
          </p>
          <p>
            <span className="font-medium text-foreground">Visibilidad por rol:</span>{' '}
            si todas las casillas de rol están en gris/marcadas, el atajo aparece para todos los
            roles. Marca solo los roles específicos para restringir su visibilidad.
          </p>
        </div>
      </section>
    </div>
  );
}
