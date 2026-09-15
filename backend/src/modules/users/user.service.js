import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { AppError } from '../../shared/utils/AppError.js';
import * as userModel from './user.model.js';
import { revokeAllUserTokens } from '../auth/auth.model.js';
import { sendWelcomeUserEmail } from '../../shared/services/brevo.service.js';

// A LOS TUTORES NO SE LES MANDA NADA. TODAVIA NO.
//
// Diego, 15/09/2026: «quita esa opcion, que nadie reciba nada aun. NO SE PUEDEN
// ENVIAR LOS CORREOS A TUTORES NI NADA DE ESO».
//
// Paso esto: Vanessa dio de alta a Cristina Garcia Torres como tutora del Master
// en Medicina Nuclear, el CRM le mando el correo de Brevo con el enlace para
// poner contraseña, y a ella le salia «required» y no podia entrar. O sea que el
// correo sale solo, llega a una persona de fuera, y encima el enlace no funciona.
//
// El aviso se corta AQUI y no en la pantalla del alta a proposito: hay dos
// caminos que llegan a este envio --crear el tutor y cambiarle el correo con la
// casilla de reenviar-- y taparlos de uno en uno es como se escapa el tercero.
//
// Para que un tutor entre mientras tanto: darle contraseña al crearlo, o desde
// «Cambiar contraseña» en su ficha. Eso no manda ningun correo.
const NO_ESCRIBIR_A_TUTORES = true;
import { logger } from '../../shared/utils/logger.js';
import { query } from '../../shared/config/db.js';

const BCRYPT_ROUNDS = 12;
const SET_PASSWORD_EXPIRY_HOURS = 24;

/**
 * Cambiar el correo de un usuario.
 *
 * Es la CREDENCIAL, no un dato de contacto: en cuanto se cambia, con el viejo ya
 * no se entra. Por eso existe `reenviarEnlace`, que emite un token nuevo y manda
 * el correo de siempre a la direccion nueva.
 *
 * Nace por los tutores: 39 de 45 tenian una direccion construida a partir de su
 * nombre —«Albertoj@iseie.com»— que no existe, asi que el enlace de bienvenida
 * no llego a nadie y ninguno de ellos habia entrado jamas.
 */
export async function cambiarCorreo(id, email, { reenviarEnlace = false } = {}) {
  const nuevo = String(email).trim().toLowerCase();
  const user = await userModel.findById(id);
  if (!user) throw new AppError('Usuario no encontrado', 404, 'NOT_FOUND');
  if (String(user.email).toLowerCase() === nuevo) return { cambiado: false, email: user.email };

  const otro = await userModel.findByEmail(nuevo);
  if (otro && otro.id !== id) {
    throw new AppError('Ese correo ya lo usa otro usuario', 409, 'EMAIL_EXISTS');
  }

  // Si se va a reenviar el enlace, el token se emite en la MISMA operacion que
  // el cambio: si se hicieran por separado y fallara el segundo, el usuario se
  // quedaria con un correo nuevo y sin forma de entrar.
  let rawToken = null;
  if (reenviarEnlace) {
    rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expires = new Date();
    expires.setHours(expires.getHours() + SET_PASSWORD_EXPIRY_HOURS);
    await query(
      `UPDATE users SET email = $1, set_password_token = $2, set_password_expires = $3,
              updated_at = NOW() WHERE id = $4`,
      [nuevo, tokenHash, expires, id]
    );
  } else {
    await query('UPDATE users SET email = $1, updated_at = NOW() WHERE id = $2', [nuevo, id]);
  }

  // Las sesiones abiertas se cierran: la credencial ha cambiado.
  try { await revokeAllUserTokens(id); } catch { /* no bloqueante */ }

  logger.info({ userId: id, de: user.email, a: nuevo, reenviarEnlace }, 'Correo de usuario cambiado');

  if (rawToken && NO_ESCRIBIR_A_TUTORES && user.role === 'tutor') {
    logger.warn({ userId: id, email: nuevo },
      'correo de tutor cambiado SIN reenviar el enlace: los avisos a tutores estan cortados (15/09)');
  } else if (rawToken) {
    const baseUrl = process.env.CRM_BASE_URL || 'http://localhost:5173/crm';
    sendWelcomeUserEmail({ nombre: user.nombre, email: nuevo, setPasswordToken: rawToken, baseUrl })
      .then((r) => logger.info({ userId: id, enviado: r.sent, motivo: r.reason }, 'Enlace reenviado'))
      .catch((err) => logger.error({ err: err.message, userId: id }, 'Fallo reenviando el enlace'));
  }

  return { cambiado: true, email: nuevo, enlaceReenviado: Boolean(rawToken) };
}

export async function list(filters) {
  return await userModel.findAll(filters);
}

export async function getById(id) {
  const user = await userModel.findById(id);
  if (!user) throw new AppError('Usuario no encontrado', 404, 'USER_NOT_FOUND');

  const projects = await userModel.getUserProjects(id);
  return { ...user, projects };
}

