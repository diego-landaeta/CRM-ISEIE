import { logger } from '../shared/utils/logger.js';
import { vuelta } from '../modules/matricula-moodle/matricula-moodle.service.js';
import { activa } from '../modules/matricula-moodle/matricula-moodle.config.js';
import { vigilar } from './latido.js';

/**
 * Matrícula automática en Moodle (#767) · el trabajo de cada hora.
 *
 * Coge las matrículas cuyo momento ya llegó (el día anterior al inicio, o al
 * pagar si no hay fecha) y las deja «listas» avisando a administración, o las
 * reintenta si falta algo. En la fase 1 no llama a Moodle.
 *
 * No arranca si MATRICULA_MOODLE_ACTIVA está apagado.
 */
const TICK_MS = parseInt(process.env.MATRICULA_MOODLE_TICK_MS || String(60 * 60 * 1000), 10);

async function tick() {
  try {
    const r = await vuelta();
    if (r.revisadas) logger.info(r, 'Matrícula Moodle: una vuelta');
    return r;
  } catch (err) {
    logger.error({ err: err.message }, 'Matrícula Moodle: fallo en la vuelta');
    return null;
  }
}

export function startMatriculaMoodleScheduler() {
  if (!activa()) {
    logger.info('Matrícula automática en Moodle apagada (MATRICULA_MOODLE_ACTIVA)');
    return;
  }
  vigilar('matricula_moodle', 'Matrícula automática en Moodle (cada hora)', tick, TICK_MS);
  logger.info({ tickMs: TICK_MS }, 'Matrícula automática en Moodle iniciada');
}
