import { logger } from '../shared/utils/logger.js';
import * as model from '../modules/cobros-externos/paypal.model.js';
import { sincronizar } from '../modules/cobros-externos/paypal.service.js';
import { paypalActivo } from '../modules/cobros-externos/interruptores.js';
import { vigilar } from './latido.js';

/**
 * Sondeo de PayPal (#766): cada 30 minutos, los campus con PayPal conectado.
 * La API de informes de PayPal se rellena con horas de retraso: sondear más a
 * menudo no trae nada antes. Lo inmediato es el webhook, si está dado de alta.
 *
 * Solo arranca con PAYPAL_COBROS_ACTIVO=1, y sin credenciales no hace nada.
 */
const TICK_MS = parseInt(process.env.PAYPAL_SYNC_TICK_MS || String(30 * 60 * 1000), 10);
let enMarcha = false;

export async function vuelta() {
  if (enMarcha || !paypalActivo()) return;
  enMarcha = true;
  try {
    for (const pid of await model.proyectosConPaypal()) {
      try {
        const r = await sincronizar(pid);
        if (r.importados) logger.info({ projectId: pid, ...r }, 'PayPal cron sync');
      } catch (err) {
        logger.warn({ projectId: pid, err: err.message }, 'PayPal cron sync error');
      }
    }
  } catch (err) {
    // Un fallo aquí no puede subir: `setInterval` no espera la promesa y
    // tumbaría el proceso (lo que pasó con el de Stripe).
    logger.error({ err: err.message }, 'PayPal cron: falló la vuelta, se reintenta en la siguiente');
  } finally { enMarcha = false; }
}

export function startPaypalCobrosSyncScheduler() {
  if (!paypalActivo()) {
    logger.info('PayPal: sondeo de cobros APAGADO (PAYPAL_COBROS_ACTIVO)');
    return;
  }
  setTimeout(vuelta, 60_000).unref?.();
  vigilar('paypal', 'Sincronización de cobros de PayPal', vuelta, TICK_MS);
  logger.info({ tickMs: TICK_MS }, 'PayPal: sondeo de cobros iniciado');
}
