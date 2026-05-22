import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import { projectAccess } from '../../shared/middleware/projectAccess.js';
import * as ctrl from './email-templates.controller.js';

const router = Router();

router.use(verifyToken);

// Catalogo de variables: cualquier usuario autenticado puede consultarlo.
router.get('/variables', ctrl.getVariables);

// Lectura: cualquier rol autenticado con acceso al proyecto puede ver
// las plantillas (necesario para usarlas al enviar email desde lead).
router.get('/',     projectAccess, ctrl.list);
router.get('/:id',  projectAccess, ctrl.getById);
router.post('/:id/render', projectAccess, ctrl.preview);

// Escritura: solo admin/superadmin.
router.post('/',         roleGuard('admin', 'superadmin'), projectAccess, ctrl.create);
router.patch('/:id',     roleGuard('admin', 'superadmin'), projectAccess, ctrl.update);
router.delete('/:id',    roleGuard('admin', 'superadmin'), projectAccess, ctrl.remove);

export default router;
