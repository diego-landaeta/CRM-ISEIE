import { logger } from '../shared/utils/logger.js';
import { vigilar } from './latido.js';
import { vuelta } from '../modules/links-pago/links-pago.externos.js';

/**
 * Links de pago creados directamente en Stripe (CRM#1019): cada 30 minutos se
 * leen los Payment Links de la cuenta de cada campus con la clave de links, para
 * que salgan en Links de pago como «Creado en Stripe», y se recogen los cobros
 * de esos links de los últimos 7 días cuyo aviso no llegó.
 *
 * Solo arranca con los links de pago encendidos (LINKS_PAGO_EN_PRODUCCION, como
 * el módulo). Solo lee de Stripe: nunca cambia un link que no creó el CRM.
 */
const TICK_MS = 30 * 60 * 1000;

export function startLinksPagoExternosScheduler() {
  vigilar('links_pago_externos', 'Links de pago: recoger los creados en Stripe', () => vuelta(), TICK_MS,
    { alArrancarMs: 4 * 60 * 1000 });
  logger.info({ tickMs: TICK_MS }, 'Links de pago: links de Stripe iniciados');
}
