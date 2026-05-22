// Rutas PUBLICAS de Make (sin auth de JWT - autenticadas por X-Make-Secret)
//
// Estas rutas se montan en /api/webhooks (ver make/index.js -> publicMount).
// NO van detras de verifyToken porque las llama Make.com / sistemas externos
// que no tienen JWT. La autenticacion es por header X-Make-Secret comparada
// constant-time contra el secret en DB (ver make.service.js).
import { Router } from 'express';
import * as ctrl from './make.controller.js';

const router = Router();

router.post('/make/:slug', ctrl.receive);

export default router;
