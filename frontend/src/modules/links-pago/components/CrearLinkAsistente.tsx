import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LinkSimple, Copy, CheckCircle, MagnifyingGlass, ArrowSquareOut, WhatsappLogo, EnvelopeSimple, WarningCircle,
} from '@phosphor-icons/react';
import client from '@/shared/api/client';
import Portal from '@/shared/components/ui/portal';
import usePermission from '@/shared/hooks/usePermission';
import { toast } from '@/shared/hooks/useToast';
import { abrirChatCrm } from '@/shared/lib/abrirChatCrm';
// El correo se carga al pulsar «Enviar por correo»: no hace falta para crear el link.
const LeadEmailDialog = lazy(() => import('@/modules/leads/components/LeadEmailDialog'));
import {
  crearLink, verConfig, ventasDelProspecto,
  type ConfigLinks, type LinkDePago, type ProspectoDelLink, type VentaDelProspecto,
} from '../api/linksPago.api';

/*
  EL ASISTENTE «CREAR LINK DE PAGO» (#680; Diego, 19/11).

  «Intenté crear uno y nada»: el único sitio para crear un link era una tarjeta
  al final de la ficha, y su diálogo se callaba lo que fallaba. El catálogo que
  no cargaba dejaba el desplegable vacío sin decir nada, y el botón «Crear
  link» se quedaba gris sin decir por qué. Este asistente se abre desde la
  pantalla «Links de pago», desde la cabecera de la ficha del prospecto y desde
  la de la venta, y:

    1. busca el prospecto (o viene ya elegido);
    2. enseña SUS ventas (programa, total y pendiente) y se elige a cuál va el
       link, o «sin venta todavía» (al pagarse se crea la venta, como antes). Si
       tiene una, sale elegida; si tiene varias, hay que elegir;
    3. curso e importe: desde una venta se propone lo pendiente y nunca más
       (CRM#909); sin venta, el precio del catálogo, con el tope del campus;
    4. dice siempre por qué no se puede crear todavía, y cualquier error del
       servidor o de Stripe sale escrito en el diálogo;
    5. con el link creado: copiar, abrir, mandarlo por el WhatsApp del CRM o
       por correo desde la ficha.

  El servidor lo vuelve a comprobar todo: esto solo lo explica antes.
*/

function dinero(n: unknown, moneda = 'EUR') {
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: moneda || 'EUR' }).format(Number(n || 0));
  } catch {
    return `${Number(n || 0).toFixed(2)} ${moneda}`;
  }
}

function cuando(d: string | null) {
  return d ? new Date(d).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

export function errorDe(e: unknown) {
  const err = e as { data?: { error?: string }; message?: string };
  return err?.data?.error || err?.message || 'Error de red: no se ha podido hablar con el servidor.';
}

export async function copiarLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast({ title: 'Link copiado', description: 'Pégalo en WhatsApp o en un correo.' });
    return true;
  } catch {
    toast({ title: 'No se ha podido copiar', description: url, variant: 'destructive' });
    return false;
  }
}

interface Curso { id: number; nombre: string; precio: string | number | null; moneda: string | null }
interface LeadEncontrado { id: number; nombre: string | null; email: string | null; telefono?: string | null; project_nombre?: string | null }

export interface CrearLinkAsistenteProps {
  /** El prospecto, si ya se sabe (ficha del prospecto). */
  leadId?: number | null;
  /** La venta, si ya se sabe (ficha o fila de la venta): sale elegida. */
  conversionId?: number | null;
  onClose: () => void;
  onCreado?: (link: LinkDePago) => void;
}

const SIN_VENTA = 'sin';

