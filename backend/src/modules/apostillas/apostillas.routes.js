import { Router } from 'express';
import multer from 'multer';
import { AppError } from '../../shared/utils/AppError.js';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import { uploadDoc } from '../../shared/middleware/upload.js';
import * as ctrl from './apostillas.controller.js';

/*
  /api/apostillas (CRM#1130 / CRM-ISEIE#786). Todo detrás de la sesión,
  documentos incluidos. Ver: `apostillas.view`; qué apostillas gestiona cada
  uno lo recorta el controlador (`apostillas.service.js`), no la ruta.
*/
const router = Router();
router.use(verifyToken);

// LAS RUTAS DE PALABRA FIJA VAN ANTES QUE `/:id`.
router.get('/', puede('apostillas.view'), ctrl.listar);
router.get('/cifras', puede('apostillas.view'), ctrl.cifras);
router.get('/catalogo', puede('apostillas.view'), ctrl.catalogo);
router.get('/personas', puede('apostillas.edit'), ctrl.personas);
router.get('/ajustes', puede('apostillas.view'), ctrl.verAjustes);
router.put('/ajustes', puede('apostillas.config'), ctrl.guardarAjustes);
router.get('/de-cliente/:leadId', puede('apostillas.view'), ctrl.deLead);
router.get('/de-venta/:conversionId', puede('apostillas.view'), ctrl.deVenta);
router.get('/documentos/:docId', puede('apostillas.view'), ctrl.descargarDocumento);

router.post('/', puede('apostillas.asociar'), ctrl.crear);
router.get('/:id', puede('apostillas.view'), ctrl.porId);
router.patch('/:id', puede('apostillas.edit'), ctrl.editar);
router.post('/:id/enlazar', puede('apostillas.asociar'), ctrl.enlazar);
// Documentos como en Incidencias (`uploadDoc`: PNG, JPG, WEBP o PDF, hasta 10 MB).
router.post('/:id/documentos', puede('apostillas.edit'), conAdjuntos, ctrl.subirDocumento);

/**
 * `uploadDoc`, con sus errores como 400 y no como 500. Se llama `conAdjuntos`
 * como en Incidencias y Consultas: el inventario de permisos la reconoce como
 * subida y no como guardia.
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
