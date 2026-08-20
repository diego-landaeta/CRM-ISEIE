import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { accountingApi } from '../api/accounting.api';
import client from '@/shared/api/client';
import { useProjectContext } from '@/contexts/ProjectContext';
import { toast } from '@/shared/hooks/useToast';
import useUrlFilters from '@/shared/hooks/useUrlFilters';
import PageHeader from '@/shared/components/ui/PageHeader';
import KpiCard from '@/shared/components/ui/KpiCard';
import EmptyState from '@/shared/components/ui/EmptyState';
import { SkeletonCard } from '@/shared/components/ui/SkeletonTable';
import {
  CurrencyEur,
  Wallet,
  TrendUp,
  TrendDown,
  WarningCircle,
  Receipt,
  ArrowRight,
  Plus,
} from '@phosphor-icons/react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from 'recharts';
import { formatDate } from '@/shared/lib/format';

function fmt(n) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
}


// Defaults para filtros persistidos en URL (refresh-safe + compartible)
const DEFAULT_FROM = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
const DEFAULT_TO = new Date().toISOString().slice(0, 10);

export default function AccountingDashboardPage() {
  const navigate = useNavigate();
  const { activeProject } = useProjectContext();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useUrlFilters({ from: DEFAULT_FROM, to: DEFAULT_TO });
  const [vend, setVend] = useState([]);

  useEffect(() => {
    const p = new URLSearchParams();
    if (activeProject?.id) p.set('projectId', String(activeProject.id));
    if (range.from) p.set('from', range.from);
    if (range.to) p.set('to', range.to);
    client.get(`/informes/ventas-vendedora?${p.toString()}`)
      .then((r) => setVend(r.success ? (r.data || []) : []))
      .catch(() => setVend([]));
  }, [activeProject?.id, range.from, range.to]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await accountingApi.dashboard({
          ...(activeProject?.id ? { projectId: activeProject.id } : {}),
          from: range.from,
          to: range.to,
        });
        if (res.success) setData(res.data);
      } catch (err) {
        toast({ title: 'Error cargando dashboard', description: err?.data?.error || err.message, variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [activeProject?.id, range.from, range.to]);

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Contabilidad" subtitle="Cargando…" />
        <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const ingresos = data.ingresos || { total_cobrado: 0, total_pendiente: 0 };
  const egresos = data.egresos || { total: 0, por_categoria: [] };
  const balance = Number(data.balance || 0);
  const cuentas_por_cobrar = data.cuentas_por_cobrar || [];
  const trend = data.trend || { ingresos: [], egresos: [] };

  // El backend manda los totales reales; el listado viene con LIMIT 50.
  const cxc = data.cuentas_por_cobrar_resumen || {
    num: cuentas_por_cobrar.length,
    total: cuentas_por_cobrar.reduce((s, r) => s + Number(r.importe_pendiente || 0), 0),
    num_vencido: 0,
    total_vencido: 0,
  };

  const mesesSet = new Set([...(trend.ingresos || []).map(x => x.mes), ...(trend.egresos || []).map(x => x.mes)]);
  const meses = Array.from(mesesSet).sort();
  const trendData = meses.map(m => ({
    mes: m.slice(5),
    ingresos: trend.ingresos.find(x => x.mes === m)?.total || 0,
    egresos: trend.egresos.find(x => x.mes === m)?.total || 0,
  }));

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Contabilidad"
        subtitle={activeProject?.nombre || ''}
        actions={
          <>
            <input
              type="date"
              value={range.from}
              onChange={e => setRange({ ...range, from: e.target.value })}
              aria-label="Fecha desde"
              className="h-9 px-3 rounded-md border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <span className="text-xs text-muted-foreground hidden sm:inline">hasta</span>
            <input
              type="date"
              value={range.to}
              onChange={e => setRange({ ...range, to: e.target.value })}
              aria-label="Fecha hasta"
              className="h-9 px-3 rounded-md border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <button
              onClick={() => navigate('/expenses')}
              aria-label="Nuevo egreso"
              className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <Plus size={14} weight="bold" /> <span className="hidden sm:inline">Egreso</span>
            </button>
          </>
        }
      />

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <KpiCard
          icon={CurrencyEur}
          iconBg="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"
          label="Ingresos cobrados"
          value={fmt(ingresos.total_cobrado)}
        />
        <KpiCard
          icon={Receipt}
          iconBg="bg-sky-50 text-sky-600 dark:bg-sky-950/30 dark:text-sky-400"
          label="Facturado (emitido)"
          value={fmt(ingresos.total_emitido || 0)}
          badge={ingresos.num_facturas ? `${ingresos.num_facturas} facturas` : null}
          badgeColor="bg-sky-50 text-sky-600 dark:bg-sky-950/30 dark:text-sky-400"
        />
        <KpiCard
          icon={Wallet}
          iconBg="bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400"
          label="Por cobrar"
          value={fmt(cxc.total)}
          badge={cxc.num ? `${cxc.num} ventas` : null}
          badgeColor="bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400"
        />
        <KpiCard
          icon={Wallet}
          iconBg="bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
          label="Vencido"
          value={fmt(cxc.total_vencido)}
          badge={cxc.num_vencido ? `${cxc.num_vencido} ventas` : null}
          badgeColor="bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
          trend="down"
        />
        <KpiCard
          icon={TrendDown}
          iconBg="bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
          label="Egresos"
          value={fmt(egresos.total)}
        />
        <KpiCard
          icon={balance >= 0 ? TrendUp : TrendDown}
          iconBg={balance >= 0
            ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400'
            : 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400'}
          label="Balance neto"
          value={fmt(balance)}
        />
      </div>

      {/* Graficas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="font-semibold mb-3">Evolución mensual (12 meses)</h3>
          <ResponsiveContainer width="100%" height={220} minHeight={200}>
            <LineChart data={trendData} margin={{ top: 5, right: 12, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="#f3f4f6" />
              <XAxis dataKey="mes" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => v >= 1000 ? `${v/1000}k` : v} />
              <Tooltip formatter={(v) => fmt(v)} contentStyle={{ borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 12 }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="ingresos" stroke="#10b981" strokeWidth={2} name="Ingresos" dot={{ fill: '#10b981', r: 3 }} />
              <Line type="monotone" dataKey="egresos" stroke="#ef4444" strokeWidth={2} name="Egresos" dot={{ fill: '#ef4444', r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="font-semibold mb-3">Egresos por categoría</h3>
          {egresos.por_categoria.length === 0 ? (
            <EmptyState icon={Receipt} title="Sin egresos" description="No hay gastos registrados en este período" />
          ) : (
            <ResponsiveContainer width="100%" height={220} minHeight={200}>
              <BarChart data={egresos.por_categoria} layout="vertical" margin={{ top: 5, right: 12, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="#f3f4f6" horizontal={false} />
                <XAxis type="number" stroke="#9ca3af" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => v >= 1000 ? `${v/1000}k` : v} />
                <YAxis type="category" dataKey="categoria" stroke="#6b7280" fontSize={12} width={100} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v) => fmt(v)} cursor={{ fill: '#f9fafb' }} contentStyle={{ borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 12 }} />
                <Bar dataKey="total" fill="#ef4444" radius={[0, 4, 4, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Ventas por vendedora */}
      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="font-semibold mb-3">Ventas por vendedora</h3>
        {vend.length === 0 ? (
          <EmptyState icon={CurrencyEur} title="Sin ventas" description="No hay ventas en este período" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-2 font-medium">Vendedora</th>
                  <th className="py-2 font-medium text-right">Ventas</th>
                  <th className="py-2 font-medium text-right">Clientes</th>
                  <th className="py-2 font-medium text-right">Cobrado</th>
                  <th className="py-2 font-medium text-right">Pendiente</th>
                </tr>
              </thead>
              <tbody>
                {vend.map((v) => (
                  <tr key={v.vendedora} className="border-b border-border/50">
                    <td className="py-2 font-medium text-foreground">{v.vendedora}</td>
                    <td className="py-2 text-right tabular-nums">{v.ventas}</td>
                    <td className="py-2 text-right tabular-nums">{v.clientes}</td>
                    <td className="py-2 text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">{fmt(v.cobrado)}</td>
                    <td className="py-2 text-right tabular-nums text-orange-600 dark:text-orange-400">{fmt(v.pendiente)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cuentas por cobrar */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Cuentas por cobrar ({cxc.num})</h3>
          {cxc.num > 0 && (
            <div className="text-sm text-muted-foreground">
              Total pendiente: <span className="font-bold tabular-nums text-orange-600 dark:text-orange-400">{fmt(cxc.total)}</span>
            </div>
          )}
        </div>

        {cuentas_por_cobrar.length === 0 ? (
          <EmptyState icon={CurrencyEur} title="Todo cobrado" description="No hay cuentas pendientes en este momento" />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden lg:block overflow-x-auto -mx-4">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-[11px] text-muted-foreground">
                  <tr>
                    <th className="text-left px-5 py-2.5 font-bold">Lead</th>
                    <th className="text-left px-5 py-2.5 font-bold">Producto</th>
                    <th className="text-left px-5 py-2.5 font-bold">Proyecto</th>
                    <th className="text-right px-5 py-2.5 font-bold">Total</th>
                    <th className="text-right px-5 py-2.5 font-bold">Pagado</th>
                    <th className="text-right px-5 py-2.5 font-bold">Pendiente</th>
                    <th className="text-left px-5 py-2.5 font-bold">Vence</th>
                    <th className="px-5 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {cuentas_por_cobrar.map(r => (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/leads/${r.lead_id}`)}>
                      <td className="px-5 py-3">
                        <div className="font-semibold">{r.lead_nombre}</div>
                        <div className="text-xs text-muted-foreground">{r.lead_email}</div>
                      </td>
                      <td className="px-5 py-3">{r.producto_contratado}</td>
                      <td className="px-5 py-3 text-muted-foreground">{r.proyecto_nombre}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{fmt(r.importe_total)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-green-600 dark:text-green-400">{fmt(r.importe_pagado)}</td>
                      <td className="px-5 py-3 text-right tabular-nums font-bold text-orange-600 dark:text-orange-400">{fmt(r.importe_pendiente)}</td>
                      <td className="px-5 py-3">
                        {r.fecha_compromiso_pago ? (
                          <span className={r.vencido ? 'text-red-600 dark:text-red-400 font-semibold' : ''}>
                            {r.vencido && <WarningCircle size={12} weight="fill" className="inline mr-1" />}
                            {formatDate(r.fecha_compromiso_pago)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Sin fecha</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <ArrowRight size={14} className="text-muted-foreground inline" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="lg:hidden space-y-2">
              {cuentas_por_cobrar.map(r => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => navigate(`/leads/${r.lead_id}`)}
                  className="w-full text-left bg-muted/40 hover:bg-muted rounded-md p-3 space-y-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate">{r.lead_nombre}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{r.producto_contratado} · {r.proyecto_nombre}</div>
                    </div>
                    <ArrowRight size={14} className="text-muted-foreground flex-shrink-0 mt-0.5" />
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="tabular-nums font-bold text-orange-600 dark:text-orange-400">{fmt(r.importe_pendiente)}</span>
                    {r.fecha_compromiso_pago && (
                      <span className={r.vencido ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-muted-foreground'}>
                        {r.vencido && <WarningCircle size={11} weight="fill" className="inline mr-0.5" />}
                        Vence {formatDate(r.fecha_compromiso_pago)}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>

            {cxc.num > cuentas_por_cobrar.length && (
              <p className="mt-3 text-[11px] text-muted-foreground">
                Mostrando las {cuentas_por_cobrar.length} mas proximas a vencer de {cxc.num}.{' '}
                <button type="button" onClick={() => navigate('/accounting/receivable')} className="text-primary hover:underline">Ver todas</button>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
