import { logger } from '../shared/utils/logger.js';
import { query } from '../shared/config/db.js';
import * as wcModel from '../modules/woocommerce/wc.model.js';
import { runFullImport } from '../modules/woocommerce/wc.controller.js';
import { vigilar } from './latido.js';

const TICK_MS = parseInt(process.env.WC_SYNC_TICK_MS || String(5 * 60 * 1000)); // 5 min default

let running = false;

async function syncProject(creds) {
  const minutesSinceLastSync = creds.last_sync_at ? (Date.now() - new Date(creds.last_sync_at).getTime()) / 60000 : Infinity;
  if (minutesSinceLastSync < (creds.sync_interval_minutes || 30)) return;

  let runId = null;
  try {
    const startRes = await wcModel.startRun(creds.project_id, null);
    runId = startRes.id;
    // Reutiliza el mismo flujo que importNow: categorías + productos + scraper
    // + field_mapping + CPT + menú. Antes el auto-sync sólo metía nombre/precio
    // y por eso ICTESS quedó sin horas/módulos/secciones.
    await runFullImport(creds, creds.project_id, runId);
    await query(`UPDATE wc_credentials SET last_sync_at = NOW() WHERE project_id = $1`, [creds.project_id]);
    logger.info({ projectId: creds.project_id }, 'WC auto-sync OK (full import)');
  } catch (err) {
    if (runId) await wcModel.finishRun(runId, { status: 'error', error_message: err.message?.slice(0, 1000) });
    logger.error({ err, projectId: creds.project_id }, 'WC auto-sync error');
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const { rows } = await query(`SELECT * FROM wc_credentials WHERE active = true AND auto_sync_enabled = true`);
    for (const c of rows) await syncProject(c);
  } catch (err) {
    logger.error({ err }, 'WC scheduler tick error');
  } finally { running = false; }
}

export function startWooCommerceSyncScheduler() {
  if (process.env.WC_SYNC_DISABLED === '1') {
    logger.warn('WooCommerce sync scheduler deshabilitado por WC_SYNC_DISABLED=1');
    return;
  }
  vigilar('woocommerce', 'Sincronización de WooCommerce', tick, TICK_MS);
  logger.info({ tickMs: TICK_MS }, 'WooCommerce sync scheduler iniciado');
}
