import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as ctrl from './payable.controller.js';

const router = Router();
router.use(verifyToken);
router.use(roleGuard('admin', 'superadmin'));

router.get('/', ctrl.list);
router.get('/stats', ctrl.stats);
router.get('/:id', ctrl.getOne);
router.post('/', ctrl.create);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);
router.post('/:id/payments', ctrl.addPayment);

export default router;
