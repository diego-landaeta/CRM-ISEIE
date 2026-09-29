import { logger } from '../../shared/utils/logger.js';
import { AppError } from '../../shared/utils/AppError.js';
import { query } from '../../shared/config/db.js';
import { sendEmail } from '../../shared/services/brevo.service.js';
import { notifyUsers } from '../notifications/notifications.service.js';
import { CRM, VERSIONES, ACTUAL, versionDe } from './versiones.js';
import { pdfDeVersion, fechaLarga } from './novedades.pdf.js';

/**
 * Las novedades de cada versión (Diego, 28/09): «esta es la versión 2.0.0; en
 * notificaciones a todos por la app y por correo del equipo debe llegar todo lo
 * nuevo… primero me lo mandas a mí y luego al subirlo se mandará, manda un pdf
 * con todo lo que se hizo».
 *
 * Dos envíos:
 *   · «prueba»: a quien lo pide (y al correo que diga), las veces que quiera.
 *   · «equipo»: aviso en la campana y correo con el PDF a todo el equipo. UNA
 *     vez por versión: lo garantiza el índice único de `novedades_envios`, no
 *     la memoria de nadie. En producción sale solo al arrancar la versión
 *     nueva (`novedadesScheduler`); en pruebas, a mano, y el freno de correos
 *     solo deja pasar la lista blanca.
 *
 * El equipo es quien trabaja en el CRM: activos, con correo, y sin los tutores,
 * que entran a ver sus cursos y no usan nada de esto.
 */

function base() {
  return (process.env.FEEDBACK_BASE_URL || process.env.CRM_BASE_URL || 'http://localhost:5173/crm').replace(/\/+$/, '');
}

const escapar = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function listar() {
  return { crm: CRM, actual: ACTUAL.version, versiones: VERSIONES };
}

export async function pdf(version) {
  const v = versionDe(version);
  if (!v) throw new AppError('Esa versión no existe', 404, 'NOT_FOUND');
  return { nombre: `novedades-${CRM.nombre.toLowerCase().replace(/\s+/g, '-')}-${v.version}.pdf`, buffer: await pdfDeVersion(v, { crm: CRM, baseUrl: base() }) };
}

/** El correo: saludo, lo más importante de cada grupo, el botón y el PDF adjunto. */
export function correoDe(v, nombre) {
  const primer = String(nombre || '').trim().split(/\s+/)[0];
  const total = v.grupos.reduce((s, g) => s + g.items.length, 0);
  const grupos = v.grupos.map((g) => `
      <p style="margin:18px 0 6px;font-size:14px;font-weight:bold;color:${CRM.color}">${escapar(g.titulo)}</p>
      <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.55;color:#1d2530">
        ${g.items.map((i) => `<li>${escapar(i.titulo)}</li>`).join('')}
      </ul>`).join('');
  const enlace = `${base()}/novedades`;
  const asunto = `Novedades de ${CRM.nombre}: versión ${v.version}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1d2530">
  <div style="max-width:600px;margin:0 auto;padding:28px 16px">
    <div style="background:${CRM.color};border-radius:10px 10px 0 0;padding:22px 26px;color:#ffffff">
      <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;opacity:.85">${escapar(CRM.nombre)}</div>
      <div style="font-size:26px;font-weight:bold;margin-top:4px">Novedades · versión ${escapar(v.version)}</div>
      <div style="font-size:13px;margin-top:4px;opacity:.9">${escapar(fechaLarga(v.fecha))}</div>
    </div>
    <div style="background:#ffffff;border-radius:0 0 10px 10px;padding:24px 26px 28px">
      <p style="font-size:15px;margin:0 0 12px">${primer ? `Hola, ${escapar(primer)}:` : 'Hola:'}</p>
      <p style="font-size:15px;line-height:1.55;margin:0 0 6px">${escapar(v.intro)}</p>
      <p style="font-size:14px;margin:0 0 4px;color:#5b6572">${total} novedades y ${v.arreglos.length} arreglos. Estas son las principales:</p>
      ${grupos}
      <p style="margin:26px 0 8px">
        <a href="${escapar(enlace)}" style="background:${CRM.color};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:bold;display:inline-block">Leer todas las novedades</a></p>
      <p style="font-size:13px;color:#5b6572;margin:10px 0 0">Te adjuntamos el PDF con todo el detalle y dónde está cada cosa.</p>
      <p style="font-size:12px;line-height:1.5;color:#8a939e;margin:22px 0 0;border-top:1px solid #e6e9ee;padding-top:14px">
        Correo automático del CRM: no lo contestes. Si el botón no funciona, copia este enlace:<br>
        <a href="${escapar(enlace)}" style="color:#5b6572;word-break:break-all">${escapar(enlace)}</a></p>
    </div>
  </div></body></html>`;
  return { asunto, html };
}

