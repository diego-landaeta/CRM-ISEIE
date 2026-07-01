import { useEffect, useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { Plus, Trash, Download, Eye, FloppyDisk, ArrowCounterClockwise, Receipt, CaretDown } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import { documentsApi, type CrmDocument } from '../api/documents.api';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useInvoiceDefaults } from '../hooks/useInvoiceDefaults';
import ClientCombobox, { type ClientPick } from './ClientCombobox';
import ProductLineCombobox from './ProductLineCombobox';
import { useProducts } from '@/modules/products/hooks/useProducts';
import type { Product } from '@/modules/products/api/products.api';
import { getAccessToken } from '@/shared/api/client';
import PreviewModal from './PreviewModal';
import { downloadDoc } from '../lib/downloadDoc';
import DatePickerInput from './DatePickerInput';

const inp = 'w-full h-9 px-3 rounded-md border border-border bg-muted/50 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all';

interface InvoiceLine {
  descripcion: string;
  cantidad: number | string;
  precio: number | string;
}

export type InvoiceTipo = 'persona_natural' | 'empresa' | 'contado';

export interface InvoiceFormValues {
  tipo: InvoiceTipo;
  emisor_nombre: string;
  emisor_nif: string;
  emisor_direccion: string;
  emisor_telefono: string;
  fecha: string;
  iva_pct: number | string;
  iva_exento: boolean;
  // persona_natural
  cliente_nombre: string;
  cliente_dni: string;
  // empresa
  cliente_razon_social: string;
  cliente_nif: string;
  // ambos
  cliente_direccion: string;
  cliente_telefono: string;
  cliente_email: string;
  notas: string;
  lineas: InvoiceLine[];
}

const TIPO_OPTIONS: { value: InvoiceTipo; label: string; desc: string }[] = [
  { value: 'persona_natural', label: 'Persona física', desc: 'Cliente individual con DNI' },
  { value: 'empresa',         label: 'Empresa',         desc: 'Razón social + NIF' },
  { value: 'contado',         label: 'Contado',         desc: 'Sin datos de cliente' },
];

interface InvoiceFormProps {
  onGenerated?: (doc: CrmDocument) => void;
  /**
   * Pre-rellena el form (al duplicar una factura existente o desde una conversión).
   */
  initialValues?: Partial<InvoiceFormValues>;
}

const todayLocal = (): string => new Date().toISOString().slice(0, 10);

const fmtMoney = (n: number): string =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }).format(n);

