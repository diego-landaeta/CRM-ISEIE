import { AppError } from '../../shared/utils/AppError.js';
import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import { veTodoElCrm } from '../../shared/utils/ambito.js';
import { listarEmisionesSchema, decisionesSchema, emitirSchema, cursosSchema, mensajeDeValidacion } from './certifex.validation.js';
import { config, urlPublica, direccionPublica, certifex, recorrer } from './certifex.cliente.js';
import { alcanceDe, centrosPermitidos, acotar, exigirCentro, exigirMatriculas, exigirExpedientes } from './certifex.alcance.js';
import { datosPara, emitirMatriculas } from './certifex.emision.js';
import { tienePermiso } from '../../shared/middleware/permissions.js';

export { certifex };

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
 * Se habla con Certifex SIEMPRE desde este servidor (certifex.cliente.js). La clave
 * (`CERTIFEX_CRM_CLAVE`) vive solo en el .env del servidor: el navegador no la ve.
 * Contrato: docs/integracion-crm.md en el repo de Certifex.
 *
 * Cada admin ve y toca solo los campus de sus proyectos (certifex.alcance.js); super
 * admin, todos. Emitir pasa por la emision comun (certifex.emision.js): con el programa
 * del CRM, igual que desde Diplomas.
 */

/** Forma de un numero de expediente de Certifex: CTF-2026-000123-AB12. */
// El prefijo es el de la empresa que numera (Certifex 0035: CEDIA, ISEIE, ICTESS, LTS) o
// el CTF de los antiguos: de 2 a 6 letras, lo mismo que acepta la verificación de Certifex.
export const NEXP = /^[A-Z]{2,6}-\d{4}-\d{6}-[A-Z0-9]{4}$/;

function parsear(schema, datos) {
  const r = schema.safeParse(datos);
  if (!r.success) throw new AppError(mensajeDeValidacion(r.error), 400, 'VALIDATION_ERROR');
  return r.data;
}

/**
 * ¿Esta conectado? Y si lo esta, sobre que centros manda este CRM (de esos, los que ve
 * quien pregunta). Nunca falla.
 */
export async function estado(req, res, next) {
  try {
    if (!config()) return res.json({ success: true, data: { conectado: false } });
    let yo;
    try {
      yo = await certifex('GET', '/yo');
    } catch (e) {
      return res.json({ success: true, data: { conectado: false, error: e.message } });
    }
    const alcance = await centrosPermitidos(req.user, yo.centros);
    const centros = alcance && Array.isArray(yo.centros) ? yo.centros.filter((c) => alcance.has(String(c).toUpperCase())) : yo.centros;
    // Un enlace local no llega a la pantalla: sin direccion publica, urlPublica va a null
    // y el panel dice por que (Certifex#96).
    const dir = direccionPublica(yo);
    res.json({ success: true, data: { conectado: true, nombre: yo.nombre, centros, urlPublica: dir.url, direccionPublica: { ok: dir.ok, motivos: dir.motivos } } });
  } catch (err) { next(err); }
}

