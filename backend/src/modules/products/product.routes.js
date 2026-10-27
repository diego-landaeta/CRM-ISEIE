import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import { projectAccess } from '../../shared/middleware/projectAccess.js';
import { uploadImage } from '../../shared/middleware/upload.js';
import * as ProductController from './product.controller.js';
import * as ModulesController from './product-modules.controller.js';

const router = Router();

router.use(verifyToken);

router.get('/', puede('products.view'), projectAccess, ProductController.list);
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
