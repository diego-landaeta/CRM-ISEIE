import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  LinkSimple, Copy, CheckCircle, MagnifyingGlass, ArrowSquareOut, WhatsappLogo, EnvelopeSimple, WarningCircle, CaretDown, CaretRight, ChatText,
  Ticket,
} from '@phosphor-icons/react';
import client from '@/shared/api/client';
import Portal from '@/shared/components/ui/portal';
import VerRecorrido from '@/shared/components/ui/VerRecorrido';
import usePermission from '@/shared/hooks/usePermission';
import { toast } from '@/shared/hooks/useToast';
import { useProjectContext } from '@/contexts/ProjectContext';
import AvisoConectarStripe, { AvisoCobroAutoApagado, tipoDeAviso } from './AvisoConectarStripe';
// El correo se carga al pulsar «Enviar por correo»: no hace falta para crear el link.
const LeadEmailDialog = lazy(() => import('@/modules/leads/components/LeadEmailDialog'));
import {
  crearLink, verConfig, ventasDelProspecto, cuotasDisponibles, listarCodigos, textoDelCodigo,
  type ConfigLinks, type CuotasDisponibles, type LinkDePago, type ProspectoDelLink, type VentaDelProspecto, type CodigoPromocional,
} from '../api/linksPago.api';
import { useWhatsappConectado, enviarPorWhatsapp, copiarMensaje } from './EnviarLink';

/*
  «CREAR LINK DE PAGO», EN UNA PANTALLA (Carlos y Diego, 20/11/2026).

  Carlos: «Hay que ponerlo más fácil. Y sin nombre de la persona. Crear link de
  pago > producto > pago único / cuotas > seleccionar. Y ya.» Diego: «que sea
  para hacerlo por cuotas y eso».

    1. el campus (solo si la persona tiene varios);
    2. el curso, con buscador: sale su precio del catálogo, que se puede bajar
       dentro del tope de descuento del campus;
    3. pago único o en cuotas, con lo que paga en cada una y CUÁNDO (Diego,
       23/11: «crear cuotas y elegir las fechas sí o sí»): una al mes de serie y
       cada fecha y cada importe se pueden cambiar. Con cobro automático, el link
       cobra la inicial y guarda la tarjeta, y Stripe cobra las demás en su fecha;
       sin él (la clave de Stripe no tiene permisos, el campus no lo permite…),
       cada cuota tiene su propio link con su vencimiento, y se dice aquí;
    4. «Crear link», y el link: copiar, abrir y, si va para un prospecto,
       mandarlo por WhatsApp o por correo.

  DOS RECORRIDOS (Diego, 21/11, CRM#982: «un enlace de pago es la inicial y lo
  otro son las cuotas, no únicamente con el monto del programa»):
    · Pago único: el precio sale del catálogo y se puede cambiar; con un descuento
      en € o en % sale el total, con el precio de antes a la vista. El link cobra
      ese total y la venta se crea por él.
    · Inicial + cuotas: sobre el total (también con descuento), la inicial que
      cobra el link y en cuántas cuotas iguales va lo que queda, con lo que es
      cada una y desde qué fecha. Stripe cobra las cuotas solas (cobro automático).
  El servidor rehace las cuentas: si no cuadran al céntimo, no crea nada.

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

/** `a - b` al céntimo, sin coma flotante (como el servidor). */
export function restaCentimos(a: number, b: number) {
  return (Math.round(a * 100) - Math.round(b * 100)) / 100;
}

export type TipoDescuento = 'monto' | 'pct';

/**
 * El total de un precio con su descuento (CRM#982), en céntimos y con enteros,
 * la misma cuenta que hace el servidor (`totalConDescuento` de la validación):
 * si no coincide al céntimo, el servidor no crea el link. null si el descuento
 * pasa del precio.
 */
export function totalConDescuento(precio: number, tipo: TipoDescuento, valor: number) {
  const precioC = Math.round(precio * 100);
  const descC = tipo === 'monto' ? Math.round(valor * 100) : Math.round((precioC * Math.round(valor * 100)) / 10000);
  if (!(precioC > 0) || descC < 0 || descC > precioC) return null;
  return { total: (precioC - descC) / 100, descuento: descC / 100 };
}

/** Las fechas de `n` pagos mensuales desde `desde` (AAAA-MM-DD), como el servidor. */
export function fechasMensuales(desde: string, n: number) {
  const [a, m, d] = desde.slice(0, 10).split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const ultimo = new Date(Date.UTC(a, m + i, 0)).getUTCDate();
    return new Date(Date.UTC(a, m - 1 + i, Math.min(d, ultimo))).toISOString().slice(0, 10);
  });
}

/** Hoy, en el reloj de quien mira, como AAAA-MM-DD. */
function hoyLocal(ahora = new Date()) {
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
}

const fechaCorta = (f: string) => f.split('-').reverse().join('/');

