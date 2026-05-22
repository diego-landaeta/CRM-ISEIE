import * as DossierService from './dossier.service.js';
import { uploadDossierSchema } from './dossier.validation.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';

export async function upload(req, res, next) {
  try {
    const parsed = uploadDossierSchema.parse({
      productId: req.body.productId || req.params.productId,
      projectId: req.projectId,
    });

    const dossier = await DossierService.uploadDossier({
      productId: parsed.productId,
      projectId: parsed.projectId,
      file: req.file,
      userId: req.user.userId,
    });

    res.status(201).json({ success: true, data: dossier });
  } catch (err) {
    if (err.name === 'ZodError') {
      return next(new AppError(err.errors.map(e => e.message).join(', '), 400, 'VALIDATION_ERROR'));
    }
    next(err);
  }
}

export async function getPresignedUrl(req, res, next) {
  try {
    const dossierId = Number(req.params.id);
    const result = await DossierService.getPresignedUrl(dossierId, req.projectId);
    logger.info({ dossierId, userId: req.user.userId }, 'Pre-signed URL generada');
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function getHistory(req, res, next) {
  try {
    const productId = Number(req.params.productId);
    const history = await DossierService.getHistory(productId, req.projectId);
    res.json({ success: true, data: history });
  } catch (err) { next(err); }
}
