// F4-004: Cron diario de limpieza de PDFs huerfanos en FS local.
// Util cuando F4-003 (R2) esta activo: tras subir el PDF a R2, el archivo
// local se mantuvo (por failover); este cron lo borra si lleva > 24h sin
// uso y no esta referenciado en `documents.file_path`.
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../shared/utils/logger.js';
import { query } from '../shared/config/db.js';
import { vigilar } from './latido.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(__dirname, '../../uploads/documents');
const TICK_MS = parseInt(process.env.DOC_ORPHAN_TICK_MS || String(24 * 60 * 60 * 1000)); // 24h
const GRACE_MS = 24 * 60 * 60 * 1000; // 24h grace period antes de borrar

let running = false;

async function cleanOrphans() {
  let files;
  try {
    files = await fs.readdir(UPLOAD_DIR);
  } catch (err) {
    if (err.code === 'ENOENT') {
      logger.debug({ dir: UPLOAD_DIR }, 'document orphans: UPLOAD_DIR no existe aun');
      return;
    }
    throw err;
  }

  if (files.length === 0) return;

  // Trae todos los basenames referenciados (file_path puede tener path completo,
  // tomamos solo el nombre del archivo).
  const { rows } = await query('SELECT file_path FROM documents WHERE file_path IS NOT NULL');
  const referenced = new Set(rows.map(r => path.basename(r.file_path)).filter(Boolean));

  const now = Date.now();
  let deleted = 0;
  let kept = 0;
  let bytesFreed = 0;

  for (const name of files) {
    const full = path.join(UPLOAD_DIR, name);
    let stat;
    try { stat = await fs.stat(full); } catch { continue; }
    if (!stat.isFile()) continue;

    // Skip si esta referenciado en DB
    if (referenced.has(name)) { kept++; continue; }

    // Grace period: si fue modificado < 24h, lo dejamos (puede estar en proceso
    // de subida a R2 o el INSERT en DB no completo aun).
    const ageMs = now - stat.mtimeMs;
    if (ageMs < GRACE_MS) { kept++; continue; }

    try {
      await fs.unlink(full);
      deleted++;
      bytesFreed += stat.size;
    } catch (err) {
      logger.warn({ err: err.message, file: name }, 'orphan cleanup: unlink fallo');
    }
  }

  logger.info({
    dir: UPLOAD_DIR,
    deleted, kept,
    mbFreed: (bytesFreed / 1024 / 1024).toFixed(2),
  }, 'document orphan cleanup tick');
}

async function tick() {
  if (running) return;
  running = true;
  try {
    await cleanOrphans();
  } catch (err) {
    logger.error({ err: err.message }, 'document orphan scheduler tick error');
  } finally {
    running = false;
  }
}

export function startDocumentOrphanScheduler() {
  if (process.env.DOC_ORPHAN_DISABLED === '1') {
    logger.info('Document orphan scheduler desactivado (DOC_ORPHAN_DISABLED=1)');
    return;
  }
  // Primer tick a los 5 min (esperamos a que la app este estable),
  // luego cada TICK_MS (default 24h).
  setTimeout(tick, 5 * 60 * 1000);
  vigilar('documentos_huerfanos', 'Documentos huérfanos', tick, TICK_MS);
  logger.info({ tickMs: TICK_MS, dir: UPLOAD_DIR }, 'Document orphan scheduler iniciado');
}
