import crypto from 'crypto';
import { query, getClient } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { logActivity } from '../auth/auth.model.js';
import { sendCodigoCambioCorreoEmail } from '../../shared/services/brevo.service.js';
import { NO_ESCRIBIR_A_TUTORES } from '../../shared/config/frenoTutores.js';
import { ROLES_DE_TUTOR } from '../../shared/utils/roles.js';
import * as userModel from './user.model.js';
import { cambiarCorreo } from './user.service.js';

/*
  CAMBIAR EL CORREO CON UN CÓDIGO (#197, gemela de CRM#211, Diego 02/10).

  Portado tal cual de MultiCRM (CRM#688 + CRM#731). Los números de issue de
  abajo (#211, #688, #708) son de MultiCRM. La tabla, en la migración 348.

  El correo es la credencial y hoy se cambia sin comprobar nada: así 39 de 45
  tutores de ISEIE se quedaron con direcciones que no existían. Ahora va en dos
  pasos:

    1. `pedirCodigo`: el CRM manda un código de 6 cifras a la dirección NUEVA.
       Caduca a los 15 minutos. Una petición nueva anula la anterior.
    2. `confirmarCodigo`: con el código bueno, el correo cambia con
       `cambiarCorreo`, que cierra las sesiones, avisa a la dirección vieja y lo
       anota en el registro (#246, #248). Como mucho 5 intentos: al quinto
       fallo la petición se anula y hay que pedir otro código.

  Solo se guarda el hash del código. El registro dice quién lo pidió, de qué
  correo a cuál, y cuándo se confirmó.

  Las decisiones de Diego (06/11, en la #688):
    - Lo pide CADA UNO para su propio correo, todos los roles
      (`cuenta.cambiar_correo`). El correo de OTRA persona lo cambia el
      superadmin al momento, sin código (`cambiarCorreo`, desde Usuarios o
      Tutores): este fichero no lo usa nadie más.
    - A un tutor no se le manda el código mientras siga el freno
      (NO_ESCRIBIR_A_TUTORES): `pedirCodigo` responde `frenado` sin error y la
      pantalla lo explica. Se levanta con CORREOS_A_TUTORES=1 en el .env.
*/

export const MINUTOS = 15;
export const INTENTOS = 5;

/**
 * El código se guarda como HMAC con una clave del .env (revisión de Diego,
 * #688): un sha256 sin secreto de seis cifras se saca probando el millón de
 * posibilidades. Sale en hexadecimal, 64 caracteres, como antes.
 */
function clave() {
  const k = process.env.CODIGO_CORREO_SECRET || process.env.JWT_SECRET;
  if (!k) throw new AppError('Falta CODIGO_CORREO_SECRET en el servidor', 500, 'SIN_CLAVE');
  return k;
}
export const hash = (codigo) => crypto.createHmac('sha256', clave()).update(String(codigo)).digest('hex');

/** ¿Es tutor (o tutor redactor, #708), de rol principal o de más? Para el freno. */
const esTutor = (u) => [u?.role, ...(u?.roles_extra || [])].some((r) => ROLES_DE_TUTOR.includes(r));

/** Lo que se le dice a un tutor mientras siga el freno (sin error: es un estado, no un fallo). */
export const MENSAJE_FRENADO = 'Ahora mismo el CRM no manda correos a los tutores, así que no te podemos mandar el código. Pide el cambio a administración: el superadmin te lo cambia al momento.';

/** ¿Le sale a esta persona el código, o lo para el freno? Lo usa también /auth/me. */
export function codigoFrenadoPara(user) {
  return NO_ESCRIBIR_A_TUTORES && esTutor(user);
}
const anotar = (porUserId, action, details, ip) => (porUserId
  ? logActivity(porUserId, action, details, ip || null).catch((err) => logger.error({ err: err.message, action }, 'No se pudo anotar en el registro'))
  : null);

