import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as ctrl from './novedades.controller.js';

const router = Router();
router.use(verifyToken);
// Leerlas y bajar el PDF: todo el equipo.
router.get('/', ctrl.listar);
router.get('/:version/pdf', ctrl.pdf);
// Mandarlas: solo quien dirige el CRM.
router.get('/:version/envios', roleGuard('superadmin', 'soporte', 'admin'), ctrl.envios);
router.post('/:version/enviar', roleGuard('superadmin', 'soporte'), ctrl.enviar);

export default router;