export async function listar(req, res, next) {
  try {
    const f = parsear(listarEmisionesSchema, req.query);
    const ambito = acotar(await alcanceDe(req.user), f.centro);
    const pagina = f.pagina ?? 1;
    const tam = f.tam ?? 50;
    let data;
    if (ambito.vacio) {
      data = { filas: [], total: 0, pagina, tam };
    } else if (ambito.centros) {
      // Varios campus suyos y ninguno elegido: Certifex filtra por uno solo, asi que se
      // recorre y se pagina aqui.
      const r = await recorrer('/candidatos', { estado: f.estado, curso: f.curso, q: f.q }, { filtro: (c) => ambito.centros.has(String(c.centro).toUpperCase()) });
      data = { filas: r.filas.slice((pagina - 1) * tam, pagina * tam), total: r.filas.length, pagina, tam, truncado: r.truncado };
    } else {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries({ ...f, centro: ambito.centro ?? f.centro })) if (v !== undefined) p.set(k, String(v));
      data = await certifex('GET', `/candidatos?${p.toString()}`);
    }
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
 *
 * Si en el panel Diplomas alguien reviso a mano con que correo esta el alumno en el CRM
 * (`edicion.emailCrm`, migracion 230), se cruza por ese y no por el de Moodle.
 */
export async function conLoDelCrm(filas, user) {
  const correoDe = (f) => String(f?.edicion?.emailCrm || f?.titular?.email || '').trim().toLowerCase();
  const correos = [...new Set(filas.map(correoDe).filter(Boolean))];
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
      [correos, veTodoElCrm(user) ? null : user?.userId ?? -1],
    );
    const porCorreo = new Map(rows.map((r) => [r.email, r]));
    for (const f of filas) {
      const r = porCorreo.get(correoDe(f));
      if (!r) continue;
      const pendiente = Math.round((r.vendido - r.cobrado) * 100) / 100;
      f.crm = { leadId: r.lead_id, fichas: r.fichas, ventas: r.ventas, vendido: r.vendido, cobrado: r.cobrado, pendiente };
    }
  } catch (e) {
    logger.warn({ err: e.message }, 'Certifex: no se pudo cruzar con el CRM');
    for (const f of filas) delete f.crm;
  }
}

/** Los campus de este CRM (los que ve quien pregunta): nombre, Moodle, logo y lo pendiente. */
export async function centros(req, res, next) {
  try {
    const alcance = await alcanceDe(req.user);
    const data = await certifex('GET', '/centros');
    res.json({ success: true, data: alcance && Array.isArray(data) ? data.filter((c) => alcance.has(String(c?.codigo).toUpperCase())) : data });
  } catch (err) { next(err); }
}