/** Seis cifras, con ceros a la izquierda y de un generador seguro. */
export function nuevoCodigo() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Anula lo que hubiera pendiente y guarda la petición nueva, en UNA
 * transacción y con la fila de la persona bloqueada (revisión de Diego, #688):
 * dos peticiones a la vez se ponen en fila en vez de chocar en el índice único
 * (23505 → 500). `codigoHash` null = solo anular.
 */
async function sustituirPeticion({ userId, emailNuevo = null, codigoHash = null, expira = null, porUserId }) {
  const db = await getClient();
  try {
    await db.query('BEGIN');
    await db.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
    await db.query(`UPDATE cambios_de_correo SET anulado_at = NOW()
                     WHERE user_id = $1 AND confirmado_at IS NULL AND anulado_at IS NULL`, [userId]);
    if (codigoHash) {
      await db.query(`INSERT INTO cambios_de_correo (user_id, email_nuevo, codigo_hash, expira_at, pedido_por_user_id)
                      VALUES ($1, $2, $3, $4, $5)`, [userId, emailNuevo, codigoHash, expira, porUserId]);
    }
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

/**
 * Manda el código a la dirección nueva. No cambia nada todavía.
 *
 * Revisión de Diego (#688, 06/11):
 *   - A un tutor, mientras siga el freno, no se le manda: `frenado: true` y el
 *     motivo, sin error. No se guarda nada.
 *   - Si la dirección ya es de otra persona, la respuesta es LA MISMA que si
 *     no (antes, un 409 EMAIL_EXISTS decía quién tiene cuenta en el CRM, y con
 *     todos los roles pudiendo preguntar). No se manda el código y queda en el
 *     registro; y se guarda una petición que ningún código abre, para que
 *     confirmar tampoco lo delate.
 *   - El correo sale sin esperar, como en «he olvidado la contraseña»: si se
 *     esperase, tardar distinto delataría también el caso de arriba.
 * @returns {{ email: string, expira_at: Date|null, enviado: boolean, frenado?: boolean, motivo?: string }}
 */
export async function pedirCodigo({ userId, emailNuevo, porUserId = userId, ip = null, enviar = sendCodigoCambioCorreoEmail }) {
  const nuevo = String(emailNuevo || '').trim().toLowerCase();
  const user = await userModel.findById(userId);
  if (!user) throw new AppError('Usuario no encontrado', 404, 'NOT_FOUND');
  if (codigoFrenadoPara(user)) {
    logger.warn({ userId }, 'código de cambio de correo NO mandado: los correos a tutores están cortados');
    return { email: nuevo, expira_at: null, enviado: false, frenado: true, motivo: MENSAJE_FRENADO };
  }
  if (String(user.email).toLowerCase() === nuevo) throw new AppError('Ese ya es tu correo', 400, 'MISMO_CORREO');

  const expira = new Date(Date.now() + MINUTOS * 60_000);
  const otro = await userModel.findByEmail(nuevo);
  if (otro && otro.id !== userId) {
    // Una petición SEÑUELO, con el hash de algo que no es un código de seis
    // cifras: ninguno la abre. Sin ella, al confirmar se notaría la diferencia
    // («no hay ningún cambio pendiente» frente a «código incorrecto») y se
    // volvería a saber de quién es la dirección. Así, el mismo camino: cuenta
    // intentos, dice «incorrecto» y al quinto se anula.
    const senuelo = hash(crypto.randomBytes(32).toString('hex'));
    await sustituirPeticion({ userId, emailNuevo: nuevo, codigoHash: senuelo, expira, porUserId });
    await anotar(porUserId, 'usuario.pedir_cambio_correo', { usuario_id: userId, de: user.email, a: nuevo, no_mandado: 'ya es de otro usuario' }, ip);
    return { email: nuevo, expira_at: expira, enviado: true };
  }

  const codigo = nuevoCodigo();
  // Solo vale el último: la petición pendiente que hubiera se anula.
  await sustituirPeticion({ userId, emailNuevo: nuevo, codigoHash: hash(codigo), expira, porUserId });
  await anotar(porUserId, 'usuario.pedir_cambio_correo', { usuario_id: userId, de: user.email, a: nuevo }, ip);

  Promise.resolve()
    .then(() => enviar({ nombre: user.nombre, a: nuevo, codigo, minutos: MINUTOS }))
    .then((r) => { if (!r?.sent) logger.warn({ userId, motivo: r?.reason }, 'El código de cambio de correo no salió'); })
    .catch((err) => logger.error({ err: err.message, userId }, 'No se pudo mandar el código de cambio de correo'));
  return { email: nuevo, expira_at: expira, enviado: true };
}

/**
 * Con el código bueno, cambia el correo. Cada intento cuenta; al quinto fallo,
 * la petición se anula.
 *
 * Revisión de Diego (#688, 05/11):
 *   - El intento se cuenta ANTES de comparar y en una sola sentencia
 *     (`intentos = intentos + 1 … WHERE intentos < 5`). Si se leía, se
 *     comparaba y luego se escribía, varias peticiones a la vez leían
 *     `intentos = 0` y cada una probaba un código: el límite de 5 no valía.
 *   - Con el bueno, la petición se marca confirmada ANTES de cambiar el
 *     correo, y solo si seguía viva: así no se puede usar dos veces. Si el
 *     cambio falla (p. ej. el correo ya lo ha cogido otra persona), la
 *     petición se anula: no queda viva con el correo sin cambiar.
 */
export async function confirmarCodigo({ userId, codigo, porUserId = userId, ip = null }) {
  const { rows: [p] } = await query(
    `UPDATE cambios_de_correo SET intentos = intentos + 1
      WHERE user_id = $1 AND confirmado_at IS NULL AND anulado_at IS NULL AND intentos < $2
      RETURNING id, intentos, codigo_hash, expira_at, email_nuevo`, [userId, INTENTOS]);
  if (!p) {
    // Viva pero sin intentos: se anula y se dice. Si no, es que no hay ninguna.
    const { rows: [agotada] } = await query(
      `UPDATE cambios_de_correo SET anulado_at = NOW()
        WHERE user_id = $1 AND confirmado_at IS NULL AND anulado_at IS NULL RETURNING id`, [userId]);
    if (agotada) throw new AppError('Demasiados intentos. Pide un código nuevo.', 429, 'DEMASIADOS_INTENTOS');
    throw new AppError('No hay ningún cambio de correo pendiente. Pide un código nuevo.', 400, 'SIN_CODIGO');
  }
  if (new Date(p.expira_at) < new Date()) {
    await query('UPDATE cambios_de_correo SET anulado_at = NOW() WHERE id = $1', [p.id]);
    throw new AppError('El código ha caducado. Pide uno nuevo.', 400, 'CODIGO_CADUCADO');
  }
  const bueno = crypto.timingSafeEqual(Buffer.from(p.codigo_hash), Buffer.from(hash(String(codigo || '').trim())));
  if (!bueno) {
    if (p.intentos >= INTENTOS) {
      await query('UPDATE cambios_de_correo SET anulado_at = NOW() WHERE id = $1', [p.id]);
      throw new AppError('Demasiados intentos. Pide un código nuevo.', 429, 'DEMASIADOS_INTENTOS');
    }
    throw new AppError(`Código incorrecto. Te quedan ${INTENTOS - p.intentos}.`, 400, 'CODIGO_INCORRECTO');
  }

  // Se reclama la petición: solo una confirmación puede ganarla.
  const { rows: [mia] } = await query(
    `UPDATE cambios_de_correo SET confirmado_at = NOW()
      WHERE id = $1 AND confirmado_at IS NULL AND anulado_at IS NULL RETURNING id`, [p.id]);
  if (!mia) throw new AppError('No hay ningún cambio de correo pendiente. Pide un código nuevo.', 400, 'SIN_CODIGO');

  // El cambio de verdad, con todo lo que ya hacía (sesiones, aviso, registro).
  let r;
  try {
    r = await cambiarCorreo(userId, p.email_nuevo, { porUserId, ip });
  } catch (err) {
    await query('UPDATE cambios_de_correo SET confirmado_at = NULL, anulado_at = NOW() WHERE id = $1', [p.id])
      .catch((e) => logger.error({ err: e.message, id: p.id }, 'No se pudo anular la petición de cambio de correo'));
    throw err;
  }
  await anotar(porUserId, 'usuario.confirmar_cambio_correo', { usuario_id: userId, a: p.email_nuevo }, ip);
  return r;
}
