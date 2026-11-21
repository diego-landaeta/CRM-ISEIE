import { logger } from '../shared/utils/logger.js';
import { vigilar } from './latido.js';
import { vuelta } from '../modules/links-pago/links-pago.cobro-auto.js';

/**
 * Cobro automático de las cuotas (#680, 309). Las cuotas las cobra STRIPE con su
 * calendario (Subscription Schedule); esto no cobra nada por su cuenta. Cada hora:
 *
 *   · el ÚNICO reintento de una cuota que falló, a los días que diga el campus
 *     (Stripe tiene sus reintentos apagados en esas facturas);
 *   · repasa el plan de las ventas con cobro automático: si algo no se pudo pasar
 *     a Stripe (la red, una clave sin permisos) se vuelve a intentar; si no ha
 *     cambiado nada, no llama a Stripe.
 *
 * Solo arranca con el cobro automático encendido (COBRO_AUTOMATICO_EN_PRODUCCION
 * en producción; siempre en /testeo y en local).
 */
const TICK_MS = 60 * 60 * 1000;

export function startCobroAutomaticoScheduler() {
  vigilar('cobro_automatico_cuotas', 'Cobro automático de cuotas: reintento y repaso del plan en Stripe', () => vuelta(), TICK_MS,
    { alArrancarMs: 5 * 60 * 1000 });
  logger.info({ tickMs: TICK_MS }, 'Cobro automático de cuotas: repaso iniciado');
}
