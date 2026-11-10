import { logger } from '../shared/utils/logger.js';
import { leerTodosLosCampus } from '../modules/consultas/consultas.service.js';
import { vigilar } from './latido.js';

/**
 * Las consultas de los alumnos, leídas del campus cada 5 minutos (#188).
 *
 * Decisión 3 del estudio de la fase 0: «empezar leyendo cada 5 minutos en el
 * piloto, que no necesita instalar nada». Solo los campus con «Leer las
 * consultas» marcado en Integraciones, y solo lo escrito desde que se marcó.
 *
 * Se apaga con CONSULTAS_CAMPUS_DISABLED=1.
 */

const CADA_MS = parseInt(process.env.CONSULTAS_CAMPUS_TICK_MS || String(5 * 60 * 1000), 10);

async function vuelta() {
  const r = await leerTodosLosCampus();
  const nuevos = r.reduce((s, x) => s + (x.nuevos || 0), 0);
  const errores = r.flatMap((x) => x.errores || []);
  if (errores.length) logger.warn({ errores: errores.slice(0, 5) }, 'Consultas: algún campus no se ha podido leer entero');
  return { campus: r.length, mensajes_nuevos: nuevos, errores: errores.length };
}

export function startConsultasCampusScheduler() {
  if (process.env.CONSULTAS_CAMPUS_DISABLED === '1') {
    logger.info('Lectura de consultas de los campus desactivada (CONSULTAS_CAMPUS_DISABLED=1)');
    return;
  }
  vigilar('consultas_campus', 'Consultas de alumnos desde el campus', vuelta, CADA_MS, { alArrancarMs: 60 * 1000 });
}
