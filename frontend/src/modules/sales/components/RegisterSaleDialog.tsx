import { useEffect, useState } from 'react';
import { Receipt, X, MagnifyingGlass, UserCheck, UserPlus, UserMinus } from '@phosphor-icons/react';
import usePermission from '@/shared/hooks/usePermission';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';
import { avisoDeLoQueFalta, type Falta } from '@/shared/lib/loQueFalta';
import Portal from '@/shared/components/ui/portal';
import Field from '@/shared/components/ui/Field';
import FilaCampos from '@/shared/components/ui/FilaCampos';
import Select from '@/shared/components/ui/Select';
import { inputClass } from '@/shared/lib/ui';

// Las notas y la dirección: la clase común, con la altura que pidan sus filas.
const textareaClass = `${inputClass} h-auto py-2 resize-none`;

interface Product { id: number; nombre: string; precio?: number | string; moneda?: string }
interface Project { id: number; nombre?: string }
interface LeadLite {
  id: number; nombre?: string; email?: string; telefono?: string; status?: string;
  /** Quien lleva el prospecto: es de quien sera la venta en «de otra gestora». */
  responsable_id?: number | null; responsable_nombre?: string | null;
}
interface Props {
  open: boolean;
  onClose: () => void;
  project: Project | null;
  onSaved?: (result: { sale_id: number; lead_id: number; retroactiva: boolean }) => void;
  /**
   * Con que modo se abre.
   *
   * Lo elige el desplegable del boton «Nueva venta» (Diego, 25/09): venta
   * propia, de otra gestora, o automatica sin gestora. Quien no lo pasa abre
   * como siempre, que es lo que hacen Clientes e Ingresos.
   */
  modoInicial?: Mode;
}

const PAYMENT_METHODS = [
  { value: 'transferencia', label: 'Transferencia' },
  { value: 'tarjeta', label: 'Tarjeta' },
  { value: 'efectivo', label: 'Efectivo' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'fraccionado', label: 'Fraccionado' },
];

/**
 * De quien es la venta que se esta registrando.
 *
 * `sin_gestora` es de Diego (25/09): una venta que se crea de cero y **no es de
 * nadie**. Hoy, quien la registra se la queda --si es gestor-- o el round-robin
 * se la encaja a la gestora que toque --si es admin--, y en los dos casos el
 * informe acaba diciendo que vendio quien solo la apunto. Lo piden las
 * contables de CEDIA e ICTESS, que registran ventas que no cerraron ellas.
 */
type Mode = 'existing' | 'new' | 'sin_gestora' | 'otra_gestora';

