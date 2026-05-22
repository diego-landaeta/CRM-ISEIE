import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as ctrl from './sequence.controller.js';

const router = Router();
router.use(verifyToken);

router.get('/', ctrl.list);
router.get('/runs', ctrl.listRuns);
router.get('/:id', ctrl.getById);
router.post('/', roleGuard('admin', 'superadmin'), ctrl.create);
router.patch('/:id', roleGuard('admin', 'superadmin'), ctrl.update);
router.delete('/:id', roleGuard('admin', 'superadmin'), ctrl.remove);
router.post('/runs/start', roleGuard('admin', 'superadmin', 'gestor'), ctrl.startManual);
router.post('/runs/:runId/stop', roleGuard('admin', 'superadmin', 'gestor'), ctrl.stopRun);

export default router;
