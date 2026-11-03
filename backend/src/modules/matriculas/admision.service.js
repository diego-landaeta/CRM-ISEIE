import crypto from 'node:crypto';
import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import { saveLocal, deleteLocal } from '../../shared/services/localStorage.service.js';
import * as leadModel from '../leads/lead.model.js';
import { firmaTransparente } from '../certifex/certifex.firma.js';
import { applyMapping } from '../webhook-tokens/mapeo.js';
import * as model from './matricula.model.js';
import { obtenerArchivo, conArchivos } from './admision.archivos.js';

/**
 * EL WEBHOOK DE ADMISIÓN (#198).
 *
 * Diego (WhatsApp, 20/10): «Hay formularios de admisión que envían esos datos de
 * admisión. Se requiere un webhook que también reciba esos datos de admisión. Es
 * decir, un webhook abierto que reciba y luego se pueda mapear. Por campus». Y a
 * Carlos: «para que se puedan sincronizar con el mail».
 *
 * Cada campus tiene su webhook de matrículas (`project_webhook_tokens`, kind
 * 'matriculas') con su mapeo (`field_mapping`), que se hace en Matrículas →
 * Webhooks con el modo escucha. Lo que llega:
 *   1. Los datos de la persona, en campos propios (#198, Diego 01/10).
 *   2. Los documentos (DNI por las dos caras, foto, título, firma), como archivo,
 *      URL o imagen en texto (admision.archivos.js). La firma, transparente y
 *      recortada al trazo, como la del diploma (#349).
 *   3. Se une a la persona: su prospecto por el correo y, si no, por el teléfono;
 *      si no existe, se crea SIN GESTORA (ver `prospectoDe`). Y su venta, si la hay.
 *   4. El mismo envío dos veces no crea dos matrículas (`envio_huella`).
 *
 * Un documento que no vale (no es imagen ni PDF, pasa de 10 MB, la URL no
 * responde…) no pierde la solicitud: se guarda sin él, y cuál y por qué va al
 * registro del servidor.
 *
 * LA RESPUESTA PÚBLICA SOLO DICE «RECIBIDO» (QA de Diego, 22/10). El token va en
 * el formulario de la web, así que lo tiene cualquiera: si la respuesta trajera el
 * prospecto, la venta o si la solicitud ya existía, bastaría con mandar un correo
 * para saber si esa persona es prospecto o ha comprado. Por eso es la misma —200,
 * `{ recibido: true, envio_id }`— sea nueva, repetida o con documentos rechazados.
 * `envio_id` es la huella del envío, no un número de la base. Lo de dentro (la
 * matrícula, el prospecto, la venta, los documentos) va en `interno`, que el
 * controlador no manda.
 */

/** Los datos del CRM a los que se mapea, con el nombre del contrato de la #198. */
export const CAMPOS_PERSONA = ['nombre', 'email', 'telefono', 'documento_tipo', 'dni', 'fecha_nacimiento',
  'direccion', 'pais', 'estudios', 'curso_solicitado', 'titulo', 'notas'];
/** Destino del mapeo → tipo de documento de la matrícula (matricula.controller.js). */
export const DOCUMENTOS = { dni_frente: 'dni', dni_dorso: 'dni_dorso', foto: 'foto', titulo_doc: 'titulo', firma: 'firma' };
const CLAVE = { dni: 'dni_doc_key', dni_dorso: 'dni_dorso_key', foto: 'foto_key', titulo: 'titulo_doc_key', firma: 'firma_key' };
const URL_DOC = { dni: 'dni_doc_url', dni_dorso: 'dni_dorso_url', foto: 'foto_url', titulo: 'titulo_doc_url', firma: 'firma_url' };

const LARGO = { nombre: 200, email: 200, telefono: 50, documento_tipo: 30, dni: 40, pais: 80, curso_solicitado: 255 };

/** ¿Es un archivo del multipart o una imagen en texto, no un dato? */
const esArchivo = (v) => (v && typeof v === 'object' && !Array.isArray(v) && v.__archivo)
  || (typeof v === 'string' && /^data:[\w.+/-]+;base64,/i.test(v.trim()));

/**
 * Para el `titulo` del contrato, que puede ser el archivo o el texto «Título /
 * Programa»: además de lo anterior, un enlace al archivo (lo normal en Gravity y
 * Elementor) o una lista de archivos o enlaces (`titulo[]`).
 */
const pareceArchivo = (v) => esArchivo(v)
  || (typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim()))
  || (Array.isArray(v) && v.length > 0 && v.every((x) => x == null || x === '' || pareceArchivo(x)) && v.some(pareceArchivo));

