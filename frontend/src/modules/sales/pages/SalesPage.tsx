import { lazy, Suspense, useState, useEffect } from 'react';
import { Plus, Receipt, UsersThree } from '@phosphor-icons/react';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import client from '@/shared/api/client';

const RegisterSaleDialog = lazy(() => import('../components/RegisterSaleDialog'));
const TopProductsCard = lazy(() => import('../components/TopProductsCard'));
const CursosVendidosCard = lazy(() => import('../components/CursosVendidosCard'));
const MyGoalCard = lazy(() => import('../components/MyGoalCard'));
const GestoresStatsTable = lazy(() => import('../components/GestoresStatsTable'));

export default function SalesPage() {
  const { activeProject } = useProjectContext() as { activeProject: { id: number; nombre?: string } | null };
  const { user } = useAuth() as { user: { role?: string } | null };
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const [open, setOpen] = useState(false);
  // -1 = "Todos los proyectos" del header. En ese caso pasamos null al backend
  // para que agregue cross-proyecto. Si NO hay proyecto activo, ni siquiera el
  // header está listo todavía.
  const hasActiveCtx = !!activeProject?.id;
  const allProjects = activeProject?.id === -1;
  const projectIdParam = hasActiveCtx && !allProjects ? activeProject!.id : null;

  // Filtro por gestora/vendedora (solo admin/superadmin). Las tarjetas ya
  // soportan responsableId; aquí solo lo elegimos.
  const [gestores, setGestores] = useState<Array<{ id: number; nombre: string }>>([]);
  const [responsableId, setResponsableId] = useState<number | null>(null);
  useEffect(() => {
    if (!isAdmin) return;
    const pid = projectIdParam ? `&projectId=${projectIdParam}` : '';
    client.get(`/users?limit=100${pid}`).then((r) => setGestores(r.success ? (r.data || []) : [])).catch(() => {});
  }, [isAdmin, projectIdParam]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Ventas {allProjects && <span className="text-sm font-normal text-muted-foreground">· Todos los proyectos</span>}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {allProjects
              ? 'Vista agregada de todos los proyectos. Para registrar una venta entra en un proyecto concreto.'
              : 'Registra ventas — del día o históricas. Crea cliente + conversión + pago en un solo paso.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && !allProjects && (
            <div className="flex items-center gap-1.5 h-9 px-2.5 rounded-md border border-border bg-card text-sm">
              <UsersThree size={14} className="text-muted-foreground" />
              <select
                value={responsableId ?? ''}
                onChange={(e) => setResponsableId(e.target.value ? Number(e.target.value) : null)}
                className="bg-transparent focus:outline-none max-w-[160px]"
                title="Filtrar por gestora"
              >
                <option value="">Todas las gestoras</option>
                {gestores.map((g) => <option key={g.id} value={g.id}>{g.nombre}</option>)}
              </select>
            </div>
          )}
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={!hasActiveCtx || allProjects}
            title={allProjects ? 'Selecciona un proyecto concreto para registrar una venta' : ''}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus size={14} weight="bold" />
            Nueva venta
          </button>
        </div>
      </header>

      {!hasActiveCtx ? (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-6 text-center text-sm text-amber-800 dark:text-amber-300">
          Cargando proyectos…
        </div>
      ) : (
        <>
          <Suspense fallback={null}>
            <CursosVendidosCard projectId={projectIdParam} responsableId={responsableId} />
          </Suspense>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Suspense fallback={null}>
              <MyGoalCard projectId={projectIdParam} />
            </Suspense>
            <Suspense fallback={null}>
              <TopProductsCard projectId={projectIdParam} responsableId={responsableId} days={null} limit={5} title="Programas más vendidos" />
            </Suspense>
          </div>

          {isAdmin && (
            <Suspense fallback={null}>
              <GestoresStatsTable projectId={projectIdParam} canEdit={!allProjects} />
            </Suspense>
          )}

          {!allProjects && (
            <div className="bg-card border border-border rounded-lg p-6 text-center text-muted-foreground text-sm">
              <Receipt size={32} weight="duotone" className="mx-auto mb-2 text-muted-foreground/50" />
              Pulsa <strong>+ Nueva venta</strong> para registrar una sobre un cliente nuevo o existente.
              <p className="text-xs mt-1 opacity-70">Por la fecha indicada se marca como histórica (anterior a hoy) o del día.</p>
            </div>
          )}
        </>
      )}

      <Suspense fallback={null}>
        <RegisterSaleDialog
          open={open}
          project={activeProject}
          onClose={() => setOpen(false)}
          onSaved={() => setOpen(false)}
        />
      </Suspense>
    </div>
  );
}
