import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { AppError } from '../../shared/utils/AppError.js';
import * as authModel from './auth.model.js';
import { buildPermissionsMap } from '../permissions/permissions.service.js';
import { NO_ESCRIBIR_A_TUTORES } from '../../shared/config/frenoTutores.js';
import { ROLES_DE_TUTOR } from '../../shared/utils/roles.js';
import { logger } from '../../shared/utils/logger.js';

const BCRYPT_ROUNDS = 12;
// Access token de 8h: el usuario aguanta una jornada completa sin necesitar
// renovar (antes era 15m, lo que provocaba "se sale solo en muy poco tiempo").
// El refresh token sigue siendo de 30 dias por seguridad para reanudar sesion.
const ACCESS_TOKEN_EXPIRY = '8h';
const REFRESH_TOKEN_EXPIRY_DAYS = 30;

function generateAccessToken(user, activeProjectId = null) {
  return jwt.sign(
    // `roles_extra` viaja en el token para que cada guardia no tenga que ir a
    // la base a preguntar.
    { userId: user.id, email: user.email, role: user.role,
      roles_extra: Array.isArray(user.roles_extra) ? user.roles_extra : [],
      customRoleId: user.custom_role_id ?? null, activeProjectId },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
}

// LO QUE EL FRONTAL SABE DE QUIEN ENTRA, igual que `/auth/me`.
//
// El login (y en ISEIE tambien el refresh) mandaban al frontal un usuario SIN
// `roles_extra`: quien es gestora y ademas tutora —Yolanda, en ICTESS— entraba
// como «solo gestora» y no le salia lo de tutora (Mis cursos) hasta recargar la
// pagina, porque solo `/auth/me` lo traia. Diego, 23/10: «a Yolanda no le salen
// las funciones». Un solo sitio para que las respuestas no vuelvan a diferir.
export function usuarioParaElFrontal(user) {
  return {
    id: user.id, nombre: user.nombre, email: user.email, role: user.role,
    roles_extra: Array.isArray(user.roles_extra) ? user.roles_extra : [],
    custom_role_id: user.custom_role_id ?? null,
    avatar_url: user.avatar_url,
    factura_manager: !!user.factura_manager, editar_fechas_factura: !!user.editar_fechas_factura,
    gestor_colaboraciones: !!user.gestor_colaboraciones, usa_mcp: !!user.usa_mcp,
    // La casilla de WhatsApp, también al entrar (QA 22/10, punto 8): sin ella los
    // avisos no saben si preguntar por /api/whatsapp/sin-leer. null = sin la columna.
    usa_whatsapp: user.usa_whatsapp ?? null,
  };
}

function generateRefreshToken() {
  return crypto.randomBytes(40).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function login(email, password, ipAddress) {
  const user = await authModel.findUserByEmail(email);
  if (!user) {
    throw new AppError('Credenciales incorrectas', 401, 'INVALID_CREDENTIALS');
  }

  if (!user.active) {
    throw new AppError('Cuenta desactivada', 403, 'ACCOUNT_DISABLED');
  }

  const validPassword = await bcrypt.compare(password, user.password_hash);
  if (!validPassword) {
    throw new AppError('Credenciales incorrectas', 401, 'INVALID_CREDENTIALS');
  }

  const projects = await authModel.getUserProjects(user.id, user.role);
  const activeProjectId = projects.length > 0 ? projects[0].id : null;
  // El mapa de permisos viaja ya con el login (#423): el frontal no tiene copia
  // de los valores de cada rol, y sin esto la pantalla se pintaría sin botones
  // hasta que llegara /auth/me.
  const permissions = await buildPermissionsMap(user.id, user.role, user.custom_role_id, user.roles_extra);

  const accessToken = generateAccessToken(user, activeProjectId);
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashToken(refreshToken);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

  await authModel.saveRefreshToken(user.id, refreshTokenHash, expiresAt);
  await authModel.updateLastLogin(user.id);
  await authModel.logActivity(user.id, 'login', null, ipAddress);

  return {
    accessToken,
    refreshToken,
    refreshTokenExpiryDays: REFRESH_TOKEN_EXPIRY_DAYS,
    user: usuarioParaElFrontal(user),
    projects: sanitizeProjects(projects, user.role),
    activeProjectId,
    permissions,
  };
}

// Solo admin/superadmin pueden ver el webhook_api_key
function sanitizeProjects(projects, role) {
  if (role === 'admin' || role === 'superadmin') return projects;
  return projects.map(({ webhook_api_key, ...rest }) => rest);
}

export { sanitizeProjects };

export async function refresh(refreshToken) {
  if (!refreshToken) {
    throw new AppError('Refresh token requerido', 401, 'REFRESH_REQUIRED');
  }

  const tokenHash = hashToken(refreshToken);
  const storedToken = await authModel.findRefreshToken(tokenHash);

  if (!storedToken || storedToken.revoked) {
    throw new AppError('Refresh token invalido', 401, 'REFRESH_INVALID');
  }

  if (new Date(storedToken.expires_at) < new Date()) {
    await authModel.revokeRefreshToken(tokenHash);
    throw new AppError('Refresh token expirado', 401, 'REFRESH_EXPIRED');
  }

  const user = await authModel.findUserById(storedToken.user_id);
  if (!user || !user.active) {
    await authModel.revokeRefreshToken(tokenHash);
    throw new AppError('Usuario no encontrado o desactivado', 401, 'USER_INVALID');
  }

  const projects = await authModel.getUserProjects(user.id, user.role);
  const activeProjectId = projects.length > 0 ? projects[0].id : null;

  // Revocar token viejo y generar uno nuevo (rotacion)
  await authModel.revokeRefreshToken(tokenHash);
  const newRefreshToken = generateRefreshToken();
  const newRefreshTokenHash = hashToken(newRefreshToken);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

  await authModel.saveRefreshToken(user.id, newRefreshTokenHash, expiresAt);

  const accessToken = generateAccessToken(user, activeProjectId);

  return {
    accessToken,
    refreshToken: newRefreshToken,
    refreshTokenExpiryDays: REFRESH_TOKEN_EXPIRY_DAYS,
    user: usuarioParaElFrontal(user),
    projects: sanitizeProjects(projects, user.role),
    activeProjectId,
  };
}

export async function logout(refreshToken, userId, ipAddress) {
  if (refreshToken) {
    const tokenHash = hashToken(refreshToken);
    await authModel.revokeRefreshToken(tokenHash);
  }

  if (userId) {
    await authModel.logActivity(userId, 'logout', null, ipAddress);
  }
}

export async function setPassword(token, newPassword) {
  const tokenHash = hashToken(token);
  const user = await authModel.findUserBySetPasswordToken(tokenHash);

  if (!user) {
    throw new AppError('Token invalido o ya utilizado', 400, 'TOKEN_INVALID');
  }

  if (new Date(user.set_password_expires) < new Date()) {
    throw new AppError('Token expirado (>24h)', 400, 'TOKEN_EXPIRED');
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  // Se REVOCAN LOS REFRESH TOKENS ANTES de cambiar la clave (#37): nadie puede
  // renovar una sesion ya abierta con el enlace de recuperacion en la mano.
  // OJO, no es un cierre inmediato: el access token (JWT, ACCESS_TOKEN_EXPIRY)
  // no se consulta en la base en cada peticion y sigue valiendo hasta que
  // caduca por si solo. Una sesion robada vive, como mucho, ese tiempo.
  // Va primero a proposito: si el cambio fallara despues, lo peor que pasa es
  // que la persona tiene que volver a entrar; al reves, quedaria la clave
  // cambiada y los refresh tokens ajenos vivos.
  await authModel.revokeAllUserTokens(user.id);
  await authModel.updatePassword(user.id, passwordHash);
  await authModel.logActivity(user.id, 'set_password', null, null);

  return { message: 'Contrasena establecida correctamente' };
}

/** Lo que dura el enlace de recuperacion. El mismo que el del alta. */
const RECOVERY_EXPIRY_HOURS = 24;
/** Minutos durante los que un enlace recien emitido impide emitir otro. */
const RECOVERY_REENVIO_MIN = 5;

/** ¿Es tutor (o tutor redactor), de rol principal o de mas? Para el freno. */
const esTutor = (u) => [u?.role, ...(u?.roles_extra || [])].some((r) => ROLES_DE_TUTOR.includes(r));

/**
 * «He olvidado la contraseña» (#37).
 *
 * NO DICE SI EL CORREO EXISTE, y por eso esta funcion no devuelve nada ni
 * lanza cuando no lo encuentra. Lo pide el ticket con su motivo escrito: «si lo
 * dice, sirve para averiguar quien trabaja aqui». Un 404 aqui convierte la
 * pantalla de entrar en un listado de empleados a base de probar correos.
 *
 * De ahi tres cosas que parecen descuidos y no lo son:
 *
 *   - se sale en silencio con un correo desconocido, y el controlador contesta
 *     lo mismo que si hubiera mandado el enlace;
 *   - un fallo al enviar tampoco cambia la respuesta —se registra y ya—, que si
 *     no, el error del correo delata que la cuenta si existia;
 *   - una cuenta dada de baja se trata como inexistente.
 *
 * El envio va sin esperar, como el del alta: contestar rapido importa, y el
 * usuario ya tiene la instruccion de mirar su bandeja.
 */
export async function pedirRecuperacion(email, baseUrl) {
  const user = await authModel.findActiveUserByEmail(String(email || '').trim());
  if (!user) return;

  // El freno de los tutores (NO_ESCRIBIR_A_TUTORES), como en `cambiarCorreo`:
  // mientras siga puesto, a un tutor no se le manda nada. Tampoco se le toca el
  // token: un enlace que no va a llegar solo pisaria el de su alta, si lo tiene.
  // Queda en el log y en el registro, y la respuesta HTTP es la misma: el
  // controlador no espera a nada de esto.
  if (NO_ESCRIBIR_A_TUTORES && esTutor(user)) {
    logger.warn({ userId: user.id },
      'recuperacion de contraseña de un tutor SIN enviar el enlace: los avisos a tutores estan cortados (15/09)');
    await authModel.logActivity(user.id, 'password_reset_frenado', null, null);
    return;
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const expires = new Date();
  expires.setHours(expires.getHours() + RECOVERY_EXPIRY_HOURS);

  // Un enlace anterior se pisa (pedirlo dos veces deja valido solo el ultimo,
  // para que no rueden llaves de mas), SALVO que el vigente se haya emitido hace
  // menos de 5 minutos: entonces no se toca ni se manda otro correo. Si no, con
  // solo saber el correo de alguien se le puede llenar el buzon e invalidar el
  // enlace que ya tiene. La respuesta HTTP es la misma en los dos casos.
  // La caducidad es «emision + 24 h», de ahi se sabe cuando se emitio.
  const recienteDesde = new Date(
    Date.now() + RECOVERY_EXPIRY_HOURS * 3_600_000 - RECOVERY_REENVIO_MIN * 60_000);
  const puesto = await authModel.setRecoveryToken(user.id, hashToken(rawToken), expires, recienteDesde);
  if (puesto === false) return;
  await authModel.logActivity(user.id, 'password_reset_requested', null, null);

  return { user, rawToken, baseUrl };
}
