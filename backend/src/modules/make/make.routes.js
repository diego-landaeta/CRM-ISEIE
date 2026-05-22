import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as ctrl from './make.controller.js';

const router = Router();

// Rutas admin (con auth)
router.use(verifyToken);
router.use(roleGuard('admin', 'superadmin'));

router.get('/', ctrl.list);
router.get('/:id', ctrl.getById);
router.post('/', ctrl.create);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);
router.post('/:id/rotate-secret', ctrl.rotateSecret);
router.get('/:id/deliveries', ctrl.deliveries);

export default router;
