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
 * Quién entra lo decide `candidatosDelDia7`: su PRIMER CONTACTO fue hace 7 a 30
 * días, no compró, no dijo que no, tiene correo y nunca se le preguntó.
 *
 * Se apaga con FEEDBACK_DIA7_DISABLED=1.
 */

// Diego, 28/09: «se cuenta desde el primer contacto; máximo 200 correos
// diarios, así que irán en pilas para que se vayan enviando». Una tanda cada
// media hora dentro del horario, hasta el tope del día (que incluye los de
// descarte). Todo se puede cambiar desde el .env.
const TICK_MS = parseInt(process.env.FEEDBACK_DIA7_TICK_MS || String(30 * 60 * 1000), 10);
const DESDE = parseInt(process.env.FEEDBACK_DIA7_DESDE || '9', 10);
const HASTA = parseInt(process.env.FEEDBACK_DIA7_HASTA || '20', 10);
const PILA = parseInt(process.env.FEEDBACK_DIA7_PILA || '25', 10);
const TOPE = parseInt(process.env.FEEDBACK_DIA7_TOPE || '200', 10);
const MAX_DIAS = parseInt(process.env.FEEDBACK_DIA7_MAX_DIAS || '30', 10);

/** La hora en Madrid, sea cual sea la del servidor. */
function horaDeMadrid() {
  return Number(new Intl.DateTimeFormat('es-ES', { hour: 'numeric', hour12: false, timeZone: 'Europe/Madrid' }).format(new Date()));
}

async function vuelta() {
  const hora = horaDeMadrid();
  // Ni de madrugada ni de noche: un correo así se lee peor, y a esa hora nadie
  // de la casa está para ver si algo ha ido mal.
  if (hora < DESDE || hora >= HASTA) return null;
  try {
    const r = await vueltaDelDia7({ pila: PILA, tope: TOPE, maxDias: MAX_DIAS });
    if (r.pedidos) logger.info(r, 'Feedback del 7.º día: una tanda');
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
  vigilar('feedback_dia7', 'Feedback del 7.º día (tandas)', vuelta, TICK_MS);
  logger.info({ desde: DESDE, hasta: HASTA, pila: PILA, tope: TOPE, maxDias: MAX_DIAS, tickMs: TICK_MS }, 'Feedback del 7.º día iniciado');
}
