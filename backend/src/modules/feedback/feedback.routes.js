import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyToken } from '../../shared/middleware/auth.js';
import * as ctrl from './feedback.controller.js';

// Con sesión: el panel, su lista y el correo de cada ficha.
const router = Router();
router.use(verifyToken);
router.get('/panel', ctrl.panel);
router.get('/lista', ctrl.lista);
router.get('/lead/:leadId', ctrl.deUnLead);
router.post('/lead/:leadId/enviar', ctrl.enviarLoRevisado);
router.post('/lead/:leadId/no-enviar', ctrl.noEnviar);

// Sin sesión: la encuesta. Con un límite por IP: el enlace no pide contraseña,
// así que es lo que impide probar tokens a ciegas.
const publicRouter = Router();
publicRouter.use(rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false }));
publicRouter.get('/:token', ctrl.encuesta);
publicRouter.post('/:token', ctrl.responder);

export default router;
export { publicRouter };
