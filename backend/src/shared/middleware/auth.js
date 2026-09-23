import jwt from 'jsonwebtoken';
import { AppError } from '../utils/AppError.js';
// Una persona puede tener mas de un rol: el principal y los añadidos.
import { tieneRol } from '../utils/roles.js';

export function verifyToken(req, _res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AppError('Token no proporcionado', 401, 'AUTH_REQUIRED'));
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    next(new AppError('Token invalido o expirado', 401, 'TOKEN_INVALID'));
  }
}

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
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError('No autenticado', 401, 'AUTH_REQUIRED'));
    }
    if (!tieneRol(req.user, ...rolesPermitidos)) {
      return next(new AppError('No tienes permisos para esta accion', 403, 'FORBIDDEN'));
    }
    next();
  };
}

export function roleGuard(...allowedRoles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError('No autenticado', 401, 'AUTH_REQUIRED'));
    }
    if (tieneRol(req.user, 'superadmin', 'soporte')) return next();
    if (!tieneRol(req.user, ...allowedRoles)) {
      return next(new AppError('No tienes permisos para esta accion', 403, 'FORBIDDEN'));
    }
    next();
  };
}
