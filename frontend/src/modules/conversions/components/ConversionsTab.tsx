import { useState, useEffect } from 'react';
import { conversionsApi, type Conversion, type Payment, type Refund, type Installment } from '../api/conversions.api';
import { toast } from '@/shared/hooks/useToast';
import ConversionDialog from './ConversionDialog';
import PaymentDialog from './PaymentDialog';
import RefundDialog from './RefundDialog';
import InstallmentsDialog from './InstallmentsDialog';
import EditConversionDialog from './EditConversionDialog';
import { Plus, Receipt, CreditCard, Trash, WarningCircle, CheckCircle, ArrowCounterClockwise, Coins, PencilSimple, Warning } from '@phosphor-icons/react';
import ConfirmDialog from '@/shared/components/ui/ConfirmDialog';
import EmptyState from '@/shared/components/ui/EmptyState';
import InvoiceButton from '@/modules/invoices/components/InvoiceButton';
import EmitirBorradorDialog from '@/modules/invoices/components/EmitirBorradorDialog';
import { invoicesApi, type Invoice } from '@/modules/invoices/api/invoices.api';
import SendInvoiceDialog from '@/modules/invoices/components/SendInvoiceDialog';
import { formatCurrency, formatDate } from '@/shared/lib/format';

interface ConversionsTabTarget {
  id: number;
  nombre?: string;
  producto_nombre?: string;
}

interface ConversionsTabProps {
  lead: ConversionsTabTarget | null | undefined;
  projectId: number;
  canManage?: boolean;
}

