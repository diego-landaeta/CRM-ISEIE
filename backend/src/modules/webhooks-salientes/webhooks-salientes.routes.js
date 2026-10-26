import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './webhooks-salientes.controller.js';

const router = Router();
router.use(verifyToken);
// `soloRoles` y no `roleGuard`: roleGuard deja pasar también a soporte, y el
// webhook de transferencias es solo de admin y super admin (Diego, 15/10), como
// Conectores. El ámbito de cada webhook lo comprueba el controlador.

router.get('/', puede('webhooks_salientes.view'), ctrl.listar);
// Antes de /:id, o Express leería «ejemplo» y «envios» como un identificador.
router.get('/ejemplo', puede('webhooks_salientes.view'), ctrl.ejemplo);
router.get('/envios', puede('webhooks_salientes.view'), ctrl.envios);
router.post('/envios/:envioId/reenviar', puede('webhooks_salientes.edit'), ctrl.reenviar);
router.get('/:id', puede('webhooks_salientes.view'), ctrl.uno);
router.post('/', puede('webhooks_salientes.create'), ctrl.crear);
router.patch('/:id', puede('webhooks_salientes.edit'), ctrl.cambiar);
router.delete('/:id', puede('webhooks_salientes.delete'), ctrl.borrar);
router.post('/:id/prueba', puede('webhooks_salientes.edit'), ctrl.prueba);

export default router;
