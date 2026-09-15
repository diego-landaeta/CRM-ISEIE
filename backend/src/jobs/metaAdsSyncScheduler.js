import { logger } from '../shared/utils/logger.js';
import { query } from '../shared/config/db.js';
import { syncIncremental, runBackfill } from '../modules/meta-ads/meta-ads.service.js';
import { vigilar } from './latido.js';

// Sync automático de Meta Ads. Antes solo había sync manual (botón en UI), por lo
// que los datos quedaban congelados entre clicks. Esta cron mantiene cada cuenta al día.
const TICK_MS = parseInt(process.env.META_SYNC_TICK_MS || String(3 * 60 * 60 * 1000)); // 3h
const DAY_MS = 86400000;
let running = false;

async function listAllAccounts() {
  const { rows } = await query(
    `SELECT id, project_id, ad_account_id, last_synced_at, last_sync_status, backfill_done
       FROM meta_ad_accounts
      ORDER BY id ASC`
  );
  return rows;
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const accounts = await listAllAccounts();
    for (const acc of accounts) {
      try {
        // Cuenta nunca completó su backfill (ej: quedó in_progress) -> recuperarla.
        if (!acc.backfill_done) {
          logger.info({ accountId: acc.id, ad_account_id: acc.ad_account_id }, 'Meta cron: backfill de recuperación (90d)');
          const r = await runBackfill(acc.id, 90);
          logger.info({ accountId: acc.id, r }, 'Meta cron: backfill recuperación OK');
          continue;
        }
        // Calcular hueco desde el último sync exitoso.
        const last = acc.last_synced_at ? new Date(acc.last_synced_at).getTime() : 0;
        const daysSince = last ? Math.ceil((Date.now() - last) / DAY_MS) : 999;
        if (daysSince > 1) {
          // Estuvo caído varios días: rellenar el hueco (acotado a 90d) en vez de solo 2 días.
          const days = Math.min(daysSince + 1, 90);
          logger.info({ accountId: acc.id, daysSince, days }, 'Meta cron: rellenando hueco con backfill acotado');
          const r = await runBackfill(acc.id, days);
          logger.info({ accountId: acc.id, r }, 'Meta cron: relleno de hueco OK');
        } else {
          const r = await syncIncremental(acc.id);
          logger.info({ accountId: acc.id, synced: r?.synced }, 'Meta cron: incremental OK');
        }
      } catch (err) {
        logger.warn({ accountId: acc.id, err: err.message }, 'Meta cron: error sincronizando cuenta');
      }
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Meta cron: error general');
  } finally {
    running = false;
  }
}

export function startMetaAdsSyncScheduler() {
  setTimeout(tick, 60_000); // primera corrida 1 min después del boot
  vigilar('meta_ads', 'Sincronización de Meta Ads', tick, TICK_MS);
  logger.info({ tickMs: TICK_MS }, 'Meta Ads sync scheduler iniciado');
}
