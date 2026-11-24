import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import { ventaPorId } from '../conversions/conversion.acceso.js';
import * as ctrl from './factura-automatica.controller.js';

// Guarda de alcance con NOMBRE: el inventario de permisos (#423) la reconoce.
const ventaDelParametro = (req, res, next) => ventaPorId(req, res, next, req.params.conversionId);

// Con sesión: ver en qué está la petición de una venta y mandar un enlace nuevo.
const router = Router();
router.use(verifyToken);
router.get('/interruptor', puede('facturas.view'), ctrl.interruptor);
router.get('/venta/:conversionId', puede('facturas.view'), ventaDelParametro, ctrl.estado);
router.post('/venta/:conversionId/reenviar', puede('facturas.cola'), ventaDelParametro, ctrl.reenviar);
// «Enviar factura automáticamente: Sí / No» y «Enviar a este correo» (24/11):
// verlo, quien ve la venta; cambiarlo, quien la edita (una gestora, las suyas).
router.get('/venta/:conversionId/envio', puede('facturas.view'), ventaDelParametro, ctrl.verEnvio);
router.put('/venta/:conversionId/envio', puede('conversions.edit'), ventaDelParametro, ctrl.guardarEnvio);
// La pantalla de la facturación automática (Finanzas › Facturas › Facturación automática).
router.get('/panel', puede('facturas.automatica'), ctrl.panel);

// Sin sesión: el formulario. El enlace es la llave; el límite por IP es lo que
// impide probar enlaces a ciegas (además de la firma y de los intentos por enlace).
const publicRouter = Router();
publicRouter.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false }));
publicRouter.get('/:token', ctrl.formulario);
publicRouter.post('/:token', ctrl.responder);

export default router;
export { publicRouter };
