// Ventas: resumen consolidado, por asesora y por cliente. Comparten filtros
// (proyecto activo, rango de fechas y busqueda) para que los tres cuadren entre si.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '@/shared/api/client';
import { useProjectContext } from '@/contexts/ProjectContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import KpiCard from '@/shared/components/ui/KpiCard';
import EmptyState from '@/shared/components/ui/EmptyState';
import SkeletonTable, { SkeletonCard } from '@/shared/components/ui/SkeletonTable';
import { toast } from '@/shared/hooks/useToast';
import {
  CurrencyEur, CheckCircle, Wallet, Receipt, UsersThree, User,
  MagnifyingGlass, WarningCircle, Calendar,
} from '@phosphor-icons/react';

function fmt(n: unknown) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Number(n || 0));
}
function fecha(d: unknown) {
  return d ? new Date(String(d)).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}
const PER_PAGE = 50;

type Resumen = {
  ventas: number; clientes: number; asesoras: number;
  importe: number; cobrado: number; pendiente: number;
  liquidadas: number; con_saldo: number; ticket_medio: number;
  cuotas: {
    ventas_con_plan: number; total: number; cobradas: number; pendientes: number;
    vencidas: number; importe_pendiente: number; importe_vencido: number;
  };
};
type Asesora = {
  user_id: number | null; nombre: string; email: string | null; role: string | null;
  ventas: number; clientes: number; importe: number; cobrado: number; pendiente: number;
  ticket_medio: number; ultima_venta: string | null;
};
type Cliente = {
  lead_id: number; cliente: string; email: string | null; telefono: string | null;
  ventas: number; importe: number; cobrado: number; pendiente: number;
  primera_venta: string; ultima_venta: string;
  cuotas_pendientes: number; cuotas_vencidas: number; cuotas_importe_pendiente: number;
  asesoras: string | null;
};

const TABS = [
  { k: 'resumen', label: 'Resumen', icon: CurrencyEur },
  { k: 'asesora', label: 'Por asesora', icon: UsersThree },
  { k: 'cliente', label: 'Por cliente', icon: User },
] as const;