/** Para comparar lo que se escribe con lo que hay: sin tildes y en minusculas (MultiCRM 22cf5ee5). */
function sinTildes(s: string) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export default function RegisterSaleDialog({ open, onClose, project, onSaved, modoInicial }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const { can } = usePermission();
  // Quien puede registrar una venta que no es de nadie. De serie admin y
  // superadmin; a quien lleve la contabilidad se le da por persona desde el
  // panel de permisos, para no tener que desplegar cada vez que cambie.
  const puedeSinGestora = can('conversions.sin_gestora');
  const [mode, setMode] = useState<Mode>(modoInicial || 'existing');

  // Cliente nuevo
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');

  // Cliente existente (búsqueda)
  const [clientSearch, setClientSearch] = useState('');
  const [clientResults, setClientResults] = useState<LeadLite[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedClient, setSelectedClient] = useState<LeadLite | null>(null);

  // Documento fiscal para factura (NIF/CIF/NIE/cédula/RFC) — opcional
  const [identificacionFiscal, setIdentificacionFiscal] = useState('');
  const [direccionFiscal, setDireccionFiscal] = useState('');

  // Venta
  const [productoId, setProductoId] = useState<number | ''>('');
  const [productSearch, setProductSearch] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [importeTotal, setImporteTotal] = useState<string>('');
  const [importePagado, setImportePagado] = useState<string>('');
  const [metodo, setMetodo] = useState('transferencia');
  const [fecha, setFecha] = useState(today);
  const [notas, setNotas] = useState('');

  // Pagos fraccionados (cuotas). Se activan al seleccionar metodo='fraccionado'.
  // Por defecto generamos N cuotas mensuales desde la fecha de pago, distribuyendo
  // el total a partes iguales (la última absorbe la diferencia para que sumen
  // exactamente el importe_total — contablemente correcto).
  const [numCuotas, setNumCuotas] = useState(3);
  const [fechaPrimeraCuota, setFechaPrimeraCuota] = useState(today);
  const [installments, setInstallments] = useState<Array<{ importe_previsto: string; fecha_vencimiento: string }>>([]);
  const [installmentsDirty, setInstallmentsDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode(modoInicial || 'existing');
    setNombre(''); setEmail(''); setTelefono('');
    setClientSearch(''); setClientResults([]); setSelectedClient(null);
    setIdentificacionFiscal('');
    setDireccionFiscal('');
    setProductoId(''); setProductSearch('');
    setImporteTotal(''); setImportePagado(''); setMetodo('transferencia');
    setFecha(today); setNotas('');
  }, [open, today]);

  // Productos del proyecto
  useEffect(() => {
    if (!open || !project?.id) return;
    client.get<Product[]>('/products', { params: { projectId: project.id, limit: 500 } })
      .then((r) => setProducts(Array.isArray(r?.data) ? r.data : []))
      .catch(() => setProducts([]));
  }, [open, project?.id]);

  // Búsqueda debounced de clientes existentes (leads convertidos del proyecto)
  useEffect(() => {
    if ((mode !== 'existing' && mode !== 'otra_gestora') || !open || !project?.id) return;
    if (clientSearch.trim().length < 2) { setClientResults([]); return; }
    const handle = setTimeout(() => {
      setSearching(true);
      client.get<LeadLite[]>('/leads', {
        params: {
          projectId: project.id,
          // En «de otra gestora» se busca entre TODOS: es un prospecto al que
          // se le registra la venta, no un cliente que ya compro.
          ...(mode === 'existing' ? { status: 'convertido' } : {}),
          search: clientSearch.trim(), limit: 20,
        },
      })
        .then((r) => setClientResults(Array.isArray(r?.data) ? r.data : []))
        .catch(() => setClientResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [mode, open, project?.id, clientSearch]);

  const productoSel = products.find((p) => p.id === productoId);
  useEffect(() => {
    if (productoSel && !importeTotal && productoSel.precio) setImporteTotal(String(productoSel.precio));
  }, [productoSel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Helpers para pagos fraccionados (cuotas)
  function addMonths(isoDate: string, months: number): string {
    const d = new Date(isoDate);
    d.setMonth(d.getMonth() + months);
    return d.toISOString().slice(0, 10);
  }
  function distributeInstallments(total: number, n: number, fechaInicio: string): Array<{ importe_previsto: string; fecha_vencimiento: string }> {
    if (!isFinite(total) || total <= 0 || n < 2) return [];
    const cuotaBase = Math.round((total / n) * 100) / 100;
    const result = [];
    for (let i = 0; i < n; i++) {
      const importe = i === n - 1
        ? Math.round((total - cuotaBase * (n - 1)) * 100) / 100
        : cuotaBase;
      result.push({ importe_previsto: String(importe), fecha_vencimiento: addMonths(fechaInicio, i) });
    }
    return result;
  }
  // Regenerar cuotas cuando cambien total / N / fecha inicio (si el user no las
  // ha editado a mano).
  useEffect(() => {
    if (metodo !== 'fraccionado') return;
    if (installmentsDirty) return;
    const totalNum = parseFloat(importeTotal);
    if (!totalNum || totalNum <= 0 || numCuotas < 2) { setInstallments([]); return; }
    setInstallments(distributeInstallments(totalNum, numCuotas, fechaPrimeraCuota));
  }, [metodo, importeTotal, numCuotas, fechaPrimeraCuota, installmentsDirty]);
  // Si cambia metodo a fraccionado, inicializa la fecha de primera cuota con la fecha del pago.
  useEffect(() => {
    if (metodo === 'fraccionado') {
      setFechaPrimeraCuota(fecha);
      setInstallmentsDirty(false);
    }
  }, [metodo]); // eslint-disable-line react-hooks/exhaustive-deps

  // SI LA BUSQUEDA DEJA UNA SOLA, SE ELIGE SOLA (como en MultiCRM, 22cf5ee5). Es lo
  // que la gente espera al escribir el nombre entero: si solo casa con una, el
  // desplegable no puede seguir en «— Selecciona —».
  useEffect(() => {
    if (!productSearch.trim()) return;
    const hay = products.filter((p) => sinTildes(p.nombre).includes(sinTildes(productSearch)));
    if (hay.length === 1 && productoId !== hay[0].id) setProductoId(hay[0].id);
  }, [productSearch, products]);   // eslint-disable-line react-hooks/exhaustive-deps

  const installmentsSum = installments.reduce((acc, it) => acc + (parseFloat(it.importe_previsto) || 0), 0);
  const installmentsMismatch = metodo === 'fraccionado' && installments.length > 0
    && Math.abs(installmentsSum - parseFloat(importeTotal || '0')) > 0.01;

  if (!open) return null;

  const productosFiltrados = productSearch.trim()
    // Sin tildes y sin mayúsculas: «terapeutica» tiene que encontrar «Terapéutica».
    ? products.filter((p) => sinTildes(p.nombre).includes(sinTildes(productSearch)))
    : products;
  const isRetroactiva = fecha < today;

  function selectClient(c: LeadLite) {
    setSelectedClient(c);
    setNombre(c.nombre || '');
    setEmail(c.email || '');
    setTelefono(c.telefono || '');
    setClientSearch('');
    setClientResults([]);
  }
  function clearSelectedClient() {
    setSelectedClient(null);
    setNombre(''); setEmail(''); setTelefono('');
  }

  async function handleSave() {
    if (!project?.id) { toast({ title: 'Selecciona un proyecto', variant: 'destructive' }); return; }
    // Cada aviso dice qué falta y dónde ponerlo, no solo «requerido»; y si
    // faltan varias cosas, todas de una vez (#106).
    const faltan: Falta[] = [];
    if ((mode === 'existing' || mode === 'otra_gestora') && !selectedClient) {
      faltan.push({ title: 'Selecciona un cliente', description: 'Búscalo por nombre, email o teléfono.', que: 'el cliente (búscalo por nombre, email o teléfono)' });
    }
    // Sin gestora basta el nombre: esta venta se registra justo cuando no hay
    // nada mas, y pedir un correo inventado es peor que no pedir nada.
    if ((mode === 'new' || mode === 'sin_gestora') && !nombre.trim()) {
      faltan.push({ title: 'Falta el nombre del cliente', description: 'Escríbelo en «Nombre del cliente».', que: 'el nombre en «Nombre del cliente»' });
    }
    if (mode === 'new' && !email.trim() && !telefono.trim()) {
      faltan.push({ title: 'Falta una forma de contacto', description: 'Pon el email o el teléfono del cliente: al menos uno de los dos.', que: 'el email o el teléfono' });
    }
    if (!productoId) {
      faltan.push({ title: 'Falta la formación', description: 'Elígela en la lista de «Producto» (puedes buscarla escribiendo encima).', que: 'la formación en «Producto»' });
    }
    const totalNum = parseFloat(importeTotal);
    if (!totalNum || totalNum <= 0) {
      faltan.push({ title: 'Falta el importe total', description: 'Escribe en «Importe total» una cantidad mayor que 0.', que: 'el importe en «Importe total»' });
    }
    const falta = avisoDeLoQueFalta(faltan);
    if (falta) { toast(falta); return; }
    const pagadoNum = importePagado === '' ? totalNum : parseFloat(importePagado);
    if (pagadoNum < 0 || pagadoNum > totalNum) {
      toast({ title: 'El importe pagado no cuadra', description: `Tiene que estar entre 0 y el importe total (${totalNum.toFixed(2)}). Si lo dejas vacío, se toma el total.`, variant: 'destructive' }); return;
    }
    // Validación específica de cuotas
    if (metodo === 'fraccionado') {
      if (installments.length < 2) {
        toast({ title: 'Cuotas requeridas', description: 'Configura al menos 2 cuotas o cambia el método.', variant: 'destructive' });
        return;
      }
      if (installmentsMismatch) {
        toast({ title: 'Las cuotas no suman el total', description: `Suma actual: ${installmentsSum.toFixed(2)} · Total: ${totalNum.toFixed(2)}`, variant: 'destructive' });
        return;
      }
      for (const [i, it] of installments.entries()) {
        const imp = parseFloat(it.importe_previsto);
        if (!isFinite(imp) || imp <= 0) {
          toast({ title: `A la cuota ${i + 1} le falta el importe`, description: 'Cada cuota necesita un importe mayor que 0. Corrígelo en el plan de cuotas.', variant: 'destructive' });
          return;
        }
        if (!it.fecha_vencimiento) {
          toast({ title: `A la cuota ${i + 1} le falta la fecha`, description: 'Elige su vencimiento en el plan de cuotas.', variant: 'destructive' });
          return;
        }
      }
    }

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        project_id: project.id,
        producto_interes_id: productoId,
        importe_total: totalNum,
        importe_pagado: pagadoNum,
        metodo_pago: metodo,
        fecha_pago: fecha,
        notas: notas.trim() || null,
      };
      if (metodo === 'fraccionado' && installments.length >= 2) {
        body.installments = installments.map(it => ({
          importe_previsto: parseFloat(it.importe_previsto),
          fecha_vencimiento: it.fecha_vencimiento,
        }));
      }
      if (mode === 'sin_gestora') body.sin_gestora = true;
      // De otra gestora: el prospecto elegido y, fijada en la venta, la
      // persona que lo lleva. Fijarla importa: si manana reasignan el
      // prospecto, la venta tiene que seguir siendo de quien la hizo.
      if (mode === 'otra_gestora' && selectedClient) {
        body.lead_id = selectedClient.id;
        if (selectedClient.responsable_id) body.vendedora_id = selectedClient.responsable_id;
      }
      if (mode === 'existing' && selectedClient) {
        body.lead_id = selectedClient.id;
      } else {
        body.nombre = nombre.trim();
        body.email = email.trim() || null;
        body.telefono = telefono.trim() || null;
      }
      if (identificacionFiscal.trim()) {
        body.identificacion_fiscal = identificacionFiscal.trim();
      }
      if (direccionFiscal.trim()) {
        body.direccion_fiscal = direccionFiscal.trim();
      }
      const res = await client.post<{ sale_id: number; lead_id: number; retroactiva: boolean; duplicado: boolean }>('/ventas', body);
      const data = res.data;
      const desc = mode === 'existing'
        ? `Venta añadida al cliente existente${data.retroactiva ? ' (histórica)' : ''}`
        : (data.retroactiva ? `Venta histórica registrada (${fecha})${data.duplicado ? ' — sobre cliente existente' : ''}` : `Venta registrada${data.duplicado ? ' — sobre cliente existente' : ''}`);
      toast({ title: 'Venta creada', description: desc });
      onSaved?.(data);
      onClose();
    } catch (err: unknown) {
      const e = err as { data?: { error?: string }; message?: string };
      toast({ title: 'No se pudo registrar la venta', description: e?.data?.error || e?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <div role="dialog" aria-modal="true" className="relative bg-card rounded-lg border border-border w-full max-w-lg flex flex-col max-h-[90vh]">
          <div className="px-5 py-4 border-b border-border flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
              <Receipt size={18} weight="regular" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-base">Registrar venta</h3>
              <p className="text-xs text-muted-foreground">
                Por la fecha que pongas se considera <strong>histórica</strong> (anterior a hoy) o <strong>del día</strong>.
              </p>
            </div>
            <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground"><X size={18} /></button>
          </div>

          <div className="p-5 space-y-4 overflow-y-auto">
            {/* Cliente existente o nuevo. Solo en la venta propia: en los
                otros modos ya lo dijo el desplegable del boton. */}
            {(mode === 'existing' || mode === 'new') && (
            <div className="bg-muted/40 p-1 rounded-lg grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => { setMode('existing'); clearSelectedClient(); }}
                className={`h-9 rounded-md text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors ${mode === 'existing' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <UserCheck size={14} weight="bold" /> Cliente existente
              </button>
              <button
                type="button"
                onClick={() => { setMode('new'); clearSelectedClient(); }}
                className={`h-9 rounded-md text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors ${mode === 'new' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <UserPlus size={14} weight="bold" /> Cliente nuevo
              </button>
            </div>
            )}
            {/* MODO: cliente existente */}
            {mode === 'existing' && (
              <div className="space-y-3">
                {!selectedClient ? (
                  <div>
                    <Field label="Buscar cliente" htmlFor="venta-buscar-cliente" required>
                      <div className="relative">
                        <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input autoComplete="off" id="venta-buscar-cliente"
                          autoFocus
                          value={clientSearch}
                          onChange={(e) => setClientSearch(e.target.value)}
                          placeholder="Nombre, email o teléfono…"
                          className={`${inputClass} pl-9`}
                        />
                      </div>
                    </Field>
                    {clientSearch.trim().length > 0 && clientSearch.trim().length < 2 && (
                      <p className="mt-1 px-1 text-secundario text-muted-foreground">Escribe al menos 2 caracteres…</p>
                    )}
                    {searching && <p className="mt-1 px-1 text-secundario text-muted-foreground">Buscando…</p>}
                    {!searching && clientSearch.trim().length >= 2 && clientResults.length === 0 && (
                      <p className="mt-1 px-1 text-secundario text-muted-foreground">
                        No se encontraron clientes. ¿Quizás es <button type="button" onClick={() => setMode('new')} className="text-primary font-semibold hover:underline">un cliente nuevo</button>?
                      </p>
                    )}
                    {clientResults.length > 0 && (
                      <div className="mt-1.5 border border-border rounded-md max-h-48 overflow-y-auto">
                        {clientResults.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => selectClient(c)}
                            className="w-full text-left px-3 py-2 hover:bg-muted text-sm border-b last:border-0 border-border"
                          >
                            <p className="font-medium truncate">{c.nombre || 'Sin nombre'}</p>
                            <p className="text-[11px] text-muted-foreground truncate">{c.email || '—'} {c.telefono ? `· ${c.telefono}` : ''}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded-md p-3 flex items-start gap-3">
                    <UserCheck size={20} weight="duotone" className="text-emerald-600 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{selectedClient.nombre || 'Sin nombre'}</p>
                      <p className="text-secundario text-muted-foreground truncate">{selectedClient.email || '—'} {selectedClient.telefono ? `· ${selectedClient.telefono}` : ''}</p>
                      <p className="text-secundario text-emerald-700 dark:text-emerald-400 mt-0.5">Cliente seleccionado — se le añadirá una nueva venta.</p>
                    </div>
                    <button type="button" onClick={clearSelectedClient} className="text-secundario text-muted-foreground hover:text-foreground underline flex-shrink-0">
                      Cambiar
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* MODO: venta de otra gestora. Diego, 25/09: «que en este caso
                seleccione el prospecto y haga ese proceso».

                Se busca entre TODOS los prospectos, no solo los convertidos: el
                caso es justo ese, alguien que todavía no ha comprado. Y la
                venta queda de quien lo lleva, no de quien la está tecleando. */}
            {mode === 'otra_gestora' && (
              <div className="space-y-3">
                {!selectedClient ? (
                  <div>
                    <Field label="Buscar el prospecto" htmlFor="venta-buscar-prospecto" required>
                      <div className="relative">
                        <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input autoComplete="off" id="venta-buscar-prospecto"
                          autoFocus
                          value={clientSearch}
                          onChange={(e) => setClientSearch(e.target.value)}
                          placeholder="Nombre, correo o teléfono…"
                          className={`${inputClass} pl-9`}
                        />
                      </div>
                    </Field>
                    {searching && <p className="mt-1 px-1 text-secundario text-muted-foreground">Buscando…</p>}
                    {!searching && clientSearch.trim().length >= 2 && clientResults.length === 0 && (
                      <p className="mt-1 px-1 text-secundario text-muted-foreground">No se encontró ningún prospecto con eso.</p>
                    )}
                    {clientResults.length > 0 && (
                      <div className="mt-1.5 border border-border rounded-md max-h-48 overflow-y-auto">
                        {clientResults.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => selectClient(c)}
                            className="w-full text-left px-3 py-2 hover:bg-muted text-sm border-b last:border-0 border-border"
                          >
                            <p className="font-medium truncate">{c.nombre || 'Sin nombre'}</p>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {c.email || '—'} {c.telefono ? `· ${c.telefono}` : ''}
                              {' · '}{c.responsable_nombre || 'sin gestora'}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900 rounded-md p-3 flex items-start gap-3">
                    <UserCheck size={20} weight="duotone" className="text-sky-600 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{selectedClient.nombre || 'Sin nombre'}</p>
                      <p className="text-secundario text-muted-foreground truncate">{selectedClient.email || '—'} {selectedClient.telefono ? `· ${selectedClient.telefono}` : ''}</p>
                      {selectedClient.responsable_nombre ? (
                        <p className="text-secundario text-sky-700 dark:text-sky-400 mt-0.5">
                          Esta venta será de <strong>{selectedClient.responsable_nombre}</strong>, que es quien lleva el prospecto.
                        </p>
                      ) : (
                        <p className="text-secundario text-amber-700 dark:text-amber-400 mt-0.5">
                          Este prospecto no tiene gestora, así que la venta no será de nadie.
                        </p>
                      )}
                    </div>
                    <button type="button" onClick={clearSelectedClient} className="text-secundario text-muted-foreground hover:text-foreground underline flex-shrink-0">
                      Cambiar
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* MODO: venta sin gestora. Pide lo mismo que «cliente nuevo» pero
                con el nombre basta, y avisa de en qué se nota. */}
            {mode === 'sin_gestora' && (
              <div className="space-y-3">
                <p className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-secundario text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-200">
                  Esta venta <strong>no se le asigna a nadie</strong>: no cuenta en los
                  números de ninguna gestora ni avanza el reparto de prospectos. Con el
                  nombre basta.
                </p>
                <Field label="Nombre del cliente" htmlFor="venta-nombre" required>
                  <input autoComplete="off" id="venta-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputClass} />
                </Field>
                <FilaCampos>
                  <Field label="Email" htmlFor="venta-email">
                    <input autoComplete="off" id="venta-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                      placeholder="opcional" className={inputClass} />
                  </Field>
                  <Field label="Teléfono" htmlFor="venta-telefono">
                    <input autoComplete="off" id="venta-telefono" value={telefono} onChange={(e) => setTelefono(e.target.value)}
                      placeholder="opcional" className={inputClass} />
                  </Field>
                </FilaCampos>
              </div>
            )}

            {/* MODO: cliente nuevo */}
            {mode === 'new' && (
              <div className="space-y-3">
                <Field label="Nombre del cliente" htmlFor="venta-nombre" required>
                  <input autoComplete="off" id="venta-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} className={inputClass} />
                </Field>
                <FilaCampos>
                  <Field label="Email" htmlFor="venta-email" hint="Hace falta el email o el teléfono">
                    <input autoComplete="off" id="venta-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                      placeholder="correo@ejemplo.com" className={inputClass} />
                  </Field>
                  <Field label="Teléfono" htmlFor="venta-telefono" hint="Hace falta el teléfono o el email">
                    <input autoComplete="off" id="venta-telefono" value={telefono} onChange={(e) => setTelefono(e.target.value)}
                      placeholder="+34..." className={inputClass} />
                  </Field>
                </FilaCampos>
              </div>
            )}

            {/* Datos fiscales (opcionales, común a ambos modos) */}
            <div className="space-y-2">
              <Field label="Identificación fiscal (opcional)" htmlFor="venta-identificacion">
                <input autoComplete="off" id="venta-identificacion"
                  value={identificacionFiscal}
                  onChange={(e) => setIdentificacionFiscal(e.target.value)}
                  placeholder="NIF / CIF / NIE / Cédula / RFC…"
                  maxLength={50}
                  className={inputClass}
                />
              </Field>
              <Field label="Dirección fiscal (opcional)" htmlFor="venta-direccion"
                hint="Los dos datos fiscales son para emitir factura. Si no los tienes, déjalos vacíos.">
                <textarea autoComplete="off" id="venta-direccion"
                  value={direccionFiscal}
                  onChange={(e) => setDireccionFiscal(e.target.value)}
                  placeholder="Calle, número, piso · Código postal · Ciudad · Provincia · País"
                  maxLength={500}
                  rows={2}
                  className={textareaClass}
                />
              </Field>
            </div>

            {/* Producto + importes (común a ambos modos) */}
            <div className="border-t border-border pt-3 space-y-3">
              <Field label="Producto" required htmlFor="venta-producto">
                <div className="space-y-1.5">
                  <input autoComplete="off" value={productSearch} onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Buscar producto…" aria-label="Buscar producto"
                    className={inputClass} />
                  {/* El desplegable del CRM, como el resto (#106, #134). */}
                  <Select<number | ''>
                    id="venta-producto"
                    value={productoId}
                    onChange={setProductoId}
                    ariaLabel="Producto"
                    options={[
                      { value: '', label: 'Elige la formación…' },
                      ...productosFiltrados.map((p) => ({
                        value: p.id,
                        label: `${p.nombre}${p.precio ? ` (${p.precio} ${p.moneda || ''})` : ''}`,
                      })),
                    ]}
                  />
                </div>
              </Field>

              <FilaCampos>
                <Field label="Importe total" htmlFor="venta-importe-total" required>
                  <input autoComplete="off" id="venta-importe-total" type="number" min="0" step="0.01" value={importeTotal}
                    onChange={(e) => setImporteTotal(e.target.value)} className={inputClass} />
                </Field>
                {/* «Por defecto: igual al total» iba de texto de ejemplo dentro
                    del campo y en el móvil salía cortado (#134): va debajo. */}
                <Field label="Importe pagado" htmlFor="venta-importe-pagado"
                  hint={importeTotal ? `Si lo dejas vacío, se toma el total (${importeTotal}).` : 'Si lo dejas vacío, se toma el total.'}>
                  <input autoComplete="off" id="venta-importe-pagado" type="number" min="0" step="0.01" value={importePagado}
                    onChange={(e) => setImportePagado(e.target.value)} className={inputClass} />
                </Field>
              </FilaCampos>

              <FilaCampos>
                <Field label="Método de pago" htmlFor="venta-metodo">
                  <Select<string> id="venta-metodo"
                    value={metodo}
                    onChange={setMetodo}
                    ariaLabel="Método de pago"
                    options={PAYMENT_METHODS}
                  />
                </Field>
                <Field label="Fecha de pago" htmlFor="venta-fecha" required
                  hint={isRetroactiva ? 'Anterior a hoy: la venta se registra como histórica.' : undefined}>
                  <input id="venta-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} max={today}
                    className={inputClass} />
                </Field>
              </FilaCampos>

              {/* Cuotas — solo cuando método es fraccionado */}
              {metodo === 'fraccionado' && (
                <div className="space-y-3 p-3 rounded-md border border-border bg-muted/20">
                  <div className="flex items-center justify-between gap-2">
                    <span className="px-1 text-tabla uppercase text-muted-foreground">Plan de cuotas</span>
                    <button type="button"
                      onClick={() => { setInstallmentsDirty(false); }}
                      className="text-secundario text-primary hover:underline">
                      Auto-distribuir
                    </button>
                  </div>
                  <FilaCampos>
                    <Field label="N° de cuotas" htmlFor="venta-num-cuotas">
                      <input autoComplete="off" id="venta-num-cuotas" type="number" min={2} max={36} value={numCuotas}
                        onChange={(e) => { setNumCuotas(parseInt(e.target.value) || 2); setInstallmentsDirty(false); }}
                        className={inputClass} />
                    </Field>
                    <Field label="1ª fecha de vencimiento" htmlFor="venta-primera-cuota">
                      <input id="venta-primera-cuota" type="date" value={fechaPrimeraCuota}
                        onChange={(e) => { setFechaPrimeraCuota(e.target.value); setInstallmentsDirty(false); }}
                        className={inputClass} />
                    </Field>
                  </FilaCampos>
                  {installments.length > 0 && (
                    <div className="space-y-1.5">
                      {/* En el móvil cada cuota va en dos líneas (fecha arriba,
                          importe debajo) y la cabecera sobra: los campos dicen
                          qué son. En pantalla ancha, una línea por cuota (#106). */}
                      <div className="hidden sm:grid grid-cols-[40px_1fr_1fr] gap-fila text-tabla uppercase text-muted-foreground px-1">
                        <span>#</span><span>Vencimiento</span><span className="text-right">Importe €</span>
                      </div>
                      {installments.map((it, idx) => (
                        <div key={idx} className="grid grid-cols-[2rem_1fr] sm:grid-cols-[40px_1fr_1fr] gap-fila items-center">
                          <span className="text-xs text-muted-foreground px-1">{idx + 1}</span>
                          <input type="date" value={it.fecha_vencimiento}
                            aria-label={`Vencimiento de la cuota ${idx + 1}`}
                            onChange={(e) => {
                              const next = [...installments];
                              next[idx] = { ...next[idx], fecha_vencimiento: e.target.value };
                              setInstallments(next); setInstallmentsDirty(true);
                            }}
                            className={`${inputClass} min-w-0`} />
                          <input autoComplete="off" type="number" min="0" step="0.01" value={it.importe_previsto}
                            aria-label={`Importe de la cuota ${idx + 1}`}
                            onChange={(e) => {
                              const next = [...installments];
                              next[idx] = { ...next[idx], importe_previsto: e.target.value };
                              setInstallments(next); setInstallmentsDirty(true);
                            }}
                            className={`${inputClass} min-w-0 text-right col-start-2 sm:col-start-auto`} />
                        </div>
                      ))}
                      <div className={`text-secundario text-right pt-1 ${installmentsMismatch ? 'text-red-600 font-semibold' : 'text-muted-foreground'}`}>
                        Suma: {installmentsSum.toFixed(2)} € · Total: {(parseFloat(importeTotal) || 0).toFixed(2)} €
                        {installmentsMismatch && ' ⚠ no coinciden'}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <Field label="Notas (opcional)" htmlFor="venta-notas">
                <textarea autoComplete="off" id="venta-notas" value={notas} onChange={(e) => setNotas(e.target.value)} rows={2}
                  placeholder="Comentarios sobre la venta…"
                  className={textareaClass} />
              </Field>
            </div>
          </div>

          <div className="flex justify-end gap-2 p-4 border-t border-border bg-muted/20">
            <button onClick={onClose} disabled={saving}
              className="h-9 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted disabled:opacity-50">
              Cancelar
            </button>
            <button onClick={handleSave} disabled={saving}
              className="h-9 px-4 rounded-md bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
              {saving ? 'Guardando…' : 'Registrar venta'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