/**
 * Un texto limpio, recortado a lo que cabe en su columna; null si viene vacío.
 * Gravity manda algunos campos compuestos (el nombre como `{ first, last }`, la
 * dirección por partes): se juntan sus partes, en el orden en que llegan.
 */
function texto(v, campo) {
  if (v == null || esArchivo(v)) return null;
  const partes = (x) => (x == null || x === '' ? [] : typeof x === 'object' ? Object.values(x).flatMap(partes) : [String(x).trim()]);
  const t = (Array.isArray(v) ? v.flatMap(partes).filter(Boolean).join(', ')
    : typeof v === 'object' ? partes(v).filter(Boolean).join(' ') : String(v)).trim();
  if (!t) return null;
  return LARGO[campo] ? t.slice(0, LARGO[campo]) : t;
}

/** «1990-05-17», «17/05/1990» o «17-05-1990» → 'AAAA-MM-DD'; null si no es una fecha. */
export function fechaDeNacimiento(v) {
  const t = texto(v);
  if (!t) return null;
  let a, m, d;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (r) [, a, m, d] = r;
  else if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t))) [, d, m, a] = r;
  else return null;
  const f = new Date(Date.UTC(+a, +m - 1, +d));
  if (f.getUTCFullYear() !== +a || f.getUTCMonth() !== +m - 1 || f.getUTCDate() !== +d) return null;
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** La huella del envío: lo que llegó (con las claves ordenadas) y sus archivos. */
export function huellaDelEnvio(body, archivos = []) {
  const ordenado = (x) => (Array.isArray(x) ? x.map(ordenado)
    : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, ordenado(x[k])])) : x);
  const h = crypto.createHash('sha256').update(JSON.stringify(ordenado(body || {})));
  for (const f of [...archivos].sort((p, q) => String(p.fieldname).localeCompare(q.fieldname))) {
    h.update(`|${f.fieldname}:`).update(crypto.createHash('sha256').update(f.buffer).digest('hex'));
  }
  return h.digest('hex');
}

/**
 * El prospecto de la persona en ese campus: primero por el correo, luego por el
 * teléfono (findDuplicateByEmailOrPhone ya ordena así). Si no existe y llegan
 * nombre y correo, se crea.
 *
 * SIN GESTORA (decidido el 20/10, Diego lo puede cambiar): quien rellena la
 * solicitud de admisión ya se está matriculando, no hay nada que venderle. Si
 * entrara en el reparto, a una gestora le caería «un prospecto nuevo» que ya
 * compró, contaría en su cola y en sus cifras, y podría llamar a alguien ya
 * matriculado. Si existe, se une a su ficha con su gestora de siempre; la
 * solicitud sale igualmente en Matrículas, y se le puede asignar gestora a mano.
 */
async function prospectoDe(projectId, persona, huella) {
  if (!persona.email && !persona.telefono) return { leadId: null, creado: false };
  const existente = await leadModel.findDuplicateByEmailOrPhone(persona.email, persona.telefono, projectId);
  if (existente) return { leadId: existente.id, creado: false };
  if (!persona.nombre || !persona.email) return { leadId: null, creado: false };
  const lead = await leadModel.createLeadWithRoundRobin({
    projectId,
    nombre: persona.nombre,
    email: persona.email,
    telefono: persona.telefono,
    productoInteresId: null,
    notas: 'Creado por la solicitud de admisión',
    landingUrl: null,
    utms: { utm_source: 'admision', utm_medium: 'webhook' },
    customFields: {},
    skipRoundRobin: true,
    idempotencyKey: `admision:${huella}`,
  });
  return { leadId: lead.id, creado: true };
}

/** La venta de ese prospecto en ese campus que aún no tiene matrícula (la más reciente). */
async function ventaDe(projectId, leadId) {
  if (!leadId) return null;
  const { rows } = await query(
    `SELECT c.id FROM conversions c
      WHERE c.lead_id = $1 AND c.project_id = $2
        AND NOT EXISTS (SELECT 1 FROM matriculas m WHERE m.conversion_id = c.id)
      ORDER BY c.fecha_conversion DESC, c.id DESC
      LIMIT 1`,
    [leadId, projectId]);
  return rows[0]?.id ?? null;
}

/** Un documento listo para guardar: la firma, en imagen, transparente y recortada (#349). */
async function prepararDocumento(tipo, archivo) {
  if (tipo !== 'firma') return archivo;
  if (archivo.ext === 'pdf') throw Object.assign(new Error('La firma tiene que ser una imagen, no un PDF.'), { isOperational: true });
  return { ...archivo, buffer: await firmaTransparente(archivo.buffer), ext: 'png' };
}

