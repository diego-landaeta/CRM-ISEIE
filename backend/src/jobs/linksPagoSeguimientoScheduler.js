import { logger } from '../shared/utils/logger.js';
import { vigilar } from './latido.js';
import { vuelta } from '../modules/links-pago/links-pago.seguimiento.js';

/**
 * Seguimiento de los links de pago que no se pagan (CRM#984). Cada 15 minutos:
 * qué links ha abierto el alumno (sesiones de Checkout en Stripe), el aviso a la
 * gestora si lo abrió y no pagó, y los recordatorios al alumno de las 24 h y de
 * las 72 h (links-pago.seguimiento.js).
 *
 * Solo arranca con el seguimiento encendido (LINKS_PAGO_SEGUIMIENTO_EN_PRODUCCION
 * en producción; siempre en /staging y en local), como el cobro automático.
 */
const TICK_MS = 15 * 60 * 1000;

export function startLinksPagoSeguimientoScheduler() {
  vigilar('links_pago_seguimiento', 'Links de pago: aperturas, aviso a la gestora y recordatorios', () => vuelta(), TICK_MS,
    { alArrancarMs: 3 * 60 * 1000 });
  logger.info({ tickMs: TICK_MS }, 'Links de pago: seguimiento iniciado');
}
