import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './project.controller.js';
import * as shortcutsCtrl from './shortcuts.controller.js';

const router = Router();

router.use(verifyToken);

// Atajos — catálogo (cualquier autenticado)
router.get('/shortcuts/catalog', puede('projects.view'), shortcutsCtrl.getCatalog);

// Sociedades emisoras (para el selector al crear/editar proyecto). Antes de '/:id'.
router.get('/sociedades', puede('projects.view'), ctrl.listSociedades);
router.post('/sociedades', puede('projects.create'), ctrl.createSociedad);

// Lectura: cualquier user autenticado
router.get('/', puede('projects.view'), ctrl.list);
router.get('/:id', puede('projects.view'), ctrl.getById);

// Escritura: «Crear proyectos» y «Configurar proyectos» (#423; de serie, soporte
// y el superadmin, que es lo que dejaba pasar el roleGuard de superadmin).
router.post('/', puede('projects.create'), ctrl.create);
router.patch('/:id', puede('projects.edit'), ctrl.update);
router.post('/:id/regenerate-webhook-key', puede('projects.edit'), ctrl.regenerateKey);

// Round-robin: estado de la cola de gestores (cualquier autenticado)
router.get('/:id/ultimo-lead', puede('projects.view'), shortcutsCtrl.getUltimoLead);
router.get('/:id/queue-state', puede('projects.view'), shortcutsCtrl.getQueueState);

export default router;
