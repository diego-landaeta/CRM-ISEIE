import { logger } from '../shared/utils/logger.js';
import { vigilar } from './latido.js';
import { repasar } from '../modules/apostillas/apostillas.alta.js';
import { avisarAtascadas } from '../modules/apostillas/apostillas.avisos.js';

/**
 * Apostillas de La Haya (CRM#1130 / CRM-ISEIE#786). Cada 10 minutos, como la
 * factura automática:
 *
 *   · las fichas que falten (ventas con el producto de apostilla y cobros de
 *     un link de apostilla creado en Stripe) — `apostillas.alta.js`;
 *   · el aviso de las atascadas: N días en el mismo estado (7 de serie), una
 *     vez al llegar y otra cada N días — `apostillas.avisos.js`.
 *
 * Solo la campana del CRM: nunca un correo al alumno. Se apaga con
 * APOSTILLAS_DESACTIVADAS=1.
 */
const TICK_MS = 10 * 60 * 1000;

export async function vuelta() {
  const creadas = await repasar();
  let avisadas = 0;
  try {
    avisadas = await avisarAtascadas();
  } catch (err) {
    // Sin la migración (42P01), nada que avisar.
    if (err?.code !== '42P01') throw err;
  }
  if (creadas || avisadas) logger.info({ creadas, avisadas }, 'Apostillas: vuelta');
  return { creadas, avisadas };
}

export function startApostillasScheduler() {
  if (process.env.APOSTILLAS_DESACTIVADAS === '1') {
    logger.info('Apostillas: tarea apagada (APOSTILLAS_DESACTIVADAS=1)');
    return;
  }
  vigilar('apostillas', 'Apostillas: fichas nuevas y avisos de atascadas', () => vuelta(), TICK_MS,
    { alArrancarMs: 2 * 60 * 1000 });
  logger.info({ tickMs: TICK_MS }, 'Apostillas: tarea iniciada');
}
