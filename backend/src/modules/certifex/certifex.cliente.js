import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';

/**
 * Como se habla con la API de Certifex (/api/crm/v1). Vive aparte para que Emisiones,
 * Diplomas, la emision comun y el alcance por campus lo usen sin importarse entre si.
 *
 * Se habla con Certifex SIEMPRE desde este servidor. La clave (`CERTIFEX_CRM_CLAVE`,
 * con forma `cfx_crm_...`) vive solo en el .env del servidor: el navegador no la ve.
 * Contrato: docs/integracion-crm.md en el repo de Certifex.
 */

export function config() {
  const url = (process.env.CERTIFEX_API_URL || '').trim().replace(/\/+$/, '');
  const clave = (process.env.CERTIFEX_CRM_CLAVE || '').trim();
  return url && clave ? { url, clave } : null;
}

/**
 * La web publica de Certifex, donde viven la verificacion y el diploma de cada titulo.
 * Por defecto la misma que la API; `CERTIFEX_PUBLICO_URL` por si alguna vez se separan.
 * No es secreta: es lo que ve cualquiera que escanee el QR de un diploma.
 */
export function urlPublica() {
  return ((process.env.CERTIFEX_PUBLICO_URL || process.env.CERTIFEX_API_URL || '').trim().replace(/\/+$/, '')) || null;
}

/** ¿Una direccion que solo abre desde el propio servidor o su red (localhost, 127.x, IP privada)? */
export function esDireccionLocal(url) {
  let h;
  try { h = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, ''); } catch { return true; }
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h === '::' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || a === 0 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/**
 * La web publica de Certifex, solo si de verdad es publica, con el motivo si no
 * (Certifex#96). El 12/10 el Certifex de pruebas escuchaba en 127.0.0.1:3017 y el panel
 * ensenaba enlaces que no abrian: un enlace local no puede llegar nunca a la pantalla.
 * Desde el servidor si vale (el PDF se trae por aqui); lo que se mira es lo que se enlaza.
 *
 * `yo` es la respuesta de Certifex a `/yo`: su `direccionPublica` dice si SUS enlaces
 * (los de `/diplomas`, los QR y los correos) abren desde fuera.
 */
export function direccionPublica(yo) {
  const motivos = [];
  const desarrollo = ['development', 'test'].includes(String(process.env.NODE_ENV || '').toLowerCase());
  const pub = urlPublica();
  if (pub && esDireccionLocal(pub) && !desarrollo) {
    motivos.push(`El CRM enlaza Certifex en ${pub}, que solo abre desde el servidor: define CERTIFEX_PUBLICO_URL con su dominio público.`);
  }
  if (yo?.direccionPublica && yo.direccionPublica.ok === false) {
    motivos.push(yo.direccionPublica.motivo || 'Certifex no tiene una dirección pública: sus enlaces y sus avisos al alumno no saldrían.');
  }
  return { url: motivos.length && pub && esDireccionLocal(pub) && !desarrollo ? null : pub, ok: motivos.length === 0, motivos };
}

/**
 * Una llamada a la API de Certifex. Los errores salen con un mensaje que la pantalla
 * puede ensenar tal cual; la clave no aparece nunca en un log.
 */
