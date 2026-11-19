import { logger } from '../shared/utils/logger.js';
import { vuelta } from '../modules/diploma-confirmacion/diploma-confirmacion.service.js';
import { activa } from '../modules/diploma-confirmacion/diploma-confirmacion.config.js';
import { vigilar } from './latido.js';

/**
 * Confirmación de datos del diploma (#768) · el vigilante.
 *
 * Cada media hora: las confirmaciones que han cumplido su plazo (7 días) sin
 * respuesta vencen, y el diploma ya puede emitirse con los datos que hay (eso
 * está decidido en la issue). Se avisa a administración del campus.
 *
 * No emite nada: eso sigue siendo de una persona en Diplomas hasta que se
 * decida lo contrario (ver `alConfirmar` en el servicio).
 *
 * No arranca si DIPLOMA_CONFIRMACION_ACTIVA está apagado.
 */
const TICK_MS = parseInt(process.env.DIPLOMA_CONFIRMACION_TICK_MS || String(30 * 60 * 1000), 10);

async function tick() {
  try {
    const r = await vuelta();
    if (r.vencidas) logger.info(r, 'Confirmación de diploma: una vuelta');
    return r;
  } catch (err) {
    logger.error({ err: err.message }, 'Confirmación de diploma: fallo en la vuelta');
    return null;
  }
}

export function startDiplomaConfirmacionScheduler() {
  if (!activa()) {
    logger.info('Confirmación de datos del diploma apagada (DIPLOMA_CONFIRMACION_ACTIVA)');
    return;
  }
  vigilar('diploma_confirmacion', 'Confirmación de datos del diploma (plazo de 7 días)', tick, TICK_MS);
  logger.info({ tickMs: TICK_MS }, 'Confirmación de datos del diploma iniciada');
}
