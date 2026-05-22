import { Router } from 'express';
import { verifyToken, roleGuard } from '../../shared/middleware/auth.js';
import { projectAccess } from '../../shared/middleware/projectAccess.js';
import { uploadPdf, validatePdfMagicBytes } from '../../shared/middleware/upload.js';
import * as DossierController from './dossier.controller.js';

const router = Router();

router.use(verifyToken);

router.post('/upload',
  roleGuard('admin', 'superadmin'),
  projectAccess,
  uploadPdf,
  validatePdfMagicBytes,
  DossierController.upload
);

router.get('/:id/url', projectAccess, DossierController.getPresignedUrl);
router.get('/product/:productId/history', projectAccess, DossierController.getHistory);

export default router;
