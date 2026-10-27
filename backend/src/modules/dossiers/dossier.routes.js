import { Router } from 'express';
import { verifyToken } from '../../shared/middleware/auth.js';
import { puede } from '../../shared/middleware/permissions.js';
import { projectAccess } from '../../shared/middleware/projectAccess.js';
import { uploadPdf, validatePdfMagicBytes } from '../../shared/middleware/upload.js';
import * as DossierController from './dossier.controller.js';

const router = Router();

router.use(verifyToken);

router.post('/upload',
  puede('dossiers.upload'),
  projectAccess,
  uploadPdf,
  validatePdfMagicBytes,
  DossierController.upload
);

router.get('/:id/url', puede('dossiers.view'), projectAccess, DossierController.getPresignedUrl);
router.get('/product/:productId/history', puede('dossiers.view'), projectAccess, DossierController.getHistory);

export default router;
