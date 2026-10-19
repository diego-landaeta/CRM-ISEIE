import { useState, useEffect, useMemo, useRef, lazy, Suspense, type FormEvent } from 'react';
import Portal from '@/shared/components/ui/portal';
import Select from '@/shared/components/ui/Select';
import Field from '@/shared/components/ui/Field';
import FilaCampos from '@/shared/components/ui/FilaCampos';
import { inputClass } from '@/shared/lib/ui';
import { X, Link as LinkIcon, Copy, CheckCircle, Receipt, FileText } from '@phosphor-icons/react';
import { conversionsApi, type Conversion, type MetodoPago } from '../api/conversions.api';
import { useProducts } from '@/modules/products/hooks/useProducts';
import { invoicesApi, invoiceFaltantes, type Invoice, type InvoiceItem } from '@/modules/invoices/api/invoices.api';
import { toast } from '@/shared/hooks/useToast';
import { avisoDeLoQueFalta, numerosMalEscritos, type Falta } from '@/shared/lib/loQueFalta';
import { useEscapeKey } from '@/shared/hooks/useDialogA11y';

const FiscalDataDialog = lazy(() => import('@/modules/invoices/components/FiscalDataDialog'));
const EmitirBorradorDialog = lazy(() => import('@/modules/invoices/components/EmitirBorradorDialog'));

// Flujo nuevo de facturación (ventana Presupuesto/Factura + auto-emisión al
// pagar) SOLO en entornos con VITE_FACTURACION_V2=true (staging). En producción
// la conversión se registra y cierra como siempre, sin ventana.
const FACT_V2 = String(import.meta.env.VITE_FACTURACION_V2 || '') === 'true';

// Construye los conceptos del documento a partir de la conversión creada.
function buildDocItems(c: Conversion): InvoiceItem[] {
  if (c.items && c.items.length > 0) {
    return c.items.map(it => ({ descripcion: it.descripcion, cantidad: it.cantidad, precio_unitario: Number(it.precio_unitario) }));
  }
  return [{ descripcion: c.producto_contratado || 'Servicio', cantidad: 1, precio_unitario: Number(c.importe_total) }];
}
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
  if (!isFinite(total) || total <= 0 || n < 1) return [];
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
  { value: 'tarjeta_stripe', label: 'Tarjeta (Stripe)' },
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'deposito', label: 'Depósito bancario' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'bizum', label: 'Bizum' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'fraccionado', label: 'Fraccionado' },
  { value: 'otro', label: 'Otro' },
];

/*
  El formulario se monta de nuevo en cada apertura y con cada prospecto.

  Antes se quedaba montado con el diálogo cerrado: al abrirlo para otro
  prospecto seguían puestos el producto, el precio y el pago del anterior, y
  se podía registrar a uno la venta de otro (visto en la prueba de la #106).
  El catálogo se pide aquí fuera, para no volver a pedirlo en cada apertura.
*/
export default function ConversionDialog(props: ConversionDialogProps) {
  const { products } = useProducts(props.projectId);
  if (!props.open) return null;
  return <FormularioConversion key={props.lead?.id ?? 'sin-prospecto'} {...props} products={products} />;
}

