import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './make.controller.js';

const router = Router();

// Rutas admin (con auth)
router.use(verifyToken);

router.get('/', puede('make.view'), ctrl.list);
router.get('/:id', puede('make.view'), ctrl.getById);
router.post('/', puede('make.create'), ctrl.create);
router.patch('/:id', puede('make.edit'), ctrl.update);
router.delete('/:id', puede('make.delete'), ctrl.remove);
router.post('/:id/rotate-secret', puede('make.edit'), ctrl.rotateSecret);
router.get('/:id/deliveries', puede('make.view'), ctrl.deliveries);

export default router;
