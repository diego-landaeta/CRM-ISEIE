import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './ia-analisis.controller.js';

const router = Router();
router.use(verifyToken);

// Cada pregunta son varias llamadas a Anthropic y cada una se paga. El tope
// mensual protege el total; esto protege de un bucle o de alguien que machaque
// el boton: ocho preguntas por minuto y persona son mas de las que se hacen a
// mano. Se puede cambiar con IA_PREGUNTAS_POR_MINUTO sin tocar el codigo.
//
// Por PERSONA y no por IP: detras del proxy de la oficina todos comparten IP, y
// la ruta siempre lleva sesion (`verifyToken` va por delante).
const limite = rateLimit({
  windowMs: 60 * 1000,
  max: () => Number(process.env.IA_PREGUNTAS_POR_MINUTO) || 8,
  keyGenerator: (req) => `u${req.user.userId}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Demasiadas preguntas seguidas. Espera un minuto.', code: 'RATE_LIMITED' },
});

// Los mismos roles que generan el reporte con IA: quien mira las cifras de la
// empresa, no cada gestora (que ve lo suyo y no necesita esto).
router.post('/preguntar', puede('reports_ia.generar'), limite, ctrl.preguntarCtrl);

export default router;
