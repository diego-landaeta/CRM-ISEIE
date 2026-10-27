import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './channel.controller.js';

const router = Router();

router.use(verifyToken);

// Todos los autenticados pueden leer los canales de su proyecto
router.get('/', puede('channels.view'), ctrl.list);

// Solo admin/superadmin pueden configurar
router.post('/', puede('channels.edit'), ctrl.create);
router.patch('/:id', puede('channels.edit'), ctrl.update);
router.delete('/:id', puede('channels.edit'), ctrl.remove);

export default router;
