import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { getDecryptedValue } from '../credentials/credentials.model.js';
import { certifex, recorrer } from './certifex.cliente.js';
import { alcanceDe, exigirCentro } from './certifex.alcance.js';

/**
 * ENVÍOS DE UN DIPLOMA, PREGUNTADOS A BREVO (Diego, 05/11/2026).
 *
 * «Necesito ver en el CRM el justificante del envío del diploma»: cuándo salió el correo,
 * a qué dirección, si se entregó y si se abrió. El correo lo manda Certifex con Brevo, y
 * Certifex usa la MISMA cuenta de Brevo que este CRM: con la clave del CRM se le pregunta a
 * Brevo por los eventos del correo del alumno y se quedan los de su diploma.
 *
 *   GET /api/certifex/diplomas/envios?exp=<nexpediente>
 *
 * Lo ve quien ve Diplomas (`diplomas.view`, o quien emite), y solo de sus campus: un
 * diploma de otro campus contesta 404, como su PDF.
 *
 * Brevo es opcional: sin clave, o si no contesta, 200 con la lista vacía y el motivo. La
 * clave no sale nunca de aquí. Brevo guarda estos eventos un tiempo limitado (90 días).
 *
 * Segunda fase (aparte): que Certifex guarde él mismo el destinatario, el asunto y el
 * identificador de cada envío; esto no lo necesita.
 */

const NEXP = /^[A-Z]{2,6}-\d{4}-\d{6}-[A-Z0-9]{4}$/;
const NO_ENCONTRADO = 'Diploma no encontrado (o no es de tus campus).';
const BREVO_EVENTOS = 'https://api.brevo.com/v3/smtp/statistics/events';

/** La clave de Brevo del CRM: la guardada (cifrada) en la base y, si no hay, la del .env. */
async function claveBrevo() {
  try {
    const deLaBase = await getDecryptedValue('brevo', null);
    if (deLaBase) return deLaBase;
  } catch (err) {
    logger.warn({ err: err.message }, 'envios: no se pudo leer la clave de Brevo de la base');
  }
  const k = process.env.BREVO_API_KEY;
  return k && k !== 'test' ? k : null;
}

/** El diploma, de Certifex: su campus, el alumno, la formación y el curso. */
async function diplomaDe(nexp) {
  const d = await certifex('GET', `/diplomas?${new URLSearchParams({ estado: 'todos', q: nexp, pagina: '1', tam: '5' })}`);
  return (Array.isArray(d?.filas) ? d.filas : []).find((x) => x.nexpediente === nexp) || null;
}

/**
 * El correo del alumno al que Certifex manda el diploma: el del titular de la matrícula
 * de la que salió. Se busca por su nombre y, si no, recorriendo las del curso.
 */
async function correoDelAlumno(d) {
  const deEsta = (c) => c?.nexpediente === d.nexpediente;
  const correo = (c) => String(c?.titular?.email || '').trim().toLowerCase() || null;
  try {
    const r = await certifex('GET', `/candidatos?${new URLSearchParams({ estado: 'todas', centro: d.centro, q: String(d.alumno || '').slice(0, 100), pagina: '1', tam: '50' })}`);
    const c = (Array.isArray(r?.filas) ? r.filas : []).find(deEsta);
    if (c) return correo(c);
  } catch (err) {
    logger.warn({ err: err.message, nexp: d.nexpediente }, 'envios: no se encontró la matrícula por el nombre');
  }
  const params = { estado: 'todas', centro: d.centro };
  if (d.cursoRef != null) params.curso = String(d.cursoRef);
  const r = await recorrer('/candidatos', params, { filtro: deEsta, completo: (h) => h.length >= 1 });
  return r.filas[0] ? correo(r.filas[0]) : null;
}