function FormularioConversion({ open, onClose, lead, projectId, onCreated, products }: ConversionDialogProps & { products: ReturnType<typeof useProducts>['products'] }) {
  const [saving, setSaving] = useState(false);
  // Paso post-venta: tras registrar la conversión, ofrecer generar Presupuesto/Factura + PDF.
  const [created, setCreated] = useState<Conversion | null>(null);
  const [docPhase, setDocPhase] = useState<'idle' | 'choose' | 'factura' | 'proforma'>('idle');
  // Factura ya emitida automáticamente por el pago → diálogo de completar datos.
  const [emitInv, setEmitInv] = useState<Invoice | null>(null);
  const notifiedRef = useRef(false);
  // Notifica al padre (refresca su lista) UNA sola vez y cierra. Se usa en X, backdrop, Esc y "Ahora no".
  const finishAndClose = () => {
    if (created && !notifiedRef.current) { notifiedRef.current = true; onCreated?.(created); }
    onClose();
  };
  useEscapeKey(finishAndClose, open);
  const [selectedLinkIdx, setSelectedLinkIdx] = useState<string>('-1'); // '-1' = sin link, 'X' = índice, 'custom' = personalizado
  const [customLink, setCustomLink] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  const [aplicaDescuento, setAplicaDescuento] = useState(false);
  // Estado del pago: 'total' SIEMPRE manda calc.total al registrar (no se queda
  // con un valor viejo si cambias el precio después), 'parcial' usa el input, 'none' = 0.
  const [pagoMode, setPagoMode] = useState<'none' | 'parcial' | 'total'>('none');
  // Método REAL con el que se cobró la inicial cuando la venta es fraccionada.
  const [metodoInicial, setMetodoInicial] = useState<MetodoPago>('tarjeta');
  const [numCuotas, setNumCuotas] = useState(3);
  const [fechaPrimeraCuota, setFechaPrimeraCuota] = useState<string>(new Date().toISOString().slice(0, 10));
  const [installments, setInstallments] = useState<Installment[]>([]);
  const [installmentsDirty, setInstallmentsDirty] = useState(false);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
  }, []);
  // Al cerrar, resetea el paso de documento para que una próxima apertura arranque limpia.
  useEffect(() => {
    if (!open) { setDocPhase('idle'); setCreated(null); setEmitInv(null); notifiedRef.current = false; }
  }, [open]);
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
  // Del catálogo o escrito a mano: si el nombre es el de un producto, se enlaza
  // y se trae su precio (antes lo hacía la lista del navegador, #106).
  const elegirProducto = (idx: number, v: string) => {
    const matched = products.find((p: any) => p.nombre === v);
    setItems(items.map((x, i) => i === idx ? { ...x, descripcion: v, product_id: matched?.id || null, precio_unitario: matched?.precio ? String(matched.precio) : x.precio_unitario } : x));
  };
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

  // Pago recibido HOY (parcial o total). El plan de cuotas reparte el PENDIENTE
  // (total − pago inicial), NO el total: si pagas 500 de 1500, las cuotas suman
  // 1000, no 1500. Así el inicial + cuotas = total del programa.
  const pagadoInicial = pagoMode === 'total' ? calc.total : pagoMode === 'parcial' ? Number(form.importe_pagado || 0) : 0;
  const pendienteFrac = Math.max(0, Number((calc.total - pagadoInicial).toFixed(2)));

  // Recalcular cuotas si: estoy en fraccionado, las cuotas NO han sido editadas a mano.
  // Se reparte el PENDIENTE neto (total − pago inicial). Las cuotas deben sumar el
  // pendiente, no el total del programa.
  useEffect(() => {
    if (form.metodo_pago !== 'fraccionado' || installmentsDirty) return;
    setInstallments(distributeInstallments(pendienteFrac, numCuotas, fechaPrimeraCuota));
  }, [form.metodo_pago, pendienteFrac, numCuotas, fechaPrimeraCuota, installmentsDirty]);

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

  // Elegir "Factura" en el paso post-venta: si el pago YA generó la factura
  // automática (con número), no se crea otra — se completa/descarga esa.
  async function handleFacturaChoice() {
    if (!created) { setDocPhase('factura'); return; }
    try {
      let inv = (await invoicesApi.byConversion(created.id)).data || null;
      if (!inv && pagoMode !== 'none') {
        // la auto-emisión corre asíncrona en el server: pequeño reintento
        await new Promise((r) => setTimeout(r, 900));
        inv = (await invoicesApi.byConversion(created.id)).data || null;
      }
      if (inv) {
        if (inv.estado === 'borrador' || invoiceFaltantes(inv).length > 0) { setEmitInv(inv); return; }
        toast({ title: `✓ Factura ${inv.codigo}`, description: 'Emitida automáticamente al registrar el pago.' });
        invoicesApi.openPdf(inv.id).catch((e: unknown) => toast({ title: 'No se pudo abrir el PDF', description: (e as { message?: string })?.message, variant: 'destructive' }));
        finishAndClose();
        return;
      }
    } catch { /* si falla la consulta, seguimos al modal normal */ }
    setDocPhase('factura');
  }

  // Paso 2c: la factura ya existe (auto-emitida al pagar) pero le faltan datos →
  // alerta para completarlos (desbloquea descargar/enviar).
  if (emitInv) {
    return (
      <Suspense fallback={null}>
        <EmitirBorradorDialog
          invoice={emitInv}
          onClose={() => { setEmitInv(null); finishAndClose(); }}
          onEmitted={(_codigo, id) => { invoicesApi.openPdf(id).catch((e: unknown) => toast({ title: 'No se pudo abrir el PDF', description: (e as { message?: string })?.message, variant: 'destructive' })); setEmitInv(null); finishAndClose(); }}
        />
      </Suspense>
    );
  }

  // Paso 2b: documento fiscal (Factura o Presupuesto) — reemplaza por completo el modal de conversión.
  if ((docPhase === 'factura' || docPhase === 'proforma') && created) {
    return (
      <Suspense fallback={null}>
        <FiscalDataDialog
          projectId={projectId}
          leadId={lead?.id ?? created.lead_id ?? 0}
          conversionId={created.id}
          docTipo={docPhase}
          defaultItems={buildDocItems(created)}
          defaultNotas={created.notas_pago || undefined}
          defaultIvaExento={created.iva_exento}
          defaultIvaPct={created.iva_pct != null ? Number(created.iva_pct) : undefined}
          defaultIvaIncluido={created.iva_incluido}
          onClose={finishAndClose}
          onCreated={(id) => { invoicesApi.openPdf(id).catch((e: unknown) => toast({ title: 'No se pudo abrir el PDF', description: (e as { message?: string })?.message, variant: 'destructive' })); finishAndClose(); }}
        />
      </Suspense>
    );
  }

  const update = <K extends keyof ConversionForm>(k: K, v: ConversionForm[K]): void =>
    setForm(f => ({ ...f, [k]: v }));

  /*
    Los límites de cada casilla (min, max y los céntimos de step="0.01").

    El formulario lleva noValidate para que avise el CRM y no el globo del
    navegador (#106), y con eso el navegador deja de comprobarlos. Aquí se
    comprueban los mismos, ni uno más, diciendo en qué casilla está el problema.
  */
  function fueraDeLimites(): { title: string; description: string } | null {
    const num = (v: unknown) => Number(v);
    const centimos = (v: unknown) => /\.\d{3,}$/.test(String(v ?? '').trim());
    const dinero = (v: unknown, casilla: string) => (centimos(v)
      ? { title: 'Demasiados decimales', description: `En «${casilla}», como mucho 2 decimales (céntimos).` } : null);
    if (!useMultiItem) {
      if (form.importe_total !== '' && num(form.importe_total) < 0) {
        return { title: 'Precio no válido', description: '«Precio base (EUR)» no puede ser negativo.' };
      }
      const d = dinero(form.importe_total, 'Precio base (EUR)'); if (d) return d;
    }
    for (const [i, it] of items.entries()) {
      if (num(it.cantidad) < 1) return { title: 'Cantidad no válida', description: `En el producto ${i + 1}, la cantidad tiene que ser 1 o más.` };
      if (num(it.precio_unitario) < 0) return { title: 'Precio no válido', description: `En el producto ${i + 1}, el precio no puede ser negativo.` };
      const d = dinero(it.precio_unitario, `Precio unitario del producto ${i + 1}`); if (d) return d;
    }
    if (form.descuento_tipo !== 'none') {
      if (num(form.descuento_valor) < 0) return { title: 'Descuento no válido', description: 'El descuento no puede ser negativo.' };
      const d = dinero(form.descuento_valor, form.descuento_tipo === 'pct' ? 'Porcentaje de descuento (%)' : 'Descuento (€)'); if (d) return d;
    }
    if (!form.iva_exento) {
      if (form.iva_pct === '' || num(form.iva_pct) < 0 || num(form.iva_pct) > 100) {
        return { title: 'IVA no válido', description: 'En «IVA», un porcentaje de 0 a 100.' };
      }
      const d = dinero(form.iva_pct, 'IVA'); if (d) return d;
    }
    if (pagoMode === 'parcial') {
      if (num(form.importe_pagado) < 0) return { title: 'Pago no válido', description: 'Lo pagado hoy no puede ser negativo.' };
      const d = dinero(form.importe_pagado, 'Pago recibido hoy'); if (d) return d;
    }
    if (form.metodo_pago === 'fraccionado') {
      if (numCuotas > 60) return { title: 'Demasiadas cuotas', description: 'En «Número de cuotas», como mucho 60.' };
      const i = installments.findIndex((c) => centimos(c.importe_previsto));
      if (i >= 0) return { title: 'Demasiados decimales', description: `En el importe de la cuota ${i + 1}, como mucho 2 decimales (céntimos).` };
    }
    return null;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!lead?.id) {
      toast({ title: 'Lead inválido', description: 'No se pudo identificar el lead asociado.', variant: 'destructive' });
      return;
    }
    const importe = calc.total;  // total final con descuento + IVA
    // Pago según el modo elegido (evita el bug de "Pagó el total" con valor viejo).
    const pagado = pagoMode === 'total' ? calc.total : pagoMode === 'parcial' ? Number(form.importe_pagado || 0) : 0;
    const prodOk = useMultiItem ? items.some(it => it.descripcion?.trim()) : form.producto_contratado?.trim();
    // Cada aviso dice qué falta y dónde ponerlo, no solo «requerido»; y si
    // faltan varias cosas, todas de una vez (#106). Las casillas de número con
    // algo que no es un número van en la misma lista.
    const faltan: Falta[] = numerosMalEscritos(e.currentTarget);
    if (!prodOk) {
      faltan.push(useMultiItem
        ? { title: 'Falta el producto contratado', description: 'Escribe al menos uno en «Productos contratados».', que: 'el producto en «Productos contratados»' }
        : { title: 'Falta el producto contratado', description: 'Elígelo del catálogo o escribe su nombre en «Producto contratado».', que: 'el producto en «Producto contratado»' });
    }
    // Un precio negativo no «falta»: lo dice fueraDeLimites, más abajo. Y si
    // está mal escrito, ya va en la lista: no se dice dos veces.
    const precioMalEscrito = faltan.some((f) => f.que.endsWith('«Precio base (EUR)»'));
    if ((isNaN(importe) || importe <= 0) && !(calc.bruto > 0) && !(calc.bruto < 0) && !precioMalEscrito) {
      faltan.push(useMultiItem
        ? { title: 'Falta el precio', description: 'El total tiene que ser mayor que 0: pon el precio de cada producto en «Productos contratados».', que: 'el precio de cada producto' }
        : { title: 'Falta el precio', description: 'El total tiene que ser mayor que 0: escribe el precio en «Precio base (EUR)».', que: 'el precio en «Precio base (EUR)»' });
    }
    const falta = avisoDeLoQueFalta(faltan);
    if (falta) { toast(falta); return; }
    const fuera = fueraDeLimites();
    if (fuera) { toast({ ...fuera, variant: 'destructive' }); return; }
    if (isNaN(importe) || importe <= 0) {
      toast({ title: 'El total queda en 0', description: 'El descuento se come todo el precio: revisa «Descuento».', variant: 'destructive' });
      return;
    }
    if (pagado > importe) {
      toast({ title: 'El pago de hoy no cuadra', description: `No puede ser mayor que el total (${importe.toFixed(2)} €).`, variant: 'destructive' });
      return;
    }
    // Validar cuotas si es fraccionado
    if (form.metodo_pago === 'fraccionado') {
      if (installments.length < 1) {
        toast({ title: 'Falta el plan de cuotas', description: 'Pon al menos 1 cuota en «Número de cuotas».', variant: 'destructive' });
        return;
      }
      const sumaCuotas = installments.reduce((s, c) => s + Number(c.importe_previsto || 0), 0);
      // Las cuotas deben cubrir el PENDIENTE (total − pago inicial), no el total.
      const objetivo = Number((importe - pagado).toFixed(2));
      const diff = Math.abs(sumaCuotas - objetivo);
      if (diff > 0.05) {
        toast({ title: 'La suma de cuotas no coincide con el pendiente', description: `Cuotas: ${sumaCuotas.toFixed(2)} € — Pendiente a fraccionar: ${objetivo.toFixed(2)} € (total ${importe.toFixed(2)} − ${pagado.toFixed(2)} pagado hoy)`, variant: 'destructive' });
        return;
      }
      const mala = installments.findIndex(c => !c.fecha_vencimiento || Number(c.importe_previsto) <= 0);
      if (mala >= 0) {
        const c = installments[mala];
        toast({
          title: `A la cuota ${mala + 1} le falta ${!c.fecha_vencimiento ? 'la fecha' : 'el importe'}`,
          description: 'Corrígelo en el plan de cuotas: cada cuota necesita un importe mayor que 0 y su vencimiento.',
          variant: 'destructive',
        });
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
        importe_pagado: pagado,
        metodo_pago: form.metodo_pago,
        // Método real del pago inicial: si la venta es fraccionada, el usuario
        // elige con qué se cobró la inicial (no "fraccionado", que es el plan).
        metodo_pago_inicial: form.metodo_pago === 'fraccionado' ? metodoInicial : form.metodo_pago,
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
        if (form.metodo_pago === 'fraccionado' && installments.length >= 1) {
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
        if (!FACT_V2) {
          // Producción (flujo clásico): registrar y cerrar, sin ventana de documento.
          onCreated?.(res.data);
          onClose();
        } else {
          // Staging (flujo nuevo): ofrecer Presupuesto/Factura + PDF.
          setCreated(res.data);
          setDocPhase('choose');
        }
      }
    } catch (err: any) {
      toast({
        title: 'No se pudo registrar la venta',
        description: err?.data?.error || err?.message || 'Vuelve a intentarlo; si sigue fallando, avisa a soporte.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  // `inputClass` es la compartida (antes había aquí una copia propia, con otro
  // redondeo y otro foco que el resto del CRM, #106).

  return (
    <Portal>
      <div role="dialog" className="fixed inset-0 !m-0 z-[70] flex items-center justify-center sm:p-4">
        <div className="fixed inset-0 !m-0 bg-black/50 backdrop-blur-sm" onClick={finishAndClose} />
        <div className="relative bg-card rounded-lg border border-border w-full max-w-lg mx-4 p-6 overflow-y-auto max-h-[90vh]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">{docPhase === 'choose' ? 'Documento de la venta' : 'Registrar conversión'}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Lead: {lead?.nombre}</p>
            </div>
            <button onClick={finishAndClose} className="p-1.5 rounded-lg hover:bg-muted">
              <X size={18} weight="bold" />
            </button>
          </div>

          {docPhase === 'choose' && created ? (
            <div className="py-4 text-center space-y-5">
              <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center">
                <CheckCircle size={28} weight="fill" className="text-emerald-600" />
              </div>
              <div>
                <h3 className="font-semibold text-base">Venta registrada</h3>
                <p className="text-sm text-muted-foreground mt-1">¿Generar un documento para el cliente y descargar el PDF?</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button type="button" onClick={() => setDocPhase('proforma')}
                  className="flex flex-col items-center gap-2 p-4 rounded-lg border border-border bg-card hover:border-primary hover:bg-muted/50 transition">
                  <FileText size={24} weight="duotone" className="text-primary" />
                  <span className="text-sm font-semibold">Presupuesto</span>
                  <span className="text-[10px] text-muted-foreground">Sin valor fiscal</span>
                </button>
                <button type="button" onClick={handleFacturaChoice}
                  className="flex flex-col items-center gap-2 p-4 rounded-lg border border-border bg-card hover:border-primary hover:bg-muted/50 transition">
                  <Receipt size={24} weight="duotone" className="text-primary" />
                  <span className="text-sm font-semibold">Factura</span>
                  <span className="text-[10px] text-muted-foreground">Documento fiscal</span>
                </button>
              </div>
              <button type="button" onClick={finishAndClose} className="text-xs text-muted-foreground hover:underline">Ahora no</button>
            </div>
          ) : (
          // noValidate: los avisos los da el CRM (handleSubmit), que dicen qué
          // falta y dónde; el globo del navegador se adelantaba (#106).
          <form onSubmit={handleSubmit} noValidate className="space-y-3">
            {/* MODO 1: Producto único (legacy) */}
            {!useMultiItem && (
              <div>
                <div className="flex justify-end">
                  <button type="button"
                    onClick={() => setItems([{ product_id: null, descripcion: form.producto_contratado || '', cantidad: 1, precio_unitario: form.importe_total || '0' }])}
                    className="px-1 text-secundario text-primary hover:underline">
                    + Añadir más productos
                  </button>
                </div>
                <Field label="Producto contratado" required htmlFor="venta-producto-contratado"
                  hint="Puedes elegir uno del catálogo o escribir un nombre nuevo.">
                  <div className="space-y-1.5">
                    {products.length > 0 ? (
                      <Select<string>
                        // Un nombre escrito a mano no está en el catálogo: el
                        // desplegable vuelve a «Seleccionar…» en vez de quedarse en blanco.
                        value={products.some(p => p.nombre === form.producto_contratado) ? form.producto_contratado : ''}
                        onChange={(v) => update('producto_contratado', v)}
                        options={[
                          { value: '', label: 'Seleccionar o escribir abajo' },
                          ...products.map(p => ({ value: p.nombre, label: p.nombre })),
                        ]}
                        ariaLabel="Producto contratado"
                      />
                    ) : null}
                    {/* Sin datalist: el catálogo ya está en el desplegable de arriba,
                        y la lista del navegador lo duplicaba con otro estilo (#106). */}
                    <input
                      id="venta-producto-contratado"
                      value={form.producto_contratado}
                      onChange={e => update('producto_contratado', e.target.value)}
                      placeholder={products.length > 0 ? 'Escribe o selecciona del listado' : 'Nombre del producto/curso'}
                      aria-label="Escribir el nombre del producto"
                      className={inputClass}
                      required={!useMultiItem}
                      autoComplete="off"
                    />
                  </div>
                </Field>
              </div>
            )}

            {/* MODO 2: Multi-item */}
            {useMultiItem && (
              <div className="border border-border rounded-md p-3 space-y-2 bg-muted/20">
                <div className="flex items-center justify-between">
                  <p className="mb-1.5 px-1 text-tabla uppercase text-muted-foreground">Productos contratados ({items.length})</p>
                  <button type="button"
                    onClick={() => { setItems([]); }}
                    className="px-1 text-secundario text-muted-foreground hover:text-foreground">Volver a producto único</button>
                </div>
                {items.map((it, idx) => (
                  // Sin datalist, como en el producto único: el catálogo con el
                  // desplegable del CRM y debajo la casilla para escribir (#106).
                  <div key={idx} className="space-y-1.5">
                    {products.length > 0 && (
                      <Select<string>
                        value={products.some((p: any) => p.nombre === it.descripcion) ? it.descripcion : ''}
                        onChange={(v) => elegirProducto(idx, v)}
                        options={[
                          { value: '', label: 'Seleccionar o escribir abajo' },
                          ...products.map((p: any) => ({ value: p.nombre, label: p.nombre })),
                        ]}
                        ariaLabel={`Producto ${idx + 1} del catálogo`}
                      />
                    )}
                    {/* En el móvil (6 columnas) la descripción ocupa la fila entera
                        y cantidad, precio y quitar van debajo; en pantalla ancha,
                        todo en una línea (#106). */}
                    <div className="grid grid-cols-6 sm:grid-cols-12 gap-fila items-center">
                      <input autoComplete="off" value={it.descripcion}
                        onChange={e => elegirProducto(idx, e.target.value)}
                        placeholder="Descripción / nombre del curso"
                        aria-label={`Producto ${idx + 1}`}
                        className={`${inputClass} col-span-6 min-w-0`} />
                      <input autoComplete="off" type="number" min="1" value={it.cantidad}
                        onChange={e => setItems(items.map((x, i) => i === idx ? { ...x, cantidad: Number(e.target.value || 1) } : x))}
                        title="Cantidad" placeholder="Cant" aria-label={`Cantidad del producto ${idx + 1}`}
                        className={`${inputClass} col-span-2 min-w-0`} />
                      <input autoComplete="off" type="number" step="0.01" min="0" value={it.precio_unitario}
                        onChange={e => setItems(items.map((x, i) => i === idx ? { ...x, precio_unitario: e.target.value } : x))}
                        title="Precio unitario" placeholder="€/u" aria-label={`Precio unitario del producto ${idx + 1}`}
                        className={`${inputClass} col-span-3 min-w-0`} />
                      <button type="button" onClick={() => setItems(items.filter((_, i) => i !== idx))}
                        className="col-span-1 text-muted-foreground hover:text-red-500 text-base">×</button>
                    </div>
                  </div>
                ))}
                <button type="button"
                  onClick={() => setItems([...items, { product_id: null, descripcion: '', cantidad: 1, precio_unitario: '0' }])}
                  className="px-1 text-secundario text-primary hover:underline">+ añadir otro producto</button>
                <div className="px-1 text-secundario text-muted-foreground">
                  Subtotal: {items.reduce((s, it) => s + Number(it.cantidad || 1) * Number(it.precio_unitario || 0), 0).toFixed(2)} €
                </div>
              </div>
            )}

            {/* DESCUENTO */}
            <div className="border border-border rounded-md p-3 bg-muted/10">
              <FilaCampos>
                <Field label="Descuento" htmlFor="venta-descuento">
                  {/* El desplegable del CRM, como el resto (#106). */}
                  <Select<'none' | 'pct' | 'monto'>
                    id="venta-descuento"
                    value={form.descuento_tipo}
                    onChange={(v) => update('descuento_tipo', v as any)}
                    ariaLabel="Descuento"
                    options={[
                      { value: 'none', label: 'Sin descuento' },
                      { value: 'pct', label: 'Porcentaje (%)' },
                      { value: 'monto', label: 'Monto fijo (€)' },
                    ]}
                  />
                </Field>
                {form.descuento_tipo !== 'none' && (
                  <Field label={form.descuento_tipo === 'pct' ? 'Porcentaje de descuento (%)' : 'Descuento (€)'} htmlFor="venta-descuento-valor"
                    hint={calc.desc > 0 ? `Se descuentan ${calc.desc.toFixed(2)} €.` : undefined}>
                    <input autoComplete="off" id="venta-descuento-valor" type="number" min="0" step="0.01" value={form.descuento_valor}
                      onChange={e => update('descuento_valor', e.target.value)}
                      placeholder={form.descuento_tipo === 'pct' ? '10' : '50'}
                      className={inputClass} />
                  </Field>
                )}
              </FilaCampos>
            </div>

            {/* IVA */}
            <div className="border border-border rounded-md p-3 bg-muted/10">
              <Field label="IVA"
                hint={form.iva_exento ? 'Operación exenta — art. 20 LIVA (servicios educativos).' : undefined}>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={form.iva_exento} onChange={e => update('iva_exento', e.target.checked as any)} />
                    Exento (sin IVA)
                  </label>
                  {!form.iva_exento && (
                    <>
                      <div className="inline-flex items-center gap-1.5">
                        <span>%:</span>
                        <div className="w-24">
                          <input autoComplete="off" type="number" min="0" max="100" step="0.01" value={form.iva_pct}
                            onChange={e => update('iva_pct', e.target.value)}
                            aria-label="Porcentaje de IVA"
                            className={inputClass} />
                        </div>
                      </div>
                      <label className="inline-flex items-center gap-1.5">
                        <input type="checkbox" checked={form.iva_incluido} onChange={e => update('iva_incluido', e.target.checked as any)} />
                        Precio ya incluye IVA (desglosar)
                      </label>
                    </>
                  )}
                </div>
              </Field>
            </div>

            <FilaCampos>
              <Field label={useMultiItem ? 'Subtotal items (auto)' : 'Precio base (EUR)'} required={!useMultiItem} htmlFor="venta-precio-base">
                <input autoComplete="off"
                  id="venta-precio-base"
                  type="number" step="0.01" min="0"
                  value={useMultiItem ? calc.bruto.toFixed(2) : form.importe_total}
                  onChange={e => update('importe_total', e.target.value)}
                  readOnly={useMultiItem}
                  className={inputClass + (useMultiItem ? ' bg-muted text-muted-foreground cursor-not-allowed' : '')}
                  required={!useMultiItem}
                />
              </Field>
              <Field label="Pago recibido hoy"
                hint={pagoMode === 'total' ? `Se registrará el pago completo: ${calc.total.toFixed(2)} €` : undefined}>
                <div className="flex rounded-lg border border-border overflow-hidden text-xs font-semibold">
                  <button type="button" onClick={() => setPagoMode('none')}
                    className={`flex-1 h-9 ${pagoMode === 'none' ? 'bg-muted text-foreground' : 'bg-card text-muted-foreground hover:bg-muted/50'}`}>Sin pago</button>
                  <button type="button" onClick={() => {
                      setPagoMode('parcial');
                      // Pago parcial ⇒ el resto se cobra a plazos: método = fraccionado
                      // (muestra el plan de cuotas). El método real de cada abono se
                      // indica al registrar cada cuota.
                      update('metodo_pago', 'fraccionado');
                    }}
                    className={`flex-1 h-9 border-x border-border ${pagoMode === 'parcial' ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300' : 'bg-card text-muted-foreground hover:bg-muted/50'}`}>Parcial</button>
                  <button type="button" onClick={() => {
                      setPagoMode('total');
                      // Venia de «Parcial», que deja el metodo en fraccionado y un
                      // plan montado. Si no se limpia aqui, se registra una venta
                      // pagada entera CON plan de cuotas, que es imposible.
                      if (form.metodo_pago === 'fraccionado') {
                        update('metodo_pago', metodoInicial);
                        setInstallments([]);
                        setInstallmentsDirty(false);
                      }
                    }}
                    className={`flex-1 h-9 ${pagoMode === 'total' ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300' : 'bg-card text-muted-foreground hover:bg-muted/50'}`}>Pagó TODO</button>
                </div>
                {pagoMode === 'parcial' && (
                  <input autoComplete="off" type="number" step="0.01" min="0" value={form.importe_pagado} onChange={e => update('importe_pagado', e.target.value)}
                    placeholder="¿Cuánto pagó?" aria-label="Cuánto pagó hoy" className={inputClass + ' mt-1.5'} autoFocus />
                )}
              </Field>
            </FilaCampos>
            {/* Con plan fraccionado, el pago inicial necesita su método real
                (la factura de ese pago lo usará; 'fraccionado' es el plan). */}
            {pagoMode !== 'none' && form.metodo_pago === 'fraccionado' && (
              <Field label="Método del pago inicial" htmlFor="venta-metodo-inicial">
                <Select<MetodoPago>
                  id="venta-metodo-inicial"
                  value={metodoInicial}
                  onChange={setMetodoInicial}
                  ariaLabel="Método del pago inicial"
                  options={[
                    { value: 'tarjeta', label: 'Tarjeta' },
                    { value: 'tarjeta_stripe', label: 'Tarjeta (Stripe)' },
                    { value: 'transferencia', label: 'Transferencia' },
                    { value: 'deposito', label: 'Depósito bancario' },
                    { value: 'efectivo', label: 'Efectivo' },
                    { value: 'bizum', label: 'Bizum' },
                    { value: 'paypal', label: 'PayPal' },
                    { value: 'otro', label: 'Otro' },
                  ] as Array<{ value: MetodoPago; label: string }>}
                />
              </Field>
            )}

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
              {form.iva_exento && <div className="text-secundario text-muted-foreground">Operación exenta de IVA</div>}
              <div className="flex justify-between font-bold text-base border-t border-border pt-1 mt-1">
                <span>TOTAL</span><span className="tabular-nums text-primary">{calc.total.toFixed(2)} €</span>
              </div>
            </div>

            <FilaCampos>
              <Field label="Método de pago" htmlFor="venta-metodo-pago">
                <Select<MetodoPago>
                  id="venta-metodo-pago"
                  value={form.metodo_pago}
                  onChange={(v) => update('metodo_pago', v)}
                  // Si pagó TODO no queda nada que fraccionar, asi que el metodo
                  // «Fraccionado» ni se ofrece. Diego, 15/09: «si le doy a pago
                  // todo no tiene sentido que me deje poner fraccionado».
                  options={METODOS
                    .filter(m => !(pagoMode === 'total' && m.value === 'fraccionado'))
                    .map(m => ({ value: m.value, label: m.label }))}
                  ariaLabel="Método de pago"
                />
              </Field>
              {/* Diego, 14/09: «en conversion la fecha de conversion seria fecha de
                  pago». Es la fecha en la que entro el dinero, que es la que
                  usan los informes y la que decide de que mes es la venta. */}
              <Field label="Fecha de pago" htmlFor="venta-fecha-pago">
                <input id="venta-fecha-pago" type="date" value={form.fecha_conversion} onChange={e => update('fecha_conversion', e.target.value)} className={inputClass} />
              </Field>
            </FilaCampos>

            {form.metodo_pago === 'fraccionado' && (
              <div className="space-y-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="px-1 text-tabla uppercase text-amber-800 dark:text-amber-300">
                    Plan de cuotas
                  </div>
                  {installmentsDirty && (
                    <button
                      type="button"
                      onClick={() => { setInstallmentsDirty(false); }}
                      className="text-secundario text-amber-700 dark:text-amber-300 underline"
                    >
                      Recalcular automáticamente
                    </button>
                  )}
                </div>

                <FilaCampos>
                  <Field label="Número de cuotas" htmlFor="venta-num-cuotas">
                    <input autoComplete="off"
                      id="venta-num-cuotas"
                      type="number" min="1" max="60"
                      value={numCuotas}
                      onChange={e => { setNumCuotas(Math.max(1, Number(e.target.value) || 1)); setInstallmentsDirty(false); }}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Fecha primera cuota" htmlFor="venta-primera-cuota">
                    <input
                      id="venta-primera-cuota"
                      type="date"
                      value={fechaPrimeraCuota}
                      onChange={e => { setFechaPrimeraCuota(e.target.value); setInstallmentsDirty(false); }}
                      className={inputClass}
                    />
                  </Field>
                </FilaCampos>

                {installments.length > 0 && (
                  <div className="space-y-1">
                    {/* En el móvil cada cuota va en dos líneas (importe arriba,
                        vencimiento debajo) y la cabecera sobra: los campos dicen
                        qué son. En pantalla ancha, una línea por cuota (#106). */}
                    <div className="hidden sm:grid grid-cols-[40px_1fr_140px] gap-fila text-tabla uppercase text-muted-foreground px-1">
                      <span>#</span>
                      <span>Importe (EUR)</span>
                      <span>Vencimiento</span>
                    </div>
                    {installments.map((c, i) => (
                      <div key={i} className="grid grid-cols-[2rem_1fr] sm:grid-cols-[40px_1fr_140px] gap-fila items-center">
                        <span className="text-xs font-mono text-muted-foreground">{i + 1}</span>
                        <input autoComplete="off"
                          type="number" step="0.01" min="0.01"
                          value={c.importe_previsto}
                          aria-label={`Importe de la cuota ${i + 1}`}
                          onChange={e => {
                            const next = [...installments];
                            next[i] = { ...next[i], importe_previsto: e.target.value };
                            setInstallments(next);
                            setInstallmentsDirty(true);
                          }}
                          className={`${inputClass} min-w-0`}
                        />
                        <input
                          type="date"
                          value={c.fecha_vencimiento}
                          aria-label={`Vencimiento de la cuota ${i + 1}`}
                          onChange={e => {
                            const next = [...installments];
                            next[i] = { ...next[i], fecha_vencimiento: e.target.value };
                            setInstallments(next);
                            setInstallmentsDirty(true);
                          }}
                          className={`${inputClass} min-w-0 col-start-2 sm:col-start-auto`}
                        />
                      </div>
                    ))}
                    {(() => {
                      const suma = installments.reduce((s, c) => s + Number(c.importe_previsto || 0), 0);
                      const diff = Math.round((pendienteFrac - suma) * 100) / 100;
                      const ok = Math.abs(diff) <= 0.05;
                      return (
                        <div className={`text-secundario font-medium pt-1 ${ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          Suma cuotas: {suma.toFixed(2)} € — Pendiente a fraccionar: {pendienteFrac.toFixed(2)} €
                          {pagadoInicial > 0 && <span className="text-muted-foreground"> (total {calc.total.toFixed(2)} € − {pagadoInicial.toFixed(2)} € pagado hoy)</span>}
                          {!ok && ` — Diferencia: ${diff.toFixed(2)} €`}
                        </div>
                      );
                    })()}
                  </div>
                )}

                <Field label="Fecha compromiso de pago pendiente (opcional)" htmlFor="venta-fecha-compromiso">
                  <input id="venta-fecha-compromiso" type="date" value={form.fecha_compromiso_pago} onChange={e => update('fecha_compromiso_pago', e.target.value)} className={inputClass} />
                </Field>
              </div>
            )}

            {/* Selector de enlace de pago Stripe (CRM-140) */}
            {(productLinks.length > 0 || form.producto_contratado) && (
              <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 space-y-2">
                <div className="flex items-center gap-2 text-secundario font-bold text-blue-800 dark:text-blue-300">
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
                  <input autoComplete="off"
                    type="url"
                    value={customLink}
                    onChange={(e) => setCustomLink(e.target.value)}
                    placeholder="https://buy.stripe.com/..."
                    aria-label="Enlace de pago personalizado"
                    className={inputClass + ' font-mono'}
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
                  <p className="px-1 text-secundario text-blue-700 dark:text-blue-300">
                    Este producto no tiene enlaces configurados. Añádelos editando el producto.
                  </p>
                )}
              </div>
            )}

            <Field label="Notas" htmlFor="venta-notas">
              <textarea autoComplete="off" id="venta-notas" value={form.notas_pago} onChange={e => update('notas_pago', e.target.value)} rows={2} className={`${inputClass} h-auto py-2 resize-none`} placeholder="Notas sobre el acuerdo..." />
            </Field>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg border border-border bg-card text-sm font-semibold hover:bg-muted">Cancelar</button>
              <button type="submit" disabled={saving} className="h-9 px-4 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
                {saving ? 'Guardando...' : 'Registrar conversión'}
              </button>
            </div>
          </form>
          )}
        </div>
      </div>
    </Portal>
  );
}
