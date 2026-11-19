import { logger } from '../shared/utils/logger.js';
import { vigilar } from './latido.js';
import { caducarVencidos } from '../modules/links-pago/links-pago.service.js';

/**
 * Links de pago (CRM#680, fase 2): cada 15 minutos, los links sin pagar cuya fecha
 * de caducidad ya ha pasado se desactivan en Stripe y se marcan «caducado».
 *
 * Un Payment Link de Stripe no caduca solo: si este trabajo no lo desactiva, el
 * cliente lo puede pagar aunque la ficha diga otra cosa. Por eso, si Stripe no
 * contesta, el link se deja vivo y se reintenta en la vuelta siguiente.
 *
 * Solo arranca con los links de pago encendidos (LINKS_PAGO_EN_PRODUCCION, como
 * el módulo). No tiene interruptor propio: de los links, en el .env solo va ese
 * (Diego, 17/11, CRM#680).
 */
const TICK_MS = 15 * 60 * 1000;

export function startLinksPagoCaducidadScheduler() {
  vigilar('links_pago_caducidad', 'Links de pago: desactivar los caducados', () => caducarVencidos(), TICK_MS,
    { alArrancarMs: 2 * 60 * 1000 });
  logger.info({ tickMs: TICK_MS }, 'Links de pago: caducidad iniciada');
}
