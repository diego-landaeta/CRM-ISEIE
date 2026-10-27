import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './installation.controller.js';

const router = Router();
router.use(verifyToken);
router.get('/', puede('installation.view'), ctrl.getInstallation);
router.patch('/', puede('installation.edit'), ctrl.updateInstallation);
export default router;
