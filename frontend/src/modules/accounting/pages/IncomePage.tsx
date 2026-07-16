import { useEffect, useState, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '@/shared/api/client';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import KpiCard from '@/shared/components/ui/KpiCard';
import EmptyState from '@/shared/components/ui/EmptyState';
import SkeletonTable from '@/shared/components/ui/SkeletonTable';
import { CurrencyEur, ArrowRight, Receipt, CheckCircle, Plus } from '@phosphor-icons/react';

const RegisterSaleDialog = lazy(() => import('@/modules/sales/components/RegisterSaleDialog'));
const TopProductsCard = lazy(() => import('@/modules/sales/components/TopProductsCard'));
const MyGoalCard = lazy(() => import('@/modules/sales/components/MyGoalCard'));
const GestoresStatsTable = lazy(() => import('@/modules/sales/components/GestoresStatsTable'));

function fmt(n) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
}
function formatDate(d) { return d ? new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '--'; }

export default function IncomePage({ title = 'Ingresos', subtitlePrefix = 'Todas las ventas registradas' }) {
  const navigate = useNavigate();
  const { activeProject } = useProjectContext();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [viewUserId, setViewUserId] = useState('all');
  const [gestores, setGestores] = useState([]);
  const [filterCurso, setFilterCurso] = useState('all');
  const effectiveResponsableId = isAdmin ? (viewUserId === 'all' ? null : Number(viewUserId)) : null;

  useEffect(() => {
    if (!activeProject?.id || !isAdmin) return;
    client.get('/sales/gestores-stats', { params: { projectId: activeProject.id, periodo: 'all' } })
      .then((r) => setGestores(r?.data?.gestores || []))
      .catch(() => setGestores([]));
  }, [activeProject?.id, isAdmin, reloadKey]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const params = { limit: 100 };
        if (activeProject?.id) params.projectId = activeProject.id;
        if (effectiveResponsableId) params.responsableId = effectiveResponsableId;
        const res = await client.get('/conversions', { params });
        if (res.success) setItems(res.data || []);
      } catch {
        setItems([]);
      } finally { setLoading(false); }
    })();
  }, [activeProject?.id, reloadKey, effectiveResponsableId]);

  // Cursos únicos para el filtro por producto.
  const cursos = [...new Set(items.map((r) => (r.producto_contratado || '').trim()).filter(Boolean))].sort();
  const visibleItems = filterCurso === 'all' ? items : items.filter((r) => (r.producto_contratado || '').trim() === filterCurso);

  const totalFacturado = visibleItems.reduce((s, r) => s + Number(r.importe_total || 0), 0);
  const totalCobrado = visibleItems.reduce((s, r) => s + Number(r.importe_pagado || 0), 0);
  // IVA aproximado: usa el iva_importe de la conversión si existe; si no, estima 21% (IVA incluido).
  const ivaAprox = visibleItems.reduce((s, r) => s + (Number(r.iva_importe) || (Number(r.importe_total || 0) * 0.21 / 1.21)), 0);

  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <PageHeader
          title={title}
          subtitle={`${subtitlePrefix}${activeProject ? ' en ' + activeProject.nombre : ''}`}
        />
        {activeProject?.id && (
          <button
            type="button"
            onClick={() => setRegisterOpen(true)}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 self-start sm:self-auto"
          >
            <Plus size={14} weight="bold" />
            Nueva venta
          </button>
        )}
      </div>

      <Suspense fallback={null}>
        <RegisterSaleDialog
          open={registerOpen}
          project={activeProject}
          onClose={() => setRegisterOpen(false)}
          onSaved={() => setReloadKey((k) => k + 1)}
        />
      </Suspense>

      {((isAdmin && gestores.length > 0) || cursos.length > 1) && (
        <div className="bg-card border border-border rounded-lg p-3 flex items-center gap-3 flex-wrap">
          {isAdmin && gestores.length > 0 && (
            <>
              <label className="text-xs font-semibold text-muted-foreground">Ver ventas de:</label>
              <select
                value={viewUserId}
                onChange={(e) => setViewUserId(e.target.value)}
                className="h-9 px-3 rounded-md border border-border bg-card text-sm font-medium min-w-[200px]"
              >
                <option value="all">— Todas (vista general) —</option>
                {gestores.map((g) => (
                  <option key={g.user_id} value={g.user_id}>
                    {g.nombre} · {g.role} ({g.ventas} venta{g.ventas === 1 ? '' : 's'})
                  </option>
                ))}
              </select>
            </>
          )}
          {cursos.length > 1 && (
            <>
              <label className="text-xs font-semibold text-muted-foreground">Curso:</label>
              <select
                value={filterCurso}
                onChange={(e) => setFilterCurso(e.target.value)}
                className="h-9 px-3 rounded-md border border-border bg-card text-sm font-medium min-w-[200px] max-w-[320px]"
              >
                <option value="all">— Todos los cursos —</option>
                {cursos.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </>
          )}
          {(viewUserId !== 'all' || filterCurso !== 'all') && (
            <button type="button" onClick={() => { setViewUserId('all'); setFilterCurso('all'); }} className="text-[11px] text-primary hover:underline">
              Quitar filtros
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          icon={Receipt}
          iconBg="bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400"
          label="Conversiones"
          numericValue={visibleItems.length}
        />
        <KpiCard
          icon={CurrencyEur}
          iconBg="bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400"
          label="Facturado"
          numericValue={totalFacturado}
          format={fmt}
        />
        <KpiCard
          icon={CheckCircle}
          iconBg="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"
          label="Cobrado"
          numericValue={totalCobrado}
          format={fmt}
        />
        <KpiCard
          icon={Receipt}
          iconBg="bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400"
          label="IVA aprox."
          numericValue={ivaAprox}
          format={fmt}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Suspense fallback={null}>
          <MyGoalCard projectId={activeProject?.id} />
        </Suspense>
        <Suspense fallback={null}>
          <TopProductsCard projectId={activeProject?.id} responsableId={effectiveResponsableId} days={null} limit={5} title={effectiveResponsableId ? `Programas vendidos por ${gestores.find(g => g.user_id === effectiveResponsableId)?.nombre || 'gestor'}` : 'Programas más vendidos'} />
        </Suspense>
      </div>

      {isAdmin && (
        <Suspense fallback={null}>
          <GestoresStatsTable projectId={activeProject?.id} canEdit={true} />
        </Suspense>
      )}

      {loading ? (
        <SkeletonTable rows={5} columns={6} />
      ) : visibleItems.length === 0 ? (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <EmptyState icon={CurrencyEur} title="Sin ventas" description="Las conversiones aparecerán aquí cuando un lead compre" />
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-[11px] text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2.5 font-bold">Fecha</th>
                  <th className="text-left px-4 py-2.5 font-bold">Cliente</th>
                  <th className="text-left px-4 py-2.5 font-bold">Producto</th>
                  <th className="text-right px-4 py-2.5 font-bold">Total</th>
                  <th className="text-right px-4 py-2.5 font-bold">Pagado</th>
                  <th className="text-left px-4 py-2.5 font-bold">Estado</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map(r => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/prospectos/${r.lead_id}`)}>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(r.fecha_conversion || r.fecha_compra)}</td>
                    <td className="px-4 py-3 font-semibold">{r.lead_nombre}</td>
                    <td className="px-4 py-3">{r.producto_contratado}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmt(r.importe_total)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-green-600 dark:text-green-400">{fmt(r.importe_pagado)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                        r.estado_pago === 'pagado' ? 'bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400' :
                        r.estado_pago === 'parcial' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400' :
                        'bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400'
                      }`}>{r.estado_pago}</span>
                    </td>
                    <td className="px-4 py-3 text-right"><ArrowRight size={14} className="text-muted-foreground inline" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-border">
            {visibleItems.map(r => (
              <button key={r.id} type="button" onClick={() => navigate(`/prospectos/${r.lead_id}`)} className="w-full text-left p-4 space-y-2 hover:bg-muted/30 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{r.lead_nombre}</div>
                    <div className="text-xs text-muted-foreground truncate">{r.producto_contratado}</div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${
                    r.estado_pago === 'pagado' ? 'bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400' :
                    r.estado_pago === 'parcial' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400' :
                    'bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400'
                  }`}>{r.estado_pago}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <div className="text-xs text-muted-foreground">{formatDate(r.fecha_conversion || r.fecha_compra)}</div>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums text-green-600 dark:text-green-400">{fmt(r.importe_pagado)}</span>
                    <span className="text-muted-foreground">/</span>
                    <span className="tabular-nums">{fmt(r.importe_total)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
