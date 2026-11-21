import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LinkSimple, Copy, CheckCircle, MagnifyingGlass, ArrowSquareOut, WhatsappLogo, EnvelopeSimple, WarningCircle, CaretDown, CaretRight,
} from '@phosphor-icons/react';
import client from '@/shared/api/client';
import Portal from '@/shared/components/ui/portal';
import usePermission from '@/shared/hooks/usePermission';
import { toast } from '@/shared/hooks/useToast';
import { abrirChatCrm } from '@/shared/lib/abrirChatCrm';
import { useProjectContext } from '@/contexts/ProjectContext';
// El correo se carga al pulsar «Enviar por correo»: no hace falta para crear el link.
const LeadEmailDialog = lazy(() => import('@/modules/leads/components/LeadEmailDialog'));
import {
  crearLink, verConfig, ventasDelProspecto, cuotasDisponibles,
  type ConfigLinks, type CuotasDisponibles, type LinkDePago, type ProspectoDelLink, type VentaDelProspecto,
} from '../api/linksPago.api';

/*
  «CREAR LINK DE PAGO», EN UNA PANTALLA (Carlos y Diego, 20/11/2026).

  Carlos: «Hay que ponerlo más fácil. Y sin nombre de la persona. Crear link de
  pago > producto > pago único / cuotas > seleccionar. Y ya.» Diego: «que sea
  para hacerlo por cuotas y eso».

    1. el campus (solo si la persona tiene varios);
    2. el curso, con buscador: sale su precio del catálogo, que se puede bajar
       dentro del tope de descuento del campus;
    3. pago único o en cuotas (de 2 al máximo del campus), con lo que paga en
       cada una. En cuotas, el link cobra la primera y guarda la tarjeta; Stripe
       cobra las demás solas cada mes. Si el campus no puede (no lo permite, o la
       clave de Stripe no tiene permisos), se dice aquí, antes de crear nada;
    4. «Crear link», y el link: copiar, abrir y, si va para un prospecto,
       mandarlo por WhatsApp o por correo.

  No hace falta prospecto ni venta: al pagar, el CRM encuentra (por el correo) o
  crea el prospecto, crea la venta a nombre de quien creó el link y le avisa.

  Plegado, «Para un prospecto o una venta concretos»: si se abre desde la ficha
  de un prospecto o de una venta, sale abierto y relleno, y el link va a esa
  venta (pago único por lo pendiente, como hasta ahora) o, sin venta, al
  prospecto (la venta se crea al pagar).

  Dice siempre por qué no se puede crear todavía, y cualquier error del servidor
  o de Stripe sale escrito. El servidor lo vuelve a comprobar todo.
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

/** El total en `n` cuotas, con los céntimos en la última (como el servidor). */
export function repartirEnCuotas(total: number, n: number) {
  const c = Math.round(total * 100);
  const base = Math.floor(c / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? c - base * (n - 1) : base) / 100);
}

interface Curso { id: number; nombre: string; precio: string | number | null; moneda: string | null }
interface LeadEncontrado { id: number; nombre: string | null; email: string | null; telefono?: string | null; project_nombre?: string | null }
interface Campus { id: number; nombre: string }

export interface CrearLinkAsistenteProps {
  /** El prospecto, si ya se sabe (ficha del prospecto). */
  leadId?: number | null;
  /** La venta, si ya se sabe (ficha o fila de la venta): sale elegida. */
  conversionId?: number | null;
  onClose: () => void;
  onCreado?: (link: LinkDePago) => void;
}

/** «Nueva venta al pagar»: el link va al prospecto y la venta se crea con el cobro. */
const NUEVA = 'nueva';

