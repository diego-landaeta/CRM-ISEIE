import * as authService from './auth.service.js';
import { sanitizeProjects } from './auth.service.js';
import * as authModel from './auth.model.js';
import { loginSchema, setPasswordSchema, changePasswordSchema, updateMyProfileSchema } from './auth.validation.js';
import { AppError } from '../../shared/utils/AppError.js';
import bcrypt from 'bcrypt';
import { query } from '../../shared/config/db.js';

// /api/auth/me devuelve `permissions` y `view` vacíos hasta que se porte el
// módulo `permissions` (custom_roles + user_permission_overrides + sidebar
// override). El frontend cae al comportamiento por defecto basado en `role`.

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
}

// El flag 'secure' obliga a HTTPS — pero estamos sirviendo por HTTP en beta.
// Si NODE_ENV=production fuerza secure=true, el navegador descarta la cookie
// al recargar (no la envía de vuelta sobre HTTP) y el usuario queda deslogueado.
// Solución: COOKIE_SECURE opcional en .env (default false hasta tener HTTPS).
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true';

function setRefreshCookie(res, refreshToken, expiryDays) {
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: 'lax',  // 'lax' funciona sobre HTTP; 'strict' a veces lo bloquea al refrescar
    maxAge: expiryDays * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearRefreshCookie(res) {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
  });
}

export async function login(req, res, next) {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    }

    const { email, password } = parsed.data;
    const ip = getClientIp(req);

    const result = await authService.login(email, password, ip);

    setRefreshCookie(res, result.refreshToken, result.refreshTokenExpiryDays);

    res.json({
      success: true,
      data: {
        accessToken: result.accessToken,
        user: result.user,
        projects: result.projects,
        activeProjectId: result.activeProjectId,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function refresh(req, res, next) {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      throw new AppError('Refresh token no encontrado', 401, 'REFRESH_REQUIRED');
    }

    const result = await authService.refresh(refreshToken);

    setRefreshCookie(res, result.refreshToken, result.refreshTokenExpiryDays);

    res.json({
      success: true,
      data: {
        accessToken: result.accessToken,
        user: result.user,
        projects: result.projects,
        activeProjectId: result.activeProjectId,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function logout(req, res, next) {
  try {
    const refreshToken = req.cookies?.refreshToken;
    const userId = req.user?.userId;
    const ip = getClientIp(req);

    await authService.logout(refreshToken, userId, ip);
    clearRefreshCookie(res);

    res.json({ success: true, data: { message: 'Sesion cerrada' } });
  } catch (err) {
    next(err);
  }
}

export async function setPassword(req, res, next) {
  try {
    const parsed = setPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    }

    const { token, password } = parsed.data;
    const result = await authService.setPassword(token, password);

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function changePassword(req, res, next) {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const { currentPassword, newPassword } = parsed.data;
    const userId = req.user.userId;

    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    if (!rows[0]) throw new AppError('Usuario no encontrado', 404, 'USER_NOT_FOUND');
    const ok = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!ok) throw new AppError('Contrasena actual incorrecta', 401, 'INVALID_CURRENT_PASSWORD');

    const newHash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, userId]);
    await authModel.logActivity(userId, 'change_password', null, req.ip);

    res.json({ success: true, data: { message: 'Contrasena actualizada' } });
  } catch (err) { next(err); }
}

export async function updateMyProfile(req, res, next) {
  try {
    const parsed = updateMyProfileSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const userId = req.user.userId;

    await query('UPDATE users SET nombre = $1, updated_at = NOW() WHERE id = $2', [parsed.data.nombre, userId]);
    const { rows } = await query(
      'SELECT id, nombre, email, role, active, avatar_url FROM users WHERE id = $1',
      [userId]
    );
    await authModel.logActivity(userId, 'update_profile', null, req.ip);
    res.json({ success: true, data: { user: rows[0] } });
  } catch (err) { next(err); }
}

export async function me(req, res, next) {
  try {
    const user = await authModel.findUserById(req.user.userId);

    if (!user) {
      throw new AppError('Usuario no encontrado', 404, 'USER_NOT_FOUND');
    }

    const projects = await authModel.getUserProjects(user.id, user.role);

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          nombre: user.nombre,
          email: user.email,
          role: user.role,
          avatar_url: user.avatar_url,
          custom_role_id: user.custom_role_id,
          custom_role_label: user.custom_role_label,
          factura_manager: !!user.factura_manager,
          gestor_colaboraciones: !!user.gestor_colaboraciones,
          editar_fechas_factura: !!user.editar_fechas_factura,
        },
        permissions: {},
        view: {},
        projects: sanitizeProjects(projects, user.role),
      },
    });
  } catch (err) {
    next(err);
  }
}
