import jwt from 'jsonwebtoken';
import { AppError } from '../utils/AppError.js';
// Una persona puede tener mas de un rol: el principal y los añadidos.
import { tieneRol, soloEsColaborador, colaboradorPuede } from '../utils/roles.js';
// La sesión se mira contra la base: rol y activo (hotfix del 26/10/2026).
import { comprobarSesion, sesionVigente } from './sesionViva.js';

/**
 * Pega a un guardia la regla que aplica (#423).
 *
 * No cambia lo que hace: solo deja escrito, en la propia función, a quién deja
 * pasar. El inventario de permisos (`modules/permissions/inventario`) recorre
 * las rutas y lee esto; así la tabla sale del código y no de una lista a mano
 * que se queda vieja.
 */
export function conRegla(fn, regla) {
  fn.regla = regla;
  return fn;
}

export async function verifyToken(req, _res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AppError('Token no proporcionado', 401, 'AUTH_REQUIRED'));
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
  } catch {
    return next(new AppError('Token invalido o expirado', 401, 'TOKEN_INVALID'));
  }

  // Un token de antes de un cambio de rol, o de alguien desactivado, ya no vale
  // (26/10/2026): el frontal lo renueva con el rol bueno o pide entrar otra vez.
  if (comprobarSesion()) {
    try {
      if (!(await sesionVigente(req.user))) {
        return next(new AppError('Tu sesión ha cambiado: vuelve a entrar', 401, 'TOKEN_INVALID'));
      }
    } catch (err) {
      return next(err);
    }
  }

  // El colaborador solo ve «Tareas» (#210, fase 5). Se corta aqui y no en cada
  // modulo porque muchas rutas solo piden token —/api/leads entre ellas— y un
  // roleGuard olvidado le abriria prospectos, ventas o finanzas.
  if (soloEsColaborador(req.user) && !colaboradorPuede(req.originalUrl)) {
    return next(new AppError('No tienes permisos para esta accion', 403, 'FORBIDDEN'));
  }
  next();
}
verifyToken.regla = { tipo: 'token' };

/**
 * Como `roleGuard`, pero SIN el atajo.
 *
 * `roleGuard` deja pasar a `superadmin` y a `soporte` antes de mirar la lista,
 * asi que `roleGuard('admin')` tambien admite a soporte. Para casi todo el CRM
 * eso es lo que se quiere y no se toca — lo usan decenas de rutas.
 *
 * Pero donde el permiso se ha pedido explicito —«unicamente el admin y
 * superadmin pueden hacerlo»— no vale «quien no encaje cae por el else»: se
 * declara quien entra y no entra nadie mas. Asi, añadir un rol nuevo el año que
 * viene no le regala el acceso.
 */
export function soloRoles(...rolesPermitidos) {
  return conRegla((req, _res, next) => {
    if (!req.user) {
      return next(new AppError('No autenticado', 401, 'AUTH_REQUIRED'));
    }
    if (!tieneRol(req.user, ...rolesPermitidos)) {
      return next(new AppError('No tienes permisos para esta accion', 403, 'FORBIDDEN'));
    }
    next();
  }, { tipo: 'roles', roles: rolesPermitidos, atajoSoporte: false });
}

export function roleGuard(...allowedRoles) {
  return conRegla((req, _res, next) => {
    if (!req.user) {
      return next(new AppError('No autenticado', 401, 'AUTH_REQUIRED'));
    }
    if (tieneRol(req.user, 'superadmin', 'soporte')) return next();
    if (!tieneRol(req.user, ...allowedRoles)) {
      return next(new AppError('No tienes permisos para esta accion', 403, 'FORBIDDEN'));
    }
    next();
  }, { tipo: 'roles', roles: allowedRoles, atajoSoporte: true });
}
