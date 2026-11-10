import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import * as ctrl from './cursos-pendientes.controller.js';

const router = Router();
router.use(verifyToken);

// Sin roleGuard: el recorte va en el servicio, porque no es por rol a secas. Una
// tutora ve los suyos, una gestora los de sus campus, un admin los de los suyos y
// el super admin todos (cursos-pendientes.service.js).
router.get('/resumen', ctrl.resumen);
router.get('/', ctrl.listar);
router.post('/', ctrl.crear);
router.get('/:id', ctrl.detalle);
router.patch('/:id', ctrl.modificar);
router.post('/:id/publicar', ctrl.publicar);
router.post('/:id/alumnas', ctrl.sumarAlumna);
router.patch('/:id/alumnas/:alumnaId', ctrl.marcarAlumna);

export default router;