export async function create({ nombre, email, role, projectIds, projects }) {
  const existing = await userModel.findByEmail(email);
  if (existing) throw new AppError('Ya existe un usuario con ese email', 409, 'EMAIL_EXISTS');

  // Password temporal (el usuario lo cambiara via set-password)
  const tempPassword = crypto.randomBytes(16).toString('hex');
  const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);

  // Token para set-password
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const expires = new Date();
  expires.setHours(expires.getHours() + SET_PASSWORD_EXPIRY_HOURS);

  const user = await userModel.create({
    nombre,
    email,
    passwordHash,
    role,
    projectIds,
    projects,
    setPasswordToken: tokenHash,
    setPasswordExpires: expires,
  });

  const userProjects = await userModel.getUserProjects(user.id);

  // Envio de email Brevo (async - no bloquea la respuesta)
  const baseUrl = process.env.CRM_BASE_URL || 'http://localhost:5173/crm';
  if (NO_ESCRIBIR_A_TUTORES && role === 'tutor') {
    logger.warn({ userId: user.id, email: user.email },
      'tutor dado de alta SIN correo de bienvenida: los avisos a tutores estan cortados (15/09)');
  } else {
  sendWelcomeUserEmail({ nombre: user.nombre, email: user.email, setPasswordToken: rawToken, baseUrl })
    .then((r) => {
      if (r.sent) logger.info({ userId: user.id, messageId: r.messageId }, 'Welcome email enviado');
      else logger.warn({ userId: user.id, reason: r.reason }, 'Welcome email NO enviado');
    })
    .catch((err) => logger.error({ err: err.message, userId: user.id }, 'Welcome email error'));
  }

  // Retorna el token raw en respuesta para test/desarrollo
  return { ...user, projects: userProjects, setPasswordToken: rawToken };
}

export async function update(id, data) {
  const user = await userModel.findById(id);
  if (!user) throw new AppError('Usuario no encontrado', 404, 'USER_NOT_FOUND');

  if (user.role === 'superadmin') {
    throw new AppError('No se puede editar al superadmin', 403, 'CANNOT_EDIT_SUPERADMIN');
  }

  const updated = await userModel.update(id, data);
  const projects = await userModel.getUserProjects(id);
  return { ...updated, projects };
}

export async function setPassword(id, password) {
  const user = await userModel.findById(id);
  if (!user) throw new AppError('Usuario no encontrado', 404, 'USER_NOT_FOUND');
  if (user.role === 'superadmin') {
    throw new AppError('No se puede cambiar la contraseña de un superadmin', 403, 'CANNOT_EDIT_SUPERADMIN');
  }
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await userModel.setPasswordHash(id, passwordHash);
  // Cierra sesiones activas: obliga a entrar con la nueva contraseña.
  await revokeAllUserTokens(id);
  return { id };
}

export async function deactivate(id) {
  const user = await userModel.findById(id);
  if (!user) throw new AppError('Usuario no encontrado', 404, 'USER_NOT_FOUND');

  if (user.role === 'superadmin') {
    throw new AppError('No se puede desactivar al superadmin', 403, 'CANNOT_DEACTIVATE_SUPERADMIN');
  }

  await userModel.deactivate(id);
  // PDF spec: al desactivar, la sesion activa se cierra inmediatamente
  await revokeAllUserTokens(id);

  // Huerfanizar los leads de los que era responsable y re-asignar via
  // round-robin a los gestores restantes de cada proyecto afectado.
  // Si no quedan gestores → los leads quedan con responsable_id = NULL.
  let reassigned = 0, orphaned = 0;
  try {
    const { rows: affectedProjects } = await query(
      `SELECT DISTINCT project_id FROM leads WHERE responsable_id = $1`,
      [id]
    );
    if (affectedProjects.length > 0) {
      // Quitarles el responsable a TODOS los leads que el user dejó atrás
      const upd = await query(
        `UPDATE leads SET responsable_id = NULL, updated_at = NOW() WHERE responsable_id = $1 RETURNING project_id`,
        [id]
      );
      orphaned = upd.rowCount;
      // Re-aplicar round-robin proyecto a proyecto
      const { reassignPendingRoundRobin } = await import('../leads/lead.model.js');
      for (const p of affectedProjects) {
        try {
          const r = await reassignPendingRoundRobin(p.project_id);
          reassigned += r.reassigned || 0;
        } catch (_) {}
      }
    }
  } catch (err) {
    logger.warn({ err: err.message, userId: id }, 'Re-asignación tras desactivar usuario falló (no bloqueante)');
  }

  return { message: 'Usuario desactivado', leads_huerfanizados: orphaned, leads_reasignados: reassigned };
}

export async function reactivate(id) {
  const user = await userModel.findById(id);
  if (!user) throw new AppError('Usuario no encontrado', 404, 'USER_NOT_FOUND');

  await userModel.reactivate(id);
  return { message: 'Usuario reactivado' };
}
