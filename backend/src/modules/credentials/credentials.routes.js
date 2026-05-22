import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as ctrl from './credentials.controller.js';

const router = Router();
router.use(verifyToken);
router.use(roleGuard('superadmin'));

router.get('/', ctrl.list);
router.post('/', ctrl.upsert);
router.post('/:id/test', ctrl.test);
router.delete('/:id', ctrl.remove);

export default router;
