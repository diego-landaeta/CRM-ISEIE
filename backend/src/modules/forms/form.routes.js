import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as ctrl from './form.controller.js';

const router = Router();

const publicSubmitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Demasiados envios. Intenta de nuevo en unos minutos.', code: 'RATE_LIMITED' },
});

const publicWebhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Rate limit exceeded', code: 'RATE_LIMITED' },
});

// PUBLICAS (sin auth, llamadas desde el embed)
router.get('/public/:embedId', ctrl.publicMeta);
router.post('/public/:embedId/submit', publicSubmitLimiter, ctrl.publicSubmit);
router.post('/webhook/:embedId', publicWebhookLimiter, ctrl.publicWebhook);
router.post('/mailhook/:embedId', publicWebhookLimiter, ctrl.publicMailhook);

router.use(verifyToken);
router.get('/', ctrl.list);
router.get('/:id', ctrl.getById);
router.get('/:id/status', ctrl.getStatus);
router.get('/:id/events', ctrl.listEvents);
router.post('/', roleGuard('admin', 'superadmin', 'soporte'), ctrl.create);
router.patch('/:id', roleGuard('admin', 'superadmin', 'soporte'), ctrl.update);
router.delete('/:id', roleGuard('admin', 'superadmin', 'soporte'), ctrl.remove);
router.post('/:id/listen', roleGuard('admin', 'superadmin', 'soporte'), ctrl.startListening);
router.post('/:id/listen/stop', roleGuard('admin', 'superadmin', 'soporte'), ctrl.stopListening);

export default router;
