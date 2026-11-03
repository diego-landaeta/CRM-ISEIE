import { logger } from '../shared/utils/logger.js';
import { revisarPlazos } from '../modules/consultas/consultas.plazos.js';
import { vigilar } from './latido.js';

/**
 * Los plazos de las consultas (#190, decisión 4): recordatorio al tutor cuando
 * una consulta se acerca al plazo y aviso a administración cuando se pasa.
 * Cada 15 minutos. Se apaga con CONSULTAS_PLAZO_DISABLED=1.
 */

const CADA_MS = parseInt(process.env.CONSULTAS_PLAZO_TICK_MS || String(15 * 60 * 1000), 10);

export function startConsultasPlazoScheduler() {
  if (process.env.CONSULTAS_PLAZO_DISABLED === '1') {
    logger.info('Recordatorios de plazo de las consultas desactivados (CONSULTAS_PLAZO_DISABLED=1)');
    return;
  }
  vigilar('consultas_plazo', 'Recordatorios y avisos de plazo de las consultas', () => revisarPlazos(), CADA_MS, { alArrancarMs: 2 * 60 * 1000 });
}
