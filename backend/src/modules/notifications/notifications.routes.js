import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import * as ctrl from './notifications.controller.js';

const router = Router();
router.use(verifyToken);
// Sin roleGuard: cada user ve sus notifs. La visibilidad está en el SERVICE
// (visibilityClause) que filtra por target_user_ids vs rol del que hace la
// request. Gestor solo ve las que tienen su user_id en target_user_ids.

router.get('/', ctrl.list);
router.get('/unread-count', ctrl.unreadCount);
router.patch('/:id/read', ctrl.markRead);
router.patch('/mark-all-read', ctrl.markAllRead);

export default router;
