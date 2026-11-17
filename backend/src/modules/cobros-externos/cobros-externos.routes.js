import { Router, raw } from 'express';
import multer from 'multer';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import { projectAccess } from '../../shared/middleware/projectAccess.js';
import { AppError } from '../../shared/utils/AppError.js';
import { paypalActivo, santanderActivo } from './interruptores.js';
import { TOPE_EXTRACTO_BYTES } from './cobros-externos.validation.js';
import * as ctrl from './cobros-externos.controller.js';

/**
 * Registro automático de cobros (#766). Cada ruta, detrás de su interruptor:
 * apagado, contesta 404 como si no existiera. `/estado` dice cuál está
 * encendido, para que la pantalla sepa qué enseñar.
 */
function soloSi(activo) {
  return function comprobarInterruptor(_req, _res, next) {
    if (!activo()) return next(new AppError('No encontrado', 404, 'NOT_FOUND'));
    next();
  };
}
const conPaypal = soloSi(paypalActivo);
const conBanco = soloSi(santanderActivo);

const recibirFichero = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TOPE_EXTRACTO_BYTES, files: 1 },
}).single('file');

const router = Router();
router.use(verifyToken);

router.get('/estado', puede('cobros_externos.view'), ctrl.estado);

// PayPal
router.get('/paypal', puede('cobros_externos.view'), conPaypal, ctrl.listarPaypal);
router.post('/paypal/sincronizar', puede('cobros_externos.edit'), conPaypal, projectAccess, ctrl.sincronizarPaypal);
router.post('/paypal/:id/enlazar', puede('cobros_externos.edit'), conPaypal, ctrl.enlazarPaypal);

// Extractos del banco. El campus va en la URL (?projectId=): con el fichero,
// el cuerpo aún no está leído cuando `projectAccess` mira.
router.get('/banco/extractos', puede('cobros_externos.view'), conBanco, ctrl.listarExtractos);
router.post('/banco/extractos', puede('cobros_externos.edit'), conBanco, projectAccess, recibirFichero, ctrl.subirExtracto);
router.get('/banco/movimientos', puede('cobros_externos.view'), conBanco, ctrl.listarMovimientos);
router.post('/banco/movimientos/:id/confirmar', puede('cobros_externos.edit'), conBanco, ctrl.confirmarMovimiento);
router.post('/banco/movimientos/:id/descartar', puede('cobros_externos.edit'), conBanco, ctrl.descartarMovimiento);

// Webhook de PayPal: público, con el cuerpo tal cual para pasárselo a PayPal al
// comprobar la firma. El interruptor lo mira el servicio (404 si está apagado).
const publicRouter = Router();
publicRouter.post(
  '/:projectId',
  raw({ type: 'application/json', limit: '1mb' }),
  function guardarCuerpoCrudo(req, _res, next) {
    req.rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : (typeof req.body === 'string' ? req.body : '');
    next();
  },
  ctrl.webhookPaypal
);

export default router;
export { publicRouter };
