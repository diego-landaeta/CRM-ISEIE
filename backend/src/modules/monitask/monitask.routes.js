import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import { AppError } from '../../shared/utils/AppError.js';
import { monitaskActivo } from './interruptor.js';
import * as ctrl from './monitask.controller.js';

/**
 * Monitask (#236). Todas detrás de MONITASK_ACTIVO: apagado, 404 como si no existiera.
 *
 *   monitask.view        ver «Equipo › Actividad» y el cotejo con las facturas
 *   monitask.configurar  la conexión, sincronizar y emparejar personas
 *
 * El `verifyToken` va en cada ruta y no en `router.use`: la vuelta del OAuth
 * (`publicRouter`, montado en /api/monitask/oauth) pasa antes por este router y no
 * lleva sesión del CRM.
 */
function comprobarInterruptor(_req, _res, next) {
  if (!monitaskActivo()) return next(new AppError('No encontrado', 404, 'NOT_FOUND'));
  next();
}

const router = Router();
const ver = [verifyToken, puede('monitask.view', 'monitask.configurar'), comprobarInterruptor];
const configurar = [verifyToken, puede('monitask.configurar'), comprobarInterruptor];

router.get('/estado', ...ver, ctrl.estado);

router.put('/conexion', ...configurar, ctrl.guardarApp);
router.delete('/conexion', ...configurar, ctrl.desconectar);
router.post('/conexion/autorizar', ...configurar, ctrl.autorizar);
router.post('/sincronizar', ...configurar, ctrl.sincronizar);
router.get('/personas', ...configurar, ctrl.personas);
router.patch('/personas/:id', ...configurar, ctrl.emparejar);

router.get('/actividad', verifyToken, puede('monitask.view'), comprobarInterruptor, ctrl.actividad);
router.get('/actividad/:id/dias', verifyToken, puede('monitask.view'), comprobarInterruptor, ctrl.dias);
router.get('/cotejo', verifyToken, puede('monitask.view'), comprobarInterruptor, ctrl.cotejo);

// La vuelta de Monitask: pública, la llave es el `state` (el interruptor lo mira el controlador).
const publicRouter = Router();
publicRouter.get('/callback', ctrl.vueltaOAuth);

export default router;
export { publicRouter };