export default function SalesAnalysisPage() {
  const navigate = useNavigate();
  const { activeProject } = useProjectContext() as { activeProject?: { id?: number; nombre?: string } };
  const [tab, setTab] = useState<'resumen' | 'asesora' | 'cliente'>('resumen');
  const [rango, setRango] = useState({ from: '', to: '' });
  const [search, setSearch] = useState('');
  const [buscado, setBuscado] = useState('');
  const [loading, setLoading] = useState(true);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [asesoras, setAsesoras] = useState<Asesora[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [page, setPage] = useState(1);
  const [totalClientes, setTotalClientes] = useState(0);

  const params: Record<string, string | number> = {};
  if (activeProject?.id) params.projectId = activeProject.id;
  if (rango.from) params.from = rango.from;
  if (rango.to) params.to = rango.to;
  if (buscado) params.search = buscado;
  const key = JSON.stringify(params);

  useEffect(() => { setPage(1); }, [key, tab]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setLoading(true);
      try {
        if (tab === 'resumen') {
          const r = await client.get<Resumen>('/ventas/resumen', { params });
          if (vivo && r.success) setResumen(r.data);
        } else if (tab === 'asesora') {
          const r = await client.get<Asesora[]>('/ventas/por-asesora', { params });
          if (vivo && r.success) setAsesoras(r.data || []);
        } else {
          const r = await client.get<Cliente[]>('/ventas/por-cliente', { params: { ...params, page, limit: PER_PAGE } });
          if (vivo && r.success) {
            setClientes(r.data || []);
            setTotalClientes((r as { pagination?: { total?: number } }).pagination?.total ?? (r.data || []).length);
          }
        }
      } catch (err) {
        toast({
          title: 'Error cargando ventas',
          description: (err as { message?: string })?.message || '',
          variant: 'destructive',
        });
      } finally { if (vivo) setLoading(false); }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tab, page]);

  const totalPages = Math.max(1, Math.ceil(totalClientes / PER_PAGE));

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Análisis de ventas"
        subtitle={activeProject?.nombre || 'Todos los proyectos'}
      />

      {/* Filtros comunes a las tres vistas */}
      <div className="bg-card border border-border rounded-lg p-3 flex items-center gap-2 flex-wrap">
        <label className="text-xs font-semibold text-muted-foreground">Desde</label>
        <input type="date" value={rango.from} onChange={(e) => setRango((v) => ({ ...v, from: e.target.value }))}
          className="h-9 px-2 rounded-md border border-border bg-card text-sm" />
        <label className="text-xs font-semibold text-muted-foreground">Hasta</label>
        <input type="date" value={rango.to} onChange={(e) => setRango((v) => ({ ...v, to: e.target.value }))}
          className="h-9 px-2 rounded-md border border-border bg-card text-sm" />
        <form
          onSubmit={(e) => { e.preventDefault(); setBuscado(search.trim()); }}
          className="flex items-center gap-2 flex-1 min-w-[220px]"
        >
          <div className="relative flex-1">
            <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cliente, email o programa…"
              className="w-full h-9 pl-8 pr-2 rounded-md border border-border bg-card text-sm"
            />
          </div>
          <button type="submit" className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold">
            Buscar
          </button>
        </form>
        {(rango.from || rango.to || buscado) && (
          <button
            type="button"
            onClick={() => { setRango({ from: '', to: '' }); setSearch(''); setBuscado(''); }}
            className="text-[11px] text-primary hover:underline whitespace-nowrap"
          >
            Quitar filtros
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.k}
            type="button"
            onClick={() => setTab(t.k)}
            className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-sm font-semibold whitespace-nowrap transition-colors ${
              tab === t.k ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
            }`}
          >
            <t.icon size={14} weight="bold" /> {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        tab === 'resumen'
          ? <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[1, 2, 3, 4].map((i) => <SkeletonCard key={i} />)}</div>
          : <SkeletonTable rows={6} columns={6} />
      ) : tab === 'resumen' ? (
        !resumen ? <EmptyState icon={Receipt} title="Sin datos" description="No hay ventas en este filtro." /> : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiCard icon={Receipt} iconBg="bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400"
                label="Ventas" value={String(resumen.ventas)}
                badge={`${resumen.clientes} clientes`} badgeColor="bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400" />
              <KpiCard icon={CurrencyEur} iconBg="bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400"
                label="Importe vendido" value={fmt(resumen.importe)}
                badge={`ticket ${fmt(resumen.ticket_medio)}`} badgeColor="bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400" />
              <KpiCard icon={CheckCircle} iconBg="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"
                label="Cobrado" value={fmt(resumen.cobrado)}
                badge={`${resumen.liquidadas} liquidadas`} badgeColor="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400" />
              <KpiCard icon={Wallet} iconBg="bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400"
                label="Pendiente de cobro" value={fmt(resumen.pendiente)}
                badge={`${resumen.con_saldo} con saldo`} badgeColor="bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400"
                trend="down" />
            </div>

            <div className="bg-card border border-border rounded-lg p-4">
              <h3 className="font-semibold mb-3 flex items-center gap-2"><Calendar size={16} weight="bold" /> Cobro fraccionado</h3>
              {resumen.cuotas.total === 0 ? (
                <EmptyState icon={Calendar} title="Sin ventas fraccionadas" description="Ninguna venta de este filtro tiene plan de cuotas." />
              ) : (
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 text-sm">
                  {[
                    { l: 'Ventas a plazos', v: String(resumen.cuotas.ventas_con_plan), c: '' },
                    { l: 'Cuotas cobradas', v: `${resumen.cuotas.cobradas} / ${resumen.cuotas.total}`, c: 'text-emerald-600 dark:text-emerald-400' },
                    { l: 'Cuotas pendientes', v: String(resumen.cuotas.pendientes), c: 'text-orange-600 dark:text-orange-400' },
                    { l: 'Importe por cobrar', v: fmt(resumen.cuotas.importe_pendiente), c: 'text-orange-600 dark:text-orange-400' },
                    { l: 'Vencido', v: `${fmt(resumen.cuotas.importe_vencido)} · ${resumen.cuotas.vencidas} cuotas`, c: 'text-red-600 dark:text-red-400' },
                  ].map((x) => (
                    <div key={x.l} className="bg-muted/40 rounded-md p-3">
                      <p className="text-[11px] text-muted-foreground">{x.l}</p>
                      <p className={`font-bold tabular-nums mt-0.5 ${x.c}`}>{x.v}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )
      ) : tab === 'asesora' ? (
        asesoras.length === 0 ? <EmptyState icon={UsersThree} title="Sin ventas" description="No hay ventas en este filtro." /> : (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-[11px] text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-bold">Asesora</th>
                    <th className="text-right px-4 py-2.5 font-bold">Ventas</th>
                    <th className="text-right px-4 py-2.5 font-bold">Clientes</th>
                    <th className="text-right px-4 py-2.5 font-bold">Vendido</th>
                    <th className="text-right px-4 py-2.5 font-bold">Cobrado</th>
                    <th className="text-right px-4 py-2.5 font-bold">Pendiente</th>
                    <th className="text-right px-4 py-2.5 font-bold">Ticket medio</th>
                    <th className="text-left px-4 py-2.5 font-bold">Última venta</th>
                  </tr>
                </thead>
                <tbody>
                  {asesoras.map((a) => (
                    <tr key={String(a.user_id)} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-semibold">
                        {a.nombre}
                        {a.role && <span className="ml-2 text-[10px] text-muted-foreground font-normal">{a.role}</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{a.ventas}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{a.clientes}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmt(a.importe)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{fmt(a.cobrado)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-orange-600 dark:text-orange-400">{fmt(a.pendiente)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{fmt(a.ticket_medio)}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fecha(a.ultima_venta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : (
        clientes.length === 0 ? <EmptyState icon={User} title="Sin clientes" description="No hay ventas en este filtro." /> : (
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-[11px] text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-bold">Cliente</th>
                    <th className="text-left px-4 py-2.5 font-bold">Asesora</th>
                    <th className="text-right px-4 py-2.5 font-bold">Ventas</th>
                    <th className="text-right px-4 py-2.5 font-bold">Importe</th>
                    <th className="text-right px-4 py-2.5 font-bold">Cobrado</th>
                    <th className="text-right px-4 py-2.5 font-bold">Pendiente</th>
                    <th className="text-left px-4 py-2.5 font-bold">Cuotas</th>
                    <th className="text-left px-4 py-2.5 font-bold">Última</th>
                  </tr>
                </thead>
                <tbody>
                  {clientes.map((cl) => (
                    <tr
                      key={cl.lead_id}
                      className="border-b last:border-0 hover:bg-muted/30 cursor-pointer"
                      onClick={() => navigate(`/leads/${cl.lead_id}`)}
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold">{cl.cliente || '—'}</div>
                        <div className="text-[11px] text-muted-foreground truncate max-w-[220px]">{cl.email || cl.telefono || ''}</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-[12px] max-w-[160px] truncate" title={cl.asesoras || ''}>{cl.asesoras || '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{cl.ventas}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmt(cl.importe)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{fmt(cl.cobrado)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-orange-600 dark:text-orange-400">{fmt(cl.pendiente)}</td>
                      <td className="px-4 py-3">
                        {cl.cuotas_pendientes === 0 ? (
                          <span className="text-muted-foreground text-[11px]">—</span>
                        ) : (
                          <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                            cl.cuotas_vencidas > 0 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'
                          }`}>
                            {cl.cuotas_vencidas > 0 && <WarningCircle size={12} weight="fill" />}
                            {cl.cuotas_pendientes} pend. · {fmt(cl.cuotas_importe_pendiente)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fecha(cl.ultima_venta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border text-sm">
                <span className="text-muted-foreground">
                  {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, totalClientes)} de {totalClientes}
                </span>
                <div className="flex items-center gap-2">
                  <button type="button" disabled={page <= 1} onClick={() => setPage((v) => Math.max(1, v - 1))}
                    className="h-8 px-3 rounded-md border border-border disabled:opacity-40 hover:bg-muted">Anterior</button>
                  <span className="text-muted-foreground tabular-nums">{page} / {totalPages}</span>
                  <button type="button" disabled={page >= totalPages} onClick={() => setPage((v) => Math.min(totalPages, v + 1))}
                    className="h-8 px-3 rounded-md border border-border disabled:opacity-40 hover:bg-muted">Siguiente</button>
                </div>
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}
