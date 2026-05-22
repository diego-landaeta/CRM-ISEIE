import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as ctrl from './project.controller.js';
import * as shortcutsCtrl from './shortcuts.controller.js';

const router = Router();

router.use(verifyToken);

// Atajos — catálogo (cualquier autenticado)
router.get('/shortcuts/catalog', shortcutsCtrl.getCatalog);

// Lectura: cualquier user autenticado
router.get('/', ctrl.list);
router.get('/:id', ctrl.getById);

// Escritura: solo superadmin
router.post('/', roleGuard('superadmin'), ctrl.create);
router.patch('/:id', roleGuard('superadmin'), ctrl.update);
router.post('/:id/regenerate-webhook-key', roleGuard('superadmin'), ctrl.regenerateKey);

// Round-robin: estado de la cola de gestores (cualquier autenticado)
router.get('/:id/queue-state', shortcutsCtrl.getQueueState);

export default router;