/** Los cursos de un campus, con lo que hay por decidir, por emitir y ya emitido. */
export async function cursos(req, res, next) {
  try {
    const { centro } = parsear(cursosSchema, req.query);
    exigirCentro(await alcanceDe(req.user), centro, 'Campus no encontrado.');
    const data = await certifex('GET', `/cursos?centro=${encodeURIComponent(centro.toUpperCase())}`);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

/**
 * 404 si alguna matricula no es de los campus de esta persona (super admin: nada que
 * mirar). Lo comparten las acciones por matricula de Emisiones y de Diplomas.
 */
export async function exigirMisMatriculas(user, ids) {
  const alcance = await alcanceDe(user);
  if (!alcance) return;
  const datos = await datosPara(ids);
  exigirMatriculas(alcance, ids, (id) => datos.get(id)?.centro);
}

/** Aprobar o rechazar. Quien decide es el usuario del CRM con sesion, no el cuerpo. */
export async function decidir(req, res, next) {
  try {
    const d = parsear(decisionesSchema, req.body);
    await exigirMisMatriculas(req.user, d.items.map((i) => i.matriculaId));
    const data = await certifex('POST', '/decisiones', {
      decisiones: d.items.map((i) => ({ ...i, decididoPor: req.user.email })),
    });
    logger.info({ userId: req.user.userId, n: d.items.length }, 'Certifex: decisiones enviadas');
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

/**
 * Emitir lo aprobado, con el programa oficial del CRM (la misma emision que Diplomas:
 * una matricula se imprime igual desde las dos pestañas). Timeout largo: en un centro
 * con Moodle, Certifex baja el expediente de cada alumno del campus, en serie (hasta 10
 * por llamada; ver `emitirSchema`).
 */
export async function emitir(req, res, next) {
  try {
    const d = parsear(emitirSchema, req.body);
    const resultados = await emitirMatriculas(req.user, d.matriculaIds);
    logger.info({ userId: req.user.userId, n: d.matriculaIds.length }, 'Certifex: emision enviada');
    res.json({ success: true, data: { resultados } });
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
    // El PDF es publico, pero desde aqui solo se ensena el de los campus de cada uno.
    await exigirExpedientes(await alcanceDe(req.user), [nexp]);
    // El A3 de imprenta (#95 de Certifex) NO es publico: se pide con la clave del CRM.
    const formato = req.query.formato == null || req.query.formato === '' ? 'digital' : String(req.query.formato);
    if (formato !== 'digital' && formato !== 'imprenta') throw new AppError('Formato desconocido: usa «digital» o «imprenta».', 400, 'VALIDATION_ERROR');
    // Quien solo VE Diplomas (`diplomas.view`, #223) ve el digital, el que le llega al
    // alumno. El A3 es para mandarlo a imprenta: eso lo hace administracion.
    if (formato === 'imprenta' && !(await tienePermiso(req, 'diplomas.imprenta'))) {
      throw new AppError('El PDF de imprenta (A3) lo descarga administración.', 403, 'FORBIDDEN');
    }
    if (formato === 'imprenta') return await enviarImprenta(res, nexp);
    let r;
    try {
      r = await fetch(`${base}/diploma.pdf?exp=${encodeURIComponent(nexp)}`, { signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      logger.error({ err: e.message, nexp }, 'Certifex: el diploma no responde');
      throw new AppError('Certifex no responde. Prueba de nuevo en un momento.', 502, 'CERTIFEX_NO_RESPONDE');
    }
    if (r.status === 404) throw new AppError('Ese titulo no existe en Certifex (o esta revocado).', 404, 'NOT_FOUND');
    // Sin generador de PDF en su servidor, Certifex redirige a la vista de impresion
    // (HTML). No es un fallo del diploma: se dice para que se abra en Certifex.
    if (r.ok && (r.headers.get('content-type') || '').includes('html')) {
      throw new AppError('Certifex no ha podido generar el PDF ahora mismo: abre el diploma en Certifex.', 502, 'CERTIFEX_SIN_PDF');
    }
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
 * El A3 de imprenta de un diploma, para la imprenta. Al alumno le llega siempre el
 * digital A4 (el publico); este solo lo da Certifex a quien tiene su clave, y solo de
 * los centros de este CRM. Se descarga como fichero y no se cachea: se pide poco y no
 * debe quedarse en ningun sitio.
 */
async function enviarImprenta(res, nexp) {
  const c = config();
  if (!c) throw new AppError('Certifex no esta conectado: faltan CERTIFEX_API_URL y CERTIFEX_CRM_CLAVE en el servidor.', 503, 'CERTIFEX_SIN_CONFIGURAR');
  let r;
  try {
    // Generar el A3 lleva unos segundos (Chromium, A3): mas margen que el resto.
    r = await fetch(`${c.url}/api/crm/v1/diplomas/${encodeURIComponent(nexp)}/pdf?formato=imprenta`, {
      headers: { Authorization: `Bearer ${c.clave}` },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    logger.error({ err: e.message, nexp }, 'Certifex: el A3 no responde');
    throw new AppError('Certifex no responde. Prueba de nuevo en un momento.', 502, 'CERTIFEX_NO_RESPONDE');
  }
  if (!r.ok || !(r.headers.get('content-type') || '').includes('pdf')) {
    const d = await r.json().catch(() => null);
    if (r.status === 401) throw new AppError('Certifex no acepta la clave de este CRM (CERTIFEX_CRM_CLAVE).', 502, 'CERTIFEX_CLAVE');
    // 404 (no es de este CRM o no existe), 409 (revocado, o su campus no tiene A3) y 503
    // (Certifex sin navegador o con la cola llena): el mensaje de Certifex se ensena tal cual.
    const estado = [400, 404, 409].includes(r.status) ? r.status : 502;
    throw new AppError(d?.error || `Certifex no devolvio el A3 (${r.status}).`, estado, 'CERTIFEX_ERROR');
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nexp}-imprenta-A3.pdf"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(Buffer.from(await r.arrayBuffer()));
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
