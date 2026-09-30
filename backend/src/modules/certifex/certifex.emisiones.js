import { AppError } from '../../shared/utils/AppError.js';
import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import { listarEmisionesSchema, decisionesSchema, emitirSchema, cursosSchema } from './certifex.validation.js';

/**
 * Certifex · Emisiones: el visto bueno y la emision de titulos, desde el CRM.
 *
 * Por que aqui. El 21/09 Certifex emitio 86 credenciales y solo dos personas habian
 * terminado: Moodle no sabe si alguien ha pagado, se dio de baja o entrego algo fuera
 * del campus; el CRM si. En un centro con este CRM conectado, Certifex no emite nada
 * que el CRM no haya aprobado (y lo sostiene su base, no solo su API).
 *
 * Emitir se puede desde los dos sitios —el panel de Certifex y aqui—, pero la ultima
 * palabra es del CRM. Aprobar y emitir son dos pasos: aprobar dice «esta persona tiene
 * derecho»; emitir gasta un numero de expediente en un registro que no se borra.
 *
 * Se habla con Certifex SIEMPRE desde este servidor. La clave (`CERTIFEX_CRM_CLAVE`,
 * con forma `cfx_crm_...`) vive solo en el .env del servidor: el navegador no la ve.
 * Contrato: docs/integracion-crm.md en el repo de Certifex.
 */

function config() {
  const url = (process.env.CERTIFEX_API_URL || '').trim().replace(/\/+$/, '');
  const clave = (process.env.CERTIFEX_CRM_CLAVE || '').trim();
  return url && clave ? { url, clave } : null;
}

/**
 * La web publica de Certifex, donde viven la verificacion y el diploma de cada titulo.
 * Por defecto la misma que la API; `CERTIFEX_PUBLICO_URL` por si alguna vez se separan.
 * No es secreta: es lo que ve cualquiera que escanee el QR de un diploma.
 */
function urlPublica() {
  return ((process.env.CERTIFEX_PUBLICO_URL || process.env.CERTIFEX_API_URL || '').trim().replace(/\/+$/, '')) || null;
}

/** Forma de un numero de expediente de Certifex: CTF-2026-000123-AB12. */
const NEXP = /^[A-Z]{3}-\d{4}-\d{6}-[A-Z0-9]{4}$/;

function parsear(schema, datos) {
  const r = schema.safeParse(datos);
  if (!r.success) throw new AppError(r.error.errors[0].message, 400, 'VALIDATION_ERROR');
  return r.data;
}

/**
 * Una llamada a la API de Certifex. Los errores salen con un mensaje que la pantalla
 * puede ensenar tal cual; la clave no aparece nunca en un log.
 */
