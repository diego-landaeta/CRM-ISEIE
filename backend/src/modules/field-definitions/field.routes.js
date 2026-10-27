import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './field.controller.js';

const router = Router();
router.use(verifyToken);

// Lectura: cualquier user con acceso al proyecto
router.get('/project/:projectId', puede('field_defs.view'), ctrl.listByProject);

// Gestion: solo admin/superadmin
router.post('/', puede('field_defs.edit'), ctrl.create);
router.patch('/:id', puede('field_defs.edit'), ctrl.update);
router.delete('/:id', puede('field_defs.edit'), ctrl.remove);
router.post('/reorder', puede('field_defs.edit'), ctrl.reorder);

export default router;
