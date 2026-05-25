// Rutas PUBLICAS de Make (sin auth de JWT - autenticadas por X-Make-Secret)
//
// Estas rutas se montan en /api/webhooks (ver make/index.js -> publicMount).
// NO van detras de verifyToken porque las llama Make.com / sistemas externos
// que no tienen JWT. La autenticacion es por header X-Make-Secret comparada
// constant-time contra el secret en DB (ver make.service.js).
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as ctrl from './make.controller.js';

const router = Router();

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Rate limit exceeded', code: 'RATE_LIMITED' },
});

router.post('/make/:slug', webhookLimiter, ctrl.receive);

export default router;
