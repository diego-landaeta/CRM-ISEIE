import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { AppError } from '../../shared/utils/AppError.js';
import * as userModel from './user.model.js';
import { revokeAllUserTokens } from '../auth/auth.model.js';
import { sendWelcomeUserEmail } from '../../shared/services/brevo.service.js';
import { logger } from '../../shared/utils/logger.js';
import { query } from '../../shared/config/db.js';

const BCRYPT_ROUNDS = 12;
const SET_PASSWORD_EXPIRY_HOURS = 24;

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
  sendWelcomeUserEmail({ nombre: user.nombre, email: user.email, setPasswordToken: rawToken, baseUrl })
    .then((r) => {
      if (r.sent) logger.info({ userId: user.id, messageId: r.messageId }, 'Welcome email enviado');
      else logger.warn({ userId: user.id, reason: r.reason }, 'Welcome email NO enviado');
    })
    .catch((err) => logger.error({ err: err.message, userId: user.id }, 'Welcome email error'));

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
