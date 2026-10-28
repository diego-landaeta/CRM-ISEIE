import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './asignacion.controller.js';

const router = Router();

// La entrada de Make: sin sesión, con la clave de su configuración. Antes del
// verifyToken del resto. Con un límite holgado: un formulario por petición.
const limiteEntrada = rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false });
router.post('/entrada', limiteEntrada, ctrl.entrada);

router.use(verifyToken);
// La misma gente que el webhook de transferencias: admin y super admin.
router.get('/', puede('webhooks_salientes.view'), ctrl.listar);
router.get('/decisiones', puede('webhooks_salientes.view'), ctrl.decisiones);
router.post('/decisiones/:id/reenviar', puede('webhooks_salientes.edit'), ctrl.reenviar);
router.post('/', puede('webhooks_salientes.create'), ctrl.crear);
router.patch('/:id', puede('webhooks_salientes.edit'), ctrl.cambiar);
router.post('/:id/clave', puede('webhooks_salientes.edit'), ctrl.nuevaClave);
router.post('/:id/prueba', puede('webhooks_salientes.edit'), ctrl.prueba);
router.delete('/:id', puede('webhooks_salientes.delete'), ctrl.borrar);

export default router;
