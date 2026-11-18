import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './diploma-confirmacion.controller.js';

// Con sesión: los mismos permisos que Diplomas. Ver, quien ve Diplomas; pedir,
// reenviar y volver a pasar lo corregido, quien emite (es el recorrido de emitir).
// Siempre en sus campus: lo mira el servicio con certifex.alcance.js.
const router = Router();
router.use(verifyToken);
router.get('/', puede('diplomas.view', 'diplomas.emit'), ctrl.estados);
router.post('/pedir', puede('diplomas.emit'), ctrl.pedir);
router.post('/:matriculaId/reenviar', puede('diplomas.emit'), ctrl.reenviar);
router.post('/:matriculaId/aplicar', puede('diplomas.emit'), ctrl.reaplicar);

// Sin sesión: la página del alumno. El enlace es la llave; el límite por IP es lo
// que impide probar enlaces a ciegas (además de la firma y de los intentos por enlace).
const publicRouter = Router();
publicRouter.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false }));
publicRouter.get('/:token', ctrl.formulario);
publicRouter.post('/:token', ctrl.responder);

export default router;
export { publicRouter };
