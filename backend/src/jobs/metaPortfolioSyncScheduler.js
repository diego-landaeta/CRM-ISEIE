import { logger } from '../shared/utils/logger.js';
import { query } from '../shared/config/db.js';
import { syncPortfolio } from '../modules/meta-ads/meta-portfolio.service.js';
import { vigilar } from './latido.js';

// #198, gemela de CRM#212.
const TICK_MS = parseInt(process.env.META_PORTFOLIO_SYNC_TICK_MS || String(3 * 60 * 60 * 1000)); // 3h
let running = false;

async function listAllPortfolios() {
  const { rows } = await query(`SELECT id FROM meta_business_portfolios ORDER BY id ASC`);
  return rows;
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const portfolios = await listAllPortfolios();
    for (const portfolio of portfolios) {
      try {
        const r = await syncPortfolio(portfolio.id);
        logger.info({ portfolioId: portfolio.id, ...r }, 'Meta portfolio cron: sync OK');
      } catch (err) {
        logger.warn({ portfolioId: portfolio.id, err: err.message }, 'Meta portfolio cron: error sincronizando portfolio');
      }
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Meta portfolio cron: error general');
  } finally {
    running = false;
  }
}

export function startMetaPortfolioSyncScheduler() {
  setTimeout(tick, 60_000); // primera corrida 1 min despues del boot
  vigilar('meta_portfolio', 'Sincronizacion de portfolios de Meta', tick, TICK_MS);
  logger.info({ tickMs: TICK_MS }, 'Meta portfolio sync scheduler iniciado');
}