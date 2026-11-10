import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import * as ctrl from './report.controller.js';

const router = Router();
router.use(verifyToken);

// Una gestora puede entrar en Reportes: el controlador le recorta cada informe a
// sus leads, sus ventas y sus cobros. Antes recibia un 403 y la pantalla le
// pintaba todo a cero.
// El overview se queda solo para admin: arma su filtro por separado y la
// pantalla de gestora no lo usa.
router.get('/overview', puede('reports.view'), ctrl.overview);

// Reportes descargables (el front arma el Excel/CSV con estas filas)
router.get('/resumen-mensual', puede('reports.mis_informes'), ctrl.resumenMensual);
router.get('/prospectos', puede('reports.mis_informes'), ctrl.prospectos);
router.get('/ventas', puede('reports.mis_informes'), ctrl.ventas);
router.get('/general', puede('reports.mis_informes'), ctrl.general);
router.get('/general-facturacion', puede('reports.mis_informes'), ctrl.generalFacturacion);
router.get('/cobros-mensuales', puede('reports.mis_informes'), ctrl.cobrosMensuales);
router.get('/ventas-vendedora', puede('reports.mis_informes'), ctrl.ventasVendedora);
router.get('/ventas-asesora', puede('reports.mis_informes'), ctrl.ventasAsesora);
router.get('/asesoras-mes', puede('reports.mis_informes'), ctrl.asesorasMes);
// Como voy yo: puesto en ventas y tasa de conversion de quien pregunta.
router.get('/mi-puesto', puede('reports.mis_informes'), ctrl.miPuesto);
router.get('/panel', puede('reports.mis_informes'), ctrl.panel);
router.get('/seguimiento', puede('reports.mis_informes'), ctrl.seguimiento);
router.get('/paises', puede('reports.mis_informes'), ctrl.paises);
router.get('/formaciones', puede('reports.mis_informes'), ctrl.formaciones);
router.get('/canales', puede('reports.mis_informes'), ctrl.canales);
// Con el gasto de publicidad: solo administracion.
router.get('/canales/dinero', puede('reports.dinero'), ctrl.dondePonerElDinero);
router.get('/detalle', puede('reports.mis_informes'), ctrl.detalle);

// La tasa de cierre, con una sola definicion para todo el CRM.
router.get('/aviso-sin-factura', puede('reports.mis_informes'), ctrl.avisoSinFactura);
router.get('/tasa-cierre', puede('reports.mis_informes'), ctrl.tasaCierre);
router.get('/tasa-cierre/detalle', puede('reports.mis_informes'), ctrl.tasaCierreDetalle);
// El baremo (#39): leerlo, cualquiera con informes (va dentro de la propia tasa); cambiarlo, quien tenga `reports.editar_baremo`.
router.get('/tasa-cierre/baremo', puede('reports.mis_informes'), ctrl.baremo);
router.put('/tasa-cierre/baremo', puede('reports.editar_baremo'), ctrl.guardarBaremo);
router.delete('/tasa-cierre/baremo', puede('reports.editar_baremo'), ctrl.quitarBaremo);

// Actividad por comercial (#203, parte B). Como el resumen del día: la gestora
// entra y se ve a sí misma; el recorte lo hace el controlador.
router.get('/actividad-comercial', puede('reports.mis_informes'), ctrl.actividadComercial);
router.get('/actividad-comercial/detalle', puede('reports.mis_informes'), ctrl.actividadComercialDetalle);

export default router;
