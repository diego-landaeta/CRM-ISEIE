import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import { uploadImage } from '../../shared/middleware/upload.js';
import * as ctrl from './invoices.controller.js';

const router = Router();

// Público (sin auth) para que el logo cargue en <img src> y en el PDF.
router.get('/issuers/:id/logo',       ctrl.getIssuerLogo);

router.use(verifyToken);

// Corte de facturacion: hasta que dia esta al dia. Consultarlo lo puede
// cualquiera; moverlo solo quien gestiona la facturacion (se comprueba dentro).
router.get('/facturacion-al-dia',     ctrl.facturacionAlDia);
router.put('/facturacion-al-dia',     ctrl.setFacturacionAlDia);
router.post('/cola/generar',          ctrl.generarDeCola);
router.post('/cola/emitir-hasta',     ctrl.emitirColaHasta);
router.get('/',                       ctrl.list);
router.get('/stats',                  ctrl.stats);
router.get('/ventas-sin-factura',     ctrl.ventasSinFactura);
router.get('/regimenes',              ctrl.listRegimenes);
router.get('/resolve-regimen',        ctrl.resolveRegimen);
router.post('/regimenes',             ctrl.createRegimen);
router.patch('/regimenes/:id',        ctrl.updateRegimen);
router.delete('/regimenes/:id',       ctrl.deleteRegimen);
router.get('/templates',              ctrl.listTemplates);
router.post('/templates',             ctrl.createTemplate);
router.get('/templates/:id',          ctrl.getTemplate);
router.patch('/templates/:id',        ctrl.updateTemplate);
router.delete('/templates/:id',       ctrl.deleteTemplate);
router.get('/issuers',                ctrl.listIssuers);
router.post('/issuers',               ctrl.createIssuer);
router.patch('/issuers/:id',          ctrl.updateIssuer);
router.delete('/issuers/:id',         ctrl.deleteIssuer);
router.post('/issuers/:id/logo',      uploadImage, ctrl.uploadIssuerLogo);
router.delete('/issuers/:id/logo',    ctrl.deleteIssuerLogo);
router.get('/config',                 ctrl.getConfig);
router.patch('/config',               ctrl.updateConfig);
router.get('/sequences',              ctrl.listSequences);
router.post('/sequences',             ctrl.setSequence);
router.get('/lead-fiscal/:leadId',    ctrl.leadFiscalData);
router.get('/by-conversion/:conversionId', ctrl.byConversion);
router.get('/:id',                    ctrl.getOne);
router.post('/',                      ctrl.create);
// Editar una factura en borrador: SOLO admin/superadmin.
router.patch('/:id',                  roleGuard('admin', 'superadmin'), ctrl.update);
// Corregir una factura YA emitida/pagada (IVA, datos, concepto): SOLO admin/superadmin.
router.patch('/:id/corregir',         roleGuard('admin', 'superadmin', 'gestor'), ctrl.corregir);
// Cambiar solo fechas (emisión/pago). Sin roleGuard: el controller valida el permiso
// editar_fechas_factura (admins y usuarios acotados a "solo fechas").
router.patch('/:id/fechas',           ctrl.updateFechas);
// Opción B: asociar una factura existente a una venta del cliente.
router.patch('/:id/asociar',          roleGuard('admin', 'superadmin', 'gestor'), ctrl.asociarVenta);
router.get('/:id/pdf',                ctrl.pdf);
router.post('/:id/send',              ctrl.send);
router.post('/:id/mark-paid',         ctrl.markPaid);
router.post('/:id/cancel',            ctrl.cancel);
// Eliminar factura + liberar número (errores de carga): SOLO admin/superadmin.
router.delete('/:id',                 roleGuard('admin', 'superadmin', 'gestor'), ctrl.destroy);
// Emitir factura de abono (rectificativa): SOLO admin/superadmin.
router.post('/:id/rectificar',        roleGuard('admin', 'superadmin', 'gestor'), ctrl.rectificar);
router.post('/:id/emitir',            ctrl.emitir);
router.post('/:id/completar-datos',   ctrl.completarDatos);

export default router;
