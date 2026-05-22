import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';

// Base dir para uploads locales. Override con env UPLOADS_DIR.
// Default: /var/crm-uploads (persistente entre deploys, fuera de /opt/crm)
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/var/crm-uploads';

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function saveLocal(relativeKey, buffer) {
  const fullPath = path.join(UPLOADS_DIR, relativeKey);
  await ensureDir(path.dirname(fullPath));
  await fs.writeFile(fullPath, buffer);
  logger.info({ key: relativeKey, size: buffer.length }, 'Archivo guardado en disco');
  return relativeKey;
}

export async function getLocal(relativeKey) {
  const fullPath = path.join(UPLOADS_DIR, relativeKey);
  const buffer = await fs.readFile(fullPath);
  const stat = await fs.stat(fullPath);
  return { buffer, size: stat.size };
}

export async function deleteLocal(relativeKey) {
  const fullPath = path.join(UPLOADS_DIR, relativeKey);
  try { await fs.unlink(fullPath); } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  logger.info({ key: relativeKey }, 'Archivo eliminado de disco');
}

export function getUploadsDir() { return UPLOADS_DIR; }
