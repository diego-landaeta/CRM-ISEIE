import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './cursos-pendientes.controller.js';
import { PERMISO_SUBIDAS } from './cursos-pendientes.subidas.js';

const router = Router();
router.use(verifyToken);

// Sin roleGuard: el recorte va en el servicio, porque no es por rol a secas. Una
// tutora ve los suyos, una gestora los de sus campus, un admin los de los suyos y
// el super admin todos (cursos-pendientes.service.js).
router.get('/resumen', ctrl.resumen);
// Control de subidas (#771): con «Gestionar colaboraciones», el permiso que ya
// tiene quien lleva las subidas. El campus lo recorta el servicio, como el resto.
router.get('/subidas', puede(PERMISO_SUBIDAS), ctrl.controlSubidas);
router.get('/', ctrl.listar);
router.post('/', ctrl.crear);
router.get('/:id', ctrl.detalle);
router.patch('/:id', ctrl.modificar);
router.post('/:id/publicar', ctrl.publicar);
router.post('/:id/alumnas', ctrl.sumarAlumna);
router.patch('/:id/alumnas/:alumnaId', ctrl.marcarAlumna);
router.post('/:id/subidas', puede(PERMISO_SUBIDAS), ctrl.abrirSubidas);
router.patch('/:id/subidas/:punto', puede(PERMISO_SUBIDAS), ctrl.marcarSubida);

export default router;
