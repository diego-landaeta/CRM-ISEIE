import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import { projectAccess } from '../../shared/middleware/projectAccess.js';
import { uploadImage } from '../../shared/middleware/upload.js';
import * as ProductController from './product.controller.js';
import * as ModulesController from './product-modules.controller.js';

import { AppError } from '../../shared/utils/AppError.js';

const router = Router();

router.use(verifyToken);

/**
 * Un id de producto (o de módulo) que no es un entero positivo: 400 INVALID_ID,
 * sin ir a la base (como en formularios, gemela de CRM#857).
 *
 * El QA de /staging del 21/11 vio `GET /api/products/NaN` → 500 (Postgres 22P02):
 * el frontal de antes del 21/11 no tenía la ruta /products/cursos-moodle, la
 * leía como la ficha del producto «cursos-moodle» y pedía `Number('cursos-moodle')`.
 * Se comprueba aquí, una vez, para todas las rutas con `:id` y `:moduleId`.
 */
function idPositivo(req, _res, next, valor) {
  if (!/^[1-9]\d{0,9}$/.test(String(valor)) || Number(valor) > 2147483647) {
    return next(new AppError('ID inválido', 400, 'INVALID_ID'));
  }
  return next();
}
router.param('id', idPositivo);
router.param('moduleId', idPositivo);

router.get('/', puede('products.view'), projectAccess, ProductController.list);
// El catálogo de todos los campus de quien pide, para «Todos» o una empresa
// (#218, Diego 04/11). Solo leer: crear o editar sigue siendo de UN campus.
// Antes de `/:id`; sin `projectAccess`, porque el controlador recorta por ámbito.
router.get('/ambito', puede('products.view'), ProductController.list);
router.get('/export', puede('products.export'), projectAccess, ProductController.exportAll);
router.get('/leads-stats', puede('products.view'), projectAccess, ProductController.leadsStats);
router.get('/:id', puede('products.view'), projectAccess, ProductController.getById);
router.get('/:id/image-url', puede('products.view'), projectAccess, ProductController.getImageUrl);
router.post('/', puede('products.create'), projectAccess, ProductController.create);
router.patch('/:id', puede('products.edit'), projectAccess, ProductController.update);
router.delete('/:id', puede('products.delete'), projectAccess, ProductController.deactivate);

// Imagen de producto. Acepta PNG/JPG/WEBP/SVG, max 5MB (definido en uploadImage).
// Almacena en R2 con clave `products/<projectId>/<productId>/<ts>.<ext>`.
router.post('/:id/image',
  puede('products.edit'),
  projectAccess,
  uploadImage,
  ProductController.uploadImage,
);
router.delete('/:id/image',
  puede('products.edit'),
  projectAccess,
  ProductController.removeImage,
);

// Módulos / temario del producto (CRUD manual desde CRM, también lo leen documentos/certificados)
router.get('/:id/modules', puede('products.view'), projectAccess, ModulesController.listModules);
router.post('/:id/modules', puede('products.edit'), projectAccess, ModulesController.createModule);
router.patch('/:id/modules/:moduleId', puede('products.edit'), projectAccess, ModulesController.updateModule);
router.delete('/:id/modules/:moduleId', puede('products.edit'), projectAccess, ModulesController.deleteModule);
router.post('/:id/modules/reorder', puede('products.edit'), projectAccess, ModulesController.reorderModules);

export default router;
