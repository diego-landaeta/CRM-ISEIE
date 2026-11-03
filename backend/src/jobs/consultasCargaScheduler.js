import { logger } from '../shared/utils/logger.js';
import { recordarCargas } from '../modules/consultas/consultas.plazos.js';
import { vigilar } from './latido.js';

/**
 * El recordatorio de «carga de trabajo desactualizada» (#190, decisión 9): a
 * cada tutor que lleva más de una semana sin actualizarla, como mucho una vez
 * por semana. Se mira una vez al día. Se apaga con
 * CONSULTAS_CARGA_RECORDATORIO_DISABLED=1.
 */

const CADA_MS = parseInt(process.env.CONSULTAS_CARGA_TICK_MS || String(24 * 60 * 60 * 1000), 10);

export function startConsultasCargaScheduler() {
  if (process.env.CONSULTAS_CARGA_RECORDATORIO_DISABLED === '1') {
    logger.info('Recordatorio de carga de trabajo desactivado (CONSULTAS_CARGA_RECORDATORIO_DISABLED=1)');
    return;
  }
  vigilar('consultas_carga', 'Recordatorio de carga de trabajo desactualizada', () => recordarCargas(), CADA_MS, { alArrancarMs: 4 * 60 * 1000 });
}
