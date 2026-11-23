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
 * Leer el catálogo: de cualquier campus (Diego, 23/11/2026: «los productos los
 * ven todos, de todos»). Quien tiene `products.view` ve los productos de todos
 * los campus, sean suyos o no: una gestora que registra una venta o un link de
 * pago de un alumno de otro campus necesita su curso (antes, 403
 * PROJECT_FORBIDDEN). Solo pide el campus que se consulta; NO mira
 * `user_projects`. Escribir (crear, editar, borrar, imagen, temario) sigue con
 * `projectAccess`: solo en sus campus.
 */
export function campusDelCatalogo(req, _res, next) {
  const projectId = req.query.projectId ?? req.params.projectId;
  if (projectId === undefined || projectId === '') {
    return next(new AppError('projectId requerido', 400, 'MISSING_PROJECT'));
  }
  if (!/^[1-9]\d{0,9}$/.test(String(projectId)) || Number(projectId) > 2147483647) {
    return next(new AppError('projectId inválido', 400, 'INVALID_ID'));
  }
  req.projectId = Number(projectId);
  return next();
}
// Alcance, no permiso (#423): dice SOBRE QUÉ campus. Aquí, cualquiera.
campusDelCatalogo.regla = { tipo: 'alcance', nombre: 'campusDelCatalogo' };

router.get('/', puede('products.view'), campusDelCatalogo, ProductController.list);
// El catálogo de varios campus, para «Todos» o una empresa (#218, Diego 04/11).
// Solo leer: crear o editar sigue siendo de UN campus. Antes de `/:id`; sin
// `projectAccess`: el controlador lee el ámbito pedido, sin recortarlo a los
// campus de quien pide (23/11: los productos los ven todos, de todos).
router.get('/ambito', puede('products.view'), ProductController.list);
router.get('/export', puede('products.export'), projectAccess, ProductController.exportAll);
router.get('/leads-stats', puede('products.view'), projectAccess, ProductController.leadsStats);
router.get('/:id', puede('products.view'), campusDelCatalogo, ProductController.getById);
router.get('/:id/image-url', puede('products.view'), campusDelCatalogo, ProductController.getImageUrl);
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
router.get('/:id/modules', puede('products.view'), campusDelCatalogo, ModulesController.listModules);
router.post('/:id/modules', puede('products.edit'), projectAccess, ModulesController.createModule);
router.patch('/:id/modules/:moduleId', puede('products.edit'), projectAccess, ModulesController.updateModule);
router.delete('/:id/modules/:moduleId', puede('products.edit'), projectAccess, ModulesController.deleteModule);
router.post('/:id/modules/reorder', puede('products.edit'), projectAccess, ModulesController.reorderModules);

export default router;