/** El día después de `f` (AAAA-MM-DD). */
function diaSiguiente(f: string) {
  const [a, m, d] = f.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * Las fechas de `n` cuotas: las que ya hay se quedan (la gestora pudo cambiarlas)
 * y las que faltan, una al mes después de la última; la primera, un mes después
 * de hoy. Con menos, se quitan las últimas.
 */
export function ajustarFechas(antes: string[], n: number, hoy: string) {
  if (antes.length >= n) return antes.slice(0, n);
  const base = antes.length ? antes[antes.length - 1] : hoy;
  return [...antes, ...fechasMensuales(base, n - antes.length + 1).slice(1)];
}

/**
 * Qué falla en las cuotas que se han escrito (23/11), en frases; vacío si nada.
 * Las mismas reglas que el servidor: al menos 0,50 € cada una, que sumen lo que
 * queda tras la inicial, la primera de mañana en adelante, cada una después de
 * la anterior y la última a menos de tres años.
 */
export function problemasDelPlan(filas: { importe: string; vence: string }[], resto: number, hoy: string) {
  const out: string[] = [];
  const importes = filas.map((f) => Number(String(f.importe).replace(',', '.')));
  if (importes.some((i) => !(i >= 0.5))) out.push('Cada cuota tiene que ser de al menos 0,50 €.');
  else {
    const suma = importes.reduce((t, i) => t + Math.round(i * 100), 0);
    if (suma !== Math.round(resto * 100)) {
      out.push(`Las cuotas suman ${dinero(suma / 100)} y tienen que sumar ${dinero(resto)} (lo que queda tras la inicial).`);
    }
  }
  const fechas = filas.map((f) => f.vence);
  if (fechas.some((f) => !/^\d{4}-\d{2}-\d{2}$/.test(f))) out.push('Pon la fecha de cada cuota.');
  else if (fechas.length) {
    if (!(fechas[0] > hoy)) out.push('La primera cuota tiene que ir de mañana en adelante: la de hoy es la inicial.');
    const mal = fechas.findIndex((f, i) => i > 0 && !(f > fechas[i - 1]));
    if (mal > 0) out.push(`La cuota ${mal + 1} tiene que ir después de la ${mal}.`);
    const [a, m, d] = hoy.split('-').map(Number);
    const tope = new Date(Date.UTC(a + 3, m - 1, d)).toISOString().slice(0, 10);
    if (fechas[fechas.length - 1] > tope) out.push('La última cuota no puede ir a más de 3 años.');
  }
  return out;
}

/**
 * Lo que se busca en «Para un prospecto» (23/11). La lista de prospectos exige el
 * campus (CRM#859): sin `projectId` ni `projectIds`, el cliente ni siquiera hace la
 * petición y devuelve una lista vacía. Por eso Daniela buscaba «34960254882» y no
 * salía nadie aunque hubiera cinco fichas con ese móvil. Se busca en todos los
 * campus de quien crea el link (el servidor los recorta a los suyos igual).
 */
export function paramsDeLaBusqueda(texto: string, campus: number[]) {
  const ids = [...new Set(campus.filter((id) => Number.isInteger(id) && id > 0))];
  return {
    search: texto.trim(), includeConverted: true, limit: 10,
    ...(ids.length === 1 ? { projectId: ids[0] } : { projectIds: ids.join(',') }),
  };
}

/** «3 × 200,00 €», «2 × 199,99 € y la última de 200,02 €» o «1 cuota de 600,00 €». */
export function textoDeLasCuotas(importes: number[]) {
  const n = importes.length;
  if (!n) return '';
  if (n === 1) return `1 cuota de ${dinero(importes[0])}`;
  return importes[0] === importes[n - 1]
    ? `${n} × ${dinero(importes[0])}`
    : `${n - 1} × ${dinero(importes[0])} y la última de ${dinero(importes[n - 1])}`;
}

/**
 * Cómo se paga un link en cuotas, en una frase. Con inicial (CRM#982), la inicial
 * con el link y las cuotas de lo que queda; los de antes, el total entre N.
 */
export function resumenDelPlan(l: Pick<LinkDePago, 'importe' | 'num_cuotas' | 'importe_cuota' | 'importe_inicial' | 'plan_cuotas' | 'guarda_tarjeta'>) {
  const n = Number(l.num_cuotas || 0);
  // Con las fechas que eligió la gestora (23/11): cada cuota con la suya.
  if (l.importe_inicial != null && Array.isArray(l.plan_cuotas) && l.plan_cuotas.length) {
    const fechas = l.plan_cuotas.map((c) => fechaCorta(String(c.vence).slice(0, 10))).join(', ');
    const como = l.guarda_tarjeta === false ? '; cada cuota, con su link' : '';
    return `${dinero(l.importe_inicial)} de inicial con el link y ${textoDeLasCuotas(l.plan_cuotas.map((c) => Number(c.importe)))} (${fechas})${como}`;
  }
  if (l.importe_inicial != null) {
    const resto = repartirEnCuotas(restaCentimos(Number(l.importe), Number(l.importe_inicial)), n - 1);
    return `${dinero(l.importe_inicial)} de inicial con el link y ${textoDeLasCuotas(resto)}, una al mes`;
  }
  return `en ${n} cuotas: ${dinero(l.importe_cuota)} al pagar el link y las demás, solas, cada mes`;
}

interface Curso { id: number; nombre: string; precio: string | number | null; moneda: string | null }

/*
  LA MONEDA DEL CAMPUS (CRM#986). Monedas sin decimales en Stripe: el importe va
  entero (1.500 CLP, no 1.500,50).
*/
const SIN_DECIMALES = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);