export default function ConversionsTab({ lead, projectId, canManage }: ConversionsTabProps) {
  const [conversions, setConversions] = useState<Conversion[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [paymentDialogConv, setPaymentDialogConv] = useState<Conversion | null>(null);
  const [refundDialogConv, setRefundDialogConv] = useState<Conversion | null>(null);
  const [installmentsDialogConv, setInstallmentsDialogConv] = useState<Conversion | null>(null);
  const [editDialogConv, setEditDialogConv] = useState<Conversion | null>(null);
  const [pendingPayment, setPendingPayment] = useState<number | null>(null);
  const [pendingConversion, setPendingConversion] = useState<number | null>(null);
  const [deleteReason, setDeleteReason] = useState<string>('duplicada');
  const [deleteMotivo, setDeleteMotivo] = useState<string>('');
  const [refundsByConv, setRefundsByConv] = useState<Record<number, Refund[]>>({});
  const [sendInvoiceDialog, setSendInvoiceDialog] = useState<Invoice | null>(null);
  const [installmentsReload, setInstallmentsReload] = useState(0);

  // Tras registrar un pago: si la conversion tiene factura emitida y aún no
  // enviada, ofrecer enviarla por email (con confirmación, no automático).
  async function checkInvoiceAfterPayment(conversionId: number): Promise<void> {
    try {
      const res = await invoicesApi.byConversion(conversionId);
      if (res.success && res.data && res.data.estado === 'emitida' && res.data.cliente_email) {
        setSendInvoiceDialog(res.data);
      }
    } catch { /* silencioso */ }
  }

  async function loadRefunds(conversionId: number): Promise<void> {
    try {
      const r = await conversionsApi.listRefunds(conversionId);
      if (r.success) {
        setRefundsByConv((prev) => ({ ...prev, [conversionId]: r.data || [] }));
      }
    } catch { /* silencioso */ }
  }

  async function load(): Promise<void> {
    if (!lead?.id) return;
    setLoading(true);
    try {
      const res = await conversionsApi.byLead(lead.id);
      if (res.success) setConversions((res.data as Conversion[]) || []);
    } catch {
      // silencioso — la tab mostrará estado vacío
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [lead?.id]);

  // Tras cargar conversiones, traemos las devoluciones de cada una (suelen ser pocas).
  useEffect(() => {
    conversions.forEach((c) => { loadRefunds(c.id); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversions]);

  async function handleDeleteRefund(refundId: number): Promise<void> {
    if (!confirm('¿Eliminar esta devolución? La operación es irreversible.')) return;
    try {
      await conversionsApi.removeRefund(refundId);
      toast({ title: 'Devolución eliminada' });
      // Recargamos las devoluciones de TODAS las conversiones (la mas barata)
      conversions.forEach((c) => loadRefunds(c.id));
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
    }
  }

  function handleDeletePayment(paymentId: number): void { setPendingPayment(paymentId); }
  async function doDeletePayment(): Promise<void> {
    if (pendingPayment === null) return;
    try {
      await conversionsApi.removePayment(pendingPayment);
      toast({ title: 'Pago eliminado' });
      await load();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || 'Error desconocido', variant: 'destructive' });
    } finally { setPendingPayment(null); }
  }

  function handleDeleteConversion(id: number): void {
    setPendingConversion(id);
    setDeleteReason('duplicada');
    setDeleteMotivo('');
  }
  async function doDeleteConversion(): Promise<void> {
    if (pendingConversion === null) return;
    if (deleteReason === 'otro' && deleteMotivo.trim().length < 3) {
      toast({ title: 'Detalle requerido', description: 'Si motivo = Otro, escribe el detalle (mín 3 chars)', variant: 'destructive' });
      return;
    }
    try {
      await conversionsApi.remove(pendingConversion, { reason: deleteReason, motivo: deleteMotivo.trim() || null });
      toast({ title: 'Conversión eliminada', description: 'Queda registro en el historial del lead' });
      await load();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || 'Error desconocido', variant: 'destructive' });
    } finally { setPendingConversion(null); }
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 animate-pulse" aria-busy="true">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-card border border-border rounded-md p-3">
            <div className="h-3 w-24 bg-muted rounded mb-2" />
            <div className="h-7 w-32 bg-muted rounded" />
          </div>
        ))}
      </div>
    );
  }

  const totalFacturado = conversions.reduce((acc, c) => acc + Number(c.importe_total), 0);
  const totalPagado = conversions.reduce((acc, c) => acc + Number(c.importe_pagado), 0);
  const totalPendiente = totalFacturado - totalPagado;

  return (
    <div className="space-y-4">
      {/* Header con stats */}
      <div className="flex items-start justify-between">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 flex-1">
          <div className="bg-card border border-border rounded-md p-3">
            <div className="text-[10px] text-muted-foreground font-bold mb-1">Total facturado</div>
            <div className="text-xl font-semibold tabular-nums">{formatCurrency(totalFacturado)}</div>
          </div>
          <div className="bg-card border border-border rounded-md p-3">
            <div className="text-[10px] text-muted-foreground font-bold mb-1">Total pagado</div>
            <div className="text-xl font-semibold text-green-600 tabular-nums">{formatCurrency(totalPagado)}</div>
          </div>
          <div className="bg-card border border-border rounded-md p-3">
            <div className="text-[10px] text-muted-foreground font-bold mb-1">Pendiente</div>
            <div className="text-xl font-semibold text-orange-600 tabular-nums">{formatCurrency(totalPendiente)}</div>
          </div>
        </div>
      </div>

      {canManage && (
        <button
          onClick={() => setDialogOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2"
        >
          <Plus size={16} weight="bold" />
          Nueva conversión
        </button>
      )}

      {/* Lista de conversiones */}
      {conversions.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="Aún no hay compras registradas"
          description="Registra una conversión cuando este lead complete una compra."
          action={
            canManage && (
              <button
                onClick={() => setDialogOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
              >
                <Plus size={14} weight="bold" />
                Registrar primera conversión
              </button>
            )
          }
        />
      ) : (
        <div className="space-y-3">
          {conversions.map((c) => {
            const pendiente = Number(c.importe_total) - Number(c.importe_pagado);
            const pagado = pendiente === 0;
            const vencido = c.fecha_compromiso_pago && pendiente > 0 && new Date(c.fecha_compromiso_pago) < new Date();

            return (
              <div key={c.id} className="bg-card border border-border rounded-md p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold">{c.producto_contratado}</h3>
                      {pagado && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"><CheckCircle size={10} weight="fill" /> Pagado</span>}
                      {vencido && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"><WarningCircle size={10} weight="fill" /> Vencido</span>}
                      {!pagado && !vencido && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300">Pendiente</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(c.fecha_conversion)} {c.metodo_pago ? `• ${c.metodo_pago}` : ''}
                      {c.fecha_compromiso_pago && ` • Compromiso: ${formatDate(c.fecha_compromiso_pago)}`}
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex gap-1">
                      {!pagado && (
                        <button
                          onClick={() => setPaymentDialogConv(c)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20"
                        >
                          <CreditCard size={14} weight="bold" />
                          Abonar
                        </button>
                      )}
                      {/* Factura "general" de la conversión SOLO si aún no hay pagos
                          (emisión manual). Con pagos, cada pago lleva su propia
                          factura (se ve en la lista de pagos). */}
                      {(Number(c.payments_count) || 0) === 0 && (
                        <InvoiceButton
                          projectId={projectId}
                          leadId={lead.id}
                          conversionId={c.id}
                          items={(c.items && c.items.length > 0)
                            ? c.items.map(it => ({ descripcion: it.descripcion, cantidad: it.cantidad, precio_unitario: Number(it.precio_unitario) }))
                            : [{ descripcion: c.producto_contratado || 'Servicio', cantidad: 1, precio_unitario: Number(c.importe_total) }]}
                        />
                      )}
                      <button
                        onClick={() => setEditDialogConv(c)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300 text-xs font-semibold hover:bg-sky-200 dark:hover:bg-sky-950/60"
                        title="Editar datos de la conversión (producto, importe, fechas, método)"
                      >
                        <PencilSimple size={14} weight="bold" />
                        Editar
                      </button>
                      <button
                        onClick={() => setInstallmentsDialogConv(c)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300 text-xs font-semibold hover:bg-violet-200 dark:hover:bg-violet-950/60"
                        title={c.metodo_pago === 'fraccionado' ? 'Ver/editar cuotas' : 'Convertir a fraccionado'}
                      >
                        <Coins size={14} weight="bold" />
                        {c.metodo_pago === 'fraccionado' ? 'Cuotas' : 'Fraccionar'}
                      </button>
                      {Number(c.importe_pagado) > 0 && (
                        <button
                          onClick={() => setRefundDialogConv(c)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 text-xs font-semibold hover:bg-amber-200 dark:hover:bg-amber-950/60"
                          title="Registrar devolución (fase de prueba)"
                        >
                          <ArrowCounterClockwise size={14} weight="bold" />
                          Devolver
                          <span className="text-[8px] font-bold uppercase opacity-70">test</span>
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteConversion(c.id)}
                        className="p-1 rounded-md hover:bg-red-50 text-muted-foreground hover:text-red-600"
                        title="Eliminar"
                      >
                        <Trash size={14} weight="bold" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Items comprados (multi-producto) */}
                {c.items && c.items.length > 0 && (
                  <div className="mb-3 border border-border rounded-md divide-y divide-border">
                    {c.items.map((it) => (
                      <div key={it.id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                        <span className="flex items-center gap-2">
                          <span className="inline-flex items-center justify-center min-w-[22px] h-[18px] px-1 rounded bg-primary/10 text-primary font-bold text-[10px]">{it.cantidad}×</span>
                          {it.descripcion}
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          {formatCurrency(Number(it.precio_unitario))} {it.cantidad > 1 && `· ${formatCurrency(Number(it.subtotal))}`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Desglose descuento + IVA */}
                {(c.descuento_tipo !== 'none' || Number(c.descuento_importe) > 0) && (
                  <div className="mb-3 bg-emerald-50/50 dark:bg-emerald-950/10 border border-emerald-200 dark:border-emerald-900 rounded-md px-3 py-2 text-xs space-y-0.5">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Subtotal</span><span className="tabular-nums">{formatCurrency(Number(c.subtotal_bruto || c.importe_total))}</span>
                    </div>
                    <div className="flex justify-between text-emerald-700 dark:text-emerald-400 font-semibold">
                      <span>Descuento {c.descuento_tipo === 'pct' ? `(${Number(c.descuento_valor)}%)` : '(monto)'}</span>
                      <span className="tabular-nums">−{formatCurrency(Number(c.descuento_importe))}</span>
                    </div>
                    {!c.iva_exento && Number(c.iva_importe) > 0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>IVA ({Number(c.iva_pct)}%){c.iva_incluido ? ' incl.' : ''}</span><span className="tabular-nums">{formatCurrency(Number(c.iva_importe))}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Importes */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                  <div className="bg-muted/50 rounded-lg p-2">
                    <div className="text-[9px] text-muted-foreground font-bold">Total</div>
                    <div className="text-sm font-semibold tabular-nums">{formatCurrency(c.importe_total)}</div>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-2">
                    <div className="text-[9px] text-muted-foreground font-bold">Pagado</div>
                    <div className="text-sm font-semibold text-green-600 tabular-nums">{formatCurrency(c.importe_pagado)}</div>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-2">
                    <div className="text-[9px] text-muted-foreground font-bold">Pendiente</div>
                    <div className="text-sm font-semibold text-orange-600 tabular-nums">{formatCurrency(pendiente)}</div>
                  </div>
                </div>

                {/* Fraccionado → plan de cuotas (vencimientos + factura por cuota).
                    Resto → lista de pagos registrados con su factura. */}
                {c.metodo_pago === 'fraccionado' ? (
                  <CuotasInline
                    conversionId={c.id}
                    canManage={canManage}
                    refreshKey={installmentsReload}
                    onManage={() => setInstallmentsDialogConv(c)}
                  />
                ) : c.payments_count > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground font-semibold">
                      Ver {c.payments_count} pago{c.payments_count !== 1 ? 's' : ''} registrado{c.payments_count !== 1 ? 's' : ''}
                    </summary>
                    <PaymentsList conversionId={c.id} onDelete={handleDeletePayment} canManage={canManage} />
                  </details>
                )}

                {/* Devoluciones (FASE DE PRUEBA) */}
                {(refundsByConv[c.id]?.length || 0) > 0 && (
                  <div className="mt-3 pt-3 border-t border-amber-200 dark:border-amber-900">
                    <div className="flex items-center gap-2 mb-2">
                      <ArrowCounterClockwise size={12} className="text-amber-600" weight="bold" />
                      <span className="text-[10px] font-bold uppercase text-amber-700 dark:text-amber-300">
                        Devoluciones registradas — fase de prueba
                      </span>
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        Neto cobrado: {formatCurrency(Number(c.importe_pagado) - (refundsByConv[c.id] || []).reduce((s, r) => s + Number(r.importe), 0))}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {(refundsByConv[c.id] || []).map((r) => (
                        <div key={r.id} className="flex items-center gap-2 text-[11px] bg-amber-50/50 dark:bg-amber-950/20 rounded px-2 py-1">
                          <span className="font-mono text-muted-foreground">{r.fecha}</span>
                          <span className="font-semibold text-amber-700 dark:text-amber-300 tabular-nums">−{formatCurrency(r.importe)}</span>
                          <span className="flex-1 text-muted-foreground truncate">{r.motivo || '(sin motivo)'}</span>
                          {r.created_by_nombre && <span className="text-muted-foreground italic">por {r.created_by_nombre}</span>}
                          {canManage && (
                            <button onClick={() => handleDeleteRefund(r.id)}
                              className="text-muted-foreground hover:text-red-600 p-0.5"
                              title="Eliminar devolución">
                              <Trash size={10} weight="bold" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConversionDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        lead={lead}
        projectId={projectId}
        onCreated={() => load()}
      />

      <PaymentDialog
        open={!!paymentDialogConv}
        onClose={() => setPaymentDialogConv(null)}
        conversion={paymentDialogConv}
        onPaid={() => {
          const convId = paymentDialogConv?.id;
          load();
          if (convId) checkInvoiceAfterPayment(convId);
        }}
      />
      {sendInvoiceDialog && (
        <SendInvoiceDialog
          invoice={sendInvoiceDialog}
          onClose={() => setSendInvoiceDialog(null)}
          onSent={() => setSendInvoiceDialog(null)}
        />
      )}
      <RefundDialog
        open={!!refundDialogConv}
        conversion={refundDialogConv}
        onClose={() => setRefundDialogConv(null)}
        onSaved={() => {
          const id = refundDialogConv?.id;
          setRefundDialogConv(null);
          if (id) loadRefunds(id);
        }}
      />
      <ConfirmDialog open={pendingPayment !== null} title="¿Eliminar pago?" message="Se recalculará el total de la conversión." onConfirm={doDeletePayment} onCancel={() => setPendingPayment(null)} />
      {/* Dialog eliminar conversión con motivo obligatorio para auditoría */}
      {pendingConversion !== null && (
        <div className="fixed inset-0 !m-0 z-[80] flex items-center justify-center p-4" onClick={() => setPendingConversion(null)}>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
          <div role="dialog" className="relative bg-card rounded-lg border border-border w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h4 className="font-semibold text-base mb-1">Eliminar compra</h4>
            <p className="text-xs text-muted-foreground mb-4">
              Se eliminarán todos sus pagos. Esta acción no se puede deshacer, pero quedará un registro en el historial del lead con el motivo.
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">Motivo *</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { value: 'duplicada', label: 'Duplicada' },
                    { value: 'error_carga', label: 'Error al cargar' },
                    { value: 'anulacion_cliente', label: 'Anulación cliente' },
                    { value: 'otro', label: 'Otro' },
                  ].map((r) => (
                    <button key={r.value} type="button"
                      onClick={() => setDeleteReason(r.value)}
                      className={`h-9 rounded-md border text-xs font-medium ${deleteReason === r.value ? 'bg-red-600 text-white border-red-600' : 'border-border bg-card hover:bg-muted'}`}
                    >{r.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-foreground mb-1.5 block">
                  Detalle {deleteReason === 'otro' ? '*' : '(opcional)'}
                </label>
                <textarea
                  value={deleteMotivo}
                  onChange={(e) => setDeleteMotivo(e.target.value)}
                  rows={2}
                  placeholder={deleteReason === 'duplicada' ? 'Ej: misma compra cargada 2 veces por error' : 'Detalle del motivo...'}
                  className="w-full px-3 py-2 rounded-md border border-border bg-card text-sm resize-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setPendingConversion(null)}
                className="h-9 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted">
                Cancelar
              </button>
              <button onClick={doDeleteConversion}
                className="h-9 px-4 rounded-md bg-red-600 text-white text-sm font-semibold hover:bg-red-700 inline-flex items-center gap-1">
                <Trash size={14} weight="bold" /> Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
      <InstallmentsDialog
        conversion={installmentsDialogConv}
        onClose={() => setInstallmentsDialogConv(null)}
        onSaved={() => { load(); setInstallmentsReload((k) => k + 1); }}
      />
      <EditConversionDialog
        conversion={editDialogConv}
        onClose={() => setEditDialogConv(null)}
        onSaved={() => load()}
      />
    </div>
  );
}

interface PaymentsListProps {
  conversionId: number;
  onDelete: (id: number) => void;
  canManage?: boolean;
}

function PaymentsList({ conversionId, onDelete, canManage }: PaymentsListProps) {
  const [payments, setPayments] = useState<Payment[] | null>(null);

  const reload = () => {
    conversionsApi.getById(conversionId).then(res => {
      if (res.success && res.data) setPayments(res.data.payments || []);
    });
  };
  useEffect(reload, [conversionId]);

  if (!payments) return <div className="mt-2 text-muted-foreground">Cargando…</div>;

  return (
    <ul className="mt-2 space-y-1">
      {payments.map(p => (
        <li key={p.id} className="flex items-center justify-between gap-2 bg-muted/30 rounded px-2 py-1.5">
          <div className="min-w-0">
            <span className="font-semibold tabular-nums">{formatCurrency(p.importe)}</span>
            <span className="text-muted-foreground ml-2">{formatDate(p.fecha)}</span>
            {p.notas && <span className="text-muted-foreground ml-2">• {p.notas}</span>}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Factura de ESTE pago */}
            <PaymentInvoiceCell src={p} onChanged={reload} />
            {canManage && (
              <button onClick={() => onDelete(p.id)} className="text-muted-foreground hover:text-red-600 p-0.5" title="Eliminar pago">
                <Trash size={12} weight="bold" />
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

// Campos de factura que trae tanto un pago como una cuota cobrada.
interface FacturaSrc {
  factura_id?: number | null;
  factura_codigo?: string | null;
  factura_estado?: string | null;
  factura_tipo?: string | null;
  cliente_nif?: string | null;
  cliente_direccion?: string | null;
  cliente_ciudad?: string | null;
  cliente_cp?: string | null;
  cliente_pais?: string | null;
}

// Muestra la factura correspondiente a un pago/cuota concreto:
// - completa → "Nº X" abre el PDF.
// - con datos faltantes → "Nº X · faltan datos" abre el diálogo para completarlos.
// - sin factura → nada.
function PaymentInvoiceCell({ src, onChanged }: { src: FacturaSrc; onChanged: () => void }) {
  const [emitOpen, setEmitOpen] = useState(false);
  const [inv, setInv] = useState<Invoice | null>(null);

  if (!src.factura_id) return null;
  const isProforma = src.factura_tipo === 'proforma';
  const isDraft = src.factura_estado === 'borrador';
  const noVal = (v?: string | null) => !v || String(v).trim() === '' || String(v).trim() === '—';
  const faltan = isProforma ? [] : [
    ['NIF', src.cliente_nif], ['dirección', src.cliente_direccion],
    ['ciudad', src.cliente_ciudad], ['CP', src.cliente_cp], ['país', src.cliente_pais],
  ].filter(([, v]) => noVal(v as string)).map(([k]) => k);
  const incompleta = !isDraft && faltan.length > 0;
  const warn = isDraft || incompleta;

  async function onClick() {
    if (warn) {
      const res = await invoicesApi.getOne(src.factura_id!);
      if (res.success && res.data) { setInv(res.data); setEmitOpen(true); }
      return;
    }
    invoicesApi.openPdf(src.factura_id!).catch((e: unknown) =>
      toast({ title: 'No se pudo abrir el PDF', description: (e as { message?: string })?.message, variant: 'destructive' }));
  }

  return (
    <>
      <button
        onClick={onClick}
        title={warn ? 'Faltan datos: complétalos para descargar/enviar' : `Ver factura ${src.factura_codigo || ''}`}
        className={`inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-semibold border ${
          warn ? 'border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
               : 'border-border bg-card hover:bg-muted'}`}
      >
        {warn ? <Warning size={11} weight="bold" /> : <Receipt size={11} weight="bold" />}
        {isDraft ? 'BORRADOR' : `Nº ${src.factura_codigo || ''}`}{incompleta ? ' · faltan datos' : ''}
      </button>
      {emitOpen && inv && (
        <EmitirBorradorDialog
          invoice={inv}
          onClose={() => setEmitOpen(false)}
          onEmitted={(codigo, id) => {
            setEmitOpen(false);
            toast({ title: '✓ Factura lista', description: codigo });
            invoicesApi.openPdf(id).catch(() => {});
            onChanged();
          }}
        />
      )}
    </>
  );
}

// Plan de cuotas de una conversión fraccionada. Muestra cada cuota con su
// vencimiento; las pagadas muestran su factura (una por cuota); las pendientes
// permiten registrar el pago (abre el diálogo de cuotas, que crea el pago +
// su factura al cobrar). Los pagos pueden ir en cualquier orden.
function CuotasInline({ conversionId, canManage, refreshKey, onManage }:
  { conversionId: number; canManage?: boolean; refreshKey: number; onManage: () => void }) {
  const [cuotas, setCuotas] = useState<Installment[] | null>(null);

  const reload = () => conversionsApi.getById(conversionId).then((res) => {
    if (res.success && res.data) setCuotas(res.data.installments || []);
  });
  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [conversionId, refreshKey]);

  if (!cuotas) return <div className="mt-3 text-xs text-muted-foreground">Cargando cuotas…</div>;
  if (cuotas.length === 0) return null;

  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const pagadas = cuotas.filter((q) => q.fecha_cobro).length;

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold uppercase text-muted-foreground flex items-center gap-1">
          <Coins size={12} weight="bold" /> Plan de cuotas — {pagadas}/{cuotas.length} pagadas
        </span>
        {canManage && (
          <button onClick={onManage} className="text-[11px] text-primary hover:underline">Gestionar cuotas</button>
        )}
      </div>
      <ul className="space-y-1">
        {cuotas.map((q) => {
          const pagada = !!q.fecha_cobro;
          const vence = q.fecha_vencimiento ? new Date(q.fecha_vencimiento) : null;
          const vencida = !pagada && vence !== null && vence < hoy;
          return (
            <li key={q.id} className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs bg-muted/30">
              <div className="min-w-0 flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center justify-center min-w-[22px] h-[18px] px-1 rounded bg-primary/10 text-primary font-bold text-[10px]">#{q.numero}</span>
                <span className="font-semibold tabular-nums">{formatCurrency(Number(pagada ? (q.importe_cobrado ?? q.importe_previsto) : q.importe_previsto))}</span>
                {pagada ? (
                  <span className="text-green-600 dark:text-green-400 inline-flex items-center gap-1">
                    <CheckCircle size={11} weight="fill" /> Pagada {formatDate(q.fecha_cobro!)}
                  </span>
                ) : (
                  <span className={vencida ? 'text-red-600 dark:text-red-400 font-medium' : 'text-muted-foreground'}>
                    Vence {formatDate(q.fecha_vencimiento)}{vencida ? ' · vencida' : ''}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {pagada ? (
                  <PaymentInvoiceCell src={q} onChanged={reload} />
                ) : canManage && (
                  <button onClick={onManage}
                    className="inline-flex items-center gap-1 h-6 px-2 rounded text-[10px] font-semibold border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20">
                    <CreditCard size={11} weight="bold" /> Registrar pago
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
