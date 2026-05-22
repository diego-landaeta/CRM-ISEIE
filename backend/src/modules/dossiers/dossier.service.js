import { v4 as uuidv4 } from 'uuid';
import * as DossierModel from './dossier.model.js';
import * as ProductModel from '../products/product.model.js';
import { uploadToR2 } from '../../shared/services/r2.service.js';
import { generatePresignedUrl } from '../../shared/utils/presignedUrl.js';
import { AppError } from '../../shared/utils/AppError.js';

export async function uploadDossier({ productId, projectId, file, userId }) {
  const product = await ProductModel.findById(productId);
  if (!product) throw new AppError('Producto no encontrado', 404, 'PRODUCT_NOT_FOUND');
  if (product.project_id !== projectId) throw new AppError('Producto no pertenece a este proyecto', 403, 'FORBIDDEN');

  const timestamp = Date.now();
  const key = `dossiers/${projectId}/${uuidv4()}-${timestamp}.pdf`;

  await uploadToR2(key, file.buffer, 'application/pdf');

  const dossier = await DossierModel.createNewVersion({
    productId,
    s3Key: key,
    filenameOriginal: file.originalname,
    sizeBytes: file.size,
    subidoPor: userId,
  });

  return dossier;
}

export async function getPresignedUrl(dossierId, projectId) {
  const dossier = await DossierModel.findById(dossierId);
  if (!dossier) throw new AppError('Dossier no encontrado', 404, 'DOSSIER_NOT_FOUND');

  const product = await ProductModel.findById(dossier.product_id);
  if (product.project_id !== projectId) throw new AppError('No tienes acceso a este dossier', 403, 'FORBIDDEN');

  const url = await generatePresignedUrl(dossier.s3_key);
  return { url, filename: dossier.filename_original };
}

export async function getHistory(productId, projectId) {
  const product = await ProductModel.findById(productId);
  if (!product) throw new AppError('Producto no encontrado', 404, 'PRODUCT_NOT_FOUND');
  if (product.project_id !== projectId) throw new AppError('No tienes acceso', 403, 'FORBIDDEN');

  return DossierModel.findByProduct(productId);
}

export async function getActiveByProduct(productId) {
  return DossierModel.findActiveByProduct(productId);
}
