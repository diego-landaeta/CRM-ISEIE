import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import * as ctrl from './report.controller.js';

const router = Router();
router.use(verifyToken);

// Una gestora puede entrar en Reportes: el controlador le recorta cada informe a
// sus leads, sus ventas y sus cobros. Antes recibia un 403 y la pantalla le
// pintaba todo a cero.
// El overview se queda solo para admin: arma su filtro por separado y la
// pantalla de gestora no lo usa.
router.get('/overview', roleGuard('admin', 'superadmin'), ctrl.overview);

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

// La tasa de cierre, con una sola definicion para todo el CRM.
router.get('/tasa-cierre', ctrl.tasaCierre);
router.get('/tasa-cierre/detalle', ctrl.tasaCierreDetalle);

export default router;
