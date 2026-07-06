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
  iva_pct: string;
  iva_incluido: boolean;
  iva_exento: boolean;
  descuento_tipo: 'none' | 'pct' | 'monto';
  descuento_valor: string;
}

interface SaleItem {
  product_id: number | null;
  descripcion: string;
  cantidad: number;
  precio_unitario: string;
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

// Acepta tanto Lead como Client; solo necesita id, nombre y opcional producto_nombre
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
  const [selectedLinkIdx, setSelectedLinkIdx] = useState<string>('-1'); // '-1' = sin link, 'X' = índice, 'custom' = personalizado
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
    iva_pct: '21',
    iva_incluido: true,   // el precio del curso ya es el precio final (IVA incluido)
    iva_exento: false,
    descuento_tipo: 'none',
    descuento_valor: '',
  });
  // Multi-item: si tiene >0 items se usan para calcular importe_total.
  // Si la lista está vacía → comportamiento legacy (1 producto, importe manual).
  const [items, setItems] = useState<SaleItem[]>([]);
  const useMultiItem = items.length > 0;

  // Desglose central: subtotal bruto → descuento → base → IVA → total.
  // En modo simple el bruto es form.importe_total (lo que ingresa el usuario);
  // en multi-item es la suma de los items.
  const calc = useMemo(() => {
    const bruto = useMultiItem
      ? items.reduce((s, it) => s + Number(it.cantidad || 1) * Number(it.precio_unitario || 0), 0)
      : Number(form.importe_total || 0);
    let desc = 0;
    if (form.descuento_tipo === 'pct') desc = bruto * Number(form.descuento_valor || 0) / 100;
    else if (form.descuento_tipo === 'monto') desc = Math.min(Number(form.descuento_valor || 0), bruto);
    const neto = Math.max(0, bruto - desc);
    const ivaPct = Number(form.iva_pct || 0);
    let base: number, iva: number, total: number;
    if (form.iva_exento) { base = neto; iva = 0; total = neto; }
    else if (form.iva_incluido) { total = neto; base = neto / (1 + ivaPct / 100); iva = total - base; }
    else { base = neto; iva = base * ivaPct / 100; total = base + iva; }
    return {
      bruto: Number(bruto.toFixed(2)), desc: Number(desc.toFixed(2)), neto: Number(neto.toFixed(2)),
      base: Number(base.toFixed(2)), iva: Number(iva.toFixed(2)), total: Number(total.toFixed(2)),
    };
  }, [useMultiItem, items, form.importe_total, form.descuento_tipo, form.descuento_valor, form.iva_pct, form.iva_incluido, form.iva_exento]);

  // Producto seleccionado por nombre exacto (CRM-140) — para mostrar sus enlaces de pago
  const selectedProduct = useMemo(
    () => products.find((p: { nombre?: string }) => p.nombre === form.producto_contratado),
    [products, form.producto_contratado]
  );
  const productLinks = useMemo<PaymentLink[]>(() => {
    if (!selectedProduct) return [];
    if (Array.isArray(selectedProduct.payment_links) && selectedProduct.payment_links.length > 0) {
      return selectedProduct.payment_links as PaymentLink[];
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

  // Al elegir un producto del catálogo, autorrellena el importe con su precio.
  // Si el usuario marca "Aplicar descuento", deja editar libremente sin pisar.
  useEffect(() => {
    if (!selectedProduct || aplicaDescuento) return;
    const precio = selectedProduct.precio != null ? String(selectedProduct.precio) : '';
    if (precio && form.importe_total !== precio) {
      setForm(f => ({ ...f, importe_total: precio }));
    }
  }, [selectedProduct, aplicaDescuento]);

  // Reset dirty flag when fraccionado switches off
  useEffect(() => {
    if (form.metodo_pago !== 'fraccionado') {
      setInstallmentsDirty(false);
      setInstallments([]);
    }
  }, [form.metodo_pago]);

  // Recalcular cuotas si: estoy en fraccionado, las cuotas NO han sido editadas a mano
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
      setForm(f => ({ ...f, producto_contratado: lead.producto_nombre }));
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
    const importe = calc.total;  // total final con descuento + IVA
    const prodOk = useMultiItem ? items.some(it => it.descripcion?.trim()) : form.producto_contratado?.trim();
    if (!prodOk) {
      toast({ title: 'Producto requerido', variant: 'destructive' });
      return;
    }
    if (isNaN(importe) || importe <= 0) {
      toast({ title: 'Importe invalido', description: 'El total debe ser mayor que 0', variant: 'destructive' });
      return;
    }
    if (Number(form.importe_pagado || 0) > importe) {
      toast({ title: 'Importe pagado invalido', description: 'No puede superar el total', variant: 'destructive' });
      return;
    }
    // Validar cuotas si es fraccionado
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
        producto_contratado: useMultiItem
          ? items.map(it => `${it.cantidad}x ${it.descripcion}`).join(' + ')
          : form.producto_contratado,
        // FK al programa del catálogo (bug: antes solo se guardaba el nombre en
        // texto y el vínculo quedaba NULL → el reporting no cruzaba la venta).
        producto_contratado_id: useMultiItem ? null : (selectedProduct?.id ?? null),
        importe_total: calc.total,
        importe_pagado: Number(form.importe_pagado || 0),
        metodo_pago: form.metodo_pago,
        fecha_compromiso_pago: form.fecha_compromiso_pago || null,
        fecha_conversion: form.fecha_conversion,
        notas_pago: form.notas_pago || null,
        items: useMultiItem ? items.map(it => ({
          product_id: it.product_id,
          descripcion: it.descripcion,
          cantidad: it.cantidad,
          precio_unitario: Number(it.precio_unitario || 0),
        })) : undefined,
        iva_pct: form.iva_exento ? 0 : Number(form.iva_pct || 21),
        iva_incluido: form.iva_incluido && !form.iva_exento,
        iva_exento: form.iva_exento,
        descuento_tipo: form.descuento_tipo,
        descuento_valor: form.descuento_tipo === 'none' ? 0 : Number(form.descuento_valor || 0),
        subtotal_bruto: calc.bruto,
      } as any);
      if (res.success && res.data) {
        // Si es fraccionado, genera las cuotas custom
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
            {/* MODO 1: Producto único (legacy) */}
            {!useMultiItem && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-medium text-muted-foreground">Producto contratado *</label>
                  <button type="button"
                    onClick={() => setItems([{ product_id: null, descripcion: form.producto_contratado || '', cantidad: 1, precio_unitario: form.importe_total || '0' }])}
                    className="text-[10px] text-primary hover:underline">
                    + Añadir más productos
                  </button>
                </div>
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
                  required={!useMultiItem}
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
            )}

            {/* MODO 2: Multi-item */}
            {useMultiItem && (
              <div className="border border-border rounded-md p-3 space-y-2 bg-muted/20">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold uppercase text-muted-foreground">Productos contratados ({items.length})</label>
                  <button type="button"
                    onClick={() => { setItems([]); }}
                    className="text-[10px] text-muted-foreground hover:text-foreground">Volver a producto único</button>
                </div>
                {items.map((it, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <input list="conversion-products-list-multi" value={it.descripcion}
                      onChange={e => {
                        const v = e.target.value;
                        const matched = products.find((p: any) => p.nombre === v);
                        setItems(items.map((x, i) => i === idx ? { ...x, descripcion: v, product_id: matched?.id || null, precio_unitario: matched?.precio ? String(matched.precio) : x.precio_unitario } : x));
                      }}
                      placeholder="Descripción / nombre del curso"
                      className="col-span-6 h-9 px-2 rounded border border-border bg-background text-sm" />
                    <input type="number" min="1" value={it.cantidad}
                      onChange={e => setItems(items.map((x, i) => i === idx ? { ...x, cantidad: Number(e.target.value || 1) } : x))}
                      title="Cantidad" placeholder="Cant"
                      className="col-span-2 h-9 px-2 rounded border border-border bg-background text-sm" />
                    <input type="number" step="0.01" min="0" value={it.precio_unitario}
                      onChange={e => setItems(items.map((x, i) => i === idx ? { ...x, precio_unitario: e.target.value } : x))}
                      title="Precio unitario" placeholder="€/u"
                      className="col-span-3 h-9 px-2 rounded border border-border bg-background text-sm" />
                    <button type="button" onClick={() => setItems(items.filter((_, i) => i !== idx))}
                      className="col-span-1 text-muted-foreground hover:text-red-500 text-base">×</button>
                  </div>
                ))}
                <datalist id="conversion-products-list-multi">
                  {products.map((p: any) => <option key={p.id} value={p.nombre} />)}
                </datalist>
                <button type="button"
                  onClick={() => setItems([...items, { product_id: null, descripcion: '', cantidad: 1, precio_unitario: '0' }])}
                  className="text-xs text-primary hover:underline">+ añadir otro producto</button>
                <div className="text-[10px] text-muted-foreground italic">
                  Subtotal: {items.reduce((s, it) => s + Number(it.cantidad || 1) * Number(it.precio_unitario || 0), 0).toFixed(2)} €
                </div>
              </div>
            )}

            {/* DESCUENTO */}
            <div className="border border-border rounded-md p-3 space-y-2 bg-muted/10">
              <label className="text-[11px] font-bold uppercase text-muted-foreground">Descuento</label>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <select value={form.descuento_tipo} onChange={e => update('descuento_tipo', e.target.value as any)}
                  className="h-7 px-2 rounded border border-border bg-background text-sm">
                  <option value="none">Sin descuento</option>
                  <option value="pct">Porcentaje (%)</option>
                  <option value="monto">Monto fijo (€)</option>
                </select>
                {form.descuento_tipo !== 'none' && (
                  <div className="inline-flex items-center gap-1">
                    <input type="number" min="0" step="0.01" value={form.descuento_valor}
                      onChange={e => update('descuento_valor', e.target.value)}
                      placeholder={form.descuento_tipo === 'pct' ? '10' : '50'}
                      className="w-20 h-7 px-2 rounded border border-border bg-background text-sm" />
                    <span>{form.descuento_tipo === 'pct' ? '%' : '€'}</span>
                    {calc.desc > 0 && <span className="text-emerald-600 font-semibold ml-1">−{calc.desc.toFixed(2)} €</span>}
                  </div>
                )}
              </div>
            </div>

            {/* IVA */}
            <div className="border border-border rounded-md p-3 space-y-2 bg-muted/10">
              <label className="text-[11px] font-bold uppercase text-muted-foreground">IVA</label>
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={form.iva_exento} onChange={e => update('iva_exento', e.target.checked as any)} />
                  Exento (sin IVA)
                </label>
                {!form.iva_exento && (
                  <>
                    <div className="inline-flex items-center gap-1">
                      <span>%:</span>
                      <input type="number" min="0" max="100" step="0.01" value={form.iva_pct}
                        onChange={e => update('iva_pct', e.target.value)}
                        className="w-16 h-7 px-2 rounded border border-border bg-background text-sm" />
                    </div>
                    <label className="inline-flex items-center gap-1.5">
                      <input type="checkbox" checked={form.iva_incluido} onChange={e => update('iva_incluido', e.target.checked as any)} />
                      Precio ya incluye IVA (desglosar)
                    </label>
                  </>
                )}
              </div>
              {form.iva_exento && <p className="text-[10px] text-muted-foreground italic">Operación exenta — art. 20 LIVA (servicios educativos)</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
                  {useMultiItem ? 'Subtotal items (auto)' : 'Precio base (EUR) *'}
                </label>
                <input
                  type="number" step="0.01" min="0"
                  value={useMultiItem ? calc.bruto.toFixed(2) : form.importe_total}
                  onChange={e => update('importe_total', e.target.value)}
                  readOnly={useMultiItem}
                  className={inputClass + (useMultiItem ? ' bg-muted text-muted-foreground cursor-not-allowed' : '')}
                  required={!useMultiItem}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Importe pagado hoy</label>
                <input type="number" step="0.01" min="0" value={form.importe_pagado} onChange={e => update('importe_pagado', e.target.value)} className={inputClass} />
                <button type="button" onClick={() => update('importe_pagado', String(calc.total))}
                  className="text-[10px] text-primary hover:underline mt-0.5">Pagó el total ({calc.total.toFixed(2)} €)</button>
              </div>
            </div>

            {/* DESGLOSE */}
            <div className="border border-primary/30 rounded-md p-3 bg-primary/5 space-y-1 text-sm">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Subtotal</span><span className="tabular-nums">{calc.bruto.toFixed(2)} €</span>
              </div>
              {calc.desc > 0 && (
                <div className="flex justify-between text-xs text-emerald-600">
                  <span>Descuento {form.descuento_tipo === 'pct' ? `(${form.descuento_valor}%)` : ''}</span>
                  <span className="tabular-nums">−{calc.desc.toFixed(2)} €</span>
                </div>
              )}
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Base imponible</span><span className="tabular-nums">{calc.base.toFixed(2)} €</span>
              </div>
              {!form.iva_exento && (
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>IVA ({form.iva_pct}%){form.iva_incluido ? ' incl.' : ''}</span><span className="tabular-nums">{calc.iva.toFixed(2)} €</span>
                </div>
              )}
              {form.iva_exento && <div className="text-[10px] text-muted-foreground italic">Operación exenta de IVA</div>}
              <div className="flex justify-between font-bold text-base border-t border-border pt-1 mt-1">
                <span>TOTAL</span><span className="tabular-nums text-primary">{calc.total.toFixed(2)} €</span>
              </div>
            </div>

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

            {/* Selector de enlace de pago Stripe (CRM-140) */}
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
