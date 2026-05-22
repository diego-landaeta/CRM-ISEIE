import * as ProductModel from './product.model.js';
import { AppError } from '../../shared/utils/AppError.js';
import { saveLocal, deleteLocal } from '../../shared/services/localStorage.service.js';
import { logger } from '../../shared/utils/logger.js';
import crypto from 'crypto';

export async function listByProject(projectId, opts = {}) {
  return ProductModel.findByProject(projectId, opts);
}

export async function getById(id, projectId) {
  const product = await ProductModel.findById(id);
  if (!product) throw new AppError('Producto no encontrado', 404, 'PRODUCT_NOT_FOUND');
  if (product.project_id !== projectId) throw new AppError('No tienes acceso a este producto', 403, 'FORBIDDEN');
  return product;
}

export async function create(data) {
  const existing = await ProductModel.findByProjectAndName(data.projectId, data.nombre);
  if (existing) throw new AppError('Ya existe un producto con ese nombre en este proyecto', 409, 'PRODUCT_DUPLICATE');
  return ProductModel.create(data);
}

export async function update(id, projectId, data) {
  const product = await getById(id, projectId);
  if (data.nombre && data.nombre !== product.nombre) {
    const existing = await ProductModel.findByProjectAndName(projectId, data.nombre);
    if (existing) throw new AppError('Ya existe un producto con ese nombre en este proyecto', 409, 'PRODUCT_DUPLICATE');
  }
  return ProductModel.update(id, data);
}

export async function deactivate(id, projectId) {
  await getById(id, projectId);
  return ProductModel.deactivate(id);
}

function extOf(mime) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/svg+xml') return 'svg';
  return 'bin';
}

export async function uploadImage(id, projectId, file) {
  const product = await getById(id, projectId);
  if (!file) throw new AppError('Archivo requerido', 400, 'FILE_REQUIRED');

  if (product.image_key) {
    deleteLocal(product.image_key).catch(err =>
      logger.warn({ err, key: product.image_key }, 'No se pudo borrar imagen previa')
    );
  }

  const ext = extOf(file.mimetype);
  const key = `products/${projectId}/${id}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  await saveLocal(key, file.buffer);

  const stored = `/api/products/${id}/image?v=${Date.now()}`;
  return ProductModel.update(id, { image_url: stored, image_key: key });
}

export async function removeImage(id, projectId) {
  const product = await getById(id, projectId);
  if (product.image_key) {
    deleteLocal(product.image_key).catch(err =>
      logger.warn({ err, key: product.image_key }, 'No se pudo borrar imagen')
    );
  }
  return ProductModel.update(id, { image_url: null, image_key: null });
}

// El image_url ya viene resuelto en el upload — devolverlo tal cual.
// Cuando se añada R2, este helper hace presigned URL si key.startsWith('r2://').
export async function resolveImageUrl(imageUrl) {
  return imageUrl || null;
}
