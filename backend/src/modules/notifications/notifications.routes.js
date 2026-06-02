import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as ctrl from './notifications.controller.js';

const router = Router();
router.use(verifyToken);
router.use(roleGuard('admin', 'superadmin')); // notifs solo para admin/superadmin

router.get('/', ctrl.list);
router.get('/unread-count', ctrl.unreadCount);
router.patch('/:id/read', ctrl.markRead);
router.patch('/mark-all-read', ctrl.markAllRead);

export default router;
