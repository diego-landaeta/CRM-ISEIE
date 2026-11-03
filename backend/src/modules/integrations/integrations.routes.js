import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import { projectAccess } from '../../shared/middleware/projectAccess.js';
import { AppError } from '../../shared/utils/AppError.js';
import * as ctrl from './integrations.controller.js';

const router = Router();

router.use(verifyToken);
// Y solo en SUS campus (QA de Diego, 22/10). Tener el permiso no basta: un admin de
// otra empresa cambiaba el projectId y veía, guardaba o borraba la integración
// de un campus ajeno —con Moodle, la URL y el token de administrador del campus—.
// Cada ruta: primero el permiso (#423) y después `projectAccess`. El controlador
// usa `req.projectId`, el campus que se ha comprobado ahí.
//
// Antes, un projectId que no es un número daba 400 aquí. `projectAccess` lo
// manda tal cual a la base, que falla, y la petición se queda sin respuesta:
// se comprueba antes, el mismo campo que mira él. Solo mira el formato, no
// quién entra: en el inventario de permisos (#423) va con los técnicos.
router.use(function projectIdConFormato(req, _res, next) {
  const pedido = req.params.projectId || req.body?.projectId || req.query.projectId;
  if (pedido !== undefined && !(/^\d{1,9}$/.test(String(pedido)) && Number(pedido) > 0)) {
    return next(new AppError('projectId requerido', 400, 'PROJECT_REQUIRED'));
  }
  next();
});

router.get('/',                puede('integrations.view'), projectAccess, ctrl.list);
router.get('/:provider',       puede('integrations.view'), projectAccess, ctrl.getOne);
router.put('/',                puede('integrations.edit'), projectAccess, ctrl.upsert);
router.post('/:provider/test', puede('integrations.edit'), projectAccess, ctrl.test);
router.delete('/:provider',    puede('integrations.edit'), projectAccess, ctrl.remove);

export default router;
