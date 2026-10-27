import { AppError } from '../utils/AppError.js';
import { tieneRol } from '../utils/roles.js';
import { conRegla } from './auth.js';
import { resolvePermission } from '../../modules/permissions/permissions.service.js';

// Middleware granular de permisos.
// Usar después de verifyToken. Complementa (no reemplaza) roleGuard.
//
// Ejemplo: router.delete('/:id', verifyToken, checkPermission('leads', 'delete'), ctrl.remove)
export function checkPermission(resource, action) {
  return conRegla(async (req, res, next) => {
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
  }, { tipo: 'permiso', clave: `${resource}.${action}`, conExtras: false });
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
  return conRegla(async (req, _res, next) => {
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
  }, { tipo: 'rolOPermiso', roles, clave: `${resource}.${acciones[0]}`, claves: acciones.map((a) => `${resource}.${a}`) });
}

/* ─── #423 · Cada acción con su permiso del catálogo ─────────────────────── */

/**
 * Lo que puede quien hace la petición, leído UNA vez por petición. Va a la
 * base, no al token: quitarle algo a alguien surte efecto ya.
 */
export function cargarPermisos(req) {
  if (!req._permisos) {
    req._permisos = import('../../modules/permissions/permissions.service.js')
      .then((s) => s.explicarPermisos(req.user.userId));
  }
  return req._permisos;
}

/** Para un controlador: `if (!(await tienePermiso(req, 'facturas.emitir'))) …` */
export async function tienePermiso(req, ...claves) {
  if (!req.user) return false;
  const e = await cargarPermisos(req);
  return Boolean(e) && claves.some((c) => e.mapa[c] === true);
}

/**
 * El guardia de una ruta: pasa quien tenga la clave (o alguna de ellas). La
 * regla queda pegada (`conRegla`) para que el inventario sepa qué pide.
 */
export function puede(...args) {
  // Opcional, al final: `{ mensaje, code }` para el 403, cuando la pantalla
  // tiene su propio aviso (WhatsApp: «No tienes activado el WhatsApp del CRM…»).
  const opciones = args.length && typeof args[args.length - 1] === 'object' ? args.pop() : {};
  const claves = args;
  return conRegla(async (req, _res, next) => {
    try {
      if (!req.user) return next(new AppError('No autenticado', 401, 'AUTH_REQUIRED'));
      if (!(await tienePermiso(req, ...claves))) {
        return next(new AppError(opciones.mensaje || 'No tienes permiso para esta accion', 403, opciones.code || 'FORBIDDEN'));
      }
      next();
    } catch (err) {
      next(err);
    }
  }, { tipo: 'puede', claves });
}
