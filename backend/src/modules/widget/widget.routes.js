import express, { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './widget.controller.js';

// Router autenticado (admin)
const router = Router();
router.use(verifyToken);
router.get('/config', puede('widget.view'), ctrl.getConfig);
router.get('/pulsaciones', puede('widget.view'), ctrl.pulsaciones);
router.patch('/config', puede('widget.edit'), ctrl.updateConfig);
router.patch('/users/:userId/phone', puede('widget.edit'), ctrl.updateUserPhone);

// Router publico — endpoint del script
const publicRouter = Router();
publicRouter.get('/whatsapp/:projectIdJs', ctrl.widgetScript);
publicRouter.get('/data/:projectIdJson', ctrl.widgetData);
// Cada pulsación del botón (sendBeacon manda texto plano, que el parser general no lee).
publicRouter.post('/clic/:projectId', express.text({ type: '*/*', limit: '2kb' }), ctrl.widgetClic);

export default router;
export { publicRouter };
