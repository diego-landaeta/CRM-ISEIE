import { Router } from 'express';
import multer from 'multer';
import { AppError } from '../../shared/utils/AppError.js';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import { uploadDoc } from '../../shared/middleware/upload.js';
import * as ctrl from './incidencias.controller.js';

const router = Router();

// Todo detras de la sesion, incluidos los adjuntos (ver la nota de Soporte:
// en Matriculas una ruta de documentos quedo publica y se descargaban DNI).
router.use(verifyToken);

// Ver: admin y gestora. Que la gestora vea SOLO LAS SUYAS lo recorta el
// controlador (`incidencias.service.js · alcanceDe`), no la ruta.
router.get('/', puede('incidencias.view'), ctrl.listar);

// LAS RUTAS DE PALABRA FIJA VAN ANTES QUE `/:id`: con `/:id` delante,
// `/metricas` se leeria como la incidencia «metricas».
router.get('/metricas', puede('incidencias.view'), ctrl.metricas);
router.get('/adjuntos/:adjuntoId', puede('incidencias.view'), ctrl.descargarAdjunto);
router.get('/personas', puede('incidencias.create', 'incidencias.edit'), ctrl.personas);

router.post('/', puede('incidencias.create'), ctrl.crear);
router.get('/:id', puede('incidencias.view'), ctrl.porId);
router.patch('/:id', puede('incidencias.edit'), ctrl.editar);
// Capturas, como en Soporte (`uploadDoc`: PNG, JPG, WEBP o PDF; sin SVG, que
// servido en linea puede llevar codigo). Las sube quien la apunta o la edita.
router.post('/:id/adjuntos', puede('incidencias.create', 'incidencias.edit'), conAdjuntos, ctrl.subirAdjunto);

/**
 * `uploadDoc`, pero sus errores (más de 10 MB, otro campo, varios ficheros, un
 * envío cortado a medias) como 400: multer y busboy los lanzan sin
 * `statusCode` y salían como un 500. Los que ya traen el suyo (un tipo que no
 * vale) pasan tal cual.
 *
 * Se llama `conAdjuntos` como la de Consultas: el inventario de permisos
 * (`inventario/rutas.js · TECNICOS`) la reconoce como subida y no como guardia.
 */
function conAdjuntos(req, res, next) {
  uploadDoc(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return next(err.code === 'LIMIT_FILE_SIZE'
        ? new AppError('El archivo pasa de 10 MB', 400, 'FILE_TOO_LARGE')
        : new AppError('Sube un archivo cada vez', 400, 'VALIDATION_ERROR'));
    }
    if (err && !err.statusCode) {
      return next(new AppError('No se pudo leer el archivo: vuelve a subirlo', 400, 'VALIDATION_ERROR'));
    }
    next(err);
  });
}

export default router;
