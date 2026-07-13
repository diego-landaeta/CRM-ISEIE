import { useEffect, useState } from 'react';
import { X, FloppyDisk } from '@phosphor-icons/react';
import { invoicesApi } from '../api/invoices.api';
import type { LeadFiscalData, InvoiceItem } from '../api/invoices.api';
import { toast } from '@/shared/hooks/useToast';

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
  const [metodoPago, setMetodoPago] = useState<'transferencia' | 'tarjeta' | 'tarjeta_stripe' | 'efectivo' | 'bizum' | 'fraccionado' | 'otro'>('transferencia');
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

  async function save() {
    if (!required) {
      toast({ title: 'Faltan datos', description: isProforma ? 'Completa al menos el nombre del cliente.' : 'Completa nombre, NIF, dirección, ciudad, CP y país.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const res = await invoicesApi.create({
        projectId, leadId, conversionId,
        issuerId: issuerId || undefined,
        tipo: isProforma ? 'proforma' : undefined,
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
      });
      if (res.success && res.data) {
        toast({ title: `✓ ${docCap} ${isProforma ? 'generado' : 'emitida'}`, description: res.data.codigo });
        onCreated(res.data.id);
      } else {
        toast({ title: 'Error', description: (res as { error?: string }).error || 'No se pudo generar', variant: 'destructive' });
      }
    } catch (e: unknown) {
      const err = e as { data?: { error?: string }; message?: string };
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
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
              <Section title="Empresa que emite">
                <select value={issuerId ?? ''} onChange={e => setIssuerId(Number(e.target.value))}
                  className="w-full h-9 px-2 rounded border border-primary/40 bg-background text-foreground text-sm font-medium [&>option]:bg-background [&>option]:text-foreground">
                  {issuers.map(iss => (
                    <option key={iss.id} value={iss.id}>{iss.razon_social} — {iss.nif}{iss.es_default ? ' (por defecto)' : ''}</option>
                  ))}
                </select>
                <p className="text-[10px] text-muted-foreground mt-1">Esta factura se emite desde esta empresa. Solo las administradoras gestionan el listado en Configuración.</p>
              </Section>
            )}
            <Section title="Cliente">
              <Field label="Nombre" value={nombre} onChange={setNombre} required />
              <div className="grid grid-cols-2 gap-3">
                <Field label="NIF / DNI / CIF" value={nif} onChange={setNif} required={!isProforma} />
                <Field label="Código postal" value={cp} onChange={setCp} required={!isProforma} />
              </div>
              <Field label="Dirección fiscal" value={direccion} onChange={setDireccion} required={!isProforma} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Ciudad" value={ciudad} onChange={setCiudad} required={!isProforma} />
                <Field label="País" value={pais} onChange={(v) => { setPais(v); setLlevaIva(!!v.toLowerCase().match(/españa|espana|spain|^es$/)); }} required={!isProforma} />
              </div>
              {/* Email y teléfono SOLO si el lead los tiene */}
              {lead?.email && <Field label="Email (opcional)" value={email} onChange={setEmail} />}
              {lead?.telefono && <Field label="Teléfono (opcional)" value={telefono} onChange={setTelefono} />}
            </Section>

            <Section title="IVA">
              <div className="flex flex-wrap gap-3 items-center text-xs">
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
                {items.map((it, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <input value={it.descripcion} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, descripcion: e.target.value } : x))}
                      placeholder="Descripción" className="col-span-7 h-9 px-2 rounded border border-border bg-background text-sm" />
                    <input type="number" value={it.cantidad} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, cantidad: Number(e.target.value) } : x))}
                      placeholder="Cant" className="col-span-2 h-9 px-2 rounded border border-border bg-background text-sm" />
                    <input type="number" step="0.01" value={it.precio_unitario} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, precio_unitario: Number(e.target.value) } : x))}
                      placeholder="€" className="col-span-2 h-9 px-2 rounded border border-border bg-background text-sm" />
                    <button onClick={() => setItems(items.filter((_, i) => i !== idx))} className="col-span-1 text-muted-foreground hover:text-red-500 text-xs">×</button>
                  </div>
                ))}
                <button onClick={() => setItems([...items, { descripcion: '', cantidad: 1, precio_unitario: 0 }])}
                  className="text-xs text-primary hover:underline">+ añadir concepto</button>
              </div>
            </Section>

            <Section title="Pago">
              <div>
                <label className="text-[11px] text-muted-foreground">Método de pago <span className="text-red-500">*</span></label>
                <select value={metodoPago} onChange={(e) => setMetodoPago(e.target.value as 'transferencia')}
                  className="w-full h-9 px-2 rounded border border-border bg-background text-sm">
                  <option value="transferencia">Transferencia bancaria</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="tarjeta_stripe">Tarjeta (Stripe)</option>
                  <option value="efectivo">Efectivo</option>
                  <option value="bizum">Bizum</option>
                  <option value="fraccionado">Pago fraccionado</option>
                  <option value="otro">Otro</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">Pie de pago (instrucciones / IBAN / etc)</label>
                <textarea value={piePago} onChange={(e) => setPiePago(e.target.value)} rows={3}
                  placeholder="Ej: IBAN ES12 3456 …  /  Pago a 30 días"
                  className="w-full px-2 py-1.5 rounded border border-border bg-background text-sm" />
              </div>
            </Section>

            <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} placeholder="Notas (opcional)"
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-sm" />
          </div>
        )}

        <div className="p-3 border-t border-border flex justify-end gap-2 bg-muted/20">
          <button onClick={onClose} className="h-9 px-3 rounded-md border border-border bg-card text-sm">Cancelar</button>
          <button onClick={save} disabled={saving || !required}
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
      <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-wider">{title}</p>
      {children}
    </div>
  );
}

function Field({ label, value, onChange, required }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <div>
      <label className="text-[11px] text-muted-foreground">{label}{required && <span className="text-red-500"> *</span>}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)}
        className={`w-full h-9 px-2 rounded border bg-background text-sm ${required && !value ? 'border-red-300' : 'border-border'}`} />
    </div>
  );
}