/** Guarda un documento ya preparado, como la subida a mano (uploadDoc), con su línea del historial. */
async function guardarDocumento(matricula, tipo, archivo) {
  const { buffer, ext } = archivo;
  const key = `matriculas/${matricula.project_id}/m-${matricula.id}-${tipo}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  await saveLocal(key, buffer);
  try {
    await model.conTransaccion(async (db) => {
      await model.update(matricula.id, { [CLAVE[tipo]]: key, [URL_DOC[tipo]]: `/api/matriculas/${matricula.id}/doc/${tipo}?v=${Date.now()}` }, db);
      await model.registrarEvento({ matriculaId: matricula.id, evento: 'documento', documento: tipo, reemplazo: false, db });
    });
  } catch (err) {
    await deleteLocal(key).catch(() => {});
    throw err;
  }
}

/** Lo que contesta el webhook: lo mismo pase lo que pase (ver arriba). */
const respuesta = (huella, interno) => ({ status: 200, data: { recibido: true, envio_id: huella }, interno });

/**
 * Y TARDA LO MISMO PASE LO QUE PASE. La respuesta ya no decía nada, pero el tiempo
 * sí (prueba de caja negra, 24/10): un correo nuevo tardaba unos 10 ms más que uno
 * que ya era prospecto (se crea el prospecto), y una solicitud repetida volvía antes
 * de descargar sus documentos, así que poniendo de documento un enlace propio se
 * sabía si esa persona ya había mandado la suya. Por eso los documentos se descargan
 * y preparan SIEMPRE, antes de mirar nada de la persona, y desde ahí la respuesta
 * sale a los RESPUESTA_FIJA_MS: lo que depende de si la persona existe (buscarla,
 * crearla, guardar la solicitud) pasa dentro de ese tiempo. Todo sigue en el momento:
 * si la base falla, la web recibe el error y puede reenviar, como antes.
 *
 * 500 ms y no 300: guardar una solicitud nueva con documentos grandes (2 × 9 MB) tardó
 * de mediana 146 ms, pero alguna vez 437 ms; con 300 se pasaba y volvía a notarse.
 *
 * La única excepción es EL MISMO ENVÍO, idéntico (la web que reintenta): se mira antes
 * de descargar nada y se contesta al momento, sin volver a bajar los enlaces. No
 * delata a nadie: que ese envío exacto ya llegó solo lo sabe quien lo mandó.
 */
const RESPUESTA_FIJA_MS = 500;
const esperarHasta = (momento) => new Promise((ok) => setTimeout(ok, Math.max(0, momento - Date.now())));

/**
 * Una solicitud de admisión que llega por el webhook de matrículas de un campus.
 * `archivos`: los del multipart (multer). `opcionesArchivo`: para las pruebas
 * (`permitirRedLocal`, y `respuestaMs` en vez de RESPUESTA_FIJA_MS).
 * Devuelve `{ status, data }`, lo que contesta el webhook, e `interno`, lo que
 * pasó (no se manda).
 */
export async function recibirAdmision(token, body, archivos = [], opcionesArchivo = {}) {
  const projectId = token.project_id;
  const envio = conArchivos(body, archivos);
  // Copia: sin mapeo, applyMapping devuelve el mismo objeto, y abajo se le añaden alias.
  const mapeado = { ...applyMapping(envio, token.field_mapping || {}) };
  const huella = huellaDelEnvio(body, archivos);

  // El mismo envío, idéntico: al momento y sin descargar nada (ver RESPUESTA_FIJA_MS).
  const repetido = await query('SELECT id FROM matriculas WHERE project_id = $1 AND envio_huella = $2', [projectId, huella]);
  if (repetido.rows[0]) return respuesta(huella, { matriculaId: repetido.rows[0].id, accion: 'duplicate_skipped' });

  // El contrato de Diego (01/10) llama `titulo` al ARCHIVO del título y `documento`
  // al número; el CRM ya usaba `titulo` para el texto «Título / Programa» y `dni`
  // para el número. Se aceptan los dos: un `titulo` que es un archivo va como
  // documento, y `documento` vale como `dni`.
  if (mapeado.titulo_doc == null && pareceArchivo(mapeado.titulo)) {
    mapeado.titulo_doc = mapeado.titulo;
    delete mapeado.titulo; // no es el texto «Título / Programa»
  }
  if (mapeado.dni == null && mapeado.documento != null) mapeado.dni = mapeado.documento;

  const persona = {};
  for (const campo of CAMPOS_PERSONA) persona[campo] = texto(mapeado[campo], campo);
  if (persona.email) persona.email = persona.email.toLowerCase();
  persona.fecha_nacimiento = fechaDeNacimiento(mapeado.fecha_nacimiento);

  // Los documentos, ANTES de mirar si la persona ya existe (ver RESPUESTA_FIJA_MS), a la
  // vez (un formulario puede mandar cinco enlaces: uno detrás de otro, la web daba el
  // envío por fallido esperando) y ya preparados; se guardan después, de uno en uno.
  const pendientes = Object.entries(DOCUMENTOS).filter(([destino]) => mapeado[destino] != null && mapeado[destino] !== '');
  const obtenidos = await Promise.all(pendientes.map(([destino, tipo]) => obtenerArchivo(mapeado[destino], archivos, opcionesArchivo)
    .then((archivo) => (archivo ? prepararDocumento(tipo, archivo) : null))
    .then((archivo) => ({ archivo }), (error) => ({ error }))));

  const salida = Date.now() + (opcionesArchivo.respuestaMs ?? RESPUESTA_FIJA_MS);
  const responder = async (interno) => { await esperarHasta(salida); return respuesta(huella, interno); };

  // Lo de antes (#198, ya en marcha): no repetir la de la misma persona por su DNI o correo.
  const dedupe = persona.dni || persona.email || null;
  if (dedupe) {
    const existente = await model.findByDedupe(projectId, dedupe);
    if (existente) return responder({ matriculaId: existente.id, accion: 'duplicate_skipped' });
  }

  let prospecto = { leadId: null, creado: false };
  try {
    prospecto = await prospectoDe(projectId, persona, huella);
  } catch (err) {
    // Sin prospecto la solicitud se guarda igual; se puede vincular después.
    logger.warn({ err: err.message, projectId }, 'Admisión: no se pudo unir ni crear el prospecto');
  }
  let conversionId = await ventaDe(projectId, prospecto.leadId);

  const crear = () => model.create({
    project_id: projectId,
    conversion_id: conversionId,
    lead_id: prospecto.leadId,
    ...persona,
    // El envío tal cual llegó (Diego, 01/10), también las imágenes en texto; los
    // archivos del multipart, como su marca «📎». En la lista no sale (va en la ficha).
    datos_admision: envio,
    source: 'webhook',
    dedupe_key: dedupe,
    envio_huella: huella,
    estado: 'solicitud_admision',
  });

  let matricula;
  try {
    matricula = await crear();
  } catch (err) {
    if (err.code !== '23505') throw err;
    // Dos envíos a la vez: el índice único deja entrar solo uno, y el otro es
    // «repetido», no un 500. Puede chocar en la huella (el mismo envío), en el DNI o
    // correo (la misma persona, con un envío algo distinto) o en la venta (dos
    // solicitudes del mismo prospecto a la vez: la segunda entra sin venta).
    if (err.constraint === 'uq_matricula_conversion' && conversionId) {
      conversionId = null;
      matricula = await crear();
    } else {
      const otra = (await query('SELECT id FROM matriculas WHERE project_id = $1 AND envio_huella = $2', [projectId, huella])).rows[0]
        || (dedupe ? await model.findByDedupe(projectId, dedupe) : null);
      if (!otra) throw err;
      return responder({ matriculaId: otra.id, accion: 'duplicate_skipped' });
    }
  }

  // Cada documento con su línea del historial.
  const guardados = [];
  const rechazados = [];
  for (let i = 0; i < pendientes.length; i++) {
    const [destino, tipo] = pendientes[i];
    try {
      if (obtenidos[i].error) throw obtenidos[i].error;
      if (!obtenidos[i].archivo) continue;
      await guardarDocumento(matricula, tipo, obtenidos[i].archivo);
      guardados.push(destino);
    } catch (err) {
      const motivo = err.isOperational ? err.message : 'No se ha podido guardar.';
      if (!err.isOperational) logger.error({ err, matriculaId: matricula.id, destino }, 'Admisión: fallo al guardar un documento');
      rechazados.push({ documento: destino, motivo });
    }
  }
  if (rechazados.length) logger.warn({ matriculaId: matricula.id, projectId, rechazados }, 'Admisión: documentos rechazados');

  return responder({
    matriculaId: matricula.id,
    accion: 'created',
    leadId: prospecto.leadId,
    leadCreado: prospecto.creado,
    conversionId,
    documentos: { guardados, rechazados },
  });
}
