import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './category.controller.js';
import { projectAccess } from '../../shared/middleware/projectAccess.js';

const router = Router();
router.use(verifyToken);

// Solo de un campus de quien pide (projectAccess): antes valía el id de cualquiera.
router.get('/tree', puede('products.view'), projectAccess, ctrl.getTree);
// Con «Todos» o una empresa (#218): el árbol de cada campus de quien pide. Antes
// de `/:id/...`; sin `projectAccess`, el controlador recorta por ámbito.
router.get('/ambito', puede('products.view'), ctrl.arbolesDelAmbito);
router.get('/project/:projectId', puede('products.view'), ctrl.listByProject);
router.get('/:id/ancestors', puede('products.view'), ctrl.getAncestors);
router.post('/', puede('products.categorias'), ctrl.create);
router.patch('/:id', puede('products.categorias'), ctrl.update);
router.delete('/:id', puede('products.categorias'), ctrl.remove);

export default router;
