import { Router, raw } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import * as ctrl from './stripe-payments.controller.js';

// Router autenticado (montado en /api/stripe-payments)
const router = Router();
router.use(verifyToken);
router.get('/', ctrl.list);
router.get('/stats', ctrl.stats);
router.post('/sync', ctrl.sync);
router.get('/:id', ctrl.getOne);
router.post('/:id/link', ctrl.link);
router.delete('/:id/link', ctrl.unlink);
router.patch('/:id/dispute', ctrl.updateDispute);

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
