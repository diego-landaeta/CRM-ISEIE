import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import { projectAccess } from '../../shared/middleware/projectAccess.js';
import * as ctrl from './proceso.controller.js';

const router = Router();
router.use(verifyToken);

// LEER los pasos lo puede hacer cualquiera con acceso al proyecto: la gestora
// necesita saber en que paso va cada prospecto, que es de lo que va todo esto.
router.get('/pasos', projectAccess, ctrl.listarPasos);

// CAMBIARLOS, no: el proceso es de la casa, no de cada gestora. Si cada una
// pudiera mover los dias, la cola de mañana diria una cosa distinta por persona
// y las cifras de cierre dejarian de poder compararse.
router.post('/pasos', roleGuard('admin', 'superadmin'), projectAccess, ctrl.crearPaso);
// Antes que `/pasos/:id` para que «orden» no se lea como un id.
router.patch('/pasos/orden', roleGuard('admin', 'superadmin'), projectAccess, ctrl.reordenarPasos);
router.patch('/pasos/:id', roleGuard('admin', 'superadmin'), projectAccess, ctrl.editarPaso);
router.delete('/pasos/:id', roleGuard('admin', 'superadmin'), projectAccess, ctrl.desactivarPaso);

export default router;
