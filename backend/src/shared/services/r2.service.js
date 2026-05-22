import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import r2Client, { R2_BUCKET } from '../config/r2.js';
import { logger } from '../utils/logger.js';

export async function uploadToR2(key, buffer, contentType) {
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await r2Client.send(command);
  logger.info({ key, size: buffer.length }, 'Archivo subido a R2');

  return key;
}

export async function getFromR2(key) {
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
  });
  const res = await r2Client.send(command);
  return {
    body: res.Body,
    contentType: res.ContentType,
    contentLength: res.ContentLength,
  };
}

export async function deleteFromR2(key) {
  const command = new DeleteObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
  });

  await r2Client.send(command);
  logger.info({ key }, 'Archivo eliminado de R2');
}
