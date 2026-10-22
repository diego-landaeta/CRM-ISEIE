import { AppError } from '../utils/AppError.js';
import { tieneRol } from '../utils/roles.js';
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

/**
 * Por su ROL o por un PERMISO (#223).
 *
 * Pasa quien tenga uno de `roles` —el principal o uno añadido, sin el atajo de
 * soporte que tiene `roleGuard`, igual que `soloRoles`— o quien tenga
 * `resource.action`: por su rol, por su rol a medida, por lo cambiado en
 * Configuración › Roles o por una excepción suya. El permiso se mira en la BASE
 * en cada petición: quitárselo a alguien surte efecto ya, no al caducar su sesión.
 *
 * Es lo que hace falta para «que lo vea quien no es admin» sin tocar lo que
 * hace el admin: Diplomas sigue siendo de administración por su rol, y además
 * lo VE a quien se le dé `diplomas.view`.
 *
 * `action` puede ser una lista: pasa quien tenga CUALQUIERA de ellas. Diego,
 * 22/10/2026: «que Dayana pueda emitir, no la dejan; puede hacerlo». Quien
 * EMITE diplomas (`diplomas.emit`) tiene que poder verlos aunque no le hayan
 * dado también `diplomas.view`: las lecturas de Diplomas piden una u otra.
 */
export function rolOPermiso(roles, resource, action) {
  const acciones = Array.isArray(action) ? action : [action];
  return async (req, _res, next) => {
    try {
      if (!req.user) return next(new AppError('No autenticado', 401, 'AUTH_REQUIRED'));
      if (tieneRol(req.user, ...roles)) return next();
      const { userId, role, customRoleId } = req.user;
      let puede = false;
      for (const a of acciones) {
        puede = await resolvePermission(
          userId, role, customRoleId ?? null, resource, a, req.user.roles_extra ?? []);
        if (puede) break;
      }
      if (!puede) return next(new AppError('No tienes permiso para esta accion', 403, 'FORBIDDEN'));
      next();
    } catch (err) {
      next(err);
    }
  };
}
