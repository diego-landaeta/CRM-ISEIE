import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, FloppyDisk, MagnifyingGlass, User, Buildings, Money } from '@phosphor-icons/react';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import client from '@/shared/api/client';
import { CURRENCIES } from '../currencies';
import { invoicesApi } from '../api/invoices.api';
import type { Issuer, InvoiceItem } from '../api/invoices.api';
import { conversionsApi, type Conversion } from '@/modules/conversions/api/conversions.api';
import { toast } from '@/shared/hooks/useToast';

type Tipo = 'persona' | 'empresa' | 'contado';
interface LeadHit { id: number; nombre: string; email?: string | null; telefono?: string | null }

export default function InvoiceCreatePage() {
  const { activeProject, projects } = useProjectContext() as {
    activeProject: { id?: number; nombre?: string; sociedad_emisora_id?: number | null };
    projects: Array<{ id: number; nombre: string; sociedad_emisora_id?: number | null }>;
  };
  // Proyecto de la factura: se puede cambiar aquí sin salir del formulario. Manda
  // sobre TODO (cliente/leads, catálogo de cursos, emisores, régimen fiscal).
  // Solo se ofrecen proyectos de la MISMA sociedad emisora (no se factura cruzado).
  const [projectId, setProjectId] = useState<number | null>(null);
  useEffect(() => {
    if (activeProject?.id && activeProject.id !== -1) setProjectId((p) => p ?? activeProject.id!);
  }, [activeProject?.id]);
  const pid = projectId ?? undefined;
  const socActual = (projects || []).find((p) => p.id === projectId)?.sociedad_emisora_id
    ?? activeProject?.sociedad_emisora_id ?? null;
  const projectOptions = (projects || []).filter((p) =>
    socActual == null ? true : p.sociedad_emisora_id === socActual);
  const { user } = useAuth() as { user: { role?: string; editar_fechas_factura?: boolean } | null };
  // Cambiar fechas de la factura: admins o permiso acotado editar_fechas_factura.
  const puedeFechas = user?.role === 'admin' || user?.role === 'superadmin' || !!user?.editar_fechas_factura;
  const navigate = useNavigate();
  const loc = useLocation();
  const invBase = loc.pathname.split('/facturas')[0];

  // Documento: factura (fiscal), proforma (presupuesto) o rectificativa (abono).
  // Deep-link ?tipo=proforma | ?tipo=rectificativa.
  const initTipo = new URLSearchParams(loc.search).get('tipo');
  const [docTipo, setDocTipo] = useState<'factura' | 'proforma' | 'rectificativa'>(
    initTipo === 'proforma' ? 'proforma' : initTipo === 'rectificativa' ? 'rectificativa' : 'factura'
  );
  const esProforma = docTipo === 'proforma';
  const esRect = docTipo === 'rectificativa';
  // Modo EDICIÓN (solo admin/superadmin): ?editId=X. Sirve tanto para borradores
  // como para CORREGIR una factura ya emitida/pagada (IVA, datos, concepto).
  const editId = new URLSearchParams(loc.search).get('editId');
  const [editEstado, setEditEstado] = useState<string | null>(null);
  // Fechas de la factura (emisión y pago). Se editan aquí mismo, en el panel.
  // Solo para admins o usuarias con el permiso editar_fechas_factura.
  const [fechaEmision, setFechaEmision] = useState('');
  const [fechaPago, setFechaPago] = useState('');
  const [fechasIniciales, setFechasIniciales] = useState({ emision: '', pago: '' });

  const [tipo, setTipo] = useState<Tipo>('persona');
  const [leadId, setLeadId] = useState<number | null>(null);
  // Asociar el documento a una VENTA (conversión) del cliente — p. ej. una proforma
  // de una conversión pendiente de pago inicial. La factura queda ligada a esa venta.
  const [leadConvs, setLeadConvs] = useState<Conversion[]>([]);
  const [assocConvId, setAssocConvId] = useState<number | ''>('');
  // Aviso antes de emitir un documento SIN venta asociada: si no, nacia suelto y no
  // aparecia en la ficha del cliente (el panel busca los documentos DE la venta).
  const [avisoVenta, setAvisoVenta] = useState(false);

  // Buscador de cliente
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<LeadHit[]>([]);
  const [openHits, setOpenHits] = useState(false);
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Datos cliente
  const [nombre, setNombre] = useState('');
  const [nif, setNif] = useState('');
  const [direccion, setDireccion] = useState('');
  const [ciudad, setCiudad] = useState('');
  const [cp, setCp] = useState('');
  const [pais, setPais] = useState('España');
  const [email, setEmail] = useState('');
  const [telefono, setTelefono] = useState('');
  // VIES: para empresa de la UE (no España), marca si su NIF-IVA está validado en VIES
  // → el motor fiscal aplica exención intracomunitaria (B2B, IVA 0%).
  const [viesOk, setViesOk] = useState(false);

  // IVA / conceptos / pago / emisor
  const [llevaIva, setLlevaIva] = useState(true);
  const [ivaIncluido, setIvaIncluido] = useState(false);
  const [items, setItems] = useState<InvoiceItem[]>([{ descripcion: '', cantidad: 1, precio_unitario: 0 }]);
  const [metodoPago, setMetodoPago] = useState<'transferencia' | 'tarjeta' | 'tarjeta_stripe' | 'efectivo' | 'bizum' | 'fraccionado' | 'otro'>('transferencia');
  const [moneda, setMoneda] = useState('EUR');
  // Doble moneda: importe total en EUROS tecleado a mano (obligatorio si moneda != EUR).
  const [totalEur, setTotalEur] = useState(''); // divisa de la factura (importes manuales, sin conversión)
  const [piePago, setPiePago] = useState('');
  const [notas, setNotas] = useState('');
  const [issuers, setIssuers] = useState<Issuer[]>([]);
  const [issuerId, setIssuerId] = useState<number | null>(null);
  const [regimenes, setRegimenes] = useState<import('../api/invoices.api').FiscalRegimen[]>([]);
  const [regimenId, setRegimenId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  // ── Abono / rectificativa: elegir factura original + motivo (+ importe parcial) ──
  const [rectList, setRectList] = useState<import('../api/invoices.api').Invoice[]>([]);
  const [rectOriginalId, setRectOriginalId] = useState<number | null>(null);
  const [rectMotivo, setRectMotivo] = useState('');
  const [rectParcial, setRectParcial] = useState('');
  // Catálogo de cursos/productos para el selector de conceptos (facturamos cursos).
  const [products, setProducts] = useState<Array<{ id: number; nombre: string; precio: number | string | null }>>([]);

  useEffect(() => {
    if (!pid) return;
    invoicesApi.getConfig(pid).then((res) => {
      if (res.success && res.data) {
        if (res.data.factura_pie_default) setPiePago(res.data.factura_pie_default);
        if (res.data.factura_metodo_default) setMetodoPago(res.data.factura_metodo_default as 'transferencia');
      }
    }).catch(() => {});
    invoicesApi.listIssuers(pid).then((res) => {
      if (res.success && res.data) {
        setIssuers(res.data);
        const def = res.data.find((i) => i.es_default) || res.data[0];
        if (def) setIssuerId(def.id);
      }
    }).catch(() => {});
    invoicesApi.listRegimenes(pid).then((res) => { if (res.success) setRegimenes(res.data || []); }).catch(() => {});
    // Catálogo de cursos del proyecto para el selector de conceptos.
    client.get<Array<{ id: number; nombre: string; precio: number | string | null }>>(`/products?projectId=${pid}&limit=1000`)
      .then((res) => { if (res.success) setProducts(res.data || []); }).catch(() => {});
  }, [pid]);

  const regimenSel = regimenes.find((r) => r.id === regimenId) || null;
  const [regimenAuto, setRegimenAuto] = useState(true);
  // Al elegir régimen A MANO: fija si lleva IVA y desactiva el motor automático.
  function pickRegimen(id: number | null) {
    setRegimenId(id);
    setRegimenAuto(false);
    const r = regimenes.find((x) => x.id === id);
    if (r) setLlevaIva(r.aplica_iva);
  }

  // MOTOR FISCAL (REQ-FIS-02): al cambiar país / CP / tipo de cliente, resuelve el
  // régimen aplicable (Canarias / UE B2B-VIES / B2C / fuera UE / España) y lo
  // autoselecciona — salvo que el usuario lo haya elegido a mano.
  useEffect(() => {
    if (!pid || !regimenAuto || regimenes.length === 0) return;
    const clienteTipo = tipo === 'empresa' ? 'empresa' : 'particular';
    let cancel = false;
    invoicesApi.resolveRegimen(pid, { pais, cp, tipo: clienteTipo, vies: viesOk }).then((res) => {
      if (cancel || !res.success || !res.data?.regimen) return;
      const r = regimenes.find((x) => x.id === res.data.regimen!.id) || res.data.regimen!;
      setRegimenId(r.id);
      setLlevaIva(r.aplica_iva);
    }).catch(() => {});
    return () => { cancel = true; };
  }, [pid, pais, cp, tipo, regimenes, regimenAuto, viesOk]);

  // Buscar leads (debounce)
  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current);
    if (!pid || search.trim().length < 2) { setHits([]); return; }
    searchRef.current = setTimeout(async () => {
      try {
        const res = await client.get<LeadHit[]>(`/leads?projectId=${pid}&search=${encodeURIComponent(search.trim())}&limit=8`);
        if (res.success) { setHits(res.data || []); setOpenHits(true); }
      } catch { /* ignore */ }
    }, 250);
  }, [search, pid]);

  // Al elegir/prefijar un cliente, traer sus ventas (para poder asociar el documento).
  useEffect(() => {
    if (!leadId || editId) { setLeadConvs([]); setAssocConvId(''); return; }
    let alive = true;
    conversionsApi.byLead(leadId).then((r) => {
      if (!alive) return;
      const list = (r.success ? (r.data as Conversion[]) : []) || [];
      setLeadConvs(list);
      // Preselecciona automáticamente si solo hay una venta pendiente de pago.
      const pend = list.filter((c) => Number(c.importe_pagado) < Number(c.importe_total));
      setAssocConvId(pend.length === 1 ? pend[0].id : '');
    }).catch(() => setLeadConvs([]));
    return () => { alive = false; };
  }, [leadId, editId]);

  async function pickLead(l: LeadHit) {
    setLeadId(l.id);
    setNombre(l.nombre);
    setSearch(l.nombre);
    setOpenHits(false);
    // Traer datos fiscales completos del lead
    try {
      const res = await invoicesApi.leadFiscalData(l.id);
      if (res.success && res.data) {
        const d = res.data;
        setNif(d.identificacion_fiscal || '');
        setDireccion(d.direccion_fiscal || '');
        setCiudad(d.ciudad_fiscal || '');
        setCp(d.codigo_postal_fiscal || '');
        setPais(d.pais_fiscal || 'España');
        setEmail(d.email || '');
        setTelefono(d.telefono || '');
        if (d.pais_fiscal && !d.pais_fiscal.toLowerCase().match(/españa|espana|spain|^es$/)) setLlevaIva(false);
        // Traer los cursos contratados (conversiones) como conceptos + importe.
        const convs = d.conversiones || [];
        if (convs.length) {
          setItems(convs.map((c) => ({
            descripcion: `Producto/servicio: servicio académico, ${c.producto_contratado || c.producto_nombre || 'programa'}`,
            cantidad: 1,
            precio_unitario: Number(c.importe_total ?? c.producto_precio ?? 0) || 0,
          })));
          // Método de pago de la conversión, si encaja con los válidos de factura.
          const MP = ['transferencia', 'tarjeta', 'tarjeta_stripe', 'efectivo', 'bizum', 'fraccionado', 'otro'];
          const mp = convs[0]?.metodo_pago;
          if (mp && MP.includes(mp)) setMetodoPago(mp as typeof metodoPago);
        }
      }
    } catch { /* ignore */ }
  }

  const missing: string[] = [];
  if (tipo !== 'contado') {
    if (!nombre.trim()) missing.push(tipo === 'empresa' ? 'Razón social' : 'Nombre');
    // En proforma (presupuesto) el NIF/DNI no es obligatorio.
    if (!esProforma && !nif.trim()) missing.push(tipo === 'empresa' ? 'NIF/CIF' : 'DNI/NIF');
  }
  if (!items.some((it) => it.descripcion.trim() && Number(it.precio_unitario) > 0)) missing.push('Al menos un concepto con precio');

  // Suma de conceptos: en la divisa elegida (o en euros si la factura es en EUR).
  // Símbolo de la divisa elegida: los conceptos se teclean en ESA moneda, así que
  // enseñar siempre el € confundía (parecía que la factura iba en euros).
  const simboloMoneda = (CURRENCIES.find((x) => x.code === moneda)?.symbol) || moneda;
  const totalConceptos = items.reduce((sum, it) => sum + (Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0), 0);

  async function generar(saltarAvisoVenta = false) {
    // Documento nuevo para un cliente pero sin venta elegida -> se avisa primero.
    if (!saltarAvisoVenta && !editId && leadId && !assocConvId) { setAvisoVenta(true); return; }
    if (moneda !== 'EUR' && !(Number(totalEur) > 0)) {
      toast({ title: 'Falta el importe en euros', description: `La factura va en ${moneda}: indica el total en euros (es el que cuenta para la contabilidad).`, variant: 'destructive' });
      return;
    }
    if (!pid) return;
    if (missing.length) { toast({ title: 'Faltan datos', description: missing.join(' · '), variant: 'destructive' }); return; }
    setSaving(true);
    try {
      const cNombre = tipo === 'contado' ? (nombre.trim() || 'Consumidor final') : nombre.trim();
      // Proforma: NIF opcional (no forzamos placeholder, el back rellena si falta).
      const cNif = tipo === 'contado' ? (nif.trim() || '—') : (nif.trim() || (esProforma ? '' : '—'));
      const body = {
        projectId: pid, leadId: leadId || undefined, issuerId: issuerId || undefined,
        conversionId: assocConvId ? Number(assocConvId) : undefined,
        tipo: esProforma ? ('proforma' as const) : undefined,
        clienteNombre: cNombre, clienteNif: cNif,
        // Empresa o persona: decide el rotulo del PDF ("RAZON SOCIAL" o
        // "NOMBRE Y APELLIDO"). Al contado se factura a un particular.
        clienteTipo: tipo === 'empresa' ? 'empresa' : 'particular',
        clienteDireccion: direccion.trim(), clienteCiudad: ciudad.trim(), clienteCp: cp.trim(), clientePais: pais.trim() || 'España',
        clienteEmail: email.trim() || null, clienteTelefono: telefono.trim() || null,
        items: items.filter((it) => it.descripcion.trim()),
        ivaPct: regimenSel ? Number(regimenSel.iva_pct) : (llevaIva ? 21 : 0),
        ivaIncluido: ivaIncluido && llevaIva,
        leyendaIva: regimenSel?.coletilla || null,
        notas: notas.trim() || undefined, metodoPago, piePago: piePago.trim() || undefined,
        moneda: moneda !== 'EUR' ? moneda : undefined,
      totalEur: moneda !== 'EUR' ? Number(totalEur || 0) : undefined,
      };
      // Edición (admin/superadmin): si la factura ya está emitida/pagada se CORRIGE
      // (mantiene su número fiscal); si es borrador, PATCH normal; si no, crear.
      const esCorreccion = !!editId && !!editEstado && editEstado !== 'borrador';
      const res = editId
        ? (esCorreccion
            ? await invoicesApi.corregir(Number(editId), { ...body, exento: !llevaIva })
            : await invoicesApi.update(Number(editId), body))
        : await invoicesApi.create(body);
      // Fechas: van por su endpoint (respeta el permiso editar_fechas_factura) y
      // solo si de verdad cambiaron.
      if (res.success && editId && puedeFechas
          && (fechaEmision !== fechasIniciales.emision || fechaPago !== fechasIniciales.pago)) {
        try {
          await invoicesApi.updateFechas(Number(editId), {
            ...(fechaEmision && fechaEmision !== fechasIniciales.emision ? { fechaEmision } : {}),
            ...(fechaPago && fechaPago !== fechasIniciales.pago ? { fechaPago } : {}),
          });
        } catch { toast({ title: 'La factura se guardó, pero no se pudieron cambiar las fechas', variant: 'destructive' }); }
      }
      if (res.success && res.data) {
        toast({ title: esCorreccion ? '✓ Factura corregida' : editId ? '✓ Borrador guardado' : (esProforma ? '✓ Presupuesto generado' : '✓ Factura emitida'), description: res.data.codigo || '' });
        invoicesApi.openPdf(res.data.id, true).catch(() => {});
        navigate(`${invBase}/facturas${esProforma ? '?tab=proformas' : ''}`);
      } else {
        toast({ title: 'Error', description: (res as { error?: string }).error, variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e?.data?.error || e?.message, variant: 'destructive' });
    } finally { setSaving(false); }
  }

  // Prefill desde la ficha del prospecto: ?leadId=X (típicamente con ?tipo=proforma).
  // Trae el cliente y sus cursos contratados como conceptos, listo para emitir.
  const prefillLeadId = new URLSearchParams(loc.search).get('leadId');
  useEffect(() => {
    if (!pid || !prefillLeadId) return;
    const lid = Number(prefillLeadId);
    if (!lid) return;
    invoicesApi.leadFiscalData(lid).then((res) => {
      if (res.success && res.data) pickLead({ id: lid, nombre: res.data.nombre || '', email: res.data.email, telefono: res.data.telefono });
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, prefillLeadId]);

  // Al cambiar de proyecto, el cliente elegido ya no aplica (pertenece a otro).
  const prevPidRef = useRef<number | null>(null);
  useEffect(() => {
    if (prevPidRef.current != null && prevPidRef.current !== projectId) {
      setLeadId(null); setHits([]); setOpenHits(false);
    }
    prevPidRef.current = projectId;
  }, [projectId]);

  // Modo edición: cargar el borrador y precargar todos los campos del formulario.
  useEffect(() => {
    if (!editId) return;
    invoicesApi.getOne(Number(editId)).then((res) => {
      if (!res.success || !res.data) return;
      const f = res.data as import('../api/invoices.api').Invoice;
      setEditEstado(f.estado || null);
        const d10 = (v?: string | null) => (v ? String(v).slice(0, 10) : '');
        setFechaEmision(d10(f.fecha_emision));
        setFechaPago(d10(f.fecha_pago));
        setFechasIniciales({ emision: d10(f.fecha_emision), pago: d10(f.fecha_pago) });
      setDocTipo(f.tipo === 'proforma' ? 'proforma' : 'factura');
      const noVal = (v?: string | null) => !v || v === '—';
      setTipo(f.cliente_tipo === 'empresa' ? 'empresa' : 'persona');
      setNombre(f.cliente_nombre === '(por completar)' ? '' : (f.cliente_nombre || ''));
      setNif(noVal(f.cliente_nif) ? '' : (f.cliente_nif || ''));
      setDireccion(noVal(f.cliente_direccion) ? '' : (f.cliente_direccion || ''));
      setCiudad(noVal(f.cliente_ciudad) ? '' : (f.cliente_ciudad || ''));
      setCp(noVal(f.cliente_cp) ? '' : (f.cliente_cp || ''));
      setPais(f.cliente_pais || 'España');
      setEmail(f.cliente_email || '');
      setTelefono(f.cliente_telefono || '');
      setLlevaIva(Number(f.iva_pct) > 0);
      setIvaIncluido(!!f.iva_incluido);
      if (Array.isArray(f.items) && f.items.length) setItems(f.items.map((it) => ({ descripcion: it.descripcion, cantidad: Number(it.cantidad) || 1, precio_unitario: Number(it.precio_unitario) || 0 })));
      if (f.metodo_pago) setMetodoPago(f.metodo_pago as typeof metodoPago);
      if (f.moneda) setMoneda(f.moneda);
        if (f.total_divisa != null) setTotalEur(String(f.total ?? ''));
      if (f.notas) setNotas(f.notas);
      if (f.issuer_id) setIssuerId(f.issuer_id);
      if (f.project_id) setProjectId(f.project_id);
      setRegimenAuto(false); // en edición no pisar el IVA con el motor automático
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  // Cargar facturas rectificables de la sociedad emisora (normales, ya emitidas).
  useEffect(() => {
    if (!esRect || !issuerId) { setRectList([]); return; }
    invoicesApi.list({ issuerId, limit: 200 }).then((r) => {
      if (r.success) setRectList((r.data || []).filter((i) =>
      // Las proformas TAMBIEN se rectifican: llevan numero y salen emitidas, asi
      // que si una se manda mal hay que poder abonarla. Solo quedan fuera las
      // rectificativas —no se rectifica un abono— y lo que aun es borrador o ya
      // esta cancelado.
        i.tipo !== 'rectificativa' && i.estado !== 'borrador' && i.estado !== 'cancelada'));
    }).catch(() => {});
  }, [esRect, issuerId]);

  const rectOrig = rectList.find((i) => i.id === rectOriginalId) || null;

  async function emitirAbono() {
    if (!rectOriginalId) { toast({ title: 'Elige la factura a rectificar', variant: 'destructive' }); return; }
    if (!rectMotivo.trim()) { toast({ title: 'Indica el motivo del abono', variant: 'destructive' }); return; }
    const parcialNum = rectParcial.trim() ? Number(rectParcial) : null;
    if (parcialNum != null && (!(parcialNum > 0) || (rectOrig && parcialNum > Number(rectOrig.total)))) {
      toast({ title: 'Importe parcial inválido', description: 'Debe ser mayor que 0 y no superar el total de la factura.', variant: 'destructive' }); return;
    }
    setSaving(true);
    try {
      const res = await invoicesApi.rectificar(rectOriginalId, { motivo: rectMotivo.trim(), parcial: parcialNum, issuerId: issuerId || undefined });
      if (res.success && res.data) {
        toast({ title: '✓ Abono emitido', description: res.data.codigo });
        invoicesApi.openPdf(res.data.id).catch((e: unknown) => toast({ title: 'No se pudo abrir el PDF', description: (e as { message?: string })?.message, variant: 'destructive' }));
        navigate(`${invBase}/facturas`);
      } else {
        toast({ title: 'Error', description: (res as { error?: string }).error, variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e?.data?.error || e?.message, variant: 'destructive' });
    } finally { setSaving(false); }
  }

  if (!pid) return <div className="p-8 text-muted-foreground">Selecciona un proyecto.</div>;

  const TIPOS: { key: Tipo; label: string; desc: string; icon: any }[] = [
    { key: 'persona', label: 'Persona física', desc: 'Cliente individual con DNI', icon: User },
    { key: 'empresa', label: 'Empresa', desc: 'Razón social + NIF', icon: Buildings },
    { key: 'contado', label: 'Contado', desc: 'Sin datos de cliente', icon: Money },
  ];

  // Gating fiscal España: se PERMITE emitir aunque falte el NIF/datos (aviso
  // informativo). SOLO se bloquea si el CIF/NIF puesto es inválido (typo).
  const selectedIssuer = issuers.find((i) => i.id === issuerId);
  const fs = selectedIssuer?.fiscal_status;
  const fiscalBlock = fs ? !fs.ready : false;
  const fiscalMissing = fs && fs.missing.length ? fs.missing : null;

  return (
    <div className="space-y-4 pb-8 max-w-4xl">
      <PageHeader title={editId ? 'Editar factura' : esRect ? 'Nuevo abono' : esProforma ? 'Nuevo presupuesto' : 'Nueva factura'} subtitle={activeProject?.nombre || ''}
        actions={(
          <Link to={`${invBase}/facturas`} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted">
            <ArrowLeft size={14} weight="bold" /> Volver
          </Link>
        )}
      />

      {/* Tipo de documento: factura fiscal vs proforma (presupuesto).
          En EDICIÓN el tipo es FIJO (no se puede convertir una factura emitida en
          proforma al editarla); solo se muestra como etiqueta. */}
      <div className="inline-flex rounded-lg border border-border bg-muted/30 p-1 text-sm font-semibold">
        {editId ? (
          <span className="px-4 h-8 inline-flex items-center rounded-md bg-primary text-primary-foreground shadow">
            {esProforma ? 'Proforma' : esRect ? 'Abono' : 'Factura'}
          </span>
        ) : ([['factura', 'Factura'], ['proforma', 'Proforma'], ['rectificativa', 'Abono']] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setDocTipo(k)}
            className={`px-4 h-8 rounded-md transition ${docTipo === k ? 'bg-primary text-primary-foreground shadow' : 'text-muted-foreground hover:text-foreground'}`}>
            {label}
          </button>
        ))}
        <span className="self-center pl-3 pr-1 text-[11px] font-normal text-muted-foreground">
          {editId ? 'El tipo no se cambia al editar una factura ya emitida'
            : esRect ? 'Factura rectificativa (abono) · importe negativo · serie R'
            : esProforma ? 'Proforma sin validez fiscal · serie propia (PRO)'
            : 'Documento fiscal con numeración correlativa'}
        </span>
      </div>

      {/* Proyecto de la factura — manda sobre cliente/leads, cursos y emisores */}
      {projectOptions.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <label className="text-xs font-bold uppercase text-muted-foreground">Proyecto</label>
          <select value={projectId ?? ''} onChange={(e) => setProjectId(Number(e.target.value))}
            className="w-full h-9 px-2 mt-1 rounded border border-primary/40 bg-background text-foreground text-sm font-medium [&>option]:bg-background [&>option]:text-foreground">
            {projectOptions.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          <p className="text-[10px] text-muted-foreground mt-1">
            Los clientes, cursos y empresas emisoras se filtran por este proyecto. Solo se listan
            proyectos de la misma sociedad (no se factura cruzado entre sociedades).
          </p>
        </div>
      )}

      {/* Emisor */}
      {issuers.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <label className="text-xs font-bold uppercase text-muted-foreground">Empresa que emite</label>
          <select value={issuerId ?? ''} onChange={(e) => setIssuerId(Number(e.target.value))}
            className="w-full h-9 px-2 mt-1 rounded border border-primary/40 bg-background text-foreground text-sm font-medium [&>option]:bg-background [&>option]:text-foreground">
            {/* Con alias se enseña el alias: dos emisoras pueden compartir razón
                social y NIF —misma sociedad, distinto logo— y así se distinguen.
                En la factura siempre sale la razón social real. */}
            {issuers.map((iss) => <option key={iss.id} value={iss.id}>{iss.alias || iss.razon_social} — {iss.nif}{iss.serie ? ` · serie ${iss.serie}` : ''}{iss.es_default ? ' (por defecto)' : ''}</option>)}
          </select>
          {fiscalMissing && !esProforma && (
            <div className={`mt-2 flex items-start gap-2 rounded-md px-3 py-2 text-xs border ${fiscalBlock ? 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400' : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400'}`}>
              <span className="font-bold">{fiscalBlock ? '⛔' : '⚠'}</span>
              {fiscalBlock ? (
                <span><b>No se puede emitir</b>: el CIF/NIF de la sociedad no tiene formato válido para España. Corrígelo en <b>Empresas emisoras</b>.</span>
              ) : (
                <span>Aviso: faltan datos ({fiscalMissing.join(', ')}). <b>Se puede emitir igual</b>; en esta factura se guardarán en blanco. Al ponerlos luego, las facturas ya emitidas no cambian.</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── ABONO / RECTIFICATIVA: elegir factura original + motivo ── */}
      {esRect && (
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <div>
            <label className="text-xs font-bold uppercase text-muted-foreground">Factura a rectificar</label>
            <p className="text-[11px] text-muted-foreground">El abono copia los datos de la factura original en negativo. Elige de esta sociedad emisora.</p>
            <select value={rectOriginalId ?? ''} onChange={(e) => setRectOriginalId(e.target.value ? Number(e.target.value) : null)}
              className="w-full h-9 px-2 mt-1 rounded border border-primary/40 bg-background text-foreground text-sm [&>option]:bg-background [&>option]:text-foreground">
              <option value="">— elegir factura —</option>
              {rectList.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.codigo} · {i.cliente_nombre} · {new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(i.total))}
                </option>
              ))}
            </select>
            {rectList.length === 0 && <p className="text-[11px] text-amber-600 mt-1">No hay facturas rectificables en esta sociedad.</p>}
          </div>
          {rectOrig && (
            <div className="text-xs rounded-md border border-border bg-muted/30 px-3 py-2">
              Rectificando <strong>{rectOrig.codigo}</strong> — {rectOrig.cliente_nombre} · total {new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(rectOrig.total))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-[11px] text-muted-foreground">Motivo del abono <span className="text-red-500">*</span></label>
              <textarea value={rectMotivo} onChange={(e) => setRectMotivo(e.target.value)} rows={2}
                placeholder="Ej: anulación por error, devolución, corrección de importe…"
                className={`w-full px-2 py-1.5 rounded border bg-background text-sm ${!rectMotivo.trim() ? 'border-red-300' : 'border-border'}`} />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Importe a rectificar (opcional)</label>
              <input type="number" step="0.01" value={rectParcial} onChange={(e) => setRectParcial(e.target.value)}
                placeholder={rectOrig ? `Total: ${Number(rectOrig.total)}` : 'Vacío = total'}
                className="w-full h-9 px-2 rounded border border-border bg-background text-sm" />
              <p className="text-[10px] text-muted-foreground mt-0.5">Vacío = abono total. Rellena solo para un abono parcial.</p>
            </div>
          </div>
        </div>
      )}

      {/* Tipo */}
      {!esRect && (<>
      <div className="grid grid-cols-3 gap-3">
        {TIPOS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTipo(t.key)}
              className={`text-left border rounded-lg p-3 transition ${tipo === t.key ? 'border-primary ring-2 ring-primary/20 bg-primary/5' : 'border-border hover:bg-muted'}`}>
              <Icon size={18} weight="bold" className={tipo === t.key ? 'text-primary' : 'text-muted-foreground'} />
              <div className="font-semibold text-sm mt-1">{t.label}</div>
              <div className="text-[11px] text-muted-foreground">{t.desc}</div>
            </button>
          );
        })}
      </div>

      {/* Cliente */}
      {tipo !== 'contado' && (
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <div>
            <label className="text-xs font-bold uppercase text-muted-foreground">Cliente</label>
            <p className="text-[11px] text-muted-foreground">Buscá por nombre/email para traer sus datos; lo que falte lo completás abajo.</p>
            <div className="relative mt-1">
              <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(e) => { setSearch(e.target.value); setLeadId(null); }} onFocus={() => hits.length && setOpenHits(true)}
                placeholder="Buscar cliente o escribir nombre nuevo…" className="w-full h-9 pl-8 pr-3 rounded border border-border bg-background text-sm" />
              {openHits && hits.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-card border border-border rounded-md shadow-lg max-h-56 overflow-auto">
                  {hits.map((h) => (
                    <button key={h.id} onClick={() => pickLead(h)} className="block w-full text-left px-3 py-2 text-sm hover:bg-muted">
                      {h.nombre}{h.email ? <span className="text-muted-foreground"> · {h.email}</span> : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Asociar el documento a una venta del cliente (p. ej. proforma de una
              conversión pendiente de pago). El concepto se escribe libre abajo. */}
          {!editId && leadId && leadConvs.length > 0 && (
            <div className="mb-3">
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Asociar a venta del cliente (opcional)</label>
              <select value={assocConvId} onChange={(e) => setAssocConvId(e.target.value ? Number(e.target.value) : '')}
                className="w-full h-9 px-2 rounded border border-border bg-background text-sm">
                <option value="">— Sin asociar (documento suelto) —</option>
                {leadConvs.map((c) => {
                  const pend = Number(c.importe_total) - Number(c.importe_pagado);
                  return (
                    <option key={c.id} value={c.id}>
                      {c.producto_contratado} · pendiente {pend.toFixed(2)}€{Number(c.importe_pagado) <= 0 ? ' (sin pago)' : ''}
                    </option>
                  );
                })}
              </select>
              <p className="text-[10px] text-muted-foreground mt-0.5">Queda ligada a esa venta y sus pagos; el concepto de la factura puede ser distinto al del producto.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label={tipo === 'empresa' ? 'Razón social' : 'Nombre y apellido'} value={nombre} onChange={(v) => { setNombre(v); if (v !== search) setSearch(v); }} required />
            <Field label={tipo === 'empresa' ? 'NIF / CIF' : 'DNI / NIF'} value={nif} onChange={setNif} required />
            <Field label="Dirección" value={direccion} onChange={setDireccion} full />
            <Field label="Ciudad" value={ciudad} onChange={setCiudad} />
            <Field label="Código postal" value={cp} onChange={setCp} />
            <Field label="País" value={pais} onChange={(v) => { setPais(v); setLlevaIva(!!v.toLowerCase().match(/españa|espana|spain|^es$/)); }} />
            <Field label="Email (opcional)" value={email} onChange={setEmail} />
            <Field label="Teléfono (opcional)" value={telefono} onChange={setTelefono} />
          </div>
          {tipo === 'empresa' && !pais.toLowerCase().match(/españa|espana|spain|^es$/) && (
            <label className="flex items-start gap-2 mt-3 p-2.5 rounded-md border border-border bg-muted/20 cursor-pointer">
              <input type="checkbox" checked={viesOk} onChange={(e) => setViesOk(e.target.checked)} className="mt-0.5" />
              <span className="text-xs text-muted-foreground">
                <b className="text-foreground">NIF-IVA validado en VIES</b> — empresa intracomunitaria con VAT válido.
                Aplica <b>exención intracomunitaria (IVA 0%)</b>. Marca solo si has verificado el NIF-IVA en VIES;
                si no, se factura como B2C con IVA.
              </span>
            </label>
          )}
        </div>
      )}

      {/* Conceptos */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-2">
        <label className="text-xs font-bold uppercase text-muted-foreground">Conceptos</label>
        {/* Cabecera de columnas para que se entienda qué es cada campo. */}
        <div className="grid grid-cols-12 gap-2 items-center px-0.5">
          <span className="col-span-6 text-[10px] font-semibold uppercase text-muted-foreground">Concepto</span>
          <span className="col-span-2 text-[10px] font-semibold uppercase text-muted-foreground text-center">Cantidad</span>
          <span className="col-span-2 text-[10px] font-semibold uppercase text-muted-foreground text-right">Precio unit.</span>
          <span className="col-span-2 text-[10px] font-semibold uppercase text-muted-foreground text-right">Subtotal</span>
        </div>
        {items.map((it, idx) => {
          const subtotal = (Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0);
          return (
          <div key={idx} className="grid grid-cols-12 gap-2 items-center">
            <input value={it.descripcion} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, descripcion: e.target.value } : x))} placeholder="Ej: Producto/servicio: servicio académico, [programa]" className="col-span-6 h-9 px-2 rounded border border-border bg-background text-sm" />
            <input type="number" min="1" value={it.cantidad} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, cantidad: Number(e.target.value) } : x))} placeholder="1" className="col-span-2 h-9 px-2 rounded border border-border bg-background text-sm text-center" />
            <div className="col-span-2 relative">
              <input type="number" step="0.01" min="0" value={it.precio_unitario} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, precio_unitario: Number(e.target.value) } : x))} placeholder="0,00" className="w-full h-9 pl-2 pr-5 rounded border border-border bg-background text-sm text-right" />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">{simboloMoneda}</span>
            </div>
            <span className="col-span-1 text-sm text-right tabular-nums font-medium">{subtotal.toFixed(2)}&nbsp;{simboloMoneda}</span>
            <button onClick={() => setItems(items.length > 1 ? items.filter((_, i) => i !== idx) : items)} title="Quitar línea" className="col-span-1 text-muted-foreground hover:text-red-500 text-lg leading-none">×</button>
          </div>
          );
        })}
        {/* Total de conceptos (suma de subtotales). El IVA se aplica más abajo. */}
        <div className="flex justify-end pt-1 border-t border-border mt-1">
          <span className="text-sm font-bold tabular-nums">Total conceptos: {items.reduce((s, it) => s + (Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0), 0).toFixed(2)} {simboloMoneda}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button onClick={() => setItems([...items, { descripcion: '', cantidad: 1, precio_unitario: 0 }])} className="text-xs text-primary hover:underline">+ añadir concepto</button>
          {products.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">o añade un curso:</span>
              <select
                value=""
                onChange={(e) => {
                  const p = products.find((x) => String(x.id) === e.target.value);
                  if (!p) return;
                  const line = { descripcion: `Producto/servicio: servicio académico, ${p.nombre}`, cantidad: 1, precio_unitario: Number(p.precio ?? 0) || 0 };
                  // Si la única fila está vacía, la reemplaza; si no, añade.
                  setItems((prev) => (prev.length === 1 && !prev[0].descripcion.trim() && !Number(prev[0].precio_unitario))
                    ? [line] : [...prev, line]);
                  e.target.value = '';
                }}
                className="h-8 px-2 rounded border border-border bg-background text-xs max-w-[280px]"
              >
                <option value="">— elegir del catálogo —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.nombre}{p.precio ? ` · ${Number(p.precio)}€` : ''}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* IVA + Pago */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-card border border-border rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase text-muted-foreground">IVA / Régimen fiscal</label>
            {regimenSel && (
              regimenAuto
                ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary" title="Resuelto por el motor fiscal según país, CP y tipo de cliente">🤖 automático</span>
                : <button type="button" onClick={() => setRegimenAuto(true)} className="text-[10px] font-semibold text-primary hover:underline">↺ automático</button>
            )}
          </div>
          {regimenes.length > 0 && (
            <select value={regimenId ?? ''} onChange={(e) => pickRegimen(e.target.value ? Number(e.target.value) : null)}
              className="w-full h-9 px-2 rounded border border-border bg-background text-foreground text-sm [&>option]:bg-background [&>option]:text-foreground">
              <option value="">Manual (elegir IVA abajo)</option>
              {regimenes.map((r) => <option key={r.id} value={r.id}>{r.nombre} — {r.aplica_iva ? `${Number(r.iva_pct)}% IVA` : 'sin IVA'}</option>)}
            </select>
          )}
          {!regimenSel && (
            <>
              <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={llevaIva} onChange={(e) => setLlevaIva(e.target.checked)} /> Lleva IVA (21%)</label>
              {!llevaIva && <p className="text-[11px] text-muted-foreground">Operación exenta de IVA.</p>}
            </>
          )}
          {llevaIva && <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={ivaIncluido} onChange={(e) => setIvaIncluido(e.target.checked)} /> El precio ya incluye IVA</label>}
          {regimenSel?.coletilla && <p className="text-[10px] text-muted-foreground border-t border-border/60 pt-1 mt-1">📎 Coletilla: <i>{regimenSel.coletilla}</i></p>}
        </div>
        <div className="bg-card border border-border rounded-lg p-4 space-y-2">
          <label className="text-xs font-bold uppercase text-muted-foreground">Pago</label>
          <select value={metodoPago} onChange={(e) => setMetodoPago(e.target.value as 'transferencia')} className="w-full h-9 px-2 rounded border border-border bg-background text-sm">
            <option value="transferencia">Transferencia bancaria</option><option value="tarjeta">Tarjeta</option><option value="tarjeta_stripe">Tarjeta (Stripe)</option>
            <option value="efectivo">Efectivo</option><option value="bizum">Bizum</option><option value="paypal">PayPal</option><option value="fraccionado">Fraccionado</option><option value="otro">Otro</option>
          </select>
          <div>
            <label className="text-[11px] text-muted-foreground">Moneda</label>
            <select value={moneda} onChange={(e) => setMoneda(e.target.value)} className="w-full h-9 px-2 rounded border border-border bg-background text-sm">
              {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.label}</option>)}
            </select>
          </div>
          {/* Doble moneda: al facturar en divisa, el importe en EUROS es obligatorio.
              Es el que manda en la contabilidad; la divisa es solo lo que se muestra. */}
          {moneda !== 'EUR' && (
            <div className="p-2.5 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 space-y-1.5">
              <p className="text-[10px] text-amber-800 dark:text-amber-300">
                Los conceptos van en <strong>{moneda}</strong> (importes manuales, sin conversión automática).
                Indica también el total en euros: es el que cuenta para la contabilidad y los reportes.
                En la factura saldrá <strong>{totalConceptos.toFixed(2)} {moneda} ({(Number(totalEur) || 0).toFixed(2)} €)</strong>.
              </p>
              <div>
                <label className="text-[11px] text-muted-foreground">Total en euros <span className="text-red-500">*</span></label>
                <input type="number" step="0.01" min="0" value={totalEur} onChange={(e) => setTotalEur(e.target.value)}
                  placeholder="0.00"
                  className={`w-full h-9 px-2 rounded border bg-background text-sm ${!totalEur ? 'border-amber-400' : 'border-border'}`} />
              </div>
            </div>
          )}
          {/* Fechas de la factura: se editan aquí, en el panel (antes había un botón aparte). */}
          {editId && puedeFechas && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-muted-foreground">Fecha de emisión</label>
                <input type="date" value={fechaEmision} onChange={(e) => setFechaEmision(e.target.value)}
                  className="w-full h-9 px-2 rounded border border-border bg-background text-sm" />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">Fecha de pago</label>
                <input type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)}
                  className="w-full h-9 px-2 rounded border border-border bg-background text-sm" />
              </div>
            </div>
          )}
          <textarea value={piePago} onChange={(e) => setPiePago(e.target.value)} rows={2} placeholder="Pie de pago (IBAN, vencimiento…)" className="w-full px-2 py-1.5 rounded border border-border bg-background text-sm" />
        </div>
      </div>
      </>)}

      <div className="flex justify-end gap-2">
        <Link to={`${invBase}/facturas`} className="h-10 px-4 rounded-md border border-border bg-card text-sm inline-flex items-center">Cancelar</Link>
        {esRect ? (
          <button onClick={emitirAbono} disabled={saving || !rectOriginalId || !rectMotivo.trim()} className="h-10 px-5 rounded-md bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5">
            <FloppyDisk size={15} weight="bold" /> {saving ? 'Emitiendo abono…' : 'Emitir abono'}
          </button>
        ) : (
          <button onClick={() => generar()} disabled={saving || (!esProforma && fiscalBlock)} title={!esProforma && fiscalBlock ? 'El CIF/NIF de la sociedad no es válido' : undefined} className="h-10 px-5 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5">
            <FloppyDisk size={15} weight="bold" /> {saving ? 'Guardando…' : editId ? 'Guardar cambios' : (esProforma ? 'Generar presupuesto' : 'Generar factura')}
          </button>
        )}
      </div>

      {/* Aviso: se va a emitir sin asociar a una venta. */}
      {avisoVenta && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" onClick={() => setAvisoVenta(false)}>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
          <div role="dialog" className="relative bg-card rounded-xl border border-border w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-base mb-1">Este documento no está asociado a ninguna venta</h3>
            {leadConvs.length > 0 ? (
              <>
                <p className="text-sm text-muted-foreground mb-3">
                  Si lo emites así <b>no aparecerá en la ficha del cliente</b>. Elige a qué venta pertenece:
                </p>
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {leadConvs.map((c) => (
                    <button key={c.id} onClick={() => { setAssocConvId(c.id); setAvisoVenta(false); }}
                      className="w-full text-left p-2.5 rounded-md border border-border hover:bg-muted/50">
                      <div className="text-sm font-medium truncate">{c.producto_contratado || 'Venta'}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {Number(c.importe_total || 0).toFixed(2)} € · cobrado {Number(c.importe_pagado || 0).toFixed(2)} €
                      </div>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground mb-3">
                Este cliente <b>todavía no tiene ninguna venta registrada</b>. Puedes emitirlo igualmente:
                cuando crees la venta, el documento <b>se asociará solo</b>.
              </p>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setAvisoVenta(false)} className="h-9 px-3 rounded-md border border-border bg-card text-sm">Cancelar</button>
              <button onClick={() => { setAvisoVenta(false); generar(true); }}
                className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90">
                Emitir sin asociar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, required, full }: { label: string; value: string; onChange: (v: string) => void; required?: boolean; full?: boolean }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <label className="text-[11px] text-muted-foreground">{label}{required && <span className="text-red-500"> *</span>}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} className={`w-full h-9 px-2 rounded border bg-background text-sm ${required && !value ? 'border-red-300' : 'border-border'}`} />


    </div>
  );
}
