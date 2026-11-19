import { query } from '../shared/config/db.js';
import { logger } from '../shared/utils/logger.js';
import { sincronizarCampus } from '../modules/consultas/consultas.plugin.js';
import { procesarAviso } from '../modules/consultas/consultas.avisos.js';
import { campusConConsultas } from '../modules/consultas/consultas.service.js';
import { vigilar } from './latido.js';

/**
 * El repaso de los campus con el plugin del CRM, cada 15 minutos (#679).
 *
 * Los avisos llegan al momento, pero un aviso se puede perder (el CRM caído más de lo que
 * Moodle reintenta, el campus desconectado un rato…). El repaso pide a cada campus los
 * mensajes desde el último que vio y mete lo que falte: pase lo que pase, en 15 minutos el
 * CRM está al día. De paso, vuelve a mandar la lista de «No disponible».
 *
 * Se apaga con MOODLE_SINCRONIZACION_DISABLED=1.
 */

const CADA_MS = parseInt(process.env.MOODLE_SINCRONIZACION_TICK_MS || String(15 * 60 * 1000), 10);

export async function repasarTodos() {
  const { rows } = await query('SELECT project_id FROM moodle_plugin_campus WHERE activo');
  const consultas = new Map((await campusConConsultas()).map((c) => [c.projectId, c]));
  const resultados = [];
  for (const { project_id: id } of rows) {
    const c = consultas.get(Number(id));
    if (!c) continue; // «Leer las consultas» apagado: ese campus no entra.
    resultados.push(await sincronizarCampus(Number(id), { procesar: procesarAviso, desdeFecha: c.desde }));
  }
  return resultados;
}

async function vuelta() {
  const r = await repasarTodos();
  const errores = r.filter((x) => x.error);
  if (errores.length) logger.warn({ errores: errores.map((x) => ({ campus: x.projectId, error: x.error })) }, 'Moodle: algún campus no se ha podido repasar');
  return { campus: r.length, mensajes: r.reduce((s, x) => s + (x.mensajes || 0), 0), nuevos: r.reduce((s, x) => s + (x.nuevos || 0), 0), errores: errores.length };
}

export function startMoodleSincronizacionScheduler() {
  if (process.env.MOODLE_SINCRONIZACION_DISABLED === '1') {
    logger.info('Repaso de los campus desactivado (MOODLE_SINCRONIZACION_DISABLED=1)');
    return;
  }
  vigilar('moodle_sincronizacion', 'Repaso de los campus con el plugin del CRM', vuelta, CADA_MS, { alArrancarMs: 2 * 60 * 1000 });
}
