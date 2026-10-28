import { logger } from '../shared/utils/logger.js';
import { procesarPendientes } from '../modules/asignacion/asignacion.service.js';
import { purgarActividad } from '../modules/asignacion/asignacion.model.js';
import { vigilar } from './latido.js';

/**
 * Asignación de leads por actividad (CRM#513, migración 230): los reintentos
 * del envío a los escenarios de Make (1, 5 y 15 minutos; la cola vive en la
 * base) y, una vez al día, la purga de `actividad_crm` de más de 30 días.
 *
 * Se apaga con ASIGNACION_DISABLED=1 (el primer envío sigue saliendo; solo
 * dejan de hacerse los reintentos).
 */
const TICK_MS = parseInt(process.env.ASIGNACION_TICK_MS || String(2 * 60 * 1000), 10);
let ultimaPurga = 0;

async function vuelta() {
  try {
    const r = await procesarPendientes();
    if (r.intentados || r.rescatados) logger.info(r, 'Asignación de leads: reintentos');
    if (Date.now() - ultimaPurga > 24 * 3600 * 1000) {
      ultimaPurga = Date.now();
      const borradas = await purgarActividad(30);
      if (borradas) logger.info({ borradas }, 'Asignación de leads: actividad de más de 30 días purgada');
    }
    return r;
  } catch (err) {
    // Sin la migración 230 las tablas no existen: se avisa y se espera a la próxima.
    logger.warn({ err: err.message }, 'Asignación de leads: no se pudieron revisar los reintentos');
    return null;
  }
}

export function startAsignacionScheduler() {
  if (process.env.ASIGNACION_DISABLED === '1') {
    logger.info('Reintentos de la asignación de leads desactivados (ASIGNACION_DISABLED=1)');
    return;
  }
  vigilar('asignacion_leads', 'Asignación de leads: reintentos', vuelta, TICK_MS);
  logger.info({ tickMs: TICK_MS }, 'Reintentos de la asignación de leads iniciados');
}
