import { useEffect, useId, useState } from 'react';
import { X, FloppyDisk } from '@phosphor-icons/react';
import { invoicesApi } from '../api/invoices.api';
import type { LeadFiscalData, InvoiceItem } from '../api/invoices.api';
import { emitirPreguntandoSiPasa } from '../lib/masQueLoCobrado';
import { toast } from '@/shared/hooks/useToast';

import Field from '@/shared/components/ui/Field';
import { inputClass } from '@/shared/lib/ui';
import { cn } from '@/shared/lib/utils';
import FilaCampos from '@/shared/components/ui/FilaCampos';
import Select from '@/shared/components/ui/Select';

interface Props {
  projectId: number;
  leadId: number;
  conversionId?: number;
  defaultItems: InvoiceItem[];
  defaultNotas?: string;
  /** 'factura' (por defecto) o 'proforma' → presupuesto (no fiscal). */
  docTipo?: 'factura' | 'proforma';
  /** IVA heredado de la conversión, para que el documento coincida con la venta. */
  defaultIvaExento?: boolean;
  defaultIvaPct?: number;
  defaultIvaIncluido?: boolean;
  onClose: () => void;
  onCreated: (invoiceId: number) => void;
}

export default function FiscalDataDialog({ projectId, leadId, conversionId, defaultItems, defaultNotas, docTipo = 'factura', defaultIvaExento, defaultIvaPct, defaultIvaIncluido, onClose, onCreated }: Props) {
  const isProforma = docTipo === 'proforma';
  const docCap = isProforma ? 'Presupuesto' : 'Factura';       // 'Presupuesto'
  const docLower = isProforma ? 'presupuesto' : 'factura';     // 'presupuesto'
  const [lead, setLead] = useState<LeadFiscalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Datos editables
  const [nombre, setNombre] = useState('');
  const [nif, setNif] = useState('');
  const [direccion, setDireccion] = useState('');
  const [ciudad, setCiudad] = useState('');
  const [cp, setCp] = useState('');
  const [pais, setPais] = useState('España');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');

  // IVA (hereda de la conversión si se pasó; si no, 21% por defecto)
  const [llevaIva, setLlevaIva] = useState(defaultIvaExento ? false : true);
  const [ivaIncluido, setIvaIncluido] = useState(!!defaultIvaIncluido);
  const ivaPct = defaultIvaPct && defaultIvaPct > 0 ? defaultIvaPct : 21;
  const [items, setItems] = useState<InvoiceItem[]>(defaultItems);
  const [notas, setNotas] = useState(defaultNotas || '');
  // Método y pie
  const [metodoPago, setMetodoPago] = useState<'transferencia' | 'deposito' | 'tarjeta' | 'tarjeta_stripe' | 'efectivo' | 'bizum' | 'paypal' | 'fraccionado' | 'otro'>('transferencia');
  const [piePago, setPiePago] = useState('');
  // Emisor (multi-empresa)
  const [issuers, setIssuers] = useState<import('../api/invoices.api').Issuer[]>([]);
  const [issuerId, setIssuerId] = useState<number | null>(null);

  useEffect(() => {
    // Cargar config del proyecto (pie default + metodo default)
    invoicesApi.getConfig(projectId).then((res) => {
      if (res.success && res.data) {
        if (res.data.factura_pie_default) setPiePago(res.data.factura_pie_default);
        if (res.data.factura_metodo_default) setMetodoPago(res.data.factura_metodo_default as 'transferencia');
      }
    }).catch(() => {});
    // Cargar empresas emisoras
    invoicesApi.listIssuers(projectId).then((res) => {
      if (res.success && res.data) {
        setIssuers(res.data);
        const def = res.data.find(i => i.es_default) || res.data[0];
        if (def) setIssuerId(def.id);
      }
    }).catch(() => {});
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    invoicesApi.leadFiscalData(leadId).then((res) => {
      if (cancelled) return;
      if (res.success && res.data) {
        const d = res.data;
        setLead(d);
        setNombre(d.nombre || '');
        setNif(d.identificacion_fiscal || '');
        setDireccion(d.direccion_fiscal || '');
        setCiudad(d.ciudad_fiscal || '');
        setCp(d.codigo_postal_fiscal || '');
        setPais(d.pais_fiscal || 'España');
        setEmail(d.email || '');
        setTelefono(d.telefono || '');
        // Auto IVA según país
        if (d.pais_fiscal && !d.pais_fiscal.toLowerCase().match(/españa|espana|spain|^es$/)) {
          setLlevaIva(false);
        }
      }
      setLoading(false);
    }).catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, [leadId]);

  function ivaPctDefault() {
    if (!llevaIva) return 0;
    return ivaPct;
  }

  // El presupuesto (proforma) NO es fiscal: solo exige nombre. La factura exige datos fiscales completos.
  const required = isProforma
    ? (nombre.trim() && metodoPago)
    : (nombre.trim() && nif.trim() && direccion.trim() && ciudad.trim() && cp.trim() && pais.trim() && metodoPago);

  // Que diga QUÉ falta, con el nombre de cada campo, y no la lista entera.
  function loQueFalta(asDraft: boolean): string[] {
    if (isProforma || asDraft) return nombre.trim() ? [] : ['Nombre'];
    return ([['Nombre', nombre], ['NIF / DNI / CIF', nif], ['Código postal', cp], ['Dirección fiscal', direccion], ['Ciudad', ciudad], ['País', pais]] as const)
      .filter(([, v]) => !v.trim()).map(([k]) => k);
  }
  const faltanParaEmitir = loQueFalta(false);

  // asDraft=true → guarda la factura como BORRADOR (sin número fiscal) aunque
  // falten datos; solo exige el nombre. Se completa y emite desde Facturación.
  async function save(asDraft = false) {
    const draftOk = nombre.trim() && metodoPago;
    if (asDraft ? !draftOk : !required) {
      toast({ title: 'Faltan datos', description: `En «Cliente»: ${loQueFalta(asDraft).join(' · ')}.`, variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const res = await emitirPreguntandoSiPasa((permitir) => invoicesApi.create({
        ...(permitir ? { permitirMasDeLoCobrado: true } : {}),
        projectId, leadId, conversionId,
        issuerId: issuerId || undefined,
        tipo: isProforma ? 'proforma' : undefined,
        borrador: !isProforma && asDraft ? true : undefined,
        clienteNombre: nombre.trim(),
        clienteNif: nif.trim(),
        clienteDireccion: direccion.trim(),
        clienteCiudad: ciudad.trim(),
        clienteCp: cp.trim(),
        clientePais: pais.trim(),
        clienteEmail: email.trim() || null,
        clienteTelefono: telefono.trim() || null,
        items,
        ivaPct: ivaPctDefault(),
        ivaIncluido: ivaIncluido && llevaIva,
        notas: notas.trim() || undefined,
        metodoPago,
        piePago: piePago.trim() || undefined,
      }));
      if (res.success && res.data) {
        toast({
          title: asDraft ? '✓ Borrador guardado' : `✓ ${docCap} ${isProforma ? 'generado' : 'emitida'}`,
          description: asDraft ? 'Sin número fiscal: complétala y emítela desde Facturación.' : (res.data.codigo || undefined),
        });
        onCreated(res.data.id);
      } else {
        toast({ title: isProforma ? 'No se pudo generar el presupuesto' : 'No se pudo emitir la factura', description: (res as { error?: string }).error || 'Inténtalo de nuevo en un momento.', variant: 'destructive' });
      }
    } catch (e: unknown) {
      const err = e as { data?: { error?: string }; message?: string };
      toast({ title: isProforma ? 'No se pudo generar el presupuesto' : 'No se pudo emitir la factura', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-card rounded-lg shadow-xl w-full max-w-2xl max-h-[95vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-border flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-base">{isProforma ? 'Datos para el presupuesto' : 'Datos fiscales para la factura'}</h3>
            <p className="text-xs text-muted-foreground">{isProforma ? 'El presupuesto no es un documento fiscal (sin valor contable)' : 'Se guardarán en el cliente para próximas facturas'}</p>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X size={16} /></button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Cargando datos del cliente…</div>
        ) : (
          <div className="p-4 space-y-3 text-sm">
            {issuers.length > 0 && (
              <Section title="Emisor">
                <Field label="Empresa que emite" htmlFor="datos-fiscales-empresa" hint="Esta factura se emite desde esta empresa. Solo las administradoras gestionan el listado en Configuración.">
                  <Select<number | null>
                    id="datos-fiscales-empresa"
                    value={issuerId ?? null}
                    onChange={(v) => { if (v) setIssuerId(v); }}
                    ariaLabel="Empresa que emite"
                    options={issuers.map((iss) => ({ value: iss.id, label: `${iss.razon_social} — ${iss.nif}${iss.es_default ? ' (por defecto)' : ''}` }))}
                  />
                </Field>
              </Section>
            )}
            <Section title="Cliente">
              <CampoTexto label="Nombre" value={nombre} onChange={setNombre} required />
              <FilaCampos>
                <CampoTexto label="NIF / DNI / CIF" value={nif} onChange={setNif} required={!isProforma} />
                <CampoTexto label="Código postal" value={cp} onChange={setCp} required={!isProforma} />
              </FilaCampos>
              <CampoTexto label="Dirección fiscal" value={direccion} onChange={setDireccion} required={!isProforma} />
              <FilaCampos>
                <CampoTexto label="Ciudad" value={ciudad} onChange={setCiudad} required={!isProforma} />
                <CampoTexto label="País" value={pais} onChange={(v) => { setPais(v); setLlevaIva(!!v.toLowerCase().match(/españa|espana|spain|^es$/)); }} required={!isProforma} />
              </FilaCampos>
              {/* Email y teléfono SOLO si el lead los tiene */}
              {lead?.email && <CampoTexto label="Email (opcional)" value={email} onChange={setEmail} />}
              {lead?.telefono && <CampoTexto label="Teléfono (opcional)" value={telefono} onChange={setTelefono} />}
            </Section>

            <Section title="IVA">
              <div className="flex flex-wrap gap-3 items-center text-sm">
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={llevaIva} onChange={(e) => setLlevaIva(e.target.checked)} />
                  Lleva IVA (21%)
                </label>
                {llevaIva && (
                  <label className="inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={ivaIncluido} onChange={(e) => setIvaIncluido(e.target.checked)} />
                    Precio incluye IVA
                  </label>
                )}
                {!llevaIva && <span className="text-muted-foreground">Operación exenta</span>}
              </div>
            </Section>

            <Section title="Conceptos">
              <div className="space-y-2">
                {/* En el móvil cada concepto va en dos filas (la descripción arriba;
                    la cantidad y el precio debajo) en vez de estrujarse (#106). */}
                {items.map((it, idx) => (
                  <div key={idx} className="grid grid-cols-6 sm:grid-cols-12 gap-fila items-center">
                    <input autoComplete="off" value={it.descripcion} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, descripcion: e.target.value } : x))}
                      placeholder="Descripción" aria-label={`Concepto ${idx + 1}`} className={`${inputClass} col-span-6 sm:col-span-7 min-w-0`} />
                    <input autoComplete="off" type="number" value={it.cantidad} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, cantidad: Number(e.target.value) } : x))}
                      placeholder="Cant" aria-label={`Cantidad del concepto ${idx + 1}`} className={`${inputClass} col-span-2 min-w-0`} />
                    <input autoComplete="off" type="number" step="0.01" value={it.precio_unitario} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, precio_unitario: Number(e.target.value) } : x))}
                      placeholder="€" aria-label={`Precio del concepto ${idx + 1}`} className={`${inputClass} col-span-3 sm:col-span-2 min-w-0`} />
                    <button onClick={() => setItems(items.filter((_, i) => i !== idx))} className="col-span-1 text-muted-foreground hover:text-red-500 text-xs">×</button>
                  </div>
                ))}
                <button onClick={() => setItems([...items, { descripcion: '', cantidad: 1, precio_unitario: 0 }])}
                  className="text-xs text-primary hover:underline">+ añadir concepto</button>
              </div>
            </Section>

            <Section title="Pago">
              <Field label="Método de pago" required htmlFor="datos-fiscales-metodo">
                <Select<string>
                  id="datos-fiscales-metodo"
                  value={metodoPago}
                  onChange={(v) => setMetodoPago(v as 'transferencia')}
                  ariaLabel="Método de pago"
                  options={[
                    { value: 'transferencia', label: 'Transferencia bancaria' },
                    { value: 'deposito', label: 'Depósito bancario' },
                    { value: 'tarjeta', label: 'Tarjeta' },
                    { value: 'tarjeta_stripe', label: 'Tarjeta (Stripe)' },
                    { value: 'efectivo', label: 'Efectivo' },
                    { value: 'bizum', label: 'Bizum' },
                    { value: 'paypal', label: 'PayPal' },
                    { value: 'fraccionado', label: 'Pago fraccionado' },
                    { value: 'otro', label: 'Otro' },
                  ]}
                />
              </Field>
              <Field label="Pie de pago (instrucciones / IBAN / etc)" htmlFor="datos-fiscales-pie">
                <textarea autoComplete="off" id="datos-fiscales-pie" value={piePago} onChange={(e) => setPiePago(e.target.value)} rows={3}
                  placeholder="Ej: IBAN ES12 3456 …  /  Pago a 30 días"
                  className={`${inputClass} h-auto py-2 resize-none`} />
              </Field>
            </Section>

            <Field label="Notas (opcional)" htmlFor="datos-fiscales-notas">
              <textarea autoComplete="off" id="datos-fiscales-notas" value={notas} onChange={(e) => setNotas(e.target.value)} rows={2}
                className={`${inputClass} h-auto py-2 resize-none`} />
            </Field>
          </div>
        )}

        <div className="p-3 border-t border-border flex flex-wrap items-center justify-end gap-2 bg-muted/20">
          {!loading && faltanParaEmitir.length > 0 && (
            <p role="status" className="mr-auto px-1 text-secundario text-muted-foreground">
              Para {isProforma ? 'generarlo' : 'emitirla'}, falta en «Cliente»: {faltanParaEmitir.join(' · ')}.
            </p>
          )}
          <button onClick={onClose} className="h-9 px-3 rounded-md border border-border bg-card text-sm">Cancelar</button>
          {!isProforma && (
            <button onClick={() => save(true)} disabled={saving || !nombre.trim()}
              title="Guarda la factura como borrador (sin número fiscal) aunque falten datos; se completa y emite desde Facturación"
              className="h-9 px-3 rounded-md border border-amber-400 text-amber-700 dark:text-amber-400 bg-card text-sm font-semibold hover:bg-amber-50 dark:hover:bg-amber-950/30 disabled:opacity-50">
              {saving ? '…' : 'Guardar borrador'}
            </button>
          )}
          <button onClick={() => save(false)} disabled={saving || !required}
            className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1.5">
            <FloppyDisk size={14} weight="bold" /> {saving ? (isProforma ? 'Generando…' : 'Emitiendo…') : (isProforma ? 'Generar presupuesto' : 'Emitir factura')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-md p-3 space-y-2">
      <p className="text-tabla uppercase text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

function CampoTexto({ label, value, onChange, required }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  // Un id propio para que la etiqueta enfoque su campo (#106).
  const id = useId();
  return (
    <Field label={label} required={required} htmlFor={id}>
      <input autoComplete="off"
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={required && !value ? true : undefined}
        className={cn(inputClass, required && !value && 'border-red-300')}
      />
    </Field>
  );
}
