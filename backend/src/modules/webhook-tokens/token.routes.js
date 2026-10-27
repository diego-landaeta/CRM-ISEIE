import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './token.controller.js';

const router = Router();

// PUBLICO: recibe payload (sin auth)
router.post('/receive/:token', ctrl.publicReceive);

router.use(verifyToken);
router.get('/', puede('webhooks.view'), ctrl.list);
router.get('/:id/status', puede('webhooks.view'), ctrl.getStatus);
router.post('/', puede('webhooks.create'), ctrl.create);
router.patch('/:id', puede('webhooks.edit'), ctrl.update);
router.delete('/:id', puede('webhooks.delete'), ctrl.remove);
router.post('/:id/listen', puede('webhooks.edit'), ctrl.startListening);
router.post('/:id/listen/stop', puede('webhooks.edit'), ctrl.stopListening);

export default router;
