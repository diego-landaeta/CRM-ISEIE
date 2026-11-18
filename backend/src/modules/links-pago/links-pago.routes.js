import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import { projectAccess } from '../../shared/middleware/projectAccess.js';
import { AppError } from '../../shared/utils/AppError.js';
import * as ctrl from './links-pago.controller.js';

/*
  Links de pago (CRM#680). Fase 1: solo lectura y el tope de descuento del campus.
  Aquí no se llama a Stripe: crear, caducar y anular llegan en la fase 2.
*/
const router = Router();
router.use(verifyToken);

// Lo mismo que Integraciones: `projectAccess` manda el projectId tal cual a la
// base, y uno que no es un número la hace fallar sin respuesta. Solo mira el
// formato; en el inventario de permisos va con los técnicos (mismo nombre).
router.use(function projectIdConFormato(req, _res, next) {
  const pedido = req.body?.projectId ?? req.query.projectId;
  if (pedido !== undefined && !(/^\d{1,9}$/.test(String(pedido)) && Number(pedido) > 0)) {
    return next(new AppError('projectId requerido', 400, 'PROJECT_REQUIRED'));
  }
  next();
});

// Antes de `/:id`, que si no se la come.
router.get('/config', puede('links_pago.configurar', 'links_pago.crear'), projectAccess, ctrl.verConfig);
router.put('/config', puede('links_pago.configurar'), projectAccess, ctrl.guardarConfig);

// Quien crea links ve los suyos; con «ver todos», los de su alcance. El
// recorte lo hace el controlador con la sesión.
router.get('/', puede('links_pago.crear', 'links_pago.ver_todos'), ctrl.listar);
router.get('/:id', puede('links_pago.crear', 'links_pago.ver_todos'), ctrl.detalle);

export default router;
