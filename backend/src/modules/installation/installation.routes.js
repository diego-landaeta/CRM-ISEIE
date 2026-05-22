import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as ctrl from './installation.controller.js';

const router = Router();
router.use(verifyToken);
router.get('/', ctrl.getInstallation);
router.patch('/', roleGuard('superadmin'), ctrl.updateInstallation);
export default router;
