import { logger } from '../shared/utils/logger.js';
import { vueltaDelDia7 } from '../modules/feedback/feedback.service.js';
import { vigilar } from './latido.js';

/**
 * El correo de «¿por qué has desistido?» al 7.º día sin comprar (#169).
 *
 * Diego, 23/09: «recuerda que si al 7.º día no hay conversión también se le
 * envía». El 7 no es un número al azar: es cuando acaba el proceso comercial,
 * así que el correo sale justo cuando ya se ha hecho todo lo que tocaba.
 *
 * Una vuelta al día, a media mañana: un correo que llega de madrugada se lee
 * peor, y a esa hora nadie de la casa está para ver si algo ha ido mal.
 *
 * Quién entra lo decide `candidatosDelDia7` (entró hace 7 a 10 días, no compró,
 * no dijo que no, tiene correo y nunca se le preguntó). El margen de 10 días
 * recupera un día de servidor parado sin escribir de golpe a la base antigua.
 *
 * Se apaga con FEEDBACK_DIA7_DISABLED=1.
 */

const TICK_MS = parseInt(process.env.FEEDBACK_DIA7_TICK_MS || String(60 * 60 * 1000), 10);
const HORA = parseInt(process.env.FEEDBACK_DIA7_HORA || '10', 10);

// Con un tick de una hora, sin esto la misma mañana daría la vuelta varias veces.
let ultimoDia = null;

async function vuelta() {
  const ahora = new Date();
  const dia = ahora.toISOString().slice(0, 10);
  if (ahora.getHours() !== HORA || ultimoDia === dia) return null;
  try {
    const r = await vueltaDelDia7();
    ultimoDia = dia;
    if (r.pedidos) logger.info(r, 'Feedback del 7.º día: pedidos');
    return r;
  } catch (err) {
    logger.error({ err: err.message }, 'Fallo pidiendo el feedback del 7.º día');
    return null;
  }
}

export function startFeedbackDia7Scheduler() {
  if (process.env.FEEDBACK_DIA7_DISABLED === '1') {
    logger.info('Feedback del 7.º día desactivado (FEEDBACK_DIA7_DISABLED=1)');
    return;
  }
  vigilar('feedback_dia7', 'Feedback del 7.º día sin comprar', vuelta, TICK_MS);
  logger.info({ hora: HORA, tickMs: TICK_MS }, 'Feedback del 7.º día iniciado');
}
