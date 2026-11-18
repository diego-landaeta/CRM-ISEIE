import { logger } from '../shared/utils/logger.js';
import { bloqueadosActivo } from '../shared/services/brevo-bloqueados.service.js';
import { revisar } from '../modules/users/brevo-bloqueos.js';
import { vigilar } from './latido.js';

/**
 * Cada 6 horas: ¿Brevo tiene bloqueado el correo de alguien del equipo?
 *
 * Caso real (ISEIE, 17/11/2026): una gestora pasó tres semanas sin recibir
 * ningún aviso del CRM porque Brevo bloqueó su dirección tras un rebote duro, y
 * nadie se enteró. La lógica está en `modules/users/brevo-bloqueos.js`.
 *
 * Interruptor: `BREVO_BLOQUEADOS_ACTIVO=true`. Apagada de serie: entonces la
 * tarea ni arranca y nada pregunta a Brevo.
 */

const TICK_MS = parseInt(process.env.BREVO_BLOQUEADOS_TICK_MS || String(6 * 60 * 60 * 1000), 10);

export function startBrevoBloqueadosScheduler() {
  if (!bloqueadosActivo()) {
    logger.info('Vigilancia de correos bloqueados en Brevo apagada (BREVO_BLOQUEADOS_ACTIVO)');
    return false;
  }
  // La primera vuelta a los 10 minutos del arranque, no a las 6 horas: tras un
  // despliegue se quiere saber pronto. Los avisos no se repiten (van por bloqueo).
  vigilar('brevo_bloqueados', 'Correos del equipo bloqueados en Brevo', revisar, TICK_MS, { alArrancarMs: 10 * 60 * 1000 });
  logger.info({ tickMs: TICK_MS }, 'Vigilancia de correos bloqueados en Brevo iniciada');
  return true;
}
