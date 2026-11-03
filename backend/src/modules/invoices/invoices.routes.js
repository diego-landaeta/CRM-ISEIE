import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import { uploadImage } from '../../shared/middleware/upload.js';
import * as ctrl from './invoices.controller.js';
import { facturaDeSuCampus, campusDelCuerpo } from './invoices.acceso.js';
import { ventaPorId, prospectoPorId } from '../conversions/conversion.acceso.js';

// Guardas de alcance con NOMBRE: el inventario de permisos (#423) las reconoce por el nombre (ver TECNICOS).
const prospectoDelParametro = (req, res, next) => prospectoPorId(req, res, next, req.params.leadId);
const ventaDelParametro = (req, res, next) => ventaPorId(req, res, next, req.params.conversionId);

const router = Router();

// Público (sin auth) para que el logo cargue en <img src> y en el PDF.
router.get('/issuers/:id/logo',       ctrl.getIssuerLogo);

router.use(verifyToken);

// Corte de facturacion: hasta que dia esta al dia. Consultarlo lo puede
// cualquiera; moverlo solo quien gestiona la facturacion (se comprueba dentro).
router.get('/facturacion-al-dia',     puede('facturas.view'), ctrl.facturacionAlDia);
router.put('/facturacion-al-dia',     puede('facturas.cola'), ctrl.setFacturacionAlDia);
router.post('/cola/generar',          puede('facturas.cola'), campusDelCuerpo, ctrl.generarDeCola);
router.post('/cola/emitir-hasta',     puede('facturas.cola'), campusDelCuerpo, ctrl.emitirColaHasta);
router.get('/',                       puede('facturas.view'), ctrl.list);
router.get('/stats',                  puede('facturas.view'), ctrl.stats);
// Que numero tocaria ahora. Va ANTES de '/:id' para que «siguiente-numero» no
// se lea como el id de una factura.
router.get('/siguiente-numero',       puede('facturas.view'), ctrl.siguienteNumero);
router.get('/ventas-sin-factura',     puede('facturas.view'), ctrl.ventasSinFactura);
router.get('/regimenes',              puede('facturas.view'), ctrl.listRegimenes);
router.get('/resolve-regimen',        puede('facturas.view'), ctrl.resolveRegimen);
router.post('/regimenes',             puede('facturas.configurar'), ctrl.createRegimen);
router.patch('/regimenes/:id',        puede('facturas.configurar'), ctrl.updateRegimen);
router.delete('/regimenes/:id',       puede('facturas.configurar'), ctrl.deleteRegimen);
router.get('/templates',              puede('facturas.view'), ctrl.listTemplates);
router.post('/templates',             puede('facturas.configurar'), ctrl.createTemplate);
router.get('/templates/:id',          puede('facturas.view'), ctrl.getTemplate);
router.patch('/templates/:id',        puede('facturas.configurar'), ctrl.updateTemplate);
router.delete('/templates/:id',       puede('facturas.configurar'), ctrl.deleteTemplate);
router.get('/issuers',                puede('facturas.view'), ctrl.listIssuers);
router.post('/issuers',               puede('facturas.configurar'), ctrl.createIssuer);
router.patch('/issuers/:id',          puede('facturas.configurar'), ctrl.updateIssuer);
router.delete('/issuers/:id',         puede('facturas.configurar'), ctrl.deleteIssuer);
router.post('/issuers/:id/logo',      puede('facturas.configurar'), uploadImage, ctrl.uploadIssuerLogo);
router.delete('/issuers/:id/logo',    puede('facturas.configurar'), ctrl.deleteIssuerLogo);
router.get('/config',                 puede('facturas.view'), ctrl.getConfig);
router.patch('/config',               puede('facturas.configurar'), ctrl.updateConfig);
router.get('/sequences',              puede('facturas.view'), ctrl.listSequences);
router.post('/sequences',             puede('facturas.configurar'), ctrl.setSequence);
router.get('/lead-fiscal/:leadId',    puede('facturas.view'), prospectoDelParametro, ctrl.leadFiscalData);
router.get('/by-conversion/:conversionId', puede('facturas.view'), ventaDelParametro, ctrl.byConversion);
router.get('/:id',                    puede('facturas.view'), facturaDeSuCampus, ctrl.getOne);
router.post('/',                      puede('facturas.create'), campusDelCuerpo, ctrl.create);
// Editar una factura en borrador: SOLO admin/superadmin.
router.patch('/:id',                  puede('facturas.edit'), facturaDeSuCampus, ctrl.update);
// Corregir una factura YA emitida/pagada (IVA, datos, concepto): admin/superadmin
// o gestora con permiso factura_manager (el controller valida que sea suya).
router.patch('/:id/corregir',         puede('facturas.gestionar'), facturaDeSuCampus, ctrl.corregir);
// Cambiar solo fechas (emisión/pago). Sin roleGuard: el controller valida el permiso
// editar_fechas_factura (admins y usuarios acotados a "solo fechas").
router.patch('/:id/fechas',           puede('facturas.editar_fechas'), facturaDeSuCampus, ctrl.updateFechas);
// Apuntar que una factura ya se le paso al cliente. NO manda correo: es una
// marca, y las facturas salen por donde cada uno las mande.
router.patch('/:id/entregada',        puede('facturas.completar'), facturaDeSuCampus, ctrl.marcarEntregada);
// Opción B: asociar una factura existente a una venta del cliente.
router.patch('/:id/asociar',          puede('facturas.gestionar'), facturaDeSuCampus, ctrl.asociarVenta);
router.get('/:id/pdf',                puede('facturas.view'), facturaDeSuCampus, ctrl.pdf);
router.post('/:id/send',              puede('facturas.enviar'), facturaDeSuCampus, ctrl.send);
router.post('/:id/mark-paid',         puede('facturas.cobrar'), facturaDeSuCampus, ctrl.markPaid);
// «Cobrada» en una proforma: apunta el cobro y la pasa a factura. El servicio
// deja solo a quien lleva la facturacion, y a una gestora, con las suyas.
router.post('/:id/cobrar-proforma',   puede('facturas.cola'), facturaDeSuCampus, ctrl.cobrarProforma);
router.post('/:id/cancel',            puede('facturas.anular'), facturaDeSuCampus, ctrl.cancel);
// Eliminar factura + liberar número: admin/superadmin o gestora factura_manager
// (el controller valida que la factura sea suya).
router.delete('/:id',                 puede('facturas.gestionar'), facturaDeSuCampus, ctrl.destroy);
// Emitir factura de abono (rectificativa): admin/superadmin o gestora factura_manager
// (el controller valida que la base sea suya).
router.post('/:id/rectificar',        puede('facturas.gestionar'), facturaDeSuCampus, ctrl.rectificar);
router.post('/:id/emitir',            puede('facturas.emitir_borrador'), facturaDeSuCampus, ctrl.emitir);
router.post('/:id/completar-datos',   puede('facturas.completar'), facturaDeSuCampus, ctrl.completarDatos);

export default router;
