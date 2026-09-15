import { Router, raw } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as ctrl from './stripe-payments.controller.js';

// Router autenticado (montado en /api/stripe-payments)
const router = Router();
router.use(verifyToken);

// Consultar y sincronizar: tambien las gestoras. Necesitan ver el correo del
// cargo para poder ponerlo en la ficha del cliente, y despues sincronizar para
// que el match se haga solo.
router.get('/', ctrl.list);
router.get('/stats', ctrl.stats);
router.post('/sync', ctrl.sync);
router.get('/:id', ctrl.getOne);

// Asociar o desasociar a mano y decidir disputas: solo admin y superadmin.
// Una asociacion manual mueve dinero de sitio y emite factura.
router.post('/:id/link', roleGuard('admin', 'superadmin'), ctrl.link);
router.delete('/:id/link', roleGuard('admin', 'superadmin'), ctrl.unlink);
router.patch('/:id/dispute', roleGuard('admin', 'superadmin'), ctrl.updateDispute);

// Router publico para webhook (montado en /api/stripe-webhook)
// Recibe raw body para poder verificar firma.
const publicRouter = Router();
publicRouter.post(
  '/:projectId',
  raw({ type: 'application/json', limit: '2mb' }),
  (req, _res, next) => { req.rawBody = req.body?.toString('utf8') || ''; next(); },
  ctrl.webhook
);

export default router;
export { publicRouter };
