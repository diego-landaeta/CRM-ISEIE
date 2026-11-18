import { logger } from '../shared/utils/logger.js';
import { vuelta } from '../modules/factura-automatica/factura-automatica.service.js';
import { activa } from '../modules/factura-automatica/factura-automatica.config.js';
import { vigilar } from './latido.js';

/**
 * Factura automática (#452) · el vigilante.
 *
 * Cada media hora: las peticiones que han cumplido su plazo (7 días) sin
 * respuesta pasan a facturarse con la ficha —si está completa y es válida— o a
 * revisión; y las ventas con datos que tienen cobros esperando turno en la
 * cola lo vuelven a intentar.
 *
 * No arranca si FACTURA_AUTOMATICA_ACTIVA está apagado.
 */
const TICK_MS = parseInt(process.env.FACTURA_AUTOMATICA_TICK_MS || String(30 * 60 * 1000), 10);

async function tick() {
  try {
    const r = await vuelta();
    if (r.vencidas || r.reintentos) logger.info(r, 'Factura automática: una vuelta');
    return r;
  } catch (err) {
    logger.error({ err: err.message }, 'Factura automática: fallo en la vuelta');
    return null;
  }
}

export function startFacturaAutomaticaScheduler() {
  if (!activa()) {
    logger.info('Factura automática apagada (FACTURA_AUTOMATICA_ACTIVA)');
    return;
  }
  vigilar('factura_automatica', 'Factura automática (plazo de 7 días)', tick, TICK_MS);
  logger.info({ tickMs: TICK_MS }, 'Factura automática iniciada');
}
