import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './message.controller.js';

const router = Router();

router.use(verifyToken);

router.get('/conversations', puede('mensajes.usar'), ctrl.listConversations);
router.get('/conversations/unread-count', puede('mensajes.usar'), ctrl.unreadCount);
router.post('/conversations', puede('mensajes.usar'), ctrl.createConversation);
router.get('/conversations/:id/messages', puede('mensajes.usar'), ctrl.listMessages);
router.post('/conversations/:id/messages', puede('mensajes.usar'), ctrl.sendMessage);
router.patch('/conversations/:id/read', puede('mensajes.usar'), ctrl.markRead);
router.post('/conversations/:id/typing', puede('mensajes.usar'), ctrl.typing);
router.get('/conversations/:id/typing', puede('mensajes.usar'), ctrl.getTyping);
router.delete('/messages/:msgId', puede('mensajes.usar'), ctrl.deleteMessage);
router.get('/users/available', puede('mensajes.usar'), ctrl.availableUsers);
router.get('/users/online', puede('mensajes.usar'), ctrl.onlineUsers);

export default router;
