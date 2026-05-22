import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as ctrl from './field.controller.js';

const router = Router();
router.use(verifyToken);

// Lectura: cualquier user con acceso al proyecto
router.get('/project/:projectId', ctrl.listByProject);

// Gestion: solo admin/superadmin
router.post('/', roleGuard('admin', 'superadmin'), ctrl.create);
router.patch('/:id', roleGuard('admin', 'superadmin'), ctrl.update);
router.delete('/:id', roleGuard('admin', 'superadmin'), ctrl.remove);
router.post('/reorder', roleGuard('admin', 'superadmin'), ctrl.reorder);

export default router;
