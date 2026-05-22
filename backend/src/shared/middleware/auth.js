import jwt from 'jsonwebtoken';
import { AppError } from '../utils/AppError.js';

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

export function roleGuard(...allowedRoles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError('No autenticado', 401, 'AUTH_REQUIRED'));
    }
    if (req.user.role === 'superadmin' || req.user.role === 'soporte') return next();
    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError('No tienes permisos para esta accion', 403, 'FORBIDDEN'));
    }
    next();
  };
}
