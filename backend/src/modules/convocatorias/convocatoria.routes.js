import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import { projectAccess } from '../../shared/middleware/projectAccess.js';
import * as ctrl from './convocatoria.controller.js';

const router = Router();
router.use(verifyToken);

// Sin `projectAccess`: pueden ser de todos los proyectos a la vez, y el
// recorte por gestora lo hace el controlador.
router.get('/embudo', ctrl.embudo);
router.get('/pendientes', ctrl.pendientes);
router.get('/lead/:leadId', ctrl.deLead);

// Ofrecerla y anotar lo que pasa despues lo hace la gestora: es su trabajo.
router.post('/:id/ofrecer', ctrl.ofrecer);
router.patch('/ofrecimientos/:id', ctrl.actualizarOfrecimiento);

// Crear y cambiar convocatorias es de la casa, no de cada gestora: quien las
// crea decide los topes de descuento.
router.get('/', projectAccess, ctrl.listar);
router.post('/', roleGuard('admin', 'superadmin'), projectAccess, ctrl.crear);
router.patch('/:id', roleGuard('admin', 'superadmin'), projectAccess, ctrl.editar);

export default router;
