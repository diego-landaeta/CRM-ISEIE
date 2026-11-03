import { Router } from 'express';
import multer from 'multer';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import { AppError } from '../../shared/utils/AppError.js';
import { MAX_BYTES } from '../matriculas/admision.archivos.js';
import * as ctrl from './token.controller.js';

const router = Router();

// ─── PÚBLICO: recibe el envío (sin sesión; la llave es el token) ─────────────
//
// El formulario de admisión manda los documentos como archivos (#198): se
// aceptan en multipart, en memoria, hasta 10 MB cada uno y 8 por envío, y el envío
// entero hasta 19 MB (topeDelEnvio, en app.js, antes de guardarlo en memoria). El tipo
// real se comprueba después (admision.archivos.js), no aquí: multer solo ve lo
// que dice quien manda. Sin multipart, multer no hace nada y el JSON o el
// formulario normal llegan como siempre.
const archivos = multer({
  storage: multer.memoryStorage(),
  // fieldSize: un campo de texto puede traer una imagen en base64 (10 MB son ~13,4 MB en texto).
  limits: { fileSize: MAX_BYTES, files: 8, fields: 200, fieldSize: 15 * 1024 * 1024 },
}).any();

function conArchivos(req, res, next) {
  archivos(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const motivo = err.code === 'LIMIT_FILE_SIZE' ? 'Un archivo pasa de 10 MB.'
        : err.code === 'LIMIT_FILE_COUNT' ? 'Demasiados archivos: como mucho 8 por envío.'
          : 'El envío de archivos no es válido.';
      return next(new AppError(motivo, 400, 'ENVIO_NO_VALIDO'));
    }
    return next(err);
  });
}

// 60 envíos por minuto y token: de sobra para un formulario de verdad, y corta a
// quien lo use para llenar el CRM. Por token (cada campus el suyo), no por IP.
const limite = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.params.token || ipKeyGenerator(req.ip),
  message: { success: false, error: { code: 'DEMASIADOS_ENVIOS', message: 'Demasiados envíos. Espera un minuto.' } },
});

router.post('/receive/:token', limite, conArchivos, ctrl.publicReceive);

// ─── ADMINISTRACIÓN ─────────────────────────────────────────────────────────
//
// La URL con el token es la llave del webhook y la muestra trae los datos de una
// persona: como el webhook de transferencias y Conectores, solo admin y super
// admin (`soloRoles`, no `roleGuard`, que deja pasar también a soporte), y cada
// uno en sus campus, que lo comprueba el controlador.
router.use(verifyToken);
router.get('/', puede('webhooks.view'), ctrl.list);
router.get('/:id/status', puede('webhooks.view'), ctrl.getStatus);
router.post('/', puede('webhooks.create'), ctrl.create);
router.patch('/:id', puede('webhooks.edit'), ctrl.update);
router.delete('/:id', puede('webhooks.delete'), ctrl.remove);
router.post('/:id/listen', puede('webhooks.edit'), ctrl.startListening);
router.post('/:id/listen/stop', puede('webhooks.edit'), ctrl.stopListening);

export default router;
