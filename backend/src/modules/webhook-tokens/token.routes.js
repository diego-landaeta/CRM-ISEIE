import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as ctrl from './token.controller.js';

const router = Router();

// PUBLICO: recibe payload (sin auth)
router.post('/receive/:token', ctrl.publicReceive);

router.use(verifyToken);
router.get('/', ctrl.list);
router.get('/:id/status', ctrl.getStatus);
router.post('/', roleGuard('admin', 'superadmin', 'soporte'), ctrl.create);
router.patch('/:id', roleGuard('admin', 'superadmin', 'soporte'), ctrl.update);
router.delete('/:id', roleGuard('admin', 'superadmin', 'soporte'), ctrl.remove);
router.post('/:id/listen', roleGuard('admin', 'superadmin', 'soporte'), ctrl.startListening);
router.post('/:id/listen/stop', roleGuard('admin', 'superadmin', 'soporte'), ctrl.stopListening);

export default router;