export default function CrearLinkAsistente({ leadId: leadInicial, conversionId: ventaInicial, onClose, onCreado }: CrearLinkAsistenteProps) {
  const { can } = usePermission();
  const navigate = useNavigate();
  const { activeProject, projects } = useProjectContext();
  const esAdmin = can('links_pago.configurar');

  // ── «Para un prospecto o una venta concretos» (plegado) ──
  const [paraAlguien, setParaAlguien] = useState(!!(leadInicial || ventaInicial));
  // Lo que se pide al servidor: el prospecto, o la venta (y de ella sale el prospecto).
  const [consulta, setConsulta] = useState<{ leadId?: number; conversionId?: number } | null>(
    leadInicial ? { leadId: leadInicial } : ventaInicial ? { conversionId: ventaInicial } : null,
  );
  const [busqueda, setBusqueda] = useState('');
  const [encontrados, setEncontrados] = useState<LeadEncontrado[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [prospecto, setProspecto] = useState<ProspectoDelLink | null>(null);
  const [cargandoProspecto, setCargandoProspecto] = useState(false);
  const [ventaElegida, setVentaElegida] = useState<string>(NUEVA);

  // ── Campus ──
  const campusPosibles: Campus[] = useMemo(
    () => (projects || []).filter((p: Campus) => Number(p?.id) > 0).map((p: Campus) => ({ id: Number(p.id), nombre: p.nombre })),
    [projects],
  );
  const [campusElegido, setCampusElegido] = useState<number | null>(() => {
    const activo = Number(activeProject?.id);
    if (activo > 0) return activo;
    return campusPosibles.length === 1 ? campusPosibles[0].id : null;
  });
  // Con prospecto, el campus es el suyo.
  const projectId = prospecto?.lead.project_id || (paraAlguien && consulta ? null : campusElegido);

  // ── Curso, importe y forma de pago ──
  const [cfg, setCfg] = useState<ConfigLinks | null>(null);
  const [cursos, setCursos] = useState<Curso[]>([]);
  const [cursosCargados, setCursosCargados] = useState(false);
  const [filtroCurso, setFiltroCurso] = useState('');
  const [cursoId, setCursoId] = useState('');
  const [importe, setImporte] = useState('');
  const [moneda, setMoneda] = useState('');
  const [forma, setForma] = useState<'unico' | 'cuotas'>('unico');
  const [numCuotas, setNumCuotas] = useState(3);
  const [cuotas, setCuotas] = useState<CuotasDisponibles | null>(null);

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<LinkDePago | null>(null);
  const [correoAbierto, setCorreoAbierto] = useState(false);

  // Buscar prospectos (solo si se abre «para un prospecto» y no viene elegido).
  useEffect(() => {
    if (!paraAlguien || consulta || busqueda.trim().length < 2) { setEncontrados([]); return undefined; }
    const t = setTimeout(() => {
      setBuscando(true);
      client.get<LeadEncontrado[]>('/leads', { params: { search: busqueda.trim(), includeConverted: true, limit: 10 } })
        .then((r) => setEncontrados(Array.isArray(r?.data) ? r.data : []))
        .catch((e) => { setEncontrados([]); setError(errorDe(e)); })
        .finally(() => setBuscando(false));
    }, 250);
    return () => clearTimeout(t);
  }, [busqueda, consulta, paraAlguien]);

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
        // La venta que viene; si solo tiene una con algo pendiente, esa; si no, una nueva al pagar.
        if (ventaInicial && ventas.some((v) => v.id === ventaInicial)) setVentaElegida(String(ventaInicial));
        else if (ventas.length === 1 && ventas[0].pendiente > 0) setVentaElegida(String(ventas[0].id));
        else setVentaElegida(NUEVA);
      })
      .catch((e) => { if (vigente) setError(`No se han podido cargar los datos del prospecto: ${errorDe(e)}`); })
      .finally(() => { if (vigente) setCargandoProspecto(false); });
    return () => { vigente = false; };
  }, [consulta, ventaInicial]);

  // Las reglas del campus, su catálogo y si admite cuotas. Si algo no carga, se dice.
  useEffect(() => {
    if (!projectId) return undefined;
    let vigente = true;
    setCfg(null);
    setCursos([]);
    setCursosCargados(false);
    setCuotas(null);
    verConfig(projectId).then((r) => {
      if (!vigente || !r.data) return;
      setCfg(r.data);
      setMoneda(r.data.moneda_defecto);
    }).catch((e) => { if (vigente) setError(`No se han podido leer las reglas de links de este campus: ${errorDe(e)}`); });
    client.get<Curso[]>('/products', { params: { projectId, limit: 500 } })
      .then((r) => { if (vigente) setCursos(Array.isArray(r?.data) ? r.data : []); })
      .catch((e) => { if (vigente) setError(`No se ha podido cargar el catálogo del campus: ${errorDe(e)}`); })
      .finally(() => { if (vigente) setCursosCargados(true); });
    cuotasDisponibles(projectId)
      .then((r) => { if (vigente && r.data) setCuotas(r.data); })
      .catch((e) => { if (vigente) setCuotas({ disponible: false, motivo: `No se ha podido saber si este campus admite cuotas: ${errorDe(e)}`, cuotas_max: null }); });
    return () => { vigente = false; };
  }, [projectId]);

  const venta: VentaDelProspecto | null = useMemo(
    () => (prospecto?.ventas || []).find((v) => String(v.id) === ventaElegida) || null,
    [prospecto, ventaElegida],
  );
  // Con venta, el link es por lo pendiente y de pago único (la venta ya tiene su plan).
  const enCuotas = !venta && forma === 'cuotas';
  const maxCuotas = Math.max(2, cuotas?.cuotas_max || cfg?.cuotas_max || 12);
  useEffect(() => { if (numCuotas > maxCuotas) setNumCuotas(maxCuotas); }, [numCuotas, maxCuotas]);

  // El curso que sale elegido: el de la venta; para un prospecto, el que le interesa.
  useEffect(() => {
    if (!cursos.length) return;
    const propuesto = venta?.producto_contratado_id ?? (prospecto && !venta ? prospecto.lead.producto_interes_id : null);
    if (propuesto && cursos.some((c) => c.id === Number(propuesto))) setCursoId(String(propuesto));
  }, [venta, cursos, prospecto]);

  const curso = useMemo(() => cursos.find((c) => String(c.id) === cursoId) || null, [cursos, cursoId]);

  // El importe propuesto: lo pendiente de la venta, o el precio del catálogo.
  // Dos efectos: si el catálogo llega después que la venta, no pisa lo que ya se cambió.
  useEffect(() => {
    if (venta) setImporte(venta.pendiente > 0 ? String(venta.pendiente) : '');
  }, [venta]);
  useEffect(() => {
    if (!venta && curso?.precio != null && Number(curso.precio) > 0) setImporte(String(Number(curso.precio)));
  }, [venta, curso]);
  // En cuotas, siempre en euros.
  useEffect(() => { if (enCuotas) setMoneda('EUR'); }, [enCuotas]);

  const cursosFiltrados = useMemo(() => {
    const q = filtroCurso.trim().toLowerCase();
    const lista = q ? cursos.filter((c) => c.nombre.toLowerCase().includes(q)) : cursos;
    // El elegido siempre a la vista, aunque el filtro no lo encuentre.
    return curso && !lista.includes(curso) ? [curso, ...lista] : lista;
  }, [cursos, filtroCurso, curso]);

  const n = Number(importe.replace(',', '.'));
  const mon = enCuotas ? 'EUR' : moneda;
  const precio = curso?.precio != null && Number(curso.precio) > 0
    && (!curso.moneda || curso.moneda.toUpperCase() === mon) ? Number(curso.precio) : null;
  const referencia = venta ? (mon === 'EUR' && venta.pendiente > 0 ? venta.pendiente : null) : precio;
  const descuento = referencia && n > 0 ? Math.max(0, Math.round(((referencia - n) / referencia) * 10000) / 100) : 0;
  const reparto = enCuotas && n > 0 ? repartirEnCuotas(n, numCuotas) : [];

  // Por qué no se puede crear todavía: siempre escrito, nunca un botón gris mudo.
  const motivos: string[] = [];
  if (paraAlguien && consulta && cargandoProspecto) motivos.push('Cargando el prospecto…');
  else if (paraAlguien && !consulta && !campusElegido) motivos.push('Elige el campus, o busca el prospecto.');
  else if (!projectId) motivos.push('Elige el campus.');
  else {
    if (!cfg) motivos.push('Cargando las reglas del campus…');
    if (cursosCargados && cursos.length === 0) motivos.push('Este campus no tiene cursos en el catálogo: sin curso no se puede crear el link.');
    if (cursos.length > 0 && !curso) motivos.push('Elige el curso.');
    if (!(n > 0)) motivos.push(venta && venta.pendiente <= 0 ? 'Esta venta ya está cobrada entera: no queda nada que cobrar con un link.' : 'Escribe el importe.');
    if (venta && mon === 'EUR' && n > 0 && Math.round(n * 100) > Math.round(venta.pendiente * 100)) {
      motivos.push(`El link no puede pasar de lo pendiente de la venta (${dinero(venta.pendiente)}).`);
    }
    if (!esAdmin && cfg && referencia != null && descuento > cfg.descuento_max_pct) {
      motivos.push(cfg.descuento_max_pct > 0
        ? `Es un ${descuento} % menos que ${venta ? 'lo pendiente' : 'el catálogo'}; el máximo en este campus es un ${cfg.descuento_max_pct} %.`
        : `En este campus solo un admin puede bajar el importe de ${venta ? 'lo pendiente' : 'el catálogo'} (${dinero(referencia, mon)}).`);
    }
    if (!esAdmin && curso && referencia == null && n > 0) {
      motivos.push(venta
        ? `Lo pendiente de la venta está en EUR: un link en ${mon} lo tiene que crear un admin.`
        : `Este curso no tiene precio en el catálogo en ${mon}: el link lo tiene que crear un admin.`);
    }
    if (enCuotas) {
      if (!cuotas) motivos.push('Comprobando si este campus admite cuotas…');
      else if (!cuotas.disponible) motivos.push(cuotas.motivo || 'Este campus no admite cuotas.');
      if (reparto.length && reparto[0] < 0.5) motivos.push('Cada cuota tiene que ser de al menos 0,50 €.');
    }
  }

  async function enviar() {
    if (motivos.length || !curso || !projectId) return;
    setEnviando(true);
    setError(null);
    const leadId = prospecto?.lead.id;
    try {
      const r = await crearLink({
        ...(venta ? { leadId, conversionId: venta.id } : leadId ? { leadId } : { projectId }),
        productId: curso.id, importe: n,
        ...(enCuotas ? { modalidad: 'cuotas' as const, num_cuotas: numCuotas } : { moneda }),
      });
      if (r.data) { setHecho(r.data); onCreado?.(r.data); } else setError('El servidor no ha devuelto el link. Mira la lista de links antes de crear otro.');
    } catch (e) {
      setError(`No se ha creado el link. ${errorDe(e)}`);
    } finally { setEnviando(false); }
  }

  async function porWhatsapp() {
    const leadId = prospecto?.lead.id;
    if (!hecho?.url || !leadId) return;
    await copiarLink(hecho.url);
    const ruta = await abrirChatCrm({ leadId });
    if (ruta) { toast({ title: 'Link copiado', description: 'Pégalo en la conversación y envíalo.' }); navigate(ruta); }
    else toast({ title: 'No se ha podido abrir el chat', description: 'El link está copiado: mándalo desde WhatsApp.', variant: 'destructive' });
  }

  function olvidarProspecto() {
    setConsulta(null); setProspecto(null); setVentaElegida(NUEVA); setCursoId(''); setImporte('');
  }

  const campo = 'w-full h-10 px-3 rounded-md border border-border bg-card text-sm';
  const lead = prospecto?.lead;
  const ventas = prospecto?.ventas || [];
  const desdeFicha = !!(leadInicial || ventaInicial);
  const nombreCampus = campusPosibles.find((c) => c.id === projectId)?.nombre;

  const resumenHecho = hecho && (hecho.modalidad === 'cuotas' && hecho.num_cuotas
    ? `${dinero(hecho.importe)} en ${hecho.num_cuotas} cuotas: ${dinero(hecho.importe_cuota)} al pagar el link y las demás, solas, cada mes`
    : dinero(hecho.importe, hecho.moneda));

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
              <p className="text-xs text-muted-foreground">Elige el curso y cómo paga. No hace falta el nombre: al pagar, el CRM crea su ficha y su venta, y te avisa.</p>
            </div>
          </div>

          {hecho ? (
            <div className="p-5 space-y-3">
              <p className="text-sm flex items-center gap-1.5 font-semibold text-success-soft-foreground">
                <CheckCircle size={16} weight="fill" aria-hidden="true" /> Link creado
              </p>
              <p className="text-sm">
                {resumenHecho} · caduca {cuando(hecho.caduca_el)}
              </p>
              <p className="text-xs text-muted-foreground">
                {venta ? `Va a la venta n.º ${venta.id}: al pagarlo, el cobro entra en ella.`
                  : lead ? `Para ${lead.nombre || `el prospecto ${lead.id}`}: al pagarlo se crea su venta, a tu nombre.`
                    : 'Sin prospecto: al pagarlo, el CRM busca su ficha por el correo (o la crea), crea la venta a tu nombre y te avisa.'}
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
                {lead && can('whatsapp.usar') && (
                  <button type="button" onClick={porWhatsapp}
                    className="inline-flex items-center gap-1 h-9 px-3 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted">
                    <WhatsappLogo size={14} weight="bold" aria-hidden="true" /> Enviar por WhatsApp
                  </button>
                )}
                {lead && can('leads.enviar_correo') && lead.email && (
                  <button type="button" onClick={() => setCorreoAbierto(true)}
                    className="inline-flex items-center gap-1 h-9 px-3 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted">
                    <EnvelopeSimple size={14} weight="bold" aria-hidden="true" /> Enviar por correo
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="p-5 space-y-4">
              {/* Campus: solo si tiene varios y el link no es de un prospecto */}
              {!lead && !(paraAlguien && consulta) && campusPosibles.length > 1 && (
                <div data-recorrido="links-asistente-campus">
                  <label htmlFor="link-campus" className="text-xs font-semibold text-muted-foreground mb-1 block">Campus</label>
                  <select id="link-campus" value={campusElegido ?? ''} className={campo}
                    onChange={(e) => { setCampusElegido(e.target.value ? Number(e.target.value) : null); setCursoId(''); setImporte(''); setFiltroCurso(''); }}>
                    <option value="">Elige el campus…</option>
                    {campusPosibles.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </div>
              )}

              {/* Curso, con buscador */}
              {projectId && (
                <section className="space-y-2" data-recorrido="links-asistente-curso">
                  <label htmlFor="link-curso-buscar" className="text-xs font-semibold text-muted-foreground block">
                    Curso{lead && nombreCampus ? ` · ${nombreCampus}` : ''}
                  </label>
                  {venta && curso ? (
                    <p className="text-sm font-medium">{curso.nombre}</p>
                  ) : (
                    <>
                      <div className="relative">
                        <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                        <input id="link-curso-buscar" type="search" value={filtroCurso} onChange={(e) => setFiltroCurso(e.target.value)}
                          placeholder={cursosCargados ? `Busca entre ${cursos.length} cursos` : 'Cargando el catálogo…'} className={`${campo} pl-8`} />
                      </div>
                      <ul role="listbox" aria-label="Curso" className="border border-border rounded-md divide-y divide-border max-h-44 overflow-y-auto">
                        {cursosFiltrados.slice(0, 80).map((c) => (
                          <li key={c.id} role="option" aria-selected={String(c.id) === cursoId}>
                            <button type="button" onClick={() => setCursoId(String(c.id))}
                              className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 ${String(c.id) === cursoId ? 'bg-primary/10 font-semibold' : 'hover:bg-muted'}`}>
                              <span className="min-w-0 truncate">{c.nombre}</span>
                              {c.precio != null && Number(c.precio) > 0 && (
                                <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{dinero(c.precio, c.moneda || 'EUR')}</span>
                              )}
                            </button>
                          </li>
                        ))}
                        {cursosCargados && cursosFiltrados.length === 0 && cursos.length > 0 && (
                          <li className="px-3 py-2 text-xs text-muted-foreground">Ningún curso con «{filtroCurso.trim()}».</li>
                        )}
                      </ul>
                    </>
                  )}
                </section>
              )}

              {/* Importe y forma de pago */}
              {projectId && curso && (
                <section className="space-y-3" data-recorrido="links-asistente-pago">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="link-importe" className="text-xs text-muted-foreground mb-1 block">{enCuotas ? 'Importe (total)' : 'Importe'}</label>
                      <input id="link-importe" type="text" inputMode="decimal" value={importe} aria-label="Importe"
                        onChange={(e) => setImporte(e.target.value)} className={`${campo} tabular-nums`} />
                    </div>
                    {!enCuotas && (cfg?.monedas.length || 0) > 1 && (
                      <div>
                        <label htmlFor="link-moneda" className="text-xs text-muted-foreground mb-1 block">Moneda</label>
                        <select id="link-moneda" value={moneda} onChange={(e) => setMoneda(e.target.value)} className={campo}>
                          {(cfg?.monedas || []).map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                    )}
                  </div>

                  {venta ? (
                    <p className="text-xs text-muted-foreground">
                      Pago único por lo pendiente de la venta ({dinero(venta.pendiente)}): el link no puede pasar de ahí. Para cobrarla a plazos, «Generar plan de pago» en la venta.
                    </p>
                  ) : (
                    <div role="radiogroup" aria-label="Cómo paga" className="grid grid-cols-2 gap-2">
                      <label className={`flex items-center gap-2 p-2.5 rounded-md border text-sm cursor-pointer ${forma === 'unico' ? 'border-primary bg-primary/5' : 'border-border'}`}>
                        <input type="radio" name="link-forma" checked={forma === 'unico'} onChange={() => setForma('unico')} />
                        <span><span className="font-medium block">Pago único</span><span className="text-xs text-muted-foreground">Todo de una vez</span></span>
                      </label>
                      <label className={`flex items-center gap-2 p-2.5 rounded-md border text-sm ${cuotas && !cuotas.disponible ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'} ${forma === 'cuotas' ? 'border-primary bg-primary/5' : 'border-border'}`}>
                        <input type="radio" name="link-forma" checked={forma === 'cuotas'} disabled={!!cuotas && !cuotas.disponible}
                          onChange={() => setForma('cuotas')} />
                        <span><span className="font-medium block">En cuotas</span><span className="text-xs text-muted-foreground">Una al mes, solas</span></span>
                      </label>
                    </div>
                  )}
                  {!venta && cuotas && !cuotas.disponible && (
                    <p className="text-xs text-muted-foreground" data-recorrido="links-asistente-cuotas-no">
                      Cuotas no disponibles: {cuotas.motivo}
                    </p>
                  )}

                  {enCuotas && (
                    <div className="rounded-md border border-border p-3 space-y-2" data-recorrido="links-asistente-cuotas">
                      <div className="flex items-center gap-2">
                        <label htmlFor="link-num-cuotas" className="text-sm">Cuotas</label>
                        <select id="link-num-cuotas" value={numCuotas} onChange={(e) => setNumCuotas(Number(e.target.value))}
                          className="h-9 px-2 rounded-md border border-border bg-card text-sm">
                          {Array.from({ length: maxCuotas - 1 }, (_, i) => i + 2).map((k) => <option key={k} value={k}>{k}</option>)}
                        </select>
                        {reparto.length > 0 && (
                          <span className="text-sm font-semibold tabular-nums" aria-live="polite">
                            {reparto[0] === reparto[reparto.length - 1]
                              ? `${numCuotas} × ${dinero(reparto[0])}`
                              : `${numCuotas - 1} × ${dinero(reparto[0])} y la última de ${dinero(reparto[reparto.length - 1])}`}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        El link cobra la primera cuota{reparto.length ? ` (${dinero(reparto[0])})` : ''} y guarda la tarjeta. Las demás las cobra Stripe solas, una al mes desde el día que pague, y cada cobro salda su cuota en la venta.
                      </p>
                    </div>
                  )}

                  {referencia != null && descuento > 0 && esAdmin && (
                    <p className="text-xs text-muted-foreground">
                      Un {descuento} % menos que {venta ? 'lo pendiente de la venta' : 'el catálogo'} ({dinero(referencia, mon)}).
                    </p>
                  )}
                  {cfg && <p className="text-xs text-muted-foreground">El link caduca a los {cfg.caducidad_dias} días.</p>}
                </section>
              )}

              {/* Opcional: para un prospecto o una venta concretos */}
              <section className="border-t border-border pt-3" data-recorrido="links-asistente-para">
                <button type="button" onClick={() => setParaAlguien((v) => !v)} aria-expanded={paraAlguien}
                  className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
                  {paraAlguien ? <CaretDown size={12} aria-hidden="true" /> : <CaretRight size={12} aria-hidden="true" />}
                  Para un prospecto o una venta concretos (opcional)
                </button>
                {paraAlguien && (
                  <div className="mt-2 space-y-2">
                    {lead ? (
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate"><strong>{lead.nombre || `Prospecto ${lead.id}`}</strong>
                          {lead.email && <span className="text-muted-foreground"> · {lead.email}</span>}</span>
                        {!desdeFicha && (
                          <button type="button" className="text-xs underline text-muted-foreground" onClick={olvidarProspecto}>Quitar</button>
                        )}
                      </div>
                    ) : consulta ? (
                      <p className="text-xs text-muted-foreground">Cargando el prospecto…</p>
                    ) : (
                      <div>
                        <label htmlFor="link-buscar" className="sr-only">Buscar prospecto</label>
                        <div className="relative">
                          <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                          <input id="link-buscar" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
                            placeholder="Nombre, correo o teléfono" className={`${campo} pl-8`} />
                        </div>
                        {buscando && <p className="text-xs text-muted-foreground mt-1">Buscando…</p>}
                        {!buscando && busqueda.trim().length >= 2 && encontrados.length === 0 && (
                          <p className="text-xs text-muted-foreground mt-1">Ningún prospecto tuyo con «{busqueda.trim()}».</p>
                        )}
                        {encontrados.length > 0 && (
                          <ul className="mt-1 border border-border rounded-md divide-y divide-border max-h-40 overflow-y-auto">
                            {encontrados.map((l) => (
                              <li key={l.id}>
                                <button type="button" onClick={() => { setConsulta({ leadId: l.id }); setCursoId(''); setImporte(''); }}
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

                    {prospecto && (
                      <div role="radiogroup" aria-label="Venta del link" className="space-y-1.5">
                        <label className={`flex items-start gap-2 p-2 rounded-md border text-sm cursor-pointer ${ventaElegida === NUEVA ? 'border-primary bg-primary/5' : 'border-border'}`}>
                          <input type="radio" name="link-venta" value={NUEVA} checked={ventaElegida === NUEVA}
                            onChange={() => { setVentaElegida(NUEVA); setCursoId(''); setImporte(''); }} className="mt-1" />
                          <span className="min-w-0">
                            <span className="font-medium">Venta nueva</span>
                            <span className="block text-xs text-muted-foreground">Se crea sola al pagar, a tu nombre.</span>
                          </span>
                        </label>
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
                      </div>
                    )}
                  </div>
                )}
              </section>

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
          cuerpoInicial={`Hola${lead.nombre ? ` ${lead.nombre.split(' ')[0]}` : ''},\n\nAquí tienes el link para pagar${curso ? ` ${curso.nombre}` : ''} (${resumenHecho}):\n\n${hecho.url}\n\nEl link caduca el ${cuando(hecho.caduca_el)}. Si tienes cualquier duda, responde a este correo.\n\nUn saludo.`}
          onClose={() => setCorreoAbierto(false)}
        />
        </Suspense>
      )}
    </Portal>
  );
}