async function registrar({ version, alcance, userId, personas, correos }) {
  const { rows: [r] } = await query(
    `INSERT INTO novedades_envios (version, alcance, enviado_por, personas, correos)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [version, alcance, userId || null, personas, correos]);
  return r;
}

export async function envios(version) {
  const { rows } = await query(
    `SELECT e.*, u.nombre AS enviado_por_nombre FROM novedades_envios e
       LEFT JOIN users u ON u.id = e.enviado_por
      WHERE e.version = $1 ORDER BY e.created_at DESC`, [version]);
  return rows;
}

function aviso(v) {
  const total = v.grupos.reduce((s, g) => s + g.items.length, 0);
  return {
    type: 'novedades',
    title: `Novedades: versión ${v.version}`,
    message: `${total} novedades y ${v.arreglos.length} arreglos. Pulsa para leerlas.`,
    link_path: '/novedades',
    metadata: { version: v.version },
  };
}

async function mandarCorreo(v, persona, adjunto, clave) {
  const { asunto, html } = correoDe(v, persona.nombre);
  const r = await sendEmail({
    to: { email: persona.email, name: persona.nombre || undefined },
    subject: asunto,
    htmlContent: html,
    tags: ['novedades', v.version],
    attachment: [adjunto],
    clave,
  }).catch((err) => ({ sent: false, reason: err.message }));
  return r;
}

/**
 * Manda las novedades.
 *   alcance 'prueba': a `userId` (campana) y al correo `correo` (o el suyo).
 *   alcance 'equipo': a todo el equipo, una sola vez por versión.
 */
export async function enviar(version, { alcance, userId = null, correo = null }) {
  const v = versionDe(version);
  if (!v) throw new AppError('Esa versión no existe', 404, 'NOT_FOUND');
  const { buffer, nombre } = await pdf(version);
  const adjunto = { name: nombre, content: buffer.toString('base64') };

  if (alcance === 'prueba') {
    const { rows: [yo] } = await query('SELECT id, nombre, email FROM users WHERE id = $1', [userId]);
    const destino = String(correo || yo?.email || '').trim();
    if (!destino) throw new AppError('Falta un correo al que mandarlo', 400, 'VALIDATION_ERROR');
    if (yo) await notifyUsers({ ...aviso(v), targetUserIds: [yo.id], triggered_by_user_id: yo.id });
    // Sin clave de idempotencia: una prueba se puede repetir las veces que haga falta.
    const r = await mandarCorreo(v, { nombre: yo?.nombre, email: destino }, adjunto, null);
    await registrar({ version: v.version, alcance, userId, personas: 1, correos: r?.sent ? 1 : 0 });
    return { alcance, a: destino, correo: r?.sent ? 'enviado' : (r?.reason || 'no salió'), detalle: r?.detalle || null };
  }

  if (alcance !== 'equipo') throw new AppError('Alcance no válido', 400, 'VALIDATION_ERROR');
  const { rows: equipo } = await query(
    `SELECT id, nombre, email FROM users
      WHERE active AND email IS NOT NULL AND email <> '' AND role <> 'tutor'
      ORDER BY id`);
  // Primero se reserva la fila: si dos arranques llegan a la vez, el índice
  // único deja pasar a uno y el otro recibe el error (y no manda nada).
  let fila;
  try {
    fila = await registrar({ version: v.version, alcance, userId, personas: equipo.length, correos: 0 });
  } catch (err) {
    if (err.code === '23505') throw new AppError(`La versión ${v.version} ya se mandó al equipo`, 409, 'YA_ENVIADA');
    throw err;
  }
  await notifyUsers({ ...aviso(v), targetUserIds: equipo.map((p) => p.id), triggered_by_user_id: userId });
  let enviados = 0;
  const fallos = [];
  for (const persona of equipo) {
    // Con clave: si algo se corta a medias y se relanza, nadie lo recibe dos veces.
    const r = await mandarCorreo(v, persona, adjunto, `novedades:${v.version}:${persona.id}`);
    if (r?.sent || r?.reason === 'YA_ENVIADO') enviados += 1;
    else fallos.push({ id: persona.id, motivo: r?.reason || '¿?' });
  }
  await query('UPDATE novedades_envios SET correos = $2 WHERE id = $1', [fila.id, enviados]);
  logger.info({ version: v.version, personas: equipo.length, enviados, fallos: fallos.length }, 'Novedades mandadas al equipo');
  return { alcance, personas: equipo.length, correos: enviados, fallos };
}

/**
 * Al arrancar en PRODUCCIÓN: si la versión actual no se ha mandado todavía al
 * equipo, se manda. Es lo que hace que «al subirlo se mande» sin que nadie se
 * acuerde.
 *
 * Hay que ENCENDERLO: NOVEDADES_AUTO=1 en el .env de producción, el día de la
 * subida. Encendido por defecto, cualquier despliegue suelto de este código
 * —un arreglo copiado a mano, o ISEIE, que saca producción y pruebas de la
 * misma rama— mandaría la versión al equipo antes de tiempo.
 */
export async function autoEnvio() {
  if (process.env.NODE_ENV !== 'production' || process.env.NOVEDADES_AUTO !== '1') return null;
  const { rows } = await query(
    "SELECT 1 FROM novedades_envios WHERE version = $1 AND alcance = 'equipo' LIMIT 1", [ACTUAL.version]);
  if (rows.length) return null;
  return enviar(ACTUAL.version, { alcance: 'equipo' });
}
