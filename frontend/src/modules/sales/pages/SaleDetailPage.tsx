// Detalle de una venta: cabecera con el cliente y la asesora, el estado de cobro,
// el plan de cuotas y cada pago con su factura. Todo lo que hay que mirar cuando
// alguien pregunta "¿esta persona qué debe?".
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import client from '@/shared/api/client';
import PageHeader from '@/shared/components/ui/PageHeader';
import KpiCard from '@/shared/components/ui/KpiCard';
import EmptyState from '@/shared/components/ui/EmptyState';
import { SkeletonCard } from '@/shared/components/ui/SkeletonTable';
import { toast } from '@/shared/hooks/useToast';
import {
  CurrencyEur, CheckCircle, Wallet, Receipt, ArrowLeft, User, Calendar,
  WarningCircle, CreditCard, ClockCounterClockwise,
} from '@phosphor-icons/react';

function fmt(n: unknown) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Number(n || 0));
}
function fecha(d: unknown) {
  return d ? new Date(String(d)).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

type Cuota = {
  id: number; numero: number; importe_previsto: string | number;
  fecha_vencimiento: string; fecha_cobro: string | null; importe_cobrado: string | number | null;
  metodo: string | null; pagado_por_stripe?: boolean; notas?: string | null;
  factura_id?: number | null; factura_codigo?: string | null; factura_estado?: string | null;
};
type Pago = {
  id: number; importe: string | number; fecha: string; notas: string | null; metodo: string | null;
  cuota_numero: number | null; pagado_por_stripe?: boolean;
  factura_id?: number | null; factura_codigo?: string | null; factura_estado?: string | null;
};
type Venta = {
  id: number; lead_id: number; producto_contratado: string;
  importe_total: string | number; importe_pagado: string | number; importe_pendiente: string | number;
  fecha_conversion: string; fecha_compromiso_pago: string | null; metodo_pago: string | null;
  notas_pago: string | null; lead_nombre: string; lead_email: string; proyecto_nombre: string;
  payments?: Pago[]; installments?: Cuota[]; items?: Array<{ id: number; descripcion: string; cantidad: number; precio_unitario: string | number }>;
};

function Chip({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'mute'; children: React.ReactNode }) {
  const tones = {
    ok: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400',
    warn: 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400',
    bad: 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400',
    mute: 'bg-muted text-muted-foreground',
  };
  return <span className={`px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${tones[tone]}`}>{children}</span>;
}

export default function SaleDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [venta, setVenta] = useState<Venta | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await client.get<Venta>(`/conversions/${id}`);
        if (res.success) setVenta(res.data);
      } catch (err) {
        toast({
          title: 'No se pudo cargar la venta',
          description: (err as { message?: string })?.message || '',
          variant: 'destructive',
        });
      } finally { setLoading(false); }
    })();
  }, [id]);

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Venta" subtitle="Cargando…" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[1, 2, 3, 4].map((i) => <SkeletonCard key={i} />)}</div>
      </div>
    );
  }
  if (!venta) {
    return <EmptyState icon={Receipt} title="Venta no encontrada" description="Puede que se haya eliminado." />;
  }

  const cuotas = venta.installments || [];
  const pagos = venta.payments || [];
  const pendiente = Number(venta.importe_pendiente || 0);
  const cuotasPend = cuotas.filter((c) => !c.fecha_cobro);
  const cuotasVenc = cuotasPend.filter((c) => new Date(c.fecha_vencimiento) < new Date());
  const deAnteriores = cuotas.filter((c) => (c.notas || '').toLowerCase().includes('facturacion anterior'));

  return (
    <div className="space-y-5 pb-8">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={14} weight="bold" /> Volver
      </button>

      <PageHeader
        title={venta.lead_nombre || `Venta #${venta.id}`}
        subtitle={`${venta.producto_contratado || 'Sin programa'} · ${venta.proyecto_nombre || ''}`}
        actions={
          <button
            type="button"
            onClick={() => navigate(`/leads/${venta.lead_id}`)}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-semibold hover:bg-muted"
          >
            <User size={14} weight="bold" /> Ficha del cliente
          </button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={CurrencyEur} iconBg="bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400"
          label="Importe de la venta" value={fmt(venta.importe_total)} />
        <KpiCard icon={CheckCircle} iconBg="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"
          label="Cobrado" value={fmt(venta.importe_pagado)}
          badge={pagos.length ? `${pagos.length} pago${pagos.length === 1 ? '' : 's'}` : null}
          badgeColor="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400" />
        <KpiCard icon={Wallet} iconBg={pendiente > 0
          ? 'bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400'
          : 'bg-muted text-muted-foreground'}
          label="Pendiente" value={fmt(pendiente)}
          badge={cuotasPend.length ? `${cuotasPend.length} cuota${cuotasPend.length === 1 ? '' : 's'}` : null}
          badgeColor="bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400" trend="down" />
        <KpiCard icon={WarningCircle} iconBg={cuotasVenc.length
          ? 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400'
          : 'bg-muted text-muted-foreground'}
          label="Cuotas vencidas" value={String(cuotasVenc.length)} trend="down" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-lg p-4 space-y-2.5 text-sm">
          <h3 className="font-semibold mb-1">Datos de la venta</h3>
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Fecha</span>
            <span className="font-medium">{fecha(venta.fecha_conversion)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Email</span>
            <span className="font-medium truncate">{venta.lead_email || '—'}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Método</span>
            <span className="font-medium">{venta.metodo_pago || '—'}</span>
          </div>
          {venta.fecha_compromiso_pago && (
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Compromiso de pago</span>
              <span className="font-medium">{fecha(venta.fecha_compromiso_pago)}</span>
            </div>
          )}
          {deAnteriores.length > 0 && (
            <p className="pt-2 text-[11px] text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
              <ClockCounterClockwise size={13} weight="bold" className="mt-0.5 flex-shrink-0" />
              {deAnteriores.length} cuota{deAnteriores.length === 1 ? '' : 's'} de esta venta se cobraron bajo la facturación anterior.
            </p>
          )}
          {venta.notas_pago && (
            <p className="pt-2 text-[11px] text-muted-foreground whitespace-pre-line border-t border-border">{venta.notas_pago}</p>
          )}
        </div>

        <div className="bg-card border border-border rounded-lg p-4 lg:col-span-2">
          <h3 className="font-semibold mb-3">Plan de cuotas</h3>
          {cuotas.length === 0 ? (
            <EmptyState icon={Calendar} title="Sin plan de cuotas" description="Esta venta no está fraccionada." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[11px] text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left py-2 font-bold">#</th>
                    <th className="text-left py-2 font-bold">Vence</th>
                    <th className="text-right py-2 font-bold">Importe</th>
                    <th className="text-left py-2 font-bold pl-4">Estado</th>
                    <th className="text-left py-2 font-bold">Factura</th>
                  </tr>
                </thead>
                <tbody>
                  {cuotas.map((c) => {
                    const cobrada = !!c.fecha_cobro;
                    const vencida = !cobrada && new Date(c.fecha_vencimiento) < new Date();
                    const anterior = (c.notas || '').toLowerCase().includes('facturacion anterior');
                    return (
                      <tr key={c.id} className="border-b border-border/50 last:border-0">
                        <td className="py-2 font-semibold tabular-nums">{c.numero}</td>
                        <td className="py-2 text-muted-foreground">{fecha(c.fecha_vencimiento)}</td>
                        <td className="py-2 text-right tabular-nums font-medium">
                          {fmt(cobrada ? c.importe_cobrado : c.importe_previsto)}
                        </td>
                        <td className="py-2 pl-4">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {cobrada
                              ? <Chip tone="ok">Cobrada {fecha(c.fecha_cobro)}</Chip>
                              : vencida ? <Chip tone="bad">Vencida</Chip> : <Chip tone="warn">Pendiente</Chip>}
                            {c.pagado_por_stripe && <Chip tone="mute">Stripe</Chip>}
                            {anterior && <Chip tone="mute">Facturación anterior</Chip>}
                          </div>
                        </td>
                        <td className="py-2">
                          {c.factura_codigo
                            ? <span className="font-mono text-[11px]">{c.factura_codigo}</span>
                            : <span className="text-muted-foreground text-[11px]">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-4">
        <h3 className="font-semibold mb-3">Pagos registrados ({pagos.length})</h3>
        {pagos.length === 0 ? (
          <EmptyState icon={CreditCard} title="Sin pagos" description="Todavía no se ha registrado ningún cobro." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left py-2 font-bold">Fecha</th>
                  <th className="text-right py-2 font-bold">Importe</th>
                  <th className="text-left py-2 font-bold pl-4">Cuota</th>
                  <th className="text-left py-2 font-bold">Método</th>
                  <th className="text-left py-2 font-bold">Factura</th>
                  <th className="text-left py-2 font-bold">Notas</th>
                </tr>
              </thead>
              <tbody>
                {pagos.map((pg) => (
                  <tr key={pg.id} className="border-b border-border/50 last:border-0">
                    <td className="py-2 text-muted-foreground whitespace-nowrap">{fecha(pg.fecha)}</td>
                    <td className="py-2 text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">{fmt(pg.importe)}</td>
                    <td className="py-2 pl-4">{pg.cuota_numero ? <Chip tone="mute">Cuota {pg.cuota_numero}</Chip> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-2">
                      {pg.pagado_por_stripe ? <Chip tone="mute">Stripe</Chip> : (pg.metodo || '—')}
                    </td>
                    <td className="py-2">
                      {pg.factura_codigo
                        ? <span className="font-mono text-[11px]">{pg.factura_codigo}</span>
                        : <Chip tone="warn">Sin factura</Chip>}
                    </td>
                    <td className="py-2 text-[11px] text-muted-foreground max-w-[240px] truncate" title={pg.notas || ''}>{pg.notas || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
