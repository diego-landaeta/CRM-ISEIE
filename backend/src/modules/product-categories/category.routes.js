import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './category.controller.js';

const router = Router();
router.use(verifyToken);

router.get('/tree', puede('products.view'), ctrl.getTree);
router.get('/project/:projectId', puede('products.view'), ctrl.listByProject);
router.get('/:id/ancestors', puede('products.view'), ctrl.getAncestors);
router.post('/', puede('products.categorias'), ctrl.create);
router.patch('/:id', puede('products.categorias'), ctrl.update);
router.delete('/:id', puede('products.categorias'), ctrl.remove);

export default router;
