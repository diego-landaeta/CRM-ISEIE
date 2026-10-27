import { Router, raw } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './stripe-payments.controller.js';

// Router autenticado (montado en /api/stripe-payments)
const router = Router();
router.use(verifyToken);

// Consultar y sincronizar: tambien las gestoras. Necesitan ver el correo del
// cargo para poder ponerlo en la ficha del cliente, y despues sincronizar para
// que el match se haga solo.
router.get('/', puede('stripe.view'), ctrl.list);
router.get('/stats', puede('stripe.view'), ctrl.stats);
router.post('/sync', puede('stripe.view'), ctrl.sync);
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
