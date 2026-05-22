import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import { projectAccess } from '../../shared/middleware/projectAccess.js';
import { uploadImage } from '../../shared/middleware/upload.js';
import * as ProductController from './product.controller.js';

const router = Router();

router.use(verifyToken);

router.get('/', projectAccess, ProductController.list);
router.get('/export', projectAccess, ProductController.exportAll);
router.get('/leads-stats', projectAccess, ProductController.leadsStats);
router.get('/:id', projectAccess, ProductController.getById);
router.get('/:id/image-url', projectAccess, ProductController.getImageUrl);
router.post('/', roleGuard('admin', 'superadmin'), projectAccess, ProductController.create);
router.patch('/:id', roleGuard('admin', 'superadmin'), projectAccess, ProductController.update);
router.delete('/:id', roleGuard('admin', 'superadmin'), projectAccess, ProductController.deactivate);

// Imagen de producto. Acepta PNG/JPG/WEBP/SVG, max 5MB (definido en uploadImage).
// Almacena en R2 con clave `products/<projectId>/<productId>/<ts>.<ext>`.
router.post('/:id/image',
  roleGuard('admin', 'superadmin'),
  projectAccess,
  uploadImage,
  ProductController.uploadImage,
);
router.delete('/:id/image',
  roleGuard('admin', 'superadmin'),
  projectAccess,
  ProductController.removeImage,
);

// NOTA: las rutas de "modules / temario" (product-modules.controller) no se han
// portado en CRM-ISEIE v1 porque dependen del modulo `project_modules`.

export default router;
