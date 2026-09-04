import { Router } from 'express';
import { verifyToken, soloRoles } from '../../shared/middleware/auth.js';
import * as ctrl from './credentials.controller.js';

const router = Router();
router.use(verifyToken);

// `soloRoles` y NO `roleGuard`, y esta es la diferencia que pide la #80.
//
// `roleGuard` deja pasar a superadmin y soporte ANTES de mirar la lista, asi
// que aqui coincidia con lo que se queria por casualidad. Con `soloRoles` se
// declara quien entra: si mañana aparece un rol nuevo, no hereda el acceso a
// las credenciales por caer en un `else`.
router.use(soloRoles('soporte', 'superadmin'));

router.get('/', ctrl.list);
// Antes que `/:id/...` para que «paridad» y «registro» no se lean como un id.
router.get('/paridad', ctrl.paridad);
router.get('/registro', ctrl.registro);

router.post('/', ctrl.upsert);
router.post('/:id/test', ctrl.test);
// El valor entero, uno a uno y dejando rastro. El listado no lo trae nunca.
router.get('/:id/revelar', ctrl.revelar);
router.delete('/:id', ctrl.remove);

export default router;
