import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { AppError } from '../../shared/utils/AppError.js';
import * as authModel from './auth.model.js';

const BCRYPT_ROUNDS = 12;
// Access token de 8h: el usuario aguanta una jornada completa sin necesitar
// renovar (antes era 15m, lo que provocaba "se sale solo en muy poco tiempo").
// El refresh token sigue siendo de 30 dias por seguridad para reanudar sesion.
const ACCESS_TOKEN_EXPIRY = '8h';
const REFRESH_TOKEN_EXPIRY_DAYS = 30;

function generateAccessToken(user, activeProjectId = null) {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role, customRoleId: user.custom_role_id ?? null, activeProjectId },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
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
    user: { id: user.id, nombre: user.nombre, email: user.email, role: user.role, avatar_url: user.avatar_url },
    projects: sanitizeProjects(projects, user.role),
    activeProjectId,
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
    user: { id: user.id, nombre: user.nombre, email: user.email, role: user.role, avatar_url: user.avatar_url },
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
  await authModel.updatePassword(user.id, passwordHash);
  await authModel.logActivity(user.id, 'set_password', null, null);

  return { message: 'Contrasena establecida correctamente' };
}
