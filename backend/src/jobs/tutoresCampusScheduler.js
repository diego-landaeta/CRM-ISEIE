import { logger } from '../shared/utils/logger.js';
import { comprobarTodos } from '../modules/tutores/tutor.campus.js';
import { vigilar } from './latido.js';

/**
 * La matrícula de los tutores en los campus, cada hora (#187). Al abrir la ficha
 * de un tutor se comprueba además en el momento si la última tiene más de unos
 * segundos (`comprobarSiHaceFalta`).
 *
 * «Comprobación periódica en un trabajo programado, con su interruptor en
 * `.env`. Si al tutor le dan de baja, se marca y deja de recibir consultas de
 * ese proyecto.»
 *
 * Solo pregunta a los campus conectados en Integraciones (provider «moodle»); si
 * no hay ninguno, la vuelta no hace nada. Un campus que no contesta no da de
 * baja a nadie: se apunta el error y el estado se queda como estaba.
 *
 * Se apaga con TUTORES_CAMPUS_DISABLED=1.
 */

const CADA_MS = parseInt(process.env.TUTORES_CAMPUS_TICK_MS || String(60 * 60 * 1000), 10);
// La primera vuelta, un rato después de arrancar: no a la vez que todo lo demás.
const AL_ARRANCAR_MS = parseInt(process.env.TUTORES_CAMPUS_PRIMERA_MS || String(10 * 60 * 1000), 10);

async function vuelta() {
  const r = await comprobarTodos();
  if (r.cambios.length) {
    logger.info({ cambios: r.cambios }, `Matrícula de tutores: ${r.cambios.length} cambio(s) de estado en los campus`);
  }
  return { tutores: r.tutores, comprobados: r.mirados, cambios: r.cambios.length };
}

export function startTutoresCampusScheduler() {
  if (process.env.TUTORES_CAMPUS_DISABLED === '1') {
    logger.info('Comprobación de tutores en los campus desactivada (TUTORES_CAMPUS_DISABLED=1)');
    return;
  }
  vigilar('tutores_campus', 'Matrícula de los tutores en los campus', vuelta, CADA_MS, { alArrancarMs: AL_ARRANCAR_MS });
}
