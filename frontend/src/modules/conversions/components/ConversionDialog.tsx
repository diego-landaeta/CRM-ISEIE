import { useState, useEffect, useMemo, useRef, type FormEvent } from 'react';
import Portal from '@/shared/components/ui/portal';
import Select from '@/shared/components/ui/Select';
import { X, Link as LinkIcon, Copy, CheckCircle } from '@phosphor-icons/react';
import { conversionsApi, type Conversion, type MetodoPago } from '../api/conversions.api';
import { useProducts } from '@/modules/products/hooks/useProducts';
import { toast } from '@/shared/hooks/useToast';
import { useEscapeKey } from '@/shared/hooks/useDialogA11y';

interface PaymentLink {
  label: string;
  url: string;
  tipo: string;
}

interface ConversionForm {
  producto_contratado: string;
  importe_total: string;
  importe_pagado: string;
  metodo_pago: MetodoPago;
  fecha_compromiso_pago: string;
  fecha_conversion: string;
  notas_pago: string;
}

interface Installment {
  importe_previsto: string;
  fecha_vencimiento: string;
}

function addMonths(isoDate: string, months: number): string {
  const d = new Date(isoDate);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function distributeInstallments(total: number, n: number, fechaInicio: string): Installment[] {
  if (!isFinite(total) || total <= 0 || n < 2) return [];
  const cuotaBase = Math.round((total / n) * 100) / 100;
  const result: Installment[] = [];
  for (let i = 0; i < n; i++) {
    const importe = i === n - 1
      ? Math.round((total - cuotaBase * (n - 1)) * 100) / 100
      : cuotaBase;
    result.push({
      importe_previsto: String(importe),
      fecha_vencimiento: addMonths(fechaInicio, i),
    });
  }
  return result;
}

interface ConversionDialogTarget {
  id: number;
  nombre?: string;
  producto_nombre?: string;
}

interface ConversionDialogProps {
  open: boolean;
  onClose: () => void;
  lead: ConversionDialogTarget | null | undefined;
  projectId: number;
  onCreated?: (data: Conversion) => void;
}

const METODOS: ReadonlyArray<{ value: MetodoPago; label: string }> = [
  { value: 'tarjeta', label: 'Tarjeta' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'fraccionado', label: 'Fraccionado' },
];

export default function ConversionDialog({ open, onClose, lead, projectId, onCreated }: ConversionDialogProps) {
  useEscapeKey(onClose, open);
  const { products } = useProducts(projectId);
  const [saving, setSaving] = useState(false);
  const [selectedLinkIdx, setSelectedLinkIdx] = useState<string>('-1');
  const [customLink, setCustomLink] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  const [aplicaDescuento, setAplicaDescuento] = useState(false);
  const [numCuotas, setNumCuotas] = useState(3);
  const [fechaPrimeraCuota, setFechaPrimeraCuota] = useState<string>(new Date().toISOString().slice(0, 10));
  const [installments, setInstallments] = useState<Installment[]>([]);
  const [installmentsDirty, setInstallmentsDirty] = useState(false);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
  }, []);
  const [form, setForm] = useState<ConversionForm>({
    producto_contratado: '',
    importe_total: '',
    importe_pagado: '0',
    metodo_pago: 'tarjeta',
    fecha_compromiso_pago: '',
    fecha_conversion: new Date().toISOString().slice(0, 10),
    notas_pago: '',
  });

  const selectedProduct = useMemo(
    () => products.find((p: { nombre?: string }) => p.nombre === form.producto_contratado),
    [products, form.producto_contratado]
  );
  const productLinks = useMemo<PaymentLink[]>(() => {
    if (!selectedProduct) return [];
    if (Array.isArray((selectedProduct as any).payment_links) && (selectedProduct as any).payment_links.length > 0) {
      return (selectedProduct as any).payment_links as PaymentLink[];
    }
    if (selectedProduct.stripe_link) {
      return [{ label: 'Pago completo', url: selectedProduct.stripe_link, tipo: 'completo' }];
    }
    return [];
  }, [selectedProduct]);

  useEffect(() => {
    setSelectedLinkIdx('-1');
    setCustomLink('');
  }, [form.producto_contratado]);

  useEffect(() => {
    if (!selectedProduct || aplicaDescuento) return;
    const precio = selectedProduct.precio != null ? String(selectedProduct.precio) : '';
    if (precio && form.importe_total !== precio) {
      setForm(f => ({ ...f, importe_total: precio }));
    }
  }, [selectedProduct, aplicaDescuento]);

  useEffect(() => {
    if (form.metodo_pago !== 'fraccionado') {
      setInstallmentsDirty(false);
      setInstallments([]);
    }
  }, [form.metodo_pago]);

  useEffect(() => {
    if (form.metodo_pago !== 'fraccionado' || installmentsDirty) return;
    const total = Number(form.importe_total);
    setInstallments(distributeInstallments(total, numCuotas, fechaPrimeraCuota));
  }, [form.metodo_pago, form.importe_total, numCuotas, fechaPrimeraCuota, installmentsDirty]);

  const activeLink = selectedLinkIdx === 'custom'
    ? customLink
    : selectedLinkIdx !== '-1' ? productLinks[Number(selectedLinkIdx)]?.url : '';

  async function copyActiveLink() {
    if (!activeLink) return;
    const { copyToClipboard } = await import('@/shared/lib/clipboard');
    const ok = await copyToClipboard(activeLink);
    if (ok) {
      setLinkCopied(true);
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
      copiedTimeoutRef.current = setTimeout(() => setLinkCopied(false), 2000);
      toast({ title: 'Enlace copiado', description: 'Pégalo en WhatsApp/Email del cliente' });
    } else {
      toast({ title: 'No se pudo copiar', variant: 'destructive' });
    }
  }

  useEffect(() => {
    if (open && lead?.producto_nombre) {
      setForm(f => ({ ...f, producto_contratado: lead.producto_nombre as string }));
    }
  }, [open, lead]);

  if (!open) return null;

  const update = <K extends keyof ConversionForm>(k: K, v: ConversionForm[K]): void =>
    setForm(f => ({ ...f, [k]: v }));

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!lead?.id) {
      toast({ title: 'Lead inválido', description: 'No se pudo identificar el lead asociado.', variant: 'destructive' });
      return;
    }
    const importe = Number(form.importe_total);
    if (!form.producto_contratado?.trim()) {
      toast({ title: 'Producto requerido', variant: 'destructive' });
      return;
    }
    if (!form.importe_total || isNaN(importe) || importe <= 0) {
      toast({ title: 'Importe invalido', description: 'El importe debe ser mayor que 0', variant: 'destructive' });
      return;
    }
    if (Number(form.importe_pagado || 0) > importe) {
      toast({ title: 'Importe pagado invalido', description: 'No puede superar el total', variant: 'destructive' });
      return;
    }
    if (form.metodo_pago === 'fraccionado') {
      if (installments.length < 2) {
        toast({ title: 'Al menos 2 cuotas requeridas', variant: 'destructive' });
        return;
      }
      const sumaCuotas = installments.reduce((s, c) => s + Number(c.importe_previsto || 0), 0);
      const diff = Math.abs(sumaCuotas - importe);
      if (diff > 0.05) {
        toast({ title: 'La suma de cuotas no coincide con el total', description: `Suma: ${sumaCuotas.toFixed(2)} EUR — Total: ${importe.toFixed(2)} EUR`, variant: 'destructive' });
        return;
      }
      if (installments.some(c => !c.fecha_vencimiento || Number(c.importe_previsto) <= 0)) {
        toast({ title: 'Revisa importe y fecha de cada cuota', variant: 'destructive' });
        return;
      }
    }
    setSaving(true);
    try {
      const res = await conversionsApi.create({
        lead_id: lead.id,
        project_id: projectId,
        producto_contratado: form.producto_contratado,
        importe_total: Number(form.importe_total),
        importe_pagado: Number(form.importe_pagado || 0),
        metodo_pago: form.metodo_pago,
        fecha_compromiso_pago: form.fecha_compromiso_pago || null,
        fecha_conversion: form.fecha_conversion,
        notas_pago: form.notas_pago || null,
      });
      if (res.success && res.data) {
        if (form.metodo_pago === 'fraccionado' && installments.length >= 2) {
          try {
            await conversionsApi.generateInstallments(res.data.id, {
              installments: installments.map(c => ({
                importe_previsto: Number(c.importe_previsto),
                fecha_vencimiento: c.fecha_vencimiento,
              })),
            });
          } catch (instErr: any) {
            toast({ title: 'Conversión creada, pero falló generar cuotas', description: instErr?.data?.error || instErr?.message, variant: 'destructive' });
          }
        }
        toast({ title: 'Conversion registrada', description: `${form.producto_contratado} - ${form.importe_total}EUR` });
        onCreated?.(res.data);
        onClose();
      }
    } catch (err: any) {
      toast({
        title: 'Error al registrar conversion',
        description: err?.data?.error || err?.message || 'Error desconocido',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  const inputClass = 'w-full h-9 px-3 rounded-lg border border-border bg-muted/50 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';

  return (
    <Portal>
      <div role="dialog" className="fixed inset-0 !m-0 z-[70] flex items-center justify-center sm:p-4">
        <div className="fixed inset-0 !m-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
        <div className="relative bg-card rounded-lg border border-border w-full max-w-lg mx-4 p-6 overflow-y-auto max-h-[90vh]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Registrar Conversion</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Lead: {lead?.nombre}</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted">
              <X size={18} weight="bold" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Producto contratado *</label>
              {products.length > 0 ? (
                <Select<string>
                  value={form.producto_contratado}
                  onChange={(v) => update('producto_contratado', v)}
                  options={[
                    { value: '', label: 'Seleccionar o escribir abajo' },
                    ...products.map(p => ({ value: p.nombre, label: p.nombre })),
                  ]}
                  ariaLabel="Producto contratado"
                />
              ) : null}
              <input
                list={products.length > 0 ? 'conversion-products-list' : undefined}
                value={form.producto_contratado}
                onChange={e => update('producto_contratado', e.target.value)}
                placeholder={products.length > 0 ? 'Escribe o selecciona del listado' : 'Nombre del producto/curso'}
                className={inputClass}
                required
                autoComplete="off"
              />
              {products.length > 0 && (
                <datalist id="conversion-products-list">
                  {products.map(p => <option key={p.id} value={p.nombre} />)}
                </datalist>
              )}
              <p className="text-[10px] text-muted-foreground mt-1">
                Puedes elegir uno del catálogo o escribir un nombre nuevo.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Importe total (EUR) *</label>
                <input
                  type="number" step="0.01" min="0.01"
                  value={form.importe_total}
                  onChange={e => { update('importe_total', e.target.value); if (selectedProduct && !aplicaDescuento) setAplicaDescuento(true); }}
                  readOnly={!!selectedProduct && !aplicaDescuento}
                  className={inputClass + (selectedProduct && !aplicaDescuento ? ' bg-muted text-muted-foreground cursor-not-allowed' : '')}
                  required
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Importe pagado hoy</label>
                <input type="number" step="0.01" min="0" value={form.importe_pagado} onChange={e => update('importe_pagado', e.target.value)} className={inputClass} />
              </div>
            </div>

            {selectedProduct && (
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={aplicaDescuento}
                    onChange={(e) => {
                      setAplicaDescuento(e.target.checked);
                      if (!e.target.checked && selectedProduct?.precio != null) {
                        update('importe_total', String(selectedProduct.precio));
                      }
                    }}
                  />
                  <span>Aplicar descuento (editar importe manualmente)</span>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 uppercase tracking-wide">Fase prueba</span>
                  {!aplicaDescuento && selectedProduct.precio != null && (
                    <span className="text-muted-foreground">— precio del catálogo: {String(selectedProduct.precio)} EUR</span>
                  )}
                </label>
                {aplicaDescuento && selectedProduct.precio != null && Number(form.importe_total) > 0 && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400 pl-6">
                    Descuento aplicado: {Number(selectedProduct.precio) - Number(form.importe_total) > 0
                      ? `−${(Number(selectedProduct.precio) - Number(form.importe_total)).toFixed(2)} EUR (${(((Number(selectedProduct.precio) - Number(form.importe_total)) / Number(selectedProduct.precio)) * 100).toFixed(1)}%)`
                      : 'sin descuento (mismo precio)'}
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Metodo de pago</label>
                <Select<MetodoPago>
                  value={form.metodo_pago}
                  onChange={(v) => update('metodo_pago', v)}
                  options={METODOS.map(m => ({ value: m.value, label: m.label }))}
                  ariaLabel="Método de pago"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Fecha conversion</label>
                <input type="date" value={form.fecha_conversion} onChange={e => update('fecha_conversion', e.target.value)} className={inputClass} />
              </div>
            </div>

            {form.metodo_pago === 'fraccionado' && (
              <div className="space-y-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="text-xs font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider">
                    Plan de cuotas
                  </div>
                  {installmentsDirty && (
                    <button
                      type="button"
                      onClick={() => { setInstallmentsDirty(false); }}
                      className="text-[10px] text-amber-700 dark:text-amber-300 underline"
                    >
                      Recalcular automáticamente
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Número de cuotas</label>
                    <input
                      type="number" min="2" max="60"
                      value={numCuotas}
                      onChange={e => { setNumCuotas(Math.max(2, Number(e.target.value) || 2)); setInstallmentsDirty(false); }}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Fecha primera cuota</label>
                    <input
                      type="date"
                      value={fechaPrimeraCuota}
                      onChange={e => { setFechaPrimeraCuota(e.target.value); setInstallmentsDirty(false); }}
                      className={inputClass}
                    />
                  </div>
                </div>

                {installments.length > 0 && (
                  <div className="space-y-1">
                    <div className="grid grid-cols-[40px_1fr_140px] gap-2 text-[10px] font-bold uppercase text-muted-foreground px-1">
                      <span>#</span>
                      <span>Importe (EUR)</span>
                      <span>Vencimiento</span>
                    </div>
                    {installments.map((c, i) => (
                      <div key={i} className="grid grid-cols-[40px_1fr_140px] gap-2 items-center">
                        <span className="text-xs font-mono text-muted-foreground">{i + 1}</span>
                        <input
                          type="number" step="0.01" min="0.01"
                          value={c.importe_previsto}
                          onChange={e => {
                            const next = [...installments];
                            next[i] = { ...next[i], importe_previsto: e.target.value };
                            setInstallments(next);
                            setInstallmentsDirty(true);
                          }}
                          className={inputClass}
                        />
                        <input
                          type="date"
                          value={c.fecha_vencimiento}
                          onChange={e => {
                            const next = [...installments];
                            next[i] = { ...next[i], fecha_vencimiento: e.target.value };
                            setInstallments(next);
                            setInstallmentsDirty(true);
                          }}
                          className={inputClass}
                        />
                      </div>
                    ))}
                    {(() => {
                      const suma = installments.reduce((s, c) => s + Number(c.importe_previsto || 0), 0);
                      const total = Number(form.importe_total) || 0;
                      const diff = Math.round((total - suma) * 100) / 100;
                      const ok = Math.abs(diff) <= 0.05;
                      return (
                        <div className={`text-[11px] font-medium pt-1 ${ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          Suma cuotas: {suma.toFixed(2)} EUR — Total: {total.toFixed(2)} EUR
                          {!ok && ` — Diferencia: ${diff.toFixed(2)} EUR`}
                        </div>
                      );
                    })()}
                  </div>
                )}

                <div>
                  <label className="text-[10px] font-medium text-muted-foreground mb-1 block">Fecha compromiso de pago pendiente (opcional)</label>
                  <input type="date" value={form.fecha_compromiso_pago} onChange={e => update('fecha_compromiso_pago', e.target.value)} className={inputClass} />
                </div>
              </div>
            )}

            {(productLinks.length > 0 || form.producto_contratado) && (
              <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 space-y-2">
                <div className="flex items-center gap-2 text-[11px] font-bold text-blue-800 dark:text-blue-300">
                  <LinkIcon size={12} weight="bold" /> Enlace de pago para compartir
                </div>
                <Select<string>
                  value={selectedLinkIdx}
                  onChange={setSelectedLinkIdx}
                  options={[
                    { value: '-1', label: 'Sin enlace' },
                    ...productLinks.map((l, i) => ({
                      value: String(i),
                      label: l.tipo !== 'completo' ? `${l.label} (${l.tipo})` : l.label,
                    })),
                    { value: 'custom', label: 'Personalizado…' },
                  ]}
                  ariaLabel="Enlace de pago"
                />
                {selectedLinkIdx === 'custom' && (
                  <input
                    type="url"
                    value={customLink}
                    onChange={(e) => setCustomLink(e.target.value)}
                    placeholder="https://buy.stripe.com/..."
                    className={inputClass + ' font-mono text-xs'}
                  />
                )}
                {activeLink && (
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate text-[11px] font-mono text-blue-700 dark:text-blue-300 bg-white/60 dark:bg-black/20 px-2 py-1.5 rounded">
                      {activeLink}
                    </code>
                    <button
                      type="button"
                      onClick={copyActiveLink}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 flex-shrink-0"
                    >
                      {linkCopied ? <CheckCircle size={12} weight="bold" /> : <Copy size={12} weight="bold" />}
                      {linkCopied ? 'Copiado' : 'Copiar'}
                    </button>
                  </div>
                )}
                {productLinks.length === 0 && form.producto_contratado && (
                  <p className="text-[10px] text-blue-700/70 dark:text-blue-300/70 italic">
                    Este producto no tiene enlaces configurados. Añádelos editando el producto.
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Notas</label>
              <textarea value={form.notas_pago} onChange={e => update('notas_pago', e.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg border border-border bg-muted/50 text-sm outline-none resize-none focus:border-primary focus:ring-2 focus:ring-primary/20" placeholder="Notas sobre el acuerdo..." />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg border border-border bg-card text-sm font-semibold hover:bg-muted">Cancelar</button>
              <button type="submit" disabled={saving} className="h-9 px-4 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
                {saving ? 'Guardando...' : 'Registrar conversion'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Portal>
  );
}
