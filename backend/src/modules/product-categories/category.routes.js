import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as ctrl from './category.controller.js';

const router = Router();
router.use(verifyToken);

router.get('/tree', ctrl.getTree);
router.get('/project/:projectId', ctrl.listByProject);
router.get('/:id/ancestors', ctrl.getAncestors);
router.post('/', roleGuard('admin', 'superadmin'), ctrl.create);
router.patch('/:id', roleGuard('admin', 'superadmin'), ctrl.update);
router.delete('/:id', roleGuard('admin', 'superadmin'), ctrl.remove);

export default router;
