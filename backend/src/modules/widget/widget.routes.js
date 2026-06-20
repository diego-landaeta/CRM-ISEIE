import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import * as ctrl from './widget.controller.js';

// Router autenticado (admin)
const router = Router();
router.use(verifyToken);
router.get('/config', ctrl.getConfig);
router.patch('/config', ctrl.updateConfig);
router.patch('/users/:userId/phone', ctrl.updateUserPhone);

// Router publico — endpoint del script
const publicRouter = Router();
publicRouter.get('/whatsapp/:projectIdJs', ctrl.widgetScript);
publicRouter.get('/data/:projectIdJson', ctrl.widgetData);

export default router;
export { publicRouter };