async function certifex(metodo, ruta, cuerpo, { timeoutMs = 20_000 } = {}) {
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

/** ¿Esta conectado? Y si lo esta, sobre que centros manda este CRM. Nunca falla. */
export async function estado(req, res, next) {
  try {
    if (!config()) return res.json({ success: true, data: { conectado: false } });
    try {
      const yo = await certifex('GET', '/yo');
      res.json({ success: true, data: { conectado: true, nombre: yo.nombre, centros: yo.centros, urlPublica: urlPublica() } });
    } catch (e) {
      res.json({ success: true, data: { conectado: false, error: e.message } });
    }
  } catch (err) { next(err); }
}

export async function listar(req, res, next) {
  try {
    const f = parsear(listarEmisionesSchema, req.query);
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v !== undefined) p.set(k, String(v));
    const data = await certifex('GET', `/candidatos?${p.toString()}`);
    if (Array.isArray(data?.filas)) await conLoDelCrm(data.filas, req.user);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

/**
 * LO QUE EL CRM SABE DE CADA ALUMNO, al lado de lo que dice Moodle.
 *
 * Es la razon de aprobar desde aqui (Diego, 30/09: «cuando alguien termina la
 * formacion, en el CRM aprobamos y Certifex emite»): Moodle sabe si termino, el CRM
 * si pago. Se cruza por el CORREO, que es lo que el contrato de Certifex da como
 * clave para encontrar al alumno (el DNI viene vacio en casi todos los campus).
 *
 * Cada fila gana `crm`: null si ese correo no esta en el CRM; si esta, cuantas
 * fichas y ventas tiene, lo vendido, lo cobrado y lo que falta. Solo se miran los
 * campus que la persona ve (super admin: todos menos los de prueba), la misma regla
 * que Conexion. Si la consulta falla, el listado sale igual, sin la columna: decidir
 * no puede quedarse bloqueado por esto.
 */
async function conLoDelCrm(filas, user) {
  const correos = [...new Set(filas.map((f) => String(f?.titular?.email || '').trim().toLowerCase()).filter(Boolean))];
  for (const f of filas) f.crm = null;
  if (!correos.length) return;
  try {
    const { rows } = await query(
      `SELECT lower(l.email) AS email,
              count(DISTINCT l.id)::int AS fichas,
              max(l.id)::int AS lead_id,
              count(c.id)::int AS ventas,
              COALESCE(sum(c.importe_total), 0)::float AS vendido,
              COALESCE(sum(c.importe_pagado), 0)::float AS cobrado
         FROM leads l
         LEFT JOIN conversions c ON c.lead_id = l.id
        WHERE l.deleted_at IS NULL
          AND lower(l.email) = ANY($1::text[])
          AND l.project_id NOT IN (SELECT id FROM projects WHERE es_prueba)
          AND ($2::int IS NULL OR EXISTS (
                SELECT 1 FROM user_projects up
                 WHERE up.user_id = $2 AND up.active AND up.project_id = l.project_id))
        GROUP BY lower(l.email)`,
      [correos, user?.role === 'superadmin' ? null : user?.userId ?? -1],
    );
    const porCorreo = new Map(rows.map((r) => [r.email, r]));
    for (const f of filas) {
      const r = porCorreo.get(String(f?.titular?.email || '').trim().toLowerCase());
      if (!r) continue;
      const pendiente = Math.round((r.vendido - r.cobrado) * 100) / 100;
      f.crm = { leadId: r.lead_id, fichas: r.fichas, ventas: r.ventas, vendido: r.vendido, cobrado: r.cobrado, pendiente };
    }
  } catch (e) {
    logger.warn({ err: e.message }, 'Certifex: no se pudo cruzar con el CRM');
    for (const f of filas) delete f.crm;
  }
}

/** Los campus de este CRM: nombre, Moodle, logo y lo que hay que hacer en cada uno. */
export async function centros(req, res, next) {
  try {
    const data = await certifex('GET', '/centros');
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

/** Los cursos de un campus, con lo que hay por decidir, por emitir y ya emitido. */
export async function cursos(req, res, next) {
  try {
    const { centro } = parsear(cursosSchema, req.query);
    const data = await certifex('GET', `/cursos?centro=${encodeURIComponent(centro.toUpperCase())}`);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

/** Aprobar o rechazar. Quien decide es el usuario del CRM con sesion, no el cuerpo. */
export async function decidir(req, res, next) {
  try {
    const d = parsear(decisionesSchema, req.body);
    const data = await certifex('POST', '/decisiones', {
      decisiones: d.items.map((i) => ({ ...i, decididoPor: req.user.email })),
    });
    logger.info({ userId: req.user.userId, n: d.items.length }, 'Certifex: decisiones enviadas');
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

/**
 * Emitir lo aprobado. Timeout largo: en un centro con Moodle, Certifex baja el
 * expediente de cada alumno del campus, en serie (hasta 10 por llamada; ver
 * `emitirSchema`).
 */
export async function emitir(req, res, next) {
  try {
    const d = parsear(emitirSchema, req.body);
    const data = await certifex('POST', '/emitir', { matriculaIds: d.matriculaIds, emitidaPor: req.user.email }, { timeoutMs: 180_000 });
    logger.info({ userId: req.user.userId, n: d.matriculaIds.length }, 'Certifex: emision enviada');
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

/**
 * El diploma en PDF de un titulo ya emitido, para verlo dentro del CRM.
 *
 * Por que pasa por aqui y no se enlaza sin mas: Certifex no deja que sus paginas se
 * incrusten en otro dominio (frame-ancestors), y eso esta bien asi. El PDF es publico
 * —es lo que abre el QR del diploma—, asi que el servidor lo trae y el CRM lo ensena.
 * No lleva la clave del CRM: es la misma peticion que haria cualquiera.
 */
export async function diploma(req, res, next) {
  try {
    const nexp = String(req.params.nexp || '').trim().toUpperCase();
    if (!NEXP.test(nexp)) throw new AppError('Numero de expediente no valido', 400, 'VALIDATION_ERROR');
    const base = urlPublica();
    if (!base) throw new AppError('Certifex no esta conectado: falta CERTIFEX_API_URL en el servidor.', 503, 'CERTIFEX_SIN_CONFIGURAR');
    let r;
    try {
      r = await fetch(`${base}/diploma.pdf?exp=${encodeURIComponent(nexp)}`, { signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      logger.error({ err: e.message, nexp }, 'Certifex: el diploma no responde');
      throw new AppError('Certifex no responde. Prueba de nuevo en un momento.', 502, 'CERTIFEX_NO_RESPONDE');
    }
    if (r.status === 404) throw new AppError('Ese titulo no existe en Certifex.', 404, 'NOT_FOUND');
    if (!r.ok || !(r.headers.get('content-type') || '').includes('pdf')) {
      throw new AppError(`Certifex no devolvio el diploma (${r.status}).`, 502, 'CERTIFEX_ERROR');
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nexp}.pdf"`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (err) { next(err); }
}

/**
 * Los logos de los campus solo pueden venir de estas dos rutas de Certifex: las imagenes
 * del repositorio y el logo subido de un centro. Cualquier otra cosa no sale del CRM:
 * esto no es un proxy abierto.
 */
const RUTA_LOGO = /^\/(?:images\/[\w-]+(?:\.[\w-]+)*\.(?:png|webp|jpe?g|svg)|api\/centros\/[A-Z0-9]{2,10}\/logo(?:\?v=[a-f0-9]{6,64})?)$/;

/**
 * El logo de un campus, traido por el servidor. Hace falta para que la pantalla pueda
 * medir su brillo (un logo blanco necesita fondo oscuro, como el de Academia IA): el
 * navegador no deja leer los pixeles de una imagen de otro dominio.
 */
export async function logo(req, res, next) {
  try {
    const ruta = String(req.query.ruta || '');
    if (!RUTA_LOGO.test(ruta) || ruta.includes('..')) throw new AppError('Ruta de logo no valida', 400, 'VALIDATION_ERROR');
    const base = urlPublica();
    if (!base) throw new AppError('Certifex no esta conectado.', 503, 'CERTIFEX_SIN_CONFIGURAR');
    let r;
    try {
      r = await fetch(`${base}${ruta}`, { signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new AppError('Certifex no responde.', 502, 'CERTIFEX_NO_RESPONDE');
    }
    const tipo = r.headers.get('content-type') || '';
    if (!r.ok || !tipo.startsWith('image/')) throw new AppError('Logo no disponible', 404, 'NOT_FOUND');
    res.setHeader('Content-Type', tipo);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (err) { next(err); }
}
