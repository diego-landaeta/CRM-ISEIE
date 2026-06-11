import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { accountingApi } from '../api/accounting.api';
import { useProjectContext } from '@/contexts/ProjectContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import KpiCard from '@/shared/components/ui/KpiCard';
import EmptyState from '@/shared/components/ui/EmptyState';
import SkeletonTable from '@/shared/components/ui/SkeletonTable';
import { CurrencyEur, WarningCircle, ArrowRight, Wallet, Receipt } from '@phosphor-icons/react';

function fmt(n) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
}
function formatDate(d) { return d ? new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '--'; }

export default function ReceivablePage() {
  const navigate = useNavigate();
  const { activeProject } = useProjectContext();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const params = activeProject?.id ? { projectId: activeProject.id } : {};
        const res = await accountingApi.dashboard({ ...params, from: '2000-01-01', to: new Date().toISOString().slice(0, 10) });
        if (res.success && res.data) setItems(res.data.cuentas_por_cobrar || []);
      } finally { setLoading(false); }
    })();
  }, [activeProject?.id]);

  const total = items.reduce((s, r) => s + Number(r.importe_pendiente || 0), 0);
  const vencidas = items.filter(r => r.vencido).length;

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Cuentas por cobrar"
        subtitle={`Facturas pendientes de cobro${activeProject ? ' en ' + activeProject.nombre : ''}`}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <KpiCard
          icon={Receipt}
          iconBg="bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400"
          label="Pendientes"
          numericValue={items.length}
        />
        <KpiCard
          icon={Wallet}
          iconBg="bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400"
          label="Total pendiente"
          numericValue={total}
          format={fmt}
        />
        <KpiCard
          icon={WarningCircle}
          iconBg={vencidas > 0
            ? 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400'
            : 'bg-muted text-muted-foreground'}
          label="Vencidas"
          numericValue={vencidas}
        />
      </div>

      {loading ? (
        <SkeletonTable rows={5} columns={7} />
      ) : items.length === 0 ? (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <EmptyState icon={CurrencyEur} title="Todo cobrado" description="No hay cuentas pendientes en este momento" />
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-[11px] text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2.5 font-bold">Cliente</th>
                  <th className="text-left px-4 py-2.5 font-bold">Producto</th>
                  <th className="text-left px-4 py-2.5 font-bold">Proyecto</th>
                  <th className="text-right px-4 py-2.5 font-bold">Total</th>
                  <th className="text-right px-4 py-2.5 font-bold">Pagado</th>
                  <th className="text-right px-4 py-2.5 font-bold">Pendiente</th>
                  <th className="text-left px-4 py-2.5 font-bold">Vence</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {items.map(r => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/leads/${r.lead_id}`)}>
                    <td className="px-4 py-3">
                      <div className="font-semibold">{r.lead_nombre}</div>
                      <div className="text-xs text-muted-foreground">{r.lead_email}</div>
                    </td>
                    <td className="px-4 py-3">{r.producto_contratado}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.proyecto_nombre}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmt(r.importe_total)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-green-600 dark:text-green-400">{fmt(r.importe_pagado)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-bold text-orange-600 dark:text-orange-400">{fmt(r.importe_pendiente)}</td>
                    <td className="px-4 py-3">
                      {r.fecha_compromiso_pago ? (
                        <span className={r.vencido ? 'text-red-600 dark:text-red-400 font-semibold' : ''}>
                          {r.vencido && <WarningCircle size={12} weight="fill" className="inline mr-1" />}
                          {formatDate(r.fecha_compromiso_pago)}
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right"><ArrowRight size={14} className="text-muted-foreground inline" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-border">
            {items.map(r => (
              <button key={r.id} type="button" onClick={() => navigate(`/leads/${r.lead_id}`)} className="w-full text-left p-4 space-y-2.5 hover:bg-muted/30 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{r.lead_nombre}</div>
                    <div className="text-xs text-muted-foreground truncate">{r.lead_email}</div>
                  </div>
                  <ArrowRight size={14} className="text-muted-foreground flex-shrink-0 mt-1" />
                </div>
                <div className="text-sm">{r.producto_contratado} <span className="text-muted-foreground">· {r.proyecto_nombre}</span></div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Total</div>
                    <div className="tabular-nums">{fmt(r.importe_total)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Pagado</div>
                    <div className="tabular-nums text-green-600 dark:text-green-400">{fmt(r.importe_pagado)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Pendiente</div>
                    <div className="tabular-nums font-semibold text-orange-600 dark:text-orange-400">{fmt(r.importe_pendiente)}</div>
                  </div>
                </div>
                {r.fecha_compromiso_pago && (
                  <div className={`text-xs ${r.vencido ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-muted-foreground'}`}>
                    {r.vencido && <WarningCircle size={12} weight="fill" className="inline mr-0.5" />}
                    Vence {formatDate(r.fecha_compromiso_pago)}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
