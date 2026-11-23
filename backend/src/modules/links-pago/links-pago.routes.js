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

// El asistente de crear link (20/11): si «Cuotas» se puede en este campus y, si
// no, por qué. Quien crea links; el campus, `projectAccess`.
router.get('/cuotas-disponibles', puede('links_pago.crear'), projectAccess, ctrl.cuotasDisponibles);

// El asistente de crear link: las ventas del prospecto, para elegir a cuál va
// (o ninguna). El controlador mira que el prospecto sea de su campus y alcance.
router.get('/ventas-del-prospecto', puede('links_pago.crear'), ctrl.ventasDelProspecto);

// «Generar plan de pago» (19/11): ver las cuotas pendientes de la venta y crear un
// link por cuota. Antes de `/:id`. El controlador mira campus y alcance de la venta.
router.get('/plan', puede('links_pago.crear'), ctrl.verPlan);
router.post('/plan', puede('links_pago.crear'), ctrl.generarPlan);

// Cobro automático de las cuotas con Stripe (309). Verlo, quien crea links (la
// ficha de la venta); activarlo o quitarlo, su permiso. Campus y alcance de la
// venta, en el controlador.
router.get('/cobro-automatico', puede('links_pago.crear', 'links_pago.ver_todos'), ctrl.verCobroAutomatico);
router.put('/cobro-automatico', puede('links_pago.cobro_automatico'), ctrl.cambiarCobroAutomatico);

// Quien crea links ve los suyos; con «ver todos», los de su alcance. El
// recorte lo hace el controlador con la sesión.
// El embudo por gestora y campus (CRM#987). Antes de `/:id`. El recorte, en el controlador.
router.get('/embudo', puede('links_pago.crear', 'links_pago.ver_todos'), ctrl.embudo);
router.get('/', puede('links_pago.crear', 'links_pago.ver_todos'), ctrl.listar);
router.get('/:id', puede('links_pago.crear', 'links_pago.ver_todos'), ctrl.detalle);

// Crear: el campus sale del prospecto o de la venta, nunca del cuerpo. Anular:
// el controlador mira que el link sea de su campus y de su alcance.
router.post('/', puede('links_pago.crear'), ctrl.crear);
router.post('/:id/anular', puede('links_pago.crear', 'links_pago.ver_todos'), ctrl.anular);
// Renovar un caducado con un clic (gemela de CRM#984): un link nuevo igual, con la
// caducidad de serie. Quien crea links, sobre uno de su campus y su alcance.
router.post('/:id/renovar', puede('links_pago.crear'), ctrl.renovar);

export default router;
