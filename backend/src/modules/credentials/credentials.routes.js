import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './credentials.controller.js';

const router = Router();
router.use(verifyToken);

// ISEIE (#230): las claves de servicios son de «Ver claves» y «Guardar claves»
// (de serie, soporte; el superadmin lo tiene todo). Antes, el roleGuard de superadmin,
// que dejaba pasar también a soporte por el atajo: los mismos.
router.get('/', puede('credentials.view'), ctrl.list);
router.post('/', puede('credentials.edit'), ctrl.upsert);
router.post('/:id/test', puede('credentials.edit'), ctrl.test);
router.delete('/:id', puede('credentials.edit'), ctrl.remove);

export default router;
