import { logger } from '../shared/utils/logger.js';
import * as model from '../modules/stripe-payments/stripe-payments.model.js';
import { syncStripePayments } from '../modules/stripe-payments/stripe-payments.service.js';
import { vigilar } from './latido.js';

// Sync incremental cada 5 min de los proyectos con Stripe configurado.
const TICK_MS = parseInt(process.env.STRIPE_SYNC_TICK_MS || String(5 * 60 * 1000));
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const projectIds = await model.listProjectsWithStripe();
    for (const pid of projectIds) {
      try {
        const r = await syncStripePayments(pid, { fullHistory: false });
        if (r.imported > 0) logger.info({ projectId: pid, imported: r.imported }, 'Stripe cron sync');
      } catch (err) {
        logger.warn({ projectId: pid, err: err.message }, 'Stripe cron sync error');
      }
    }
  } finally { running = false; }
}

export function startStripePaymentsSyncScheduler() {
  setTimeout(tick, 30_000); // primera corrida a los 30s del boot
  vigilar('stripe', 'Sincronización de pagos de Stripe', tick, TICK_MS);
  logger.info({ tickMs: TICK_MS }, 'Stripe payments sync scheduler iniciado');
}