export default function InvoiceForm({ onGenerated, initialValues }: InvoiceFormProps) {
  const { activeProject } = useProjectContext();
  const { defaults, save: saveDefaults, reset: resetDefaults } = useInvoiceDefaults(activeProject?.id);
  const { products } = useProducts(activeProject?.id);
  const [loading, setLoading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [emisorOpen, setEmisorOpen] = useState(false);
  const [nextNumber, setNextNumber] = useState<number | null>(null);
  const [nextFormatted, setNextFormatted] = useState<string>('');
  const [numeroOverride, setNumeroOverride] = useState<string>('');

  const [touched, setTouched] = useState(false);

  const { register, control, handleSubmit, watch, setValue, reset } = useForm<InvoiceFormValues>({
    defaultValues: {
      tipo: 'persona_natural',
      emisor_nombre: defaults.emisor_nombre,
      emisor_nif: defaults.emisor_nif,
      emisor_direccion: defaults.emisor_direccion,
      emisor_telefono: defaults.emisor_telefono,
      fecha: todayLocal(),
      iva_pct: defaults.iva_pct,
      iva_exento: true, // Formación reglada: cursos exentos (Art. 20.1.9° LIVA)
      cliente_nombre: '',
      cliente_dni: '',
      cliente_razon_social: '',
      cliente_nif: '',
      cliente_direccion: '',
      cliente_telefono: '',
      cliente_email: '',
      notas: defaults.notas,
      lineas: [{ descripcion: '', cantidad: 1, precio: '' }],
      ...initialValues,
    },
  });

  // Si llegan initialValues nuevos (duplicar otra factura), recargar todo
  useEffect(() => {
    if (initialValues) {
      reset({
        tipo: 'persona_natural',
        emisor_nombre: defaults.emisor_nombre,
        emisor_nif: defaults.emisor_nif,
        emisor_direccion: defaults.emisor_direccion,
        emisor_telefono: defaults.emisor_telefono,
        fecha: todayLocal(),
        iva_pct: defaults.iva_pct,
        iva_exento: true,
        notas: defaults.notas,
        cliente_nombre: '',
        cliente_dni: '',
        cliente_razon_social: '',
        cliente_nif: '',
        cliente_direccion: '',
        cliente_telefono: '',
        cliente_email: '',
        lineas: [{ descripcion: '', cantidad: 1, precio: '' }],
        ...initialValues,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValues]);

  const { fields, append, remove } = useFieldArray({ control, name: 'lineas' });
  const lineas = watch('lineas');
  const ivaPct = parseFloat(String(watch('iva_pct'))) || 0;
  const ivaExento = watch('iva_exento');

  // Totales por línea + globales
  const lineTotals = lineas.map((l) => {
    const qty = parseFloat(String(l.cantidad || 0));
    const price = parseFloat(String(l.precio || 0));
    return Number.isFinite(qty) && Number.isFinite(price) ? qty * price : 0;
  });
  const subtotal = lineTotals.reduce((s, n) => s + n, 0);
  const iva = ivaExento ? 0 : subtotal * (ivaPct / 100);
  const total = subtotal + iva;

  const cliente_nombre = watch('cliente_nombre');
  const fecha = watch('fecha');
  const tipo = watch('tipo');

  // Lista de campos obligatorios faltantes. Se usa para bloquear download/preview
  // y para resaltar visualmente cada campo invalido cuando `touched` es true.
  function getMissingFields(values: InvoiceFormValues): string[] {
    const missing: string[] = [];
    if (!values.fecha?.trim()) missing.push('Fecha');
    if (!values.emisor_nombre?.trim()) missing.push('Nombre del emisor');
    if (!values.emisor_nif?.trim()) missing.push('NIF del emisor');
    if (values.tipo === 'persona_natural') {
      if (!values.cliente_nombre?.trim()) missing.push('Nombre y apellido del cliente');
      if (!values.cliente_dni?.trim()) missing.push('DNI del cliente');
    } else if (values.tipo === 'empresa') {
      if (!values.cliente_razon_social?.trim()) missing.push('Razón social');
      if (!values.cliente_nif?.trim()) missing.push('NIF de la empresa');
    }
    // 'contado': sin requisitos de cliente
    const validLine = (values.lineas || []).some(l =>
      String(l.descripcion || '').trim() &&
      Number(l.cantidad) > 0 &&
      Number(l.precio) > 0
    );
    if (!validLine) missing.push('Al menos una línea con descripción, cantidad y precio');
    return missing;
  }

  function reportMissing(values: InvoiceFormValues): boolean {
    const missing = getMissingFields(values);
    if (missing.length === 0) return false;
    setTouched(true);
    toast({
      title: 'Faltan campos obligatorios',
      description: missing.join(' · '),
      variant: 'destructive',
    });
    return true;
  }

  const invalidFields = touched ? new Set(getMissingFields(watch())) : new Set<string>();

  function handleClientPick(c: ClientPick) {
    // Trae del lead todos los datos disponibles; los que falten quedan para completar
    // (getMissingFields resalta/bloquea los obligatorios que sigan vacíos).
    setValue('cliente_nombre', c.nombre, { shouldDirty: true });
    if (c.dni) setValue('cliente_dni', c.dni, { shouldDirty: true });
    if (c.direccion) setValue('cliente_direccion', c.direccion, { shouldDirty: true });
    if (c.email) setValue('cliente_email', c.email, { shouldDirty: true });
    if (c.telefono) setValue('cliente_telefono', c.telefono, { shouldDirty: true });
    // Tipo empresa: reutiliza nombre/DNI como razón social/NIF de partida.
    setValue('cliente_razon_social', c.nombre, { shouldDirty: true });
    if (c.dni) setValue('cliente_nif', c.dni, { shouldDirty: true });
  }

  function handleSaveDefaults() {
    const formValues = watch();
    saveDefaults({
      emisor_nombre: formValues.emisor_nombre,
      emisor_nif: formValues.emisor_nif,
      emisor_direccion: formValues.emisor_direccion,
      emisor_telefono: formValues.emisor_telefono,
      iva_pct: parseFloat(String(formValues.iva_pct)) || 21,
      notas: formValues.notas,
    });
    toast({ title: 'Datos del emisor guardados', description: 'Se autocompletarán en futuras facturas' });
  }

  async function handlePreview(): Promise<void> {
    const data = watch();
    if (reportMissing(data)) return;
    setPreviewing(true);
    try {
      // Inyectar el numero que se usaria al generar — backend solo lo asigna
      // en /generate, pero el preview necesita verlo en el pill rosa-palo.
      const overrideN = parseInt(numeroOverride, 10);
      const previewData = {
        ...data,
        numero: Number.isFinite(overrideN) && overrideN >= 1 ? overrideN : (nextNumber ?? ''),
      };
      const baseUrl = (import.meta.env.BASE_URL || '/crm/').replace(/\/$/, '');
      const token = getAccessToken() || '';
      const res = await fetch(`${baseUrl}/api/documents/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: 'invoice', data: previewData }),
      });
      if (!res.ok) {
        toast({ title: 'Error generando preview', variant: 'destructive' });
        return;
      }
      const html = await res.text();
      setPreviewHtml(html);
    } catch {
      toast({ title: 'Error generando preview', variant: 'destructive' });
    } finally {
      setPreviewing(false);
    }
  }

  async function onSubmit(data: InvoiceFormValues): Promise<void> {
    if (!activeProject?.id) return;
    if (reportMissing(data)) return;
    setLoading(true);
    try {
      // Si el usuario edito el numero, lo enviamos como override; backend
      // reposiciona el contador y la sucesion continua desde ese valor.
      const overrideNum = numeroOverride && parseInt(numeroOverride, 10) !== nextNumber
        ? parseInt(numeroOverride, 10)
        : undefined;
      const res = await documentsApi.generate(
        activeProject.id,
        'invoice',
        data as unknown as Record<string, unknown>,
        overrideNum,
      );
      if (res.success && res.data) {
        saveDefaults({
          emisor_nombre: data.emisor_nombre,
          emisor_nif: data.emisor_nif,
          emisor_direccion: data.emisor_direccion,
          emisor_telefono: data.emisor_telefono,
          iva_pct: parseFloat(String(data.iva_pct)) || 21,
          notas: data.notas,
        });
        toast({ title: 'Factura generada', description: `Nº ${res.data.number} — descargando PDF…` });
        onGenerated?.(res.data);
        // Auto-descarga del PDF recien generado
        downloadDoc(res.data, activeProject.id).catch(() => {/* silencioso */});
        // Refrescar el siguiente numero para la proxima factura
        await loadNextNumber();
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally { setLoading(false); }
  }

  // Carga el siguiente numero del backend y rellena el campo override
  async function loadNextNumber(): Promise<void> {
    if (!activeProject?.id) return;
    try {
      const res = await documentsApi.nextNumber(activeProject.id, 'invoice');
      if (res.success && res.data) {
        setNextNumber(res.data.number);
        setNextFormatted(res.data.formatted);
        setNumeroOverride(String(res.data.number));
      }
    } catch { /* silencioso */ }
  }

  useEffect(() => { loadNextNumber();   }, [activeProject?.id]);

  const overrideNumValue = parseInt(numeroOverride, 10);
  const overrideEdited = nextNumber != null && Number.isFinite(overrideNumValue) && overrideNumValue !== nextNumber;
  const formattedOverride = Number.isFinite(overrideNumValue) && overrideNumValue >= 1
    ? `FAC-${new Date().getFullYear()}-${String(overrideNumValue).padStart(4, '0')}`
    : nextFormatted;

  return (
    <>
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Numero de factura (peek + override) */}
      <section className="bg-gradient-to-r from-primary/5 to-transparent border border-primary/20 rounded-lg p-4 flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <label className="text-xs text-muted-foreground mb-1 block">Número de factura</label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground tabular-nums">FAC-{new Date().getFullYear()}-</span>
            <input
              type="number"
              min="1"
              value={numeroOverride}
              onChange={(e) => setNumeroOverride(e.target.value)}
              className="w-24 h-9 px-2 rounded-md border border-border bg-muted/50 text-sm tabular-nums font-semibold text-center outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all"
              aria-label="Número de factura"
            />
            {overrideEdited && (
              <button
                type="button"
                onClick={() => nextNumber != null && setNumeroOverride(String(nextNumber))}
                className="text-[11px] text-primary hover:underline"
                title="Volver al siguiente número automático"
              >
                Restablecer
              </button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5">
            {overrideEdited
              ? <><span className="font-medium text-foreground">{formattedOverride}</span> · La numeración continuará desde aquí</>
              : <>Siguiente disponible: <span className="font-medium text-foreground">{nextFormatted || '—'}</span></>}
          </p>
        </div>
      </section>

      {/* Tipo de factura */}
      <section className="bg-card border border-border rounded-lg p-5">
        <h3 className="font-semibold text-sm mb-3">Tipo de factura</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {TIPO_OPTIONS.map((t) => {
            const active = tipo === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setValue('tipo', t.value, { shouldDirty: true })}
                className={`text-left rounded-lg border p-3 transition-all ${
                  active
                    ? 'border-primary bg-primary/10 ring-2 ring-primary/20'
                    : 'border-border bg-card hover:bg-muted/40'
                }`}
              >
                <div className={`font-semibold text-sm ${active ? 'text-primary' : 'text-foreground'}`}>
                  {t.label}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">{t.desc}</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Cliente — render condicional según tipo */}
      <section className="bg-card border border-border rounded-lg p-5">
        <div className="flex items-end justify-between gap-3 mb-4">
          <div>
            <h3 className="font-semibold text-sm">
              {tipo === 'contado' ? 'Sin datos de cliente' : 'Datos del cliente'}
            </h3>
            <p className="text-[11px] text-muted-foreground">
              {tipo === 'contado'
                ? 'Las facturas de contado no incluyen datos identificativos del comprador.'
                : 'Busca por nombre/email para autocompletar desde tu base de prospectos.'}
            </p>
          </div>
          <div className="shrink-0">
            <label className="text-xs text-muted-foreground mb-1 block">Fecha <span className="text-red-500">*</span></label>
            <DatePickerInput
              value={fecha}
              onChange={(iso) => setValue('fecha', iso, { shouldDirty: true })}
              className="w-44"
              required
              ariaLabel="Fecha de la factura"
              invalid={invalidFields.has('Fecha')}
            />
          </div>
        </div>

        {tipo === 'persona_natural' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground mb-1 block">
                Nombre y apellido <span className="text-red-500">*</span>
              </label>
              <div className={invalidFields.has('Nombre y apellido del cliente') ? 'ring-2 ring-red-400/20 rounded-md' : ''}>
                <ClientCombobox
                  projectId={activeProject?.id}
                  value={cliente_nombre}
                  onChange={(v) => setValue('cliente_nombre', v, { shouldDirty: true })}
                  onSelect={handleClientPick}
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                DNI <span className="text-red-500">*</span>
              </label>
              <input
                {...register('cliente_dni')}
                placeholder="39.064.302"
                className={inp + (invalidFields.has('DNI del cliente') ? ' border-red-400 ring-2 ring-red-400/20' : '')}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Teléfono</label>
              <input
                {...register('cliente_telefono')}
                placeholder="+34 600 000 000"
                className={inp}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground mb-1 block">Dirección</label>
              <input
                {...register('cliente_direccion')}
                placeholder="Calle, número, ciudad, país"
                className={inp}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground mb-1 block">Email</label>
              <input
                type="email"
                {...register('cliente_email')}
                placeholder="cliente@ejemplo.com"
                className={inp}
              />
            </div>
          </div>
        )}

        {tipo === 'empresa' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground mb-1 block">
                Razón social <span className="text-red-500">*</span>
              </label>
              <input
                {...register('cliente_razon_social')}
                placeholder="Centro Médico Artemedeci Limitada"
                className={inp + (invalidFields.has('Razón social') ? ' border-red-400 ring-2 ring-red-400/20' : '')}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                NIF <span className="text-red-500">*</span>
              </label>
              <input
                {...register('cliente_nif')}
                placeholder="77489760-7"
                className={inp + (invalidFields.has('NIF de la empresa') ? ' border-red-400 ring-2 ring-red-400/20' : '')}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Teléfono</label>
              <input
                {...register('cliente_telefono')}
                placeholder="+56 9 8529 7340"
                className={inp}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground mb-1 block">Dirección</label>
              <input
                {...register('cliente_direccion')}
                placeholder="Calle, número, ciudad, país"
                className={inp}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-muted-foreground mb-1 block">Email</label>
              <input
                type="email"
                {...register('cliente_email')}
                placeholder="contacto@empresa.com"
                className={inp}
              />
            </div>
          </div>
        )}

        {tipo === 'contado' && (
          <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
            La factura se emitirá con el título <strong className="text-foreground">"FACTURA DE CONTADO"</strong> y
            sin sección de cliente. Incluye automáticamente el texto de exención IVA del art. 20 L37/1992.
          </div>
        )}
      </section>

      {/* Líneas */}
      <section className="bg-card border border-border rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-sm">Conceptos</h3>
          <button
            type="button"
            onClick={() => append({ descripcion: '', cantidad: 1, precio: '' })}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs text-primary font-semibold hover:bg-primary/5 transition-colors border border-primary/30 hover:border-primary/50"
          >
            <Plus size={13} /> Añadir línea
          </button>
        </div>

        {/* Desktop header */}
        <div className="hidden sm:grid grid-cols-12 gap-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-2">
          <span className="col-span-6">Descripción</span>
          <span className="col-span-2 text-center">Cantidad</span>
          <span className="col-span-2 text-center">Precio (€)</span>
          <span className="col-span-1 text-right">Subtotal</span>
          <span className="col-span-1" />
        </div>

        <div className="space-y-2">
          {fields.map((f, i) => (
            <div key={f.id} className="grid grid-cols-12 gap-2 items-start sm:items-center pb-2 sm:pb-0 border-b border-border sm:border-0 last:border-0">
              <div className="col-span-12 sm:col-span-6">
                <ProductLineCombobox
                  value={watch(`lineas.${i}.descripcion`) || ''}
                  onChange={(v) => setValue(`lineas.${i}.descripcion`, v, { shouldDirty: true })}
                  onSelectProduct={(p: Product) => {
                    if (p.precio != null && p.precio !== '') {
                      setValue(`lineas.${i}.precio`, String(p.precio), { shouldDirty: true });
                    }
                  }}
                  products={products}
                  placeholder="Descripción del servicio (o elige un curso del catálogo)"
                />
              </div>
              <div className="col-span-4 sm:col-span-2">
                <span className="sm:hidden text-[10px] text-muted-foreground block">Cantidad</span>
                <input
                  {...register(`lineas.${i}.cantidad`)}
                  type="number" min="1" step="1"
                  className={inp + ' text-center'}
                  defaultValue={1}
                  aria-label={`Cantidad línea ${i + 1}`}
                />
              </div>
              <div className="col-span-4 sm:col-span-2">
                <span className="sm:hidden text-[10px] text-muted-foreground block">Precio (€)</span>
                <input
                  {...register(`lineas.${i}.precio`)}
                  type="number" step="0.01" min="0"
                  className={inp + ' text-center'}
                  placeholder="0,00"
                  aria-label={`Precio línea ${i + 1}`}
                />
              </div>
              <div className="col-span-3 sm:col-span-1 text-right tabular-nums font-semibold text-sm pt-2 sm:pt-0" aria-label={`Subtotal línea ${i + 1}`}>
                {fmtMoney(lineTotals[i] || 0)}
              </div>
              <button
                type="button"
                onClick={() => remove(i)}
                disabled={fields.length === 1}
                aria-label={`Eliminar línea ${i + 1}`}
                className="col-span-1 flex justify-center text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed pt-2 sm:pt-0"
              >
                <Trash size={14} />
              </button>
            </div>
          ))}
        </div>

        {/* Footer: IVA toggle (izq) + totales compactos (der) */}
        <div className="mt-5 pt-4 border-t border-border grid grid-cols-1 sm:grid-cols-5 gap-4 items-start">
          <div className="sm:col-span-3 space-y-2">
            <label className="flex items-start gap-2 cursor-pointer text-xs">
              <input
                {...register('iva_exento')}
                type="checkbox"
                className="h-4 w-4 mt-0.5 cursor-pointer accent-primary shrink-0"
              />
              <span className="leading-snug">
                <span className="font-medium">Operación exenta de IVA</span>
                <span className="block text-[11px] text-muted-foreground">Servicios educativos · Art. 20.1.9° LIVA</span>
              </span>
            </label>
            {!ivaExento && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground pl-6">
                <span>IVA aplicable:</span>
                <input
                  {...register('iva_pct')}
                  type="number" min="0" max="100" step="1"
                  className="w-14 h-7 text-center border border-border rounded text-xs bg-muted/50 tabular-nums"
                  aria-label="Porcentaje IVA"
                />
                <span>%</span>
              </div>
            )}
          </div>
          <div className="sm:col-span-2 space-y-1.5 text-sm tabular-nums">
            <div className="flex justify-between items-baseline">
              <span className="text-muted-foreground text-xs">Subtotal</span>
              <span>{fmtMoney(subtotal)}</span>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-muted-foreground text-xs">IVA{ivaExento ? ' (exento)' : ` (${watch('iva_pct') || 0}%)`}</span>
              <span className={ivaExento ? 'text-muted-foreground italic' : ''}>
                {ivaExento ? '—' : fmtMoney(iva)}
              </span>
            </div>
            <div className="flex justify-between items-baseline pt-1.5 border-t border-border font-bold text-base">
              <span>Total</span>
              <span className="text-primary">{fmtMoney(total)}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Notas / IBAN */}
      <section className="bg-card border border-border rounded-lg p-5">
        <h3 className="font-semibold text-sm mb-3">Notas / Datos bancarios</h3>
        <p className="text-[11px] text-muted-foreground mb-2">Aparecerá al pie de la factura. Se guarda como predeterminado.</p>
        <textarea
          {...register('notas')}
          rows={3}
          className={inp + ' h-auto py-2 font-mono text-xs'}
          placeholder="IBAN: ES12 1234 5678 9012 3456 7890&#10;Beneficiario: ...&#10;Concepto: ..."
        />
      </section>

      {/* Datos del emisor (colapsable — ISEIE) */}
      <section className="bg-card border border-border rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setEmisorOpen(o => !o)}
          aria-expanded={emisorOpen ? true : undefined}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/30 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <div>
            <h3 className="font-semibold text-sm">Datos del emisor · ISEIE</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">Razón social, NIF, dirección — se guardan como predeterminados</p>
          </div>
          <CaretDown size={14} className={`text-muted-foreground transition-transform ${emisorOpen ? 'rotate-180' : ''}`} />
        </button>
        {emisorOpen && (
          <div className="border-t border-border px-4 py-4 space-y-3">
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={handleSaveDefaults}
                className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-[11px] font-medium border border-border bg-card hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40"
                title="Guardar como predeterminado"
              >
                <FloppyDisk size={12} /> Guardar
              </button>
              <button
                type="button"
                onClick={() => { resetDefaults(); toast({ title: 'Defaults restaurados' }); }}
                className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-[11px] font-medium border border-border bg-card hover:bg-muted transition-colors text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                title="Restaurar"
              >
                <ArrowCounterClockwise size={12} /> Reset
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Nombre / Razón social</label>
                <input {...register('emisor_nombre')} className={inp} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">NIF</label>
                <input {...register('emisor_nif')} className={inp} />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-muted-foreground mb-1 block">Dirección</label>
                <textarea {...register('emisor_direccion')} rows={2} className={inp + ' h-auto py-2'} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Teléfono</label>
                <input {...register('emisor_telefono')} className={inp} />
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Acciones */}
      <div className="flex flex-col sm:flex-row justify-end gap-2 sticky bottom-0 -mx-4 sm:mx-0 px-4 sm:px-0 py-3 sm:py-0 bg-background sm:bg-transparent border-t border-border sm:border-0">
        <button
          type="button"
          onClick={handlePreview}
          disabled={previewing || loading}
          className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <Eye size={16} />
          {previewing ? 'Generando…' : 'Vista previa'}
        </button>
        <button
          type="submit"
          disabled={loading || previewing}
          className="inline-flex items-center justify-center gap-2 h-10 px-6 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <Download size={16} />
          {loading ? 'Generando PDF…' : 'Generar Factura'}
        </button>
      </div>
    </form>

    {/* Preview modal */}
    {previewHtml && (
      <PreviewModal
        html={previewHtml}
        title="Vista previa de la factura"
        TitleIcon={Receipt}
        onClose={() => setPreviewHtml(null)}
      />
    )}
    </>
  );
}
