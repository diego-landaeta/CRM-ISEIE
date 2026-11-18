import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import { projectAccess } from '../../shared/middleware/projectAccess.js';
import { AppError } from '../../shared/utils/AppError.js';
import * as ctrl from './links-pago.controller.js';

/*
  Links de pago (CRM#680). Fase 1: lectura y el tope de descuento del campus.
  Fase 2: crear y anular un link de pago único, el resto de reglas del campus y
  el webhook de la cuenta. Lo que llama a Stripe usa la clave de escritura del
  campus (Integraciones › Links de pago).
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
// El webhook de la cuenta de Stripe: ver, añadirle los eventos de los links, activarlo o desactivarlo.
router.get('/webhook', puede('links_pago.configurar'), projectAccess, ctrl.verWebhook);
router.put('/webhook', puede('links_pago.configurar'), projectAccess, ctrl.cambiarWebhook);

// Quien crea links ve los suyos; con «ver todos», los de su alcance. El
// recorte lo hace el controlador con la sesión.
router.get('/', puede('links_pago.crear', 'links_pago.ver_todos'), ctrl.listar);
router.get('/:id', puede('links_pago.crear', 'links_pago.ver_todos'), ctrl.detalle);

// Crear: el campus sale del prospecto o de la venta, nunca del cuerpo. Anular:
// el controlador mira que el link sea de su campus y de su alcance.
router.post('/', puede('links_pago.crear'), ctrl.crear);
router.post('/:id/anular', puede('links_pago.crear', 'links_pago.ver_todos'), ctrl.anular);

export default router;
