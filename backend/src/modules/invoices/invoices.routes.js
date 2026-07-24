import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import { uploadImage } from '../../shared/middleware/upload.js';
import * as ctrl from './invoices.controller.js';

const router = Router();

// Público (sin auth) para que el logo cargue en <img src> y en el PDF.
router.get('/issuers/:id/logo',       ctrl.getIssuerLogo);

router.use(verifyToken);

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
router.get('/:id/pdf',                ctrl.pdf);
router.post('/:id/send',              ctrl.send);
router.post('/:id/mark-paid',         ctrl.markPaid);
router.post('/:id/cancel',            ctrl.cancel);
router.post('/:id/rectificar',        ctrl.rectificar);
router.post('/:id/emitir',            ctrl.emitir);
router.post('/:id/completar-datos',   ctrl.completarDatos);

export default router;
