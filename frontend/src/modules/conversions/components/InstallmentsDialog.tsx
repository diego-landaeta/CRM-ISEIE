import { useEffect, useState } from 'react';
import { X, CalendarBlank, Plus, Trash, CheckCircle, Coins } from '@phosphor-icons/react';
import { conversionsApi, type Conversion } from '../api/conversions.api';
import { toast } from '@/shared/hooks/useToast';
import { formatCurrency, formatDate } from '@/shared/lib/format';

interface Installment {
  id?: number;
  numero?: number;
  importe_previsto: number;
  fecha_vencimiento: string;
  fecha_cobro?: string | null;
  importe_cobrado?: number | null;
  metodo?: string | null;
  metodo_pago?: string | null;
}

interface Props {
  conversion: Conversion | null;
  onClose: () => void;
  onSaved?: () => void;
}

// Diálogo para gestionar las cuotas de una conversión.
// - Si la conversión es de pago único: ofrece "Convertir a fraccionado" (N cuotas mensuales o personalizadas).
// - Si ya tiene cuotas: las lista, permite marcar pagadas, editar fechas/importes, añadir/quitar cuotas.
export default function InstallmentsDialog({ conversion, onClose, onSaved }: Props) {
  const [installments, setInstallments] = useState<Installment[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'view' | 'create'>('view');
  const [numCuotas, setNumCuotas] = useState(3);
  const [fechaInicio, setFechaInicio] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [draftInstallments, setDraftInstallments] = useState<Installment[]>([]);
  // Editor de importe_total para aplicar descuentos/becas antes de fraccionar.
  const [totalDraft, setTotalDraft] = useState<string>('');
  const [savingTotal, setSavingTotal] = useState(false);
  // Mini-form de cobro/edición de cuota: pide importe + fecha (no asume hoy).
  // mode='new' marca pagada por primera vez; mode='edit' modifica un pago hecho.
  const [payingInst, setPayingInst] = useState<Installment | null>(null);
  const [payMode, setPayMode] = useState<'new' | 'edit'>('new');
  const [payImporte, setPayImporte] = useState<string>('');
  const [payFecha, setPayFecha] = useState<string>('');
  const [payMetodo, setPayMetodo] = useState<string>('transferencia');
  const [payingNow, setPayingNow] = useState(false);

  async function load() {
    if (!conversion) return;
    setLoading(true);
    try {
      const res = await conversionsApi.listInstallments(conversion.id);
      const items = (res.success ? (res.data as Installment[]) : []) || [];
      setInstallments(items);
      setMode(items.length > 0 ? 'view' : 'create');
    } catch {
      setInstallments([]);
      setMode('create');
    } finally { setLoading(false); }
  }

  useEffect(() => {
    if (conversion) {
      load();
      setTotalDraft(String(conversion.importe_total));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversion?.id]);

  // Actualiza el importe_total de la conversión (para aplicar descuentos).
  async function handleSaveTotal() {
    if (!conversion) return;
    const nuevoTotal = Number(totalDraft);
    if (!isFinite(nuevoTotal) || nuevoTotal <= 0) {
      toast({ title: 'Importe inválido', variant: 'destructive' });
      return;
    }
    const pagado = Number(conversion.importe_pagado || 0);
    if (nuevoTotal < pagado) {
      toast({ title: 'Total no puede ser menor a lo pagado', description: `Ya cobrado: ${formatCurrency(pagado)}`, variant: 'destructive' });
      return;
    }
    setSavingTotal(true);
    try {
      await conversionsApi.update(conversion.id, { importe_total: nuevoTotal } as any);
      toast({ title: 'Total actualizado', description: `Nuevo pendiente: ${formatCurrency(nuevoTotal - pagado)}` });
      onSaved?.();
      // Forzar recálculo del draft con el nuevo total
      if (conversion) {
        (conversion as any).importe_total = nuevoTotal;
      }
      // re-trigger del useEffect generador
      setNumCuotas((n) => n);
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setSavingTotal(false); }
  }

  // Si entra en modo create, genera draft equirepartido por num+fecha.
  // IMPORTANTE: NO ajustamos la ultima cuota para que todas tengan el mismo
  // importe. Si la division no es exacta, la suma diferira y el total de
  // la conversion se actualizara al guardar (ver handleGenerate).
  useEffect(() => {
    if (mode !== 'create' || !conversion) return;
    const total = Number(conversion.importe_total) - Number(conversion.importe_pagado || 0);
    const start = new Date(fechaInicio);
    const importeCuota = Math.floor((total / numCuotas) * 100) / 100;
    const arr: Installment[] = [];
    for (let i = 0; i < numCuotas; i++) {
      const venc = new Date(start);
      venc.setMonth(venc.getMonth() + i);
      arr.push({ importe_previsto: importeCuota, fecha_vencimiento: venc.toISOString().slice(0, 10) });
    }
    setDraftInstallments(arr);
  }, [mode, numCuotas, fechaInicio, conversion]);

  async function handleGenerate() {
    if (!conversion) return;
    const suma = draftInstallments.reduce((s, c) => s + Number(c.importe_previsto || 0), 0);
    const pagado = Number(conversion.importe_pagado || 0);
    const totalActual = Number(conversion.importe_total);
    const nuevoTotal = +(suma + pagado).toFixed(2);

    if (draftInstallments.length < 1) {
      toast({ title: 'Añade al menos una cuota', variant: 'destructive' });
      return;
    }
    if (draftInstallments.some((c) => !c.fecha_vencimiento || Number(c.importe_previsto) <= 0)) {
      toast({ title: 'Cuota incompleta', description: 'Todas las cuotas requieren fecha e importe > 0', variant: 'destructive' });
      return;
    }

    try {
      // Si la suma de cuotas + pagado no es igual al total actual de la conversión,
      // ajustamos el total para que cuadre con lo que la gestora puso. NO redondeamos.
      if (Math.abs(nuevoTotal - totalActual) > 0.001) {
        await conversionsApi.update(conversion.id, { importe_total: nuevoTotal } as any);
        toast({
          title: 'Total ajustado',
          description: `Importe total: ${formatCurrency(totalActual)} → ${formatCurrency(nuevoTotal)} (suma exacta de cuotas + ya pagado)`,
        });
      }
      await conversionsApi.generateInstallments(conversion.id, {
        installments: draftInstallments.map(c => ({
          importe_previsto: Number(c.importe_previsto),
          fecha_vencimiento: c.fecha_vencimiento,
        })),
      });
      await conversionsApi.update(conversion.id, { metodo_pago: 'fraccionado' } as any);
      toast({ title: 'Cuotas creadas', description: `${draftInstallments.length} cuotas programadas.` });
      onSaved?.();
      await load();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
    }
  }

  function handlePayInstallment(inst: Installment) {
    if (!inst.id) return;
    setPayingInst(inst);
    setPayMode('new');
    setPayImporte(String(inst.importe_previsto));
    setPayFecha(new Date().toISOString().slice(0, 10));
    setPayMetodo(inst.metodo || 'transferencia');
  }

  function handleEditPaid(inst: Installment) {
    if (!inst.id) return;
    setPayingInst(inst);
    setPayMode('edit');
    setPayImporte(String(inst.importe_cobrado || inst.importe_previsto));
    setPayFecha((inst.fecha_cobro || '').slice(0, 10));
    setPayMetodo(inst.metodo || 'transferencia');
  }

  async function handleUnpay(inst: Installment) {
    if (!inst.id) return;
    if (!confirm(`¿Deshacer el pago de la cuota #${inst.numero}? Se borra el cobro y la cuota vuelve a pendiente.`)) return;
    try {
      await conversionsApi.unpayInstallment(inst.id);
      toast({ title: 'Pago deshecho', description: `Cuota #${inst.numero} vuelve a pendiente` });
      onSaved?.();
      await load();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' });
    }
  }

  async function confirmPayInstallment() {
    if (!payingInst?.id) return;
    const importe = Number(payImporte);
    if (!isFinite(importe) || importe <= 0) {
      toast({ title: 'Importe inválido', variant: 'destructive' });
      return;
    }
    if (!payFecha) {
      toast({ title: 'Fecha requerida', variant: 'destructive' });
      return;
    }
    setPayingNow(true);
    try {
      if (payMode === 'edit') {
        await conversionsApi.editPaidInstallment(payingInst.id, { importe_cobrado: importe, fecha_cobro: payFecha });
        toast({ title: 'Pago actualizado', description: `${importe}€ el ${payFecha}` });
      } else {
        await conversionsApi.payInstallment(payingInst.id, { importe_cobrado: importe, fecha_cobro: payFecha, metodo: payMetodo });
        toast({ title: 'Cuota cobrada', description: `${importe}€ el ${payFecha}` });
      }
      setPayingInst(null);
      onSaved?.();
      await load();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' });
    } finally { setPayingNow(false); }
  }

  async function handleDeleteInstallment(inst: Installment) {
    if (!inst.id || !confirm(`¿Eliminar cuota #${inst.numero}? Esto no es reversible.`)) return;
    try {
      await conversionsApi.deleteInstallment(inst.id);
      toast({ title: 'Cuota eliminada' });
      onSaved?.();
      await load();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' });
    }
  }

  if (!conversion) return null;

  const pendiente = Number(conversion.importe_total) - Number(conversion.importe_pagado || 0);

  return (
    <div className="fixed inset-0 !m-0 z-[80] flex items-center justify-center sm:p-4">
      <div className="fixed inset-0 !m-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" className="relative bg-card sm:rounded-lg border border-border w-full max-w-2xl flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-border flex items-start gap-3">
          <div className="w-9 h-9 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
            <Coins size={18} weight="regular" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-base">Cuotas de pago</h3>
            <p className="text-xs text-muted-foreground truncate">{conversion.producto_contratado} · Pendiente {formatCurrency(pendiente)}</p>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : mode === 'view' && installments.length > 0 ? (
            <>
              <p className="text-xs text-muted-foreground">Cuotas programadas:</p>
              <div className="border border-border rounded-md divide-y divide-border">
                {installments.map(inst => {
                  const pagada = !!inst.fecha_cobro;
                  return (
                    <div key={inst.id} className="p-3 flex items-center gap-3 text-sm">
                      <span className="font-bold text-muted-foreground w-8">#{inst.numero}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold tabular-nums">{formatCurrency(inst.importe_previsto)}</p>
                        <p className="text-[11px] text-muted-foreground">Vence {formatDate(inst.fecha_vencimiento)}</p>
                      </div>
                      {pagada ? (
                        <>
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700 dark:text-green-400">
                            <CheckCircle size={14} weight="fill" /> {inst.fecha_cobro ? formatDate(inst.fecha_cobro) : 'Pagada'} · {formatCurrency(Number(inst.importe_cobrado || 0))}
                          </span>
                          <button onClick={() => handleEditPaid(inst)}
                            title="Editar pago (fecha o importe)"
                            className="px-2 py-1 rounded-md text-[11px] font-semibold text-sky-700 hover:bg-sky-100 dark:hover:bg-sky-950/40">
                            Editar
                          </button>
                          <button onClick={() => handleUnpay(inst)}
                            title="Deshacer el pago (vuelve a pendiente)"
                            className="px-2 py-1 rounded-md text-[11px] font-semibold text-amber-700 hover:bg-amber-100 dark:hover:bg-amber-950/40">
                            Deshacer
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => handlePayInstallment(inst)}
                            className="px-2.5 py-1 rounded-md bg-primary text-white text-xs font-semibold hover:bg-primary/90">
                            Marcar pagada
                          </button>
                          <button onClick={() => handleDeleteInstallment(inst)}
                            title="Eliminar cuota"
                            className="p-1 text-muted-foreground hover:text-red-600"><Trash size={14} /></button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              <button
                onClick={() => setMode('create')}
                className="text-xs text-primary hover:underline"
              >+ Regenerar cuotas (sobreescribe las no cobradas)</button>
            </>
          ) : (
            // Modo create
            <>
              <p className="text-xs text-muted-foreground">
                Convierte esta conversión en pagos fraccionados. Las cuotas se distribuyen sobre el importe <strong>pendiente</strong> ({formatCurrency(pendiente)}).
              </p>

              {/* Editor de importe total para aplicar descuentos/becas */}
              <div className="border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 rounded-md p-3">
                <label className="text-[11px] font-semibold text-amber-800 dark:text-amber-300 mb-1 block">
                  ¿Aplicar descuento o beca? Modifica el importe total antes de fraccionar:
                </label>
                <div className="flex gap-2 items-center">
                  <input
                    type="number" step="0.01" min={0} value={totalDraft}
                    onChange={(e) => setTotalDraft(e.target.value)}
                    className="flex-1 h-9 px-3 rounded-md border border-border bg-card text-sm tabular-nums"
                  />
                  <button
                    onClick={handleSaveTotal}
                    disabled={savingTotal || Number(totalDraft) === Number(conversion.importe_total)}
                    className="h-9 px-3 rounded-md bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 disabled:opacity-50"
                  >
                    {savingTotal ? '...' : 'Actualizar total'}
                  </button>
                </div>
                <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-1">
                  Ejemplo: 30% de beca sobre 950€ → escribe <strong>665</strong>. Luego abajo las 6 cuotas sumarán ese nuevo total.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Nº de cuotas</label>
                  <input
                    type="number" min={2} max={36} value={numCuotas}
                    onChange={(e) => setNumCuotas(Math.max(2, Math.min(36, Number(e.target.value) || 2)))}
                    className="w-full h-9 px-3 rounded-md border border-border bg-muted/50 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Fecha primera cuota</label>
                  <input type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)}
                    className="w-full h-9 px-3 rounded-md border border-border bg-muted/50 text-sm" />
                </div>
              </div>

              <div className="border border-border rounded-md divide-y divide-border">
                {draftInstallments.map((c, i) => (
                  <div key={i} className="p-2 flex items-center gap-2 text-sm">
                    <span className="font-bold text-muted-foreground w-8">#{i + 1}</span>
                    <input
                      type="number" step="0.01" value={c.importe_previsto}
                      onChange={(e) => {
                        const next = [...draftInstallments];
                        next[i] = { ...next[i], importe_previsto: Number(e.target.value) || 0 };
                        setDraftInstallments(next);
                      }}
                      className="flex-1 h-8 px-2 rounded-md border border-border bg-muted/50 text-sm tabular-nums"
                    />
                    <input
                      type="date" value={c.fecha_vencimiento}
                      onChange={(e) => {
                        const next = [...draftInstallments];
                        next[i] = { ...next[i], fecha_vencimiento: e.target.value };
                        setDraftInstallments(next);
                      }}
                      className="h-8 px-2 rounded-md border border-border bg-muted/50 text-sm"
                    />
                    <button onClick={() => setDraftInstallments(draftInstallments.filter((_, j) => j !== i))}
                      className="p-1 text-muted-foreground hover:text-red-600"><Trash size={12} /></button>
                  </div>
                ))}
                <div className="p-2 flex items-center justify-between">
                  <button
                    onClick={() => setDraftInstallments([...draftInstallments, {
                      importe_previsto: 0,
                      fecha_vencimiento: draftInstallments[draftInstallments.length - 1]?.fecha_vencimiento || fechaInicio,
                    }])}
                    className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                  ><Plus size={12} weight="bold" /> Añadir cuota</button>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    Suma: {formatCurrency(draftInstallments.reduce((s, c) => s + Number(c.importe_previsto || 0), 0))}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-between items-center gap-2 p-4 border-t border-border bg-muted/20">
          <button onClick={onClose} className="h-9 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted">
            Cerrar
          </button>
          {mode === 'create' && (
            <button onClick={handleGenerate}
              className="h-9 px-4 rounded-md bg-primary text-white text-sm font-semibold hover:bg-primary/90 inline-flex items-center gap-2">
              <CalendarBlank size={14} weight="bold" /> Guardar cuotas
            </button>
          )}
        </div>
      </div>

      {/* Mini-modal cobro de cuota: importe + fecha (no se asume hoy) */}
      {payingInst && (
        <div className="fixed inset-0 !m-0 z-[90] flex items-center justify-center p-4" onClick={() => setPayingInst(null)}>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
          <div role="dialog" className="relative bg-card rounded-lg border border-border w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h4 className="font-semibold text-base mb-1">
              {payMode === 'edit' ? 'Editar pago' : 'Cobrar cuota'} #{payingInst.numero}
            </h4>
            <p className="text-xs text-muted-foreground mb-4">
              {payMode === 'edit'
                ? 'Cambia importe o fecha. Se actualizará el pago y el total cobrado.'
                : `Importe previsto: ${formatCurrency(payingInst.importe_previsto)}`}
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Importe cobrado (€)</label>
                <input
                  type="number" step="0.01" min={0} value={payImporte}
                  onChange={(e) => setPayImporte(e.target.value)}
                  className="w-full h-9 px-3 rounded-md border border-border bg-muted/50 text-sm tabular-nums"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Fecha del pago</label>
                <input
                  type="date" value={payFecha}
                  onChange={(e) => setPayFecha(e.target.value)}
                  className="w-full h-9 px-3 rounded-md border border-border bg-muted/50 text-sm"
                />
                <p className="text-[10px] text-muted-foreground mt-1">Por defecto hoy. Cámbialo si registras un pago pasado.</p>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Método de pago de esta cuota</label>
                <select
                  value={payMetodo}
                  onChange={(e) => setPayMetodo(e.target.value)}
                  className="w-full h-9 px-3 rounded-md border border-border bg-muted/50 text-sm"
                >
                  <option value="transferencia">Transferencia bancaria</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="tarjeta_stripe">Tarjeta (Stripe)</option>
                  <option value="efectivo">Efectivo</option>
                  <option value="bizum">Bizum</option>
                  <option value="otro">Otro</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setPayingInst(null)} disabled={payingNow}
                className="h-9 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={confirmPayInstallment} disabled={payingNow}
                className="h-9 px-4 rounded-md bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
                {payingNow ? 'Guardando…' : (payMode === 'edit' ? 'Guardar cambios' : 'Confirmar cobro')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