/**
 * La moneda que sale elegida (la misma regla que el servidor): desde una venta,
 * euros (lo pendiente está en euros); si el curso tiene precio en una moneda que
 * el campus admite, esa (el link sale con su precio); si no, la del campus.
 */
export function monedaPropuesta(cfg: Pick<ConfigLinks, 'monedas' | 'moneda_defecto'> | null, curso: Pick<Curso, 'precio' | 'moneda'> | null, desdeVenta = false) {
  const monedas = cfg?.monedas || [];
  if (desdeVenta && monedas.includes('EUR')) return 'EUR';
  const delCurso = curso?.moneda ? curso.moneda.trim().toUpperCase() : null;
  if (delCurso && curso?.precio != null && Number(curso.precio) > 0 && monedas.includes(delCurso)) return delCurso;
  return cfg?.moneda_defecto || 'EUR';
}
interface LeadEncontrado { id: number; nombre: string | null; email: string | null; telefono?: string | null; project_nombre?: string | null }
interface Campus { id: number; nombre: string }

export interface CrearLinkAsistenteProps {
  /** El prospecto, si ya se sabe (ficha del prospecto). */
  leadId?: number | null;
  /** La venta, si ya se sabe (ficha o fila de la venta): sale elegida. */
  conversionId?: number | null;
  onClose: () => void;
  onCreado?: (link: LinkDePago) => void;
  /** Cómo sale elegido el pago (los atajos de la pantalla «Links de pago», CRM#982). */
  formaInicial?: 'unico' | 'cuotas';
  /**
   * Desde el chat de WhatsApp (gemela de CRM#983): la conversación abierta (y de quién es la
   * sesión, si un admin mira la de otra). «Enviar por WhatsApp» manda el link ahí,
   * con su mensaje, sin abrir otra conversación.
   */
  conversacionId?: number | null;
  usuarioId?: number | null;
  onEnviado?: () => void;
}

/** «Nueva venta al pagar»: el link va al prospecto y la venta se crea con el cobro. */
const NUEVA = 'nueva';

