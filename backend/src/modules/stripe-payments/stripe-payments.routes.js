import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import * as ctrl from './stripe-payments.controller.js';

const router = Router();
router.use(verifyToken);

router.get('/', ctrl.list);
router.get('/stats', ctrl.stats);
router.post('/sync', ctrl.sync);
router.post('/:id/link', ctrl.link);
router.delete('/:id/link', ctrl.unlink);

export default router;
