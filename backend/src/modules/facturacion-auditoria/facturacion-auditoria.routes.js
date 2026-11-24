import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './facturacion-auditoria.controller.js';

// La auditoría de facturación (#765): solo superadmin y admin (facturas.auditoria).
const router = Router();

router.use(verifyToken);

router.get('/estado',     puede('facturas.auditoria'), ctrl.estado);
router.get('/historial',  puede('facturas.auditoria'), ctrl.historial);
router.get('/simular',    puede('facturas.auditoria'), ctrl.simular);
router.post('/auditar',   puede('facturas.auditoria'), ctrl.auditar);
router.post('/reanudar',  puede('facturas.auditoria'), ctrl.reanudar);

export default router;
