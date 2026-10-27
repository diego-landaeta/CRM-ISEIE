import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './novedades.controller.js';

const router = Router();
router.use(verifyToken);
// Leerlas y bajar el PDF: todo el equipo.
router.get('/', puede('novedades.view'), ctrl.listar);
router.get('/:version/pdf', puede('novedades.view'), ctrl.pdf);
// Mandarlas: solo quien dirige el CRM.
router.get('/:version/envios', puede('novedades.envios'), ctrl.envios);
router.post('/:version/enviar', puede('novedades.enviar'), ctrl.enviar);

export default router;
