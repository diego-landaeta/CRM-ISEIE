import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as ctrl from './integrations.controller.js';

const router = Router();

router.use(verifyToken);
router.use(roleGuard('superadmin', 'admin'));

router.get('/',                ctrl.list);
router.get('/:provider',       ctrl.getOne);
router.put('/',                ctrl.upsert);
router.post('/:provider/test', ctrl.test);
router.delete('/:provider',    ctrl.remove);

export default router;
