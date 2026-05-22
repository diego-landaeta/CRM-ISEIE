import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as ctrl from './channel.controller.js';

const router = Router();

router.use(verifyToken);

// Todos los autenticados pueden leer los canales de su proyecto
router.get('/', ctrl.list);

// Solo admin/superadmin pueden configurar
router.post('/', roleGuard('admin', 'superadmin'), ctrl.create);
router.patch('/:id', roleGuard('admin', 'superadmin'), ctrl.update);
router.delete('/:id', roleGuard('admin', 'superadmin'), ctrl.remove);

export default router;
