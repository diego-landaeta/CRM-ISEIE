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
router.get('/ventas-vendedora', ctrl.ventasVendedora);
router.get('/ventas-asesora', ctrl.ventasAsesora);
router.get('/asesoras-mes', ctrl.asesorasMes);
router.get('/panel', ctrl.panel);
router.get('/paises', ctrl.paises);
router.get('/formaciones', ctrl.formaciones);
router.get('/detalle', ctrl.detalle);

export default router;
