import { logger } from '../shared/utils/logger.js';
import { sincronizarTodos } from '../modules/consultas/consultas.alumnos.js';
import { vigilar } from './latido.js';

/**
 * Los alumnos matriculados de cada tutor, del campus al CRM, una vez al día
 * (#189: «al matricularse y una vez al día»; sin plugin en el campus, «al
 * matricularse» no se puede saber al momento, así que es la vuelta diaria y el
 * botón «Sincronizar ahora»).
 *
 * Solo los campus que leen consultas. Se apaga con CONSULTAS_ALUMNOS_DISABLED=1.
 */

const CADA_MS = parseInt(process.env.CONSULTAS_ALUMNOS_TICK_MS || String(24 * 60 * 60 * 1000), 10);

async function vuelta() {
  const r = await sincronizarTodos();
  const errores = r.flatMap((x) => x.errores || []);
  if (errores.length) logger.warn({ errores: errores.slice(0, 5) }, 'Consultas: algún campus no ha dado sus alumnos enteros');
  return {
    campus: r.length,
    alumnos: r.reduce((s, x) => s + (x.alumnos || 0), 0),
    nuevos: r.reduce((s, x) => s + (x.nuevos || 0), 0),
    bajas: r.reduce((s, x) => s + (x.bajas || 0), 0),
    errores: errores.length,
  };
}

export function startConsultasAlumnosScheduler() {
  if (process.env.CONSULTAS_ALUMNOS_DISABLED === '1') {
    logger.info('Sincronización de alumnos de los campus desactivada (CONSULTAS_ALUMNOS_DISABLED=1)');
    return;
  }
  vigilar('consultas_alumnos', 'Alumnos matriculados de cada tutor', vuelta, CADA_MS, { alArrancarMs: 3 * 60 * 1000 });
}
