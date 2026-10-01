import { AppError } from '../utils/AppError.js';
import { resolvePermission } from '../../modules/permissions/permissions.service.js';

// Middleware granular de permisos.
// Usar después de verifyToken. Complementa (no reemplaza) roleGuard.
//
// Ejemplo: router.delete('/:id', verifyToken, checkPermission('leads', 'delete'), ctrl.remove)
export function checkPermission(resource, action) {
  return async (req, res, next) => {
    try {
      const { userId, role, customRoleId } = req.user;

      const allowed = await resolvePermission(userId, role, customRoleId ?? null, resource, action);
      if (!allowed) {
        return next(new AppError('No tienes permiso para esta accion', 403, 'FORBIDDEN'));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