const PROBLEMAS = new Set(['bounces', 'hardBounces', 'softBounces', 'blocked', 'spam', 'invalid', 'error', 'deferred', 'unsubscribed']);
const ABIERTO = new Set(['opened', 'uniqueOpened', 'loadedByProxy']);
const sinAcentos = (t) => String(t || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** ¿Es un correo de diploma de Certifex? El asunto dice «diploma» (o lo manda Certifex). */
export const esDeDiploma = (e) => sinAcentos(e.subject).includes('diplom') || /certifex/i.test(String(e.from || ''));

/**
 * Los eventos de Brevo agrupados por correo (messageId): cuándo se pidió el envío,
 * cuándo se entregó, cuándo se abrió por primera vez y cualquier rebote o error.
 */
export function agruparEventos(eventos) {
  const porId = new Map();
  for (const e of eventos) {
    const id = String(e.messageId || '').trim();
    const fecha = new Date(e.date);
    if (!id || Number.isNaN(fecha.getTime())) continue;
    const iso = fecha.toISOString();
    if (!porId.has(id)) {
      porId.set(id, {
        messageId: id, asunto: e.subject || null, remitente: e.from || null, destinatario: e.email || null,
        enviadoEn: null, entregadoEn: null, abiertoEn: null, problemas: [],
      });
    }
    const g = porId.get(id);
    g.asunto ||= e.subject || null;
    g.remitente ||= e.from || null;
    g.destinatario ||= e.email || null;
    const antes = (a) => !a || iso < a;
    if (e.event === 'requests' && antes(g.enviadoEn)) g.enviadoEn = iso;
    else if (e.event === 'delivered' && antes(g.entregadoEn)) g.entregadoEn = iso;
    else if (ABIERTO.has(e.event) && antes(g.abiertoEn)) g.abiertoEn = iso;
    else if (PROBLEMAS.has(e.event)) g.problemas.push({ evento: e.event, fecha: iso, motivo: e.reason || null });
  }
  const lista = [...porId.values()];
  for (const g of lista) g.problemas.sort((a, b) => a.fecha.localeCompare(b.fecha));
  // Lo más reciente primero (sin «requests», por su primer evento).
  const cuando = (g) => g.enviadoEn || g.entregadoEn || g.problemas[0]?.fecha || g.abiertoEn || '';
  return lista.sort((a, b) => cuando(b).localeCompare(cuando(a)));
}

/** Pregunta a Brevo. Nunca lanza: { envios, motivo }. */
async function enviosEnBrevo(email) {
  const clave = await claveBrevo();
  if (!clave) return { envios: [], motivo: 'Brevo no está configurado en este CRM: no se puede consultar el envío.' };
  try {
    const qs = new URLSearchParams({ email, days: '90', limit: '50', sort: 'desc' });
    const r = await fetch(`${BREVO_EVENTOS}?${qs}`, {
      headers: { 'api-key': clave, accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      logger.warn({ status: r.status }, 'envios: Brevo no contestó bien');
      return { envios: [], motivo: `Brevo respondió ${r.status}: no se pudo consultar el envío.` };
    }
    const d = await r.json().catch(() => null);
    const eventos = (Array.isArray(d?.events) ? d.events : []).filter(esDeDiploma);
    const envios = agruparEventos(eventos);
    return { envios, motivo: envios.length ? null : 'Brevo no tiene ningún correo de diploma a esta dirección en los últimos 90 días.' };
  } catch (err) {
    logger.warn({ err: err.message }, 'envios: Brevo no responde');
    return { envios: [], motivo: 'Brevo no responde ahora mismo: prueba de nuevo en un momento.' };
  }
}

/** GET /api/certifex/diplomas/envios?exp=<nexpediente> */
export async function envios(req, res, next) {
  try {
    const nexp = String(req.query.exp || '').trim().toUpperCase();
    if (!NEXP.test(nexp)) throw new AppError('Numero de expediente no valido', 400, 'VALIDATION_ERROR');
    const d = await diplomaDe(nexp);
    if (!d) throw new AppError(NO_ENCONTRADO, 404, 'NOT_FOUND');
    exigirCentro(await alcanceDe(req.user), d.centro, NO_ENCONTRADO);
    const base = { nexpediente: nexp, centro: d.centro, alumno: d.alumno ?? null, titulacion: d.titulacion ?? null };
    const email = await correoDelAlumno(d);
    if (!email) {
      return res.json({ success: true, data: { ...base, email: null, envios: [], motivo: 'Certifex no tiene el correo de este alumno: no hay a quién preguntar en Brevo.' } });
    }
    const { envios: lista, motivo } = await enviosEnBrevo(email);
    res.json({ success: true, data: { ...base, email, envios: lista, motivo } });
  } catch (err) { next(err); }
}

// ─────────────────────────────────────────────── columna «Aviso al alumno»

/**
 * Para la columna «Aviso al alumno» de Emitidos (Diego, 05/11/2026: «sale mi correo y creo
 * que se lo mandó a mí»): a QUIÉN se manda el diploma —el correo del titular, el mismo al
 * que Certifex lo envía— y el NOMBRE de quien aprobó el aviso. Pone en cada fila
 * `titularEmail` y, si hay aviso, `aviso.porNombre`. Si algo falla, la lista sale igual.
 *
 * El correo sale de las matrículas aprobadas de Certifex (lo emitido desde el CRM se
 * aprobó antes); lo emitido fuera del CRM y sin aviso no se busca.
 */
export async function conDestinatario(filas, { query }) {
  for (const d of filas) {
    d.titularEmail = null;
    if (d.aviso) d.aviso.porNombre = null;
  }
  const buscados = new Set(filas.filter((d) => d.aviso || d.emitidoEnCrm).map((d) => d.nexpediente));
  if (buscados.size) {
    try {
      const centros = [...new Set(filas.map((d) => String(d.centro).toUpperCase()))];
      const params = centros.length === 1 ? { estado: 'aprobada', centro: centros[0] } : { estado: 'aprobada' };
      const r = await recorrer('/candidatos', params, {
        filtro: (c) => buscados.has(c.nexpediente),
        completo: (h) => h.length >= buscados.size,
      });
      const porExp = new Map(r.filas.map((c) => [c.nexpediente, String(c?.titular?.email || '').trim().toLowerCase() || null]));
      for (const d of filas) d.titularEmail = porExp.get(d.nexpediente) ?? null;
    } catch (err) {
      logger.warn({ err: err.message }, 'diplomas: sin el correo de los alumnos');
    }
  }
  // «persona@x (CRM …)» → el nombre de esa persona en el CRM, si existe.
  const correoDe = (por) => String(por || '').replace(/\s*\(CRM\b[^)]*\)\s*$/i, '').trim().toLowerCase();
  const correos = [...new Set(filas.filter((d) => d.aviso?.por).map((d) => correoDe(d.aviso.por)).filter((c) => c.includes('@')))];
  if (correos.length) {
    try {
      const { rows } = await query('SELECT lower(email) AS email, nombre FROM users WHERE lower(email) = ANY($1::text[])', [correos]);
      const nombres = new Map(rows.map((u) => [u.email, u.nombre]));
      for (const d of filas) if (d.aviso?.por) d.aviso.porNombre = nombres.get(correoDe(d.aviso.por)) || null;
    } catch (err) {
      logger.warn({ err: err.message }, 'diplomas: sin el nombre de quien aprobó');
    }
  }
}
