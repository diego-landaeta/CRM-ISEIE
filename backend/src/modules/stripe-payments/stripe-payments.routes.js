import { Router, raw } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './stripe-payments.controller.js';
import * as disputas from './disputas.controller.js';
import { projectAccess } from '../../shared/middleware/projectAccess.js';

// Router autenticado (montado en /api/stripe-payments)
const router = Router();
router.use(verifyToken);

// Consultar y sincronizar: tambien las gestoras. Necesitan ver el correo del
// cargo para poder ponerlo en la ficha del cliente, y despues sincronizar para
// que el match se haga solo.
router.get('/', puede('stripe.view'), ctrl.list);
router.get('/stats', puede('stripe.view'), ctrl.stats);
// Solo los campus de quien lo pide (#428): antes el projectId del cuerpo iba tal cual.
router.post('/sync', puede('stripe.view'), projectAccess, ctrl.sync);
// Disputas (#396): solo lectura, admin y super admin (y soporte), cada uno en sus
// campus. Antes de `/:id`: con el comodin por delante, `/disputas` se leeria
// como el cargo con id «disputas».
router.get('/disputas', puede('stripe.edit'), disputas.listar);
router.post('/disputas/sincronizar', puede('stripe.edit'), projectAccess, disputas.sincronizar);
// Cargos sueltos y cobros sin cargo de una venta, para enlazarlos (CRM#888).
router.get('/de-la-venta/:conversionId', puede('stripe.edit'), ctrl.deLaVenta);
router.get('/:id', puede('stripe.view'), ctrl.getOne);

// Asociar o desasociar a mano y decidir disputas: solo admin y superadmin.
// Una asociacion manual mueve dinero de sitio y emite factura.
router.post('/:id/link', puede('stripe.edit'), ctrl.link);
router.delete('/:id/link', puede('stripe.edit'), ctrl.unlink);
router.patch('/:id/dispute', puede('stripe.edit'), ctrl.updateDispute);

// Router publico para webhook (montado en /api/stripe-webhook)
// Recibe raw body para poder verificar firma.
const publicRouter = Router();
publicRouter.post(
  '/:projectId',
  raw({ type: 'application/json', limit: '2mb' }),
  function guardarCuerpoCrudo(req, _res, next) { req.rawBody = req.body?.toString('utf8') || ''; next(); },
  ctrl.webhook
);

export default router;
export { publicRouter };
