import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import { projectAccess } from '../../shared/middleware/projectAccess.js';
import * as ctrl from './convocatoria.controller.js';

const router = Router();
router.use(verifyToken);

// Sin `projectAccess`: pueden ser de todos los proyectos a la vez, y el
// recorte por gestora lo hace el controlador.
router.get('/embudo', puede('convocatorias.view'), ctrl.embudo);
router.get('/pendientes', puede('convocatorias.view'), ctrl.pendientes);
router.get('/lead/:leadId', puede('convocatorias.view'), ctrl.deLead);

// Ofrecerla y anotar lo que pasa despues lo hace la gestora: es su trabajo.
router.post('/:id/ofrecer', puede('convocatorias.ofrecer'), ctrl.ofrecer);
router.patch('/ofrecimientos/:id', puede('convocatorias.ofrecer'), ctrl.actualizarOfrecimiento);

// Crear y cambiar convocatorias es de la casa, no de cada gestora: quien las
// crea decide los topes de descuento.
router.get('/', puede('convocatorias.view'), projectAccess, ctrl.listar);
router.post('/', puede('convocatorias.create'), projectAccess, ctrl.crear);
router.patch('/:id', puede('convocatorias.edit'), projectAccess, ctrl.editar);

export default router;