export default function CrearLinkAsistente({ leadId: leadInicial, conversionId: ventaInicial, onClose, onCreado }: CrearLinkAsistenteProps) {
  const { can } = usePermission();
  const navigate = useNavigate();
  const esAdmin = can('links_pago.configurar');

  // 1. El prospecto. `consulta` es lo que se pide al servidor: el prospecto, o la
  // venta (y de ella sale el prospecto). Una sola vez por elección.
  const [consulta, setConsulta] = useState<{ leadId?: number; conversionId?: number } | null>(
    leadInicial ? { leadId: leadInicial } : ventaInicial ? { conversionId: ventaInicial } : null,
  );
  const [busqueda, setBusqueda] = useState('');
  const [encontrados, setEncontrados] = useState<LeadEncontrado[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [prospecto, setProspecto] = useState<ProspectoDelLink | null>(null);
  const [cargandoProspecto, setCargandoProspecto] = useState(false);

  // 2. La venta
  const [ventaElegida, setVentaElegida] = useState<string>('');

  // 3. Curso, importe y reglas
  const [cfg, setCfg] = useState<ConfigLinks | null>(null);
  const [cursos, setCursos] = useState<Curso[]>([]);
  const [cursosCargados, setCursosCargados] = useState(false);
  const [filtroCurso, setFiltroCurso] = useState('');
  const [cursoId, setCursoId] = useState('');
  const [importe, setImporte] = useState('');
  const [moneda, setMoneda] = useState('');
  const [dias, setDias] = useState('');

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<LinkDePago | null>(null);
  const [correoAbierto, setCorreoAbierto] = useState(false);

  // Buscar prospectos (solo si no viene elegido).
  useEffect(() => {
    if (consulta || busqueda.trim().length < 2) { setEncontrados([]); return undefined; }
    const t = setTimeout(() => {
      setBuscando(true);
      client.get<LeadEncontrado[]>('/leads', { params: { search: busqueda.trim(), includeConverted: true, limit: 10 } })
        .then((r) => setEncontrados(Array.isArray(r?.data) ? r.data : []))
        .catch((e) => { setEncontrados([]); setError(errorDe(e)); })
        .finally(() => setBuscando(false));
    }, 250);
    return () => clearTimeout(t);
  }, [busqueda, consulta]);

  // El prospecto elegido (o el de la venta): sus datos y sus ventas.
  useEffect(() => {
    if (!consulta) return undefined;
    let vigente = true;
    setCargandoProspecto(true);
    setError(null);
    ventasDelProspecto(consulta)
      .then((r) => {
        if (!vigente || !r.data) return;
        setProspecto(r.data);
        const ventas = r.data.ventas || [];
        // Venta elegida: la que viene; si solo tiene una, esa; si no tiene, «sin venta».
        if (ventaInicial && ventas.some((v) => v.id === ventaInicial)) setVentaElegida(String(ventaInicial));
        else if (ventas.length === 1) setVentaElegida(String(ventas[0].id));
        else if (ventas.length === 0) setVentaElegida(SIN_VENTA);
      })
      .catch((e) => { if (vigente) setError(`No se han podido cargar los datos del prospecto: ${errorDe(e)}`); })
      .finally(() => { if (vigente) setCargandoProspecto(false); });
    return () => { vigente = false; };
  }, [consulta, ventaInicial]);

  const leadId = prospecto?.lead.id ?? consulta?.leadId ?? null;

  const projectId = prospecto?.lead.project_id || null;

  // Las reglas del campus y su catálogo. Si algo no carga, se dice.
  useEffect(() => {
    if (!projectId) return undefined;
    let vigente = true;
    setCursosCargados(false);
    verConfig(projectId).then((r) => {
      if (!vigente || !r.data) return;
      setCfg(r.data);
      setMoneda(r.data.moneda_defecto);
      setDias(String(r.data.caducidad_dias));
    }).catch((e) => { if (vigente) setError(`No se han podido leer las reglas de links de este campus: ${errorDe(e)}`); });
    client.get<Curso[]>('/products', { params: { projectId, limit: 500 } })
      .then((r) => { if (vigente) setCursos(Array.isArray(r?.data) ? r.data : []); })
      .catch((e) => { if (vigente) setError(`No se ha podido cargar el catálogo del campus: ${errorDe(e)}`); })
      .finally(() => { if (vigente) setCursosCargados(true); });
    return () => { vigente = false; };
  }, [projectId]);

  const venta: VentaDelProspecto | null = useMemo(
    () => (prospecto?.ventas || []).find((v) => String(v.id) === ventaElegida) || null,
    [prospecto, ventaElegida],
  );
  const sinVenta = ventaElegida === SIN_VENTA;

  // El curso que sale elegido: el de la venta; sin venta, el que le interesa.
  useEffect(() => {
    if (!cursos.length) return;
    const propuesto = venta?.producto_contratado_id ?? (sinVenta ? prospecto?.lead.producto_interes_id : null);
    if (propuesto && cursos.some((c) => c.id === Number(propuesto))) setCursoId(String(propuesto));
  }, [venta, sinVenta, cursos, prospecto]);

  const curso = useMemo(() => cursos.find((c) => String(c.id) === cursoId) || null, [cursos, cursoId]);

  // El importe propuesto: lo pendiente de la venta, o el precio del catálogo.
  // Dos efectos y no uno: si el catálogo llega después que la venta, no debe
  // pisar el importe que la persona ya ha cambiado.
  useEffect(() => {
    if (venta) setImporte(venta.pendiente > 0 ? String(venta.pendiente) : '');
  }, [venta]);
  useEffect(() => {
    if (sinVenta && curso?.precio != null && Number(curso.precio) > 0) setImporte(String(Number(curso.precio)));
  }, [sinVenta, curso]);

  const cursosFiltrados = useMemo(() => {
    const q = filtroCurso.trim().toLowerCase();
    const lista = q ? cursos.filter((c) => c.nombre.toLowerCase().includes(q)) : cursos;
    // El elegido siempre a la vista, aunque el filtro no lo encuentre.
    return curso && !lista.includes(curso) ? [curso, ...lista] : lista;
  }, [cursos, filtroCurso, curso]);

  const n = Number(importe.replace(',', '.'));
  const precio = curso?.precio != null && Number(curso.precio) > 0
    && (!curso.moneda || curso.moneda.toUpperCase() === moneda) ? Number(curso.precio) : null;
  const referencia = venta ? (moneda === 'EUR' && venta.pendiente > 0 ? venta.pendiente : null) : precio;
  const descuento = referencia && n > 0 ? Math.max(0, Math.round(((referencia - n) / referencia) * 10000) / 100) : 0;

  // Por qué no se puede crear todavía: siempre escrito, nunca un botón gris mudo.
  const motivos: string[] = [];
  if (!consulta) motivos.push('Busca y elige el prospecto.');
  else if (cargandoProspecto) motivos.push('Cargando el prospecto…');
  else if (prospecto) {
    if (!ventaElegida) motivos.push('Elige a qué venta va el link, o «Sin venta todavía».');
    if (!cfg) motivos.push('Cargando las reglas del campus…');
    if (cursosCargados && cursos.length === 0) motivos.push('Este campus no tiene cursos en el catálogo: sin curso no se puede crear el link.');
    if (cursos.length > 0 && !curso) motivos.push('Elige el curso.');
    if (!(n > 0)) motivos.push(venta && venta.pendiente <= 0 ? 'Esta venta ya está cobrada entera: no queda nada que cobrar con un link.' : 'Escribe el importe.');
    if (venta && moneda === 'EUR' && n > 0 && Math.round(n * 100) > Math.round(venta.pendiente * 100)) {
      motivos.push(`El link no puede pasar de lo pendiente de la venta (${dinero(venta.pendiente)}).`);
    }
    if (!esAdmin && cfg && referencia != null && descuento > cfg.descuento_max_pct) {
      motivos.push(cfg.descuento_max_pct > 0
        ? `Es un ${descuento} % menos que ${venta ? 'lo pendiente' : 'el catálogo'}; el máximo en este campus es un ${cfg.descuento_max_pct} %.`
        : `En este campus solo un admin puede bajar el importe de ${venta ? 'lo pendiente' : 'el catálogo'} (${dinero(referencia, moneda)}).`);
    }
    if (!esAdmin && curso && referencia == null && n > 0) {
      motivos.push(venta
        ? `Lo pendiente de la venta está en EUR: un link en ${moneda} lo tiene que crear un admin.`
        : `Este curso no tiene precio en el catálogo en ${moneda}: el link lo tiene que crear un admin.`);
    }
    if (cfg && Number(dias) > cfg.caducidad_max_dias) motivos.push(`La caducidad no puede pasar de ${cfg.caducidad_max_dias} días.`);
  }

  async function enviar() {
    if (motivos.length || !curso || !leadId) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await crearLink({
        leadId, ...(venta ? { conversionId: venta.id } : {}),
        productId: curso.id, importe: n, moneda, caducidad_dias: Number(dias),
      });
      if (r.data) { setHecho(r.data); onCreado?.(r.data); } else setError('El servidor no ha devuelto el link. Mira la lista de links antes de crear otro.');
    } catch (e) {
      setError(`No se ha creado el link. ${errorDe(e)}`);
    } finally { setEnviando(false); }
  }

  async function porWhatsapp() {
    if (!hecho?.url || !leadId) return;
    await copiarLink(hecho.url);
    const ruta = await abrirChatCrm({ leadId });
    if (ruta) { toast({ title: 'Link copiado', description: 'Pégalo en la conversación y envíalo.' }); navigate(ruta); }
    else toast({ title: 'No se ha podido abrir el chat', description: 'El link está copiado: mándalo desde WhatsApp.', variant: 'destructive' });
  }

  const campo = 'w-full h-10 px-3 rounded-md border border-border bg-card text-sm';
  const lead = prospecto?.lead;
  const ventas = prospecto?.ventas || [];

  return (
    <Portal>
      <div className="fixed inset-0 !m-0 z-[80] flex items-center justify-center sm:p-4">
        <div className="fixed inset-0 !m-0 bg-black/60 backdrop-blur-sm" onClick={enviando ? undefined : onClose} />
        <div role="dialog" aria-modal="true" aria-labelledby="crear-link-titulo" data-recorrido="links-asistente"
          className="relative bg-card sm:rounded-lg border border-border w-full max-w-lg flex flex-col max-h-[100dvh] overflow-y-auto">
          <div className="px-5 py-4 border-b border-border flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
              <LinkSimple size={18} weight="regular" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 id="crear-link-titulo" className="font-semibold text-base">Crear link de pago</h3>
              <p className="text-xs text-muted-foreground">Pago único, con la cuenta de Stripe del campus del prospecto.</p>
            </div>
          </div>

          {hecho ? (
            <div className="p-5 space-y-3">
              <p className="text-sm flex items-center gap-1.5 font-semibold text-success-soft-foreground">
                <CheckCircle size={16} weight="fill" aria-hidden="true" /> Link creado
              </p>
              <p className="text-sm">
                {dinero(hecho.importe, hecho.moneda)} · caduca {cuando(hecho.caduca_el)}
                {venta ? ` · para la venta n.º ${venta.id}` : ' · sin venta: se crea al pagarse'}
              </p>
              <div className="flex gap-2">
                <input readOnly value={hecho.url || ''} aria-label="Link de pago" className={`${campo} font-mono text-xs`} onFocus={(e) => e.target.select()} />
                <button type="button" onClick={() => hecho.url && copiarLink(hecho.url)}
                  className="inline-flex items-center gap-1 h-10 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90">
                  <Copy size={14} weight="bold" aria-hidden="true" /> Copiar
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {hecho.url && (
                  <a href={hecho.url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 h-9 px-3 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted">
                    <ArrowSquareOut size={14} weight="bold" aria-hidden="true" /> Abrir
                  </a>
                )}
                {can('whatsapp.usar') && (
                  <button type="button" onClick={porWhatsapp}
                    className="inline-flex items-center gap-1 h-9 px-3 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted">
                    <WhatsappLogo size={14} weight="bold" aria-hidden="true" /> Enviar por WhatsApp
                  </button>
                )}
                {can('leads.enviar_correo') && lead?.email && (
                  <button type="button" onClick={() => setCorreoAbierto(true)}
                    className="inline-flex items-center gap-1 h-9 px-3 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted">
                    <EnvelopeSimple size={14} weight="bold" aria-hidden="true" /> Enviar por correo
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="p-5 space-y-4">
              {/* 1. El prospecto */}
              <section data-recorrido="links-asistente-prospecto">
                <p className="text-xs font-semibold text-muted-foreground mb-1">1 · Prospecto</p>
                {lead ? (
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate"><strong>{lead.nombre || `Prospecto ${lead.id}`}</strong>
                      {lead.email && <span className="text-muted-foreground"> · {lead.email}</span>}</span>
                    {!leadInicial && !ventaInicial && (
                      <button type="button" className="text-xs underline text-muted-foreground"
                        onClick={() => { setConsulta(null); setProspecto(null); setVentaElegida(''); setCfg(null); setCursos([]); setCursoId(''); setImporte(''); }}>
                        Cambiar
                      </button>
                    )}
                  </div>
                ) : consulta ? (
                  <p className="text-xs text-muted-foreground">Cargando el prospecto…</p>
                ) : (
                  <div>
                    <label htmlFor="link-buscar" className="sr-only">Buscar prospecto</label>
                    <div className="relative">
                      <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                      <input id="link-buscar" autoFocus value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
                        placeholder="Nombre, correo o teléfono" className={`${campo} pl-8`} />
                    </div>
                    {buscando && <p className="text-xs text-muted-foreground mt-1">Buscando…</p>}
                    {!buscando && busqueda.trim().length >= 2 && encontrados.length === 0 && (
                      <p className="text-xs text-muted-foreground mt-1">Ningún prospecto tuyo con «{busqueda.trim()}».</p>
                    )}
                    {encontrados.length > 0 && (
                      <ul className="mt-1 border border-border rounded-md divide-y divide-border max-h-48 overflow-y-auto">
                        {encontrados.map((l) => (
                          <li key={l.id}>
                            <button type="button" onClick={() => setConsulta({ leadId: l.id })}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-muted">
                              <span className="font-medium">{l.nombre || `Prospecto ${l.id}`}</span>
                              <span className="text-xs text-muted-foreground"> {l.email || l.telefono || ''}{l.project_nombre ? ` · ${l.project_nombre}` : ''}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </section>

              {/* 2. La venta */}
              {prospecto && (
                <section data-recorrido="links-asistente-venta">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">2 · ¿A qué venta va?</p>
                  <div role="radiogroup" aria-label="Venta del link" className="space-y-1.5">
                    {ventas.map((v) => (
                      <label key={v.id} className={`flex items-start gap-2 p-2 rounded-md border text-sm cursor-pointer ${ventaElegida === String(v.id) ? 'border-primary bg-primary/5' : 'border-border'}`}>
                        <input type="radio" name="link-venta" value={v.id} checked={ventaElegida === String(v.id)}
                          onChange={() => setVentaElegida(String(v.id))} className="mt-1" />
                        <span className="min-w-0">
                          <span className="font-medium">{v.producto_nombre || 'Venta sin curso'}</span>
                          <span className="block text-xs text-muted-foreground">
                            Venta n.º {v.id} · total {dinero(v.importe_total)} · pendiente <strong className={v.pendiente > 0 ? 'text-foreground' : ''}>{dinero(v.pendiente)}</strong>
                          </span>
                        </span>
                      </label>
                    ))}
                    <label className={`flex items-start gap-2 p-2 rounded-md border text-sm cursor-pointer ${sinVenta ? 'border-primary bg-primary/5' : 'border-border'}`}>
                      <input type="radio" name="link-venta" value={SIN_VENTA} checked={sinVenta}
                        onChange={() => setVentaElegida(SIN_VENTA)} className="mt-1" />
                      <span>
                        <span className="font-medium">Sin venta todavía</span>
                        <span className="block text-xs text-muted-foreground">Cuando lo pague, el CRM crea la venta con este curso y este importe.</span>
                      </span>
                    </label>
                  </div>
                </section>
              )}

              {/* 3. Curso e importe */}
              {prospecto && ventaElegida && (
                <section className="space-y-3" data-recorrido="links-asistente-importe">
                  <p className="text-xs font-semibold text-muted-foreground">3 · Curso e importe</p>
                  <div>
                    <label htmlFor="link-curso" className="text-xs text-muted-foreground mb-1 block">Curso</label>
                    {cursos.length > 12 && (
                      <input aria-label="Filtrar cursos" value={filtroCurso} onChange={(e) => setFiltroCurso(e.target.value)}
                        placeholder="Escribe para filtrar el catálogo" className={`${campo} mb-1.5`} />
                    )}
                    <select id="link-curso" value={cursoId} onChange={(e) => setCursoId(e.target.value)} className={campo}>
                      <option value="">{cursosCargados ? `Elige un curso… (${cursosFiltrados.length})` : 'Cargando el catálogo…'}</option>
                      {cursosFiltrados.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nombre}{c.precio != null && Number(c.precio) > 0 ? ` — ${dinero(c.precio, c.moneda || 'EUR')}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="link-importe" className="text-xs text-muted-foreground mb-1 block">Importe</label>
                      <input id="link-importe" type="text" inputMode="decimal" value={importe}
                        onChange={(e) => setImporte(e.target.value)} className={`${campo} tabular-nums`} />
                    </div>
                    <div>
                      <label htmlFor="link-moneda" className="text-xs text-muted-foreground mb-1 block">Moneda</label>
                      <select id="link-moneda" value={moneda} onChange={(e) => setMoneda(e.target.value)} className={campo}
                        disabled={!cfg || cfg.monedas.length < 2}>
                        {(cfg?.monedas || []).map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="link-dias" className="text-xs text-muted-foreground mb-1 block">
                      Caduca a los (días){cfg ? ` · máximo ${cfg.caducidad_max_dias}` : ''}
                    </label>
                    <input id="link-dias" type="number" min={1} max={cfg?.caducidad_max_dias} value={dias}
                      onChange={(e) => setDias(e.target.value)} className={`${campo} w-28 tabular-nums`} />
                  </div>
                  {venta && (
                    <p className="text-xs text-muted-foreground">
                      Lo pendiente de esta venta es {dinero(venta.pendiente)}: el link no puede pasar de ahí. Al pagarlo, el cobro entra en esta venta y salda su cuota.
                    </p>
                  )}
                  {referencia != null && descuento > 0 && esAdmin && (
                    <p className="text-xs text-muted-foreground">
                      Un {descuento} % menos que {venta ? 'lo pendiente de la venta' : 'el catálogo'} ({dinero(referencia, moneda)}).
                    </p>
                  )}
                </section>
              )}

              {motivos.length > 0 && !cargandoProspecto && (
                <ul className="text-xs text-warning-soft-foreground space-y-0.5" aria-live="polite" data-recorrido="links-asistente-motivos">
                  {motivos.map((m) => <li key={m} className="flex gap-1"><WarningCircle size={13} className="mt-0.5 flex-shrink-0" aria-hidden="true" /> {m}</li>)}
                </ul>
              )}
              {error && (
                <p role="alert" className="text-sm rounded-md border border-destructive/40 bg-destructive-soft text-destructive-soft-foreground px-3 py-2">
                  {error}
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 p-4 border-t border-border bg-muted/20">
            <button type="button" onClick={onClose} disabled={enviando}
              className="inline-flex items-center h-9 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted disabled:opacity-50">
              {hecho ? 'Cerrar' : 'Cancelar'}
            </button>
            {!hecho && (
              <button type="button" onClick={enviar} disabled={enviando || motivos.length > 0}
                title={motivos[0] || undefined}
                className="inline-flex items-center h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
                {enviando ? 'Creando…' : 'Crear link'}
              </button>
            )}
          </div>
        </div>
      </div>
      {correoAbierto && lead && hecho?.url && (
        <Suspense fallback={null}>
        <LeadEmailDialog
          open
          encima
          leadId={lead.id}
          leadName={lead.nombre}
          leadEmail={lead.email}
          asuntoInicial={`Tu link de pago${curso ? `: ${curso.nombre}` : ''}`}
          cuerpoInicial={`Hola${lead.nombre ? ` ${lead.nombre.split(' ')[0]}` : ''},\n\nAquí tienes el link para pagar${curso ? ` ${curso.nombre}` : ''} (${dinero(hecho.importe, hecho.moneda)}):\n\n${hecho.url}\n\nEl link caduca el ${cuando(hecho.caduca_el)}. Si tienes cualquier duda, responde a este correo.\n\nUn saludo.`}
          onClose={() => setCorreoAbierto(false)}
        />
        </Suspense>
      )}
    </Portal>
  );
}
