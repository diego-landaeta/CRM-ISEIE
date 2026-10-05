import { Router } from 'express';
import { verifyToken, soloRoles } from '../../shared/middleware/auth.js';
import * as ctrl from './connectors.controller.js';

const router = Router();
router.use(verifyToken);
// `soloRoles` y no `roleGuard`: roleGuard deja pasar tambien a soporte, y
// Conectores es solo de admin y super admin (Diego, 29/09).
router.use(soloRoles('admin', 'superadmin'));

router.get('/', ctrl.list);
router.get('/:id', ctrl.getById);
router.post('/', ctrl.create);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

router.post('/:id/preview', ctrl.preview);
router.post('/:id/import', ctrl.runImport);

export default router;
