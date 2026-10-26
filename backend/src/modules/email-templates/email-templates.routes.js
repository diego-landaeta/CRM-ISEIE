import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import { projectAccess } from '../../shared/middleware/projectAccess.js';
import * as ctrl from './email-templates.controller.js';

const router = Router();

router.use(verifyToken);

// Catálogo de variables — cualquier usuario autenticado puede consultarlo.
router.get('/variables', puede('email_templates.view'), ctrl.getVariables);

// Lectura: cualquier rol autenticado con acceso al proyecto puede ver
// las plantillas (necesario para usarlas al enviar email desde lead).
router.get('/',     puede('email_templates.view'), projectAccess, ctrl.list);
router.get('/:id',  puede('email_templates.view'), projectAccess, ctrl.getById);
router.post('/:id/render', puede('email_templates.view'), projectAccess, ctrl.preview);

// Escritura: solo admin/superadmin.
router.post('/',         puede('email_templates.create'), projectAccess, ctrl.create);
router.patch('/:id',     puede('email_templates.edit'), projectAccess, ctrl.update);
router.delete('/:id',    puede('email_templates.delete'), projectAccess, ctrl.remove);

export default router;