export async function certifex(metodo, ruta, cuerpo, { timeoutMs = 20_000 } = {}) {
  const c = config();
  if (!c) throw new AppError('Certifex no esta conectado: faltan CERTIFEX_API_URL y CERTIFEX_CRM_CLAVE en el servidor.', 503, 'CERTIFEX_SIN_CONFIGURAR');
  let r;
  try {
    r = await fetch(`${c.url}/api/crm/v1${ruta}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${c.clave}`, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    logger.error({ err: e.message, ruta }, 'Certifex: no responde');
    throw new AppError('Certifex no responde. Prueba de nuevo en un momento.', 502, 'CERTIFEX_NO_RESPONDE');
  }
  const datos = await r.json().catch(() => null);
  if (r.status === 401) throw new AppError('Certifex no acepta la clave de este CRM (CERTIFEX_CRM_CLAVE).', 502, 'CERTIFEX_CLAVE');
  if (!r.ok) throw new AppError(datos?.error || `Certifex respondio ${r.status}`, r.status >= 500 ? 502 : r.status, 'CERTIFEX_ERROR');
  return datos;
}

// ─────────────────────────────────────────────── lo que sabe hacer el Certifex conectado

/**
 * ¿El Certifex conectado tiene ya esta ruta POST? Se pregunta con un cuerpo vacio: si la
 * tiene, contesta con SU error de validacion (400, o el 404/409 de lo que no encuentra);
 * si no, con su 404 generico «No encontrado.». Asi el CRM no ofrece un boton que fallaria
 * a medias mientras Certifex no este desplegado (#351). Se recuerda 5 minutos.
 *
 * Si no se puede saber (Certifex no contesta, la clave no vale, un proxy devuelve HTML),
 * lanza ese error: no se confunde «no se pudo preguntar» con «no lo tiene».
 */
const CAPACIDAD_MS = 5 * 60_000;
let capacidades = new Map();

export async function certifexTieneRuta(ruta) {
  const sabido = capacidades.get(ruta);
  if (sabido && Date.now() < sabido.hasta) return sabido.valor;
  let valor;
  try {
    await certifex('POST', ruta, {}, { timeoutMs: 10_000 });
    valor = true; // un 200 con el cuerpo vacio no deberia pasar, pero la ruta existe
  } catch (e) {
    // Solo cuenta lo que contesta Certifex con su JSON (`{ error }`). Sin el, `certifex()`
    // pone «Certifex respondio N»: no se sabe de quien es la respuesta.
    const deCertifex = e.code === 'CERTIFEX_ERROR' && !/^Certifex respondio \d+$/.test(String(e.message));
    if (deCertifex && e.statusCode === 404 && String(e.message).trim() === 'No encontrado.') valor = false;
    else if (deCertifex && [400, 404, 409, 422].includes(e.statusCode)) valor = true;
    else {
      logger.warn({ err: e.message, code: e.code, ruta }, 'Certifex: no se pudo saber si tiene la ruta');
      throw e;
    }
  }
  capacidades.set(ruta, { valor, hasta: Date.now() + CAPACIDAD_MS });
  return valor;
}

/** Para las pruebas: olvida lo sabido de Certifex. */
export function olvidarCapacidades() {
  capacidades = new Map();
}

// ─────────────────────────────────────────────── recorrer paginas de Certifex

/** Lo mas grande que da Certifex por pagina, y hasta donde se recorre (10 000 filas). */
export const TAM_CERTIFEX = 200;
const MAX_PAGINAS = 50;

/**
 * Recorre un listado de Certifex pagina a pagina, quedandose con lo que pasa `filtro`.
 *
 *  · `completo(filas)`: ya esta todo lo que se buscaba; se deja de pedir. No depende
 *    del orden.
 *  · `antiguo(fila)` con `fecha(fila)`: Certifex no filtra por fechas, pero en su base
 *    ordena lo mas reciente primero. Se deja de pedir cuando una pagina ENTERA llega
 *    ordenada (tambien respecto a la anterior) y su ultima fila ya es anterior a lo que
 *    se busca. Si alguna vez llega desordenada, no se para por fecha: se recorre todo.
 *    (El Certifex de pruebas, con el repositorio en memoria, no ordena: con una parada
 *    por la primera fila antigua, «desde hoy» devolvia vacio.)
 */
export async function recorrer(ruta, params, { filtro = () => true, completo = () => false, antiguo = null, fecha = null } = {}) {
  const filas = [];
  let ordenado = true;
  let previa = null;
  for (let p = 1; p <= MAX_PAGINAS; p++) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    qs.set('pagina', String(p));
    qs.set('tam', String(TAM_CERTIFEX));
    const d = await certifex('GET', `${ruta}?${qs.toString()}`);
    const lote = Array.isArray(d?.filas) ? d.filas : [];
    for (const f of lote) {
      if (filtro(f)) filas.push(f);
      if (completo(filas)) return { filas, truncado: false };
      if (fecha) {
        const t = fecha(f) || null;
        if (previa && t && t > previa) ordenado = false;
        if (t) previa = t;
      }
    }
    if (lote.length < TAM_CERTIFEX || p * TAM_CERTIFEX >= Number(d?.total ?? 0)) return { filas, truncado: false };
    const ultima = lote[lote.length - 1];
    if (antiguo && fecha && ordenado && ultima && antiguo(ultima)) return { filas, truncado: false };
  }
  return { filas, truncado: true };
}
