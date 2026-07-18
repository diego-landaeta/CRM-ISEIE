import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as ctrl from './report.controller.js';

const router = Router();
router.use(verifyToken);
router.use(roleGuard('admin', 'superadmin'));

router.get('/overview', ctrl.overview);

// Reportes descargables
router.get('/resumen-mensual', ctrl.resumenMensual);
router.get('/prospectos', ctrl.prospectos);
router.get('/ventas', ctrl.ventas);
router.get('/general', ctrl.general);
router.get('/general-facturacion', ctrl.generalFacturacion);
router.get('/cobros-mensuales', ctrl.cobrosMensuales);

export default router;