export default function CrearLinkAsistente({
  leadId: leadInicial, conversionId: ventaInicial, onClose, onCreado, formaInicial = 'unico',
  conversacionId = null, usuarioId = null, onEnviado,
}: CrearLinkAsistenteProps) {
  const { can } = usePermission();
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
  // CRM#986: la moneda sigue al curso hasta que la gestora la cambia a mano.
  const [monedaTocada, setMonedaTocada] = useState(false);
  // CRM#986: si el link admite códigos promocionales, y los vigentes del campus.
  const [codigosPromo, setCodigosPromo] = useState(false);
  const [vigentes, setVigentes] = useState<CodigoPromocional[]>([]);
  const [forma, setForma] = useState<'unico' | 'cuotas'>(formaInicial);
  const [numCuotas, setNumCuotas] = useState(3);
  // CRM#982: descuento en € o en % sobre el precio, y la inicial de «inicial más cuotas».
  const [descTipo, setDescTipo] = useState<TipoDescuento>('pct');
  const [descValor, setDescValor] = useState('');
  const [inicial, setInicial] = useState('');
  const [inicialTocada, setInicialTocada] = useState(false);
  const [cuotas, setCuotas] = useState<CuotasDisponibles | null>(null);
  // 23/11: el importe y la fecha de cada cuota de después de la inicial.
  const [importesCuotas, setImportesCuotas] = useState<string[]>([]);
  const [fechasCuotas, setFechasCuotas] = useState<string[]>([]);

  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<LinkDePago | null>(null);
  const [correoAbierto, setCorreoAbierto] = useState(false);

  // Buscar prospectos (solo si se abre «para un prospecto» y no viene elegido).
  const idsDeCampus = campusPosibles.map((c) => c.id).join(',');
  useEffect(() => {
    if (!paraAlguien || consulta || busqueda.trim().length < 2) { setEncontrados([]); return undefined; }
    const ids = idsDeCampus ? idsDeCampus.split(',').map(Number) : [];
    if (!ids.length) { setEncontrados([]); return undefined; }
    const t = setTimeout(() => {
      setBuscando(true);
      client.get<LeadEncontrado[]>('/leads', { params: paramsDeLaBusqueda(busqueda, ids) })
        .then((r) => setEncontrados(Array.isArray(r?.data) ? r.data : []))
        .catch((e) => { setEncontrados([]); setError(errorDe(e)); })
        .finally(() => setBuscando(false));
    }, 250);
    return () => clearTimeout(t);
  }, [busqueda, consulta, paraAlguien, idsDeCampus]);

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
    setVigentes([]);
    setMonedaTocada(false);
    verConfig(projectId).then((r) => {
      if (!vigente || !r.data) return;
      setCfg(r.data);
      setMoneda(r.data.moneda_defecto);
      // Códigos promocionales (CRM#986): si el campus los admite, el link también, y los vigentes a la vista.
      setCodigosPromo(r.data.codigos_promo === true);
      if (r.data.codigos_promo) {
        listarCodigos(projectId).then((c) => { if (vigente) setVigentes(Array.isArray(c?.data) ? c.data : []); }).catch(() => {});
      }
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
  // Con inicial (CRM#982), las cuotas son las de después: de 1 al máximo del campus.
  const maxCuotas = Math.max(1, cuotas?.cuotas_max || cfg?.cuotas_max || 12);
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
  // La moneda del campus (CRM#986): la del curso si tiene precio en ella; desde una
  // venta, euros. Hasta que la gestora la cambie. En cuotas, siempre euros (`mon`).
  useEffect(() => {
    if (cfg && !monedaTocada) setMoneda(monedaPropuesta(cfg, curso, !!venta));
  }, [cfg, curso, venta, monedaTocada]);

  const cursosFiltrados = useMemo(() => {
    const q = filtroCurso.trim().toLowerCase();
    const lista = q ? cursos.filter((c) => c.nombre.toLowerCase().includes(q)) : cursos;
    // El elegido siempre a la vista, aunque el filtro no lo encuentre.
    return curso && !lista.includes(curso) ? [curso, ...lista] : lista;
  }, [cursos, filtroCurso, curso]);

  // `n`: el precio (sale del catálogo, o lo pendiente de la venta, y se puede cambiar).
  const n = Number(importe.replace(',', '.'));
  const mon = enCuotas ? 'EUR' : moneda;
  const precio = curso?.precio != null && Number(curso.precio) > 0
    && (!curso.moneda || curso.moneda.toUpperCase() === mon) ? Number(curso.precio) : null;

  /*
    EL DESCUENTO (CRM-ISEIE#657, gemela de CRM#982): en € o en % sobre ese precio,
    y el total que paga. Sin descuento, el total es el precio. Lo que se mide
    contra el tope del campus es el total, como siempre.
  */
  const dv = descValor.trim() ? Number(descValor.replace(',', '.')) : 0;
  const conDescuento = dv > 0;
  const descuentoMal = descValor.trim() !== '' && !(dv >= 0);
  const calculo = n > 0 && !descuentoMal ? totalConDescuento(n, descTipo, conDescuento ? dv : 0) : null;
  const total = calculo ? calculo.total : 0;
  const referencia = venta ? (mon === 'EUR' && venta.pendiente > 0 ? venta.pendiente : null) : precio;
  const descuento = referencia && total > 0 ? Math.max(0, Math.round(((referencia - total) / referencia) * 10000) / 100) : 0;

  /*
    INICIAL MÁS CUOTAS: el link cobra la inicial y lo que queda va en N cuotas.
    Desde el 23/11 (Diego: «crear cuotas y elegir las fechas sí o sí»), cada cuota
    con su importe (a partes iguales de serie, editable) y su fecha (una al mes
    desde hoy de serie, editable). Se mandan tal cual al servidor.
  */
  const ini = Number(inicial.replace(',', '.'));
  const resto = enCuotas && total > 0 && ini > 0 ? restaCentimos(total, ini) : 0;
  const hoy = hoyLocal();
  // La inicial que se propone: la parte de un reparto igual, hasta que se toca.
  useEffect(() => {
    if (enCuotas && !inicialTocada && total > 0) setInicial(String(repartirEnCuotas(total, numCuotas + 1)[0]));
  }, [enCuotas, inicialTocada, total, numCuotas]);
  // Al cambiar lo que queda o el número de cuotas, a partes iguales otra vez.
  useEffect(() => {
    setImportesCuotas(resto > 0 ? repartirEnCuotas(resto, numCuotas).map(String) : []);
  }, [resto, numCuotas]);
  // Las fechas: las que ya hay se quedan; las nuevas, una al mes.
  useEffect(() => { setFechasCuotas((antes) => ajustarFechas(antes, numCuotas, hoy)); }, [numCuotas, hoy]);
  const filasCuotas = importesCuotas.map((importe, i) => ({ importe, vence: fechasCuotas[i] || '' }));
  const importesPlan = filasCuotas.map((f) => Number(String(f.importe).replace(',', '.')));
  const cobroAuto = !!cuotas?.automatico;

  // Sin clave (o con una live en pruebas) el servidor no va a crear nada en este
  // campus: se dice en cuanto se sabe el campus y no se deja rellenar, en vez de
  // avisar después de rellenarlo todo (QA de /testeo del 18/11, gemela de CRM#948).
  const sinClave = (projectId && cfg?.aviso_clave) || null;
  // Cuotas sin cobro automático por la clave de Stripe (CRM-ISEIE#667, gemela de
  // CRM#992; desde el 23/11 ya no apaga las cuotas): el aviso que lleva a
  // Integraciones › Links de pago, con el motivo concreto.
  const tipoAviso = cuotas && !cuotas.automatico ? tipoDeAviso(cuotas.codigo) : null;
  const avisoConectar = !venta && tipoAviso === 'conectar' && projectId && cuotas
    ? <AvisoConectarStripe campus={[{ project_id: projectId, codigo: String(cuotas.codigo), motivo: cuotas.motivo }]} onIr={onClose} />
    : null;

  // Por qué no se puede crear todavía: siempre escrito, nunca un botón gris mudo.
  const motivos: string[] = [];
  if (paraAlguien && consulta && cargandoProspecto) motivos.push('Cargando el prospecto…');
  else if (paraAlguien && !consulta && !campusElegido) motivos.push('Elige el campus, o busca el prospecto.');
  else if (!projectId) motivos.push('Elige el campus.');
  else if (sinClave) motivos.push('Falta conectar Stripe en este campus.');
  else {
    if (!cfg) motivos.push('Cargando las reglas del campus…');
    if (cursosCargados && cursos.length === 0) motivos.push('Este campus no tiene cursos en el catálogo: sin curso no se puede crear el link.');
    if (cursos.length > 0 && !curso) motivos.push('Elige el curso.');
    if (!(n > 0)) motivos.push(venta && venta.pendiente <= 0 ? 'Esta venta ya está cobrada entera: no queda nada que cobrar con un link.' : 'Escribe el importe.');
    if (n > 0 && (descuentoMal || !calculo)) motivos.push('El descuento no puede superar el precio.');
    if (SIN_DECIMALES.has(mon) && total > 0 && !Number.isInteger(Math.round(total * 100) / 100)) {
      motivos.push(`En ${mon} el importe va sin decimales.`);
    }
    else if (n > 0 && calculo && !(total > 0)) motivos.push('Con ese descuento no queda nada que cobrar: el total tiene que ser mayor que 0.');
    if (venta && mon === 'EUR' && total > 0 && Math.round(total * 100) > Math.round(venta.pendiente * 100)) {
      motivos.push(`El link no puede pasar de lo pendiente de la venta (${dinero(venta.pendiente)}).`);
    }
    if (!esAdmin && cfg && referencia != null && descuento > cfg.descuento_max_pct) {
      motivos.push(cfg.descuento_max_pct > 0
        ? `Es un ${descuento} % menos que ${venta ? 'lo pendiente' : 'el catálogo'}; el máximo en este campus es un ${cfg.descuento_max_pct} %.`
        : `En este campus solo un admin puede bajar el importe de ${venta ? 'lo pendiente' : 'el catálogo'} (${dinero(referencia, mon)}).`);
    }
    if (!esAdmin && curso && referencia == null && total > 0) {
      motivos.push(venta
        ? `Lo pendiente de la venta está en EUR: un link en ${mon} lo tiene que crear un admin.`
        : `Este curso no tiene precio en el catálogo en ${mon}: el link lo tiene que crear un admin.`);
    }
    if (enCuotas) {
      if (!cuotas) motivos.push('Comprobando si este campus admite cuotas…');
      else if (!cuotas.disponible) motivos.push(cuotas.motivo || 'Este campus no admite cuotas.');
      if (total > 0) {
        if (!(ini > 0)) motivos.push('Escribe la inicial: lo que cobra el link al pagarlo.');
        else if (Math.round(ini * 100) >= Math.round(total * 100)) motivos.push('La inicial tiene que ser menor que el total.');
        else if (ini < 0.5) motivos.push('La inicial tiene que ser de al menos 0,50 €.');
        else motivos.push(...problemasDelPlan(filasCuotas, resto, hoy));
      }
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
        productId: curso.id, importe: total,
        // El precio y el descuento, para que el servidor rehaga la cuenta y los guarde.
        ...(conDescuento ? { precio_original: n, descuento_tipo: descTipo, descuento_valor: dv } : {}),
        ...(enCuotas ? {
          modalidad: 'cuotas' as const, num_cuotas: numCuotas, inicial: ini,
          cuotas: filasCuotas.map((f, i) => ({ importe: importesPlan[i], vence: f.vence })),
        } : { moneda }),
        // CRM#986: solo donde caben (pago único, sin venta y el campus los admite).
        ...(cfg?.codigos_promo && !enCuotas && !venta ? { codigos_promo: codigosPromo } : {}),
      });
      if (r.data) { setHecho(r.data); onCreado?.(r.data); } else setError('El servidor no ha devuelto el link. Mira la lista de links antes de crear otro.');
    } catch (e) {
      setError(`No se ha creado el link. ${errorDe(e)}`);
    } finally { setEnviando(false); }
  }

  /*
    (gemela de CRM#983) «Enviar por WhatsApp» MANDA el link, con su mensaje, en la conversación
    del CRM con el prospecto (o en la del chat desde el que se abrió). Antes lo
    copiaba y abría el chat para pegarlo a mano. Solo con WhatsApp conectado.
  */
  const [enviandoWa, setEnviandoWa] = useState(false);
  const [enviadoWa, setEnviadoWa] = useState(false);
  async function porWhatsapp() {
    const leadId = prospecto?.lead.id;
    if (!hecho?.url || (!leadId && !conversacionId)) return;
    setEnviandoWa(true);
    try {
      await enviarPorWhatsapp(hecho, { leadId, nombre: prospecto?.lead.nombre, conversacionId, usuarioId });
      setEnviadoWa(true);
      toast({ title: 'Link enviado por WhatsApp', description: 'Ha salido en la conversación del CRM, con su mensaje.' });
      onEnviado?.();
    } catch (e) {
      toast({ title: 'No se ha podido enviar', description: `${errorDe(e)} Puedes copiar el mensaje y mandarlo a mano.`, variant: 'destructive' });
    } finally { setEnviandoWa(false); }
  }

  function olvidarProspecto() {
    setConsulta(null); setProspecto(null); setVentaElegida(NUEVA); setCursoId(''); setImporte('');
  }

  const conDescuentoHecho = hecho && hecho.descuento_tipo && Number(hecho.descuento_importe) > 0 && hecho.precio_original != null
    ? ` (precio ${dinero(hecho.precio_original, hecho.moneda)} menos ${dinero(hecho.descuento_importe, hecho.moneda)} de descuento)`
    : '';

  const campo = 'w-full h-10 px-3 rounded-md border border-border bg-card text-sm';
  const lead = prospecto?.lead;
  const waConectado = useWhatsappConectado(!!hecho && !!(lead || conversacionId));
  const ventas = prospecto?.ventas || [];
  const desdeFicha = !!(leadInicial || ventaInicial);
  const nombreCampus = campusPosibles.find((c) => c.id === projectId)?.nombre;

  const resumenHecho = hecho && (hecho.modalidad === 'cuotas' && hecho.num_cuotas
    ? `${dinero(hecho.importe)}${conDescuentoHecho}: ${resumenDelPlan(hecho)}`
    : `${dinero(hecho.importe, hecho.moneda)}${conDescuentoHecho}${hecho.codigos_promo ? ' · admite códigos promocionales' : ''}`);

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
            {/* El recorrido del asistente (CRM#1012): solo al pulsarlo. Va dentro de
                la ventana: la cabecera queda debajo y no se puede pulsar. */}
            {!hecho && <VerRecorrido id="links-asistente" compacto dentroDe='[data-recorrido="links-asistente"]' />}
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
                {hecho.url && (
                  <button type="button" onClick={() => copiarMensaje(hecho, lead?.nombre)}
                    className="inline-flex items-center gap-1 h-9 px-3 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted">
                    <ChatText size={14} weight="bold" aria-hidden="true" /> Copiar mensaje
                  </button>
                )}
                {(lead || conversacionId) && waConectado && (
                  <button type="button" onClick={porWhatsapp} disabled={enviandoWa || enviadoWa}
                    className={`inline-flex items-center gap-1 h-9 px-3 rounded-md text-sm font-semibold disabled:opacity-60 ${conversacionId
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'border border-border bg-card hover:bg-muted'}`}>
                    <WhatsappLogo size={14} weight="bold" aria-hidden="true" />
                    {enviadoWa ? 'Enviado por WhatsApp' : enviandoWa ? 'Enviando…' : conversacionId ? 'Enviar en este chat' : 'Enviar por WhatsApp'}
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

              {sinClave && (
                <div role="alert" data-recorrido="links-asistente-sin-clave" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-foreground">
                  <WarningCircle size={18} weight="fill" className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                  <p>
                    <span className="font-semibold block">FALTA CONECTAR STRIPE</span>
                    {sinClave.error}
                  </p>
                </div>
              )}
              {sinClave && avisoConectar}

              <fieldset disabled={!!sinClave} aria-disabled={!!sinClave} className="space-y-4 min-w-0 disabled:opacity-60">
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
                      <label htmlFor="link-importe" className="text-xs text-muted-foreground mb-1 block">{enCuotas ? 'Precio del programa' : 'Importe'}</label>
                      <input id="link-importe" type="text" inputMode="decimal" value={importe} aria-label="Importe"
                        onChange={(e) => setImporte(e.target.value)} className={`${campo} tabular-nums`} />
                    </div>
                    {!enCuotas && (cfg?.monedas.length || 0) > 1 && (
                      <div>
                        <label htmlFor="link-moneda" className="text-xs text-muted-foreground mb-1 block">Moneda</label>
                        <select id="link-moneda" value={moneda} onChange={(e) => { setMoneda(e.target.value); setMonedaTocada(true); }} className={campo}>
                          {(cfg?.monedas || []).map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Descuento en € o en % (CRM#982): calcula el total, con el precio a la vista */}
                  <div className="space-y-1" data-recorrido="links-asistente-descuento">
                    <label htmlFor="link-descuento" className="text-xs text-muted-foreground block">Descuento (opcional)</label>
                    <div className="flex gap-2">
                      <input id="link-descuento" type="text" inputMode="decimal" value={descValor} aria-label="Descuento"
                        placeholder="0" onChange={(e) => setDescValor(e.target.value)} className={`${campo} tabular-nums`} />
                      <select value={descTipo} aria-label="Tipo de descuento" onChange={(e) => setDescTipo(e.target.value as TipoDescuento)}
                        className="h-10 px-2 rounded-md border border-border bg-card text-sm">
                        <option value="pct">%</option>
                        <option value="monto">{mon === 'EUR' ? '€' : mon}</option>
                      </select>
                    </div>
                    {conDescuento && calculo && total > 0 && (
                      <p className="text-sm" aria-live="polite" data-testid="link-total">
                        Total <strong className="tabular-nums">{dinero(total, mon)}</strong>
                        <span className="text-xs text-muted-foreground">
                          {' '}· precio <s className="tabular-nums">{dinero(n, mon)}</s> menos {dinero(calculo.descuento, mon)}
                          {descTipo === 'pct' ? ` (${String(dv).replace('.', ',')} %)` : ''}
                        </span>
                      </p>
                    )}
                    {!venta && precio != null && Math.round(n * 100) !== Math.round(precio * 100) && n > 0 && (
                      <p className="text-xs text-muted-foreground">Precio del catálogo: {dinero(precio, mon)}.</p>
                    )}
                  </div>

                  {venta ? (
                    <p className="text-xs text-muted-foreground">
                      Pago único por lo pendiente de la venta ({dinero(venta.pendiente)}): el link no puede pasar de ahí. Para cobrarla a plazos, «Generar plan de pago» en la venta.
                    </p>
                  ) : (
                    <div role="radiogroup" aria-label="Cómo paga" className="grid grid-cols-2 gap-2" data-recorrido="links-asistente-forma">
                      <label className={`flex items-center gap-2 p-2.5 rounded-md border text-sm cursor-pointer ${forma === 'unico' ? 'border-primary bg-primary/5' : 'border-border'}`}>
                        <input type="radio" name="link-forma" checked={forma === 'unico'} onChange={() => setForma('unico')} />
                        <span><span className="font-medium block">Pago único</span><span className="text-xs text-muted-foreground">Todo de una vez</span></span>
                      </label>
                      <label className={`flex items-center gap-2 p-2.5 rounded-md border text-sm ${cuotas && !cuotas.disponible ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'} ${forma === 'cuotas' ? 'border-primary bg-primary/5' : 'border-border'}`}>
                        <input type="radio" name="link-forma" checked={forma === 'cuotas'} disabled={!!cuotas && !cuotas.disponible}
                          onChange={() => setForma('cuotas')} />
                        <span><span className="font-medium block">Inicial + cuotas</span><span className="text-xs text-muted-foreground">
                          {cuotas && !cuotas.automatico ? 'El link cobra la inicial; cada cuota, con su link' : 'El link cobra la inicial; las cuotas, solas'}
                        </span></span>
                      </label>
                    </div>
                  )}
                  {/* Códigos promocionales de campaña (CRM#986): solo en pago único y sin venta. */}
                  {!venta && !enCuotas && cfg?.codigos_promo && (
                    <div className="space-y-1" data-recorrido="links-asistente-codigos">
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={codigosPromo} onChange={(e) => setCodigosPromo(e.target.checked)} />
                        <Ticket size={14} aria-hidden="true" /> Admite códigos promocionales
                      </label>
                      {codigosPromo && (
                        <p className="text-xs text-muted-foreground" data-testid="link-codigos-vigentes">
                          {vigentes.length
                            ? <>El alumno puede escribir al pagar: {vigentes.map((c) => `${c.codigo} (−${textoDelCodigo(c)}, hasta el ${fechaCorta(c.caduca_el)})`).join(' · ')}. Lo que descuente queda en la venta.</>
                            : <>El alumno puede escribir un código de campaña al pagar; ahora no hay ninguno vigente en este campus.</>}
                        </p>
                      )}
                    </div>
                  )}
                  {/* Cuotas en otra moneda (CRM#986): van en euros, y se dice. */}
                  {!venta && enCuotas && cfg && cfg.moneda_defecto !== 'EUR' && (
                    <p className="text-xs text-muted-foreground" data-testid="link-cuotas-en-euros">
                      Las cuotas van en euros: el CRM lleva en euros el plan de cada venta. Para cobrar en {cfg.moneda_defecto}, pago único.
                    </p>
                  )}
                  {/* Sin cuotas solo si el campus no las admite (en euros): el texto. */}
                  {!venta && cuotas && !cuotas.disponible && (
                    <p className="text-xs text-muted-foreground" data-recorrido="links-asistente-cuotas-no">
                      Cuotas no disponibles: {cuotas.motivo}
                    </p>
                  )}
                  {/* 23/11: sin cobro automático, las cuotas siguen (cada una con su link)
                      y se dice por qué. CRM#992: si es por la clave de Stripe, el aviso
                      que lleva a ponerla (sin clave de links va arriba); si es el
                      interruptor del servidor, que no está activo aquí. */}
                  {!venta && enCuotas && cuotas?.disponible && !cuotas.automatico && (
                    <div className="space-y-2" data-recorrido="links-asistente-cuotas-sin-auto">
                      <p role="status" data-testid="aviso-cuotas-sin-auto"
                        className="flex items-start gap-1.5 rounded-md border border-border bg-muted/30 p-2.5 text-xs text-muted-foreground">
                        <WarningCircle size={14} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
                        <span>
                          <span className="font-semibold text-foreground">El cobro no será automático: cada cuota tendrá su propio link.</span>{' '}
                          Al pagar la inicial se crea un link por cuota, con su fecha de vencimiento; los verás en la venta y en «Links de pago» para mandarlos cuando toque.
                          {tipoAviso !== 'conectar' && tipoAviso !== 'entorno' && cuotas.motivo ? ` (${cuotas.motivo})` : ''}
                        </span>
                      </p>
                      {tipoAviso === 'conectar' ? (!sinClave && avisoConectar)
                        : tipoAviso === 'entorno' ? <AvisoCobroAutoApagado motivo={cuotas.motivo} /> : null}
                    </div>
                  )}

                  {enCuotas && (
                    <div className="rounded-md border border-border p-3 space-y-2" data-recorrido="links-asistente-cuotas">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="link-inicial" className="text-xs text-muted-foreground mb-1 block">Inicial (la cobra el link)</label>
                          <input id="link-inicial" type="text" inputMode="decimal" value={inicial} aria-label="Inicial"
                            onChange={(e) => { setInicial(e.target.value); setInicialTocada(true); }} className={`${campo} tabular-nums`} />
                        </div>
                        <div>
                          <label htmlFor="link-num-cuotas" className="text-xs text-muted-foreground mb-1 block">Cuotas</label>
                          <select id="link-num-cuotas" value={numCuotas} onChange={(e) => setNumCuotas(Number(e.target.value))}
                            className={campo}>
                            {Array.from({ length: maxCuotas }, (_, i) => i + 1).map((k) => <option key={k} value={k}>{k}</option>)}
                          </select>
                        </div>
                      </div>
                      {filasCuotas.length > 0 && (
                        <>
                          <p className="text-sm" aria-live="polite" data-testid="link-resumen-cuotas">
                            Quedan <strong className="tabular-nums">{dinero(resto)}</strong> en{' '}
                            <strong className="tabular-nums">{textoDeLasCuotas(importesPlan.map((x) => (x > 0 ? x : 0)))}</strong>.
                          </p>
                          <table className="w-full text-sm" data-testid="link-plan-cuotas">
                            <thead>
                              <tr className="text-xs text-muted-foreground">
                                <th className="text-left font-medium pb-1">Cuota</th>
                                <th className="text-left font-medium pb-1">Importe (€)</th>
                                <th className="text-left font-medium pb-1">Fecha</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filasCuotas.map((f, i) => (
                                <tr key={i}>
                                  <td className="pr-2 py-0.5 text-xs text-muted-foreground tabular-nums">{i + 1}</td>
                                  <td className="pr-2 py-0.5">
                                    <input type="text" inputMode="decimal" value={f.importe} aria-label={`Importe de la cuota ${i + 1}`}
                                      onChange={(e) => setImportesCuotas((xs) => xs.map((x, k) => (k === i ? e.target.value : x)))}
                                      className="w-full h-9 px-2 rounded-md border border-border bg-card text-sm tabular-nums" />
                                  </td>
                                  <td className="py-0.5">
                                    <input type="date" value={f.vence} min={diaSiguiente(hoy)} aria-label={`Fecha de la cuota ${i + 1}`}
                                      onChange={(e) => setFechasCuotas((xs) => xs.map((x, k) => (k === i ? e.target.value : x)))}
                                      className="w-full h-9 px-2 rounded-md border border-border bg-card text-sm" />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div className="flex flex-wrap gap-3">
                            <button type="button" className="text-xs underline text-muted-foreground hover:text-foreground"
                              onClick={() => setImportesCuotas(repartirEnCuotas(resto, numCuotas).map(String))}>
                              Repartir a partes iguales
                            </button>
                            <button type="button" className="text-xs underline text-muted-foreground hover:text-foreground"
                              onClick={() => setFechasCuotas(ajustarFechas([], numCuotas, hoy))}>
                              Una al mes desde hoy
                            </button>
                          </div>
                        </>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {cobroAuto
                          ? <>Al pagar, el link cobra la inicial{ini > 0 ? ` (${dinero(ini)})` : ''} y guarda la tarjeta. Stripe cobra cada cuota sola en su fecha, y cada cobro salda su cuota en la venta.</>
                          : <>Al pagar, el link cobra la inicial{ini > 0 ? ` (${dinero(ini)})` : ''} y se crea un link por cuota, que vence en su fecha. Cada cobro salda su cuota en la venta.</>}
                      </p>
                    </div>
                  )}

                  {referencia != null && descuento > 0 && esAdmin && !conDescuento && (
                    <p className="text-xs text-muted-foreground">
                      Un {descuento} % menos que {venta ? 'lo pendiente de la venta' : 'el catálogo'} ({dinero(referencia, mon)}).
                    </p>
                  )}
                  {cfg && <p className="text-xs text-muted-foreground">El link caduca a los {cfg.caducidad_dias} días.</p>}
                </section>
              )}
              </fieldset>

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

              {motivos.length > 0 && !cargandoProspecto && !sinClave && (
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
              {hecho || sinClave ? 'Cerrar' : 'Cancelar'}
            </button>
            {!hecho && (
              <button type="button" onClick={enviar} disabled={enviando || motivos.length > 0} data-recorrido="links-asistente-crear"
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
