import { logger } from '../shared/utils/logger.js';
import { vigilar } from './latido.js';
import { vuelta } from '../modules/stripe-payments/disputas.service.js';

/**
 * Disputas de Stripe (#396): cada 30 minutos, las de todas las cuentas
 * conectadas y el segundo aviso de las que vencen sin respuesta.
 *
 * Hace falta aunque haya webhook: el webhook trae la disputa al momento, pero
 * hoy ninguna cuenta lo tiene configurado, y el sondeo de cobros no ve las
 * disputas (solo pide los cargos nuevos). Solo lee de Stripe.
 *
 * APAGADO DE SERIE: llama a Stripe, asi que solo arranca con
 * STRIPE_DISPUTAS_ACTIVO=1 (lo enciende Diego). STRIPE_DISPUTAS_DISABLED=1 lo
 * apaga aunque este encendido. Cada cuanto: STRIPE_DISPUTAS_TICK_MS.
 */
const si = (v) => ['1', 'true'].includes(String(v || '').trim().toLowerCase());
const TICK_MS = parseInt(process.env.STRIPE_DISPUTAS_TICK_MS || String(30 * 60 * 1000), 10);

export function startStripeDisputasScheduler() {
  if (!si(process.env.STRIPE_DISPUTAS_ACTIVO) || process.env.STRIPE_DISPUTAS_DISABLED === '1') {
    logger.info('Disputas de Stripe: sondeo APAGADO (STRIPE_DISPUTAS_ACTIVO)');
    return;
  }
  // La primera vuelta a los 2 minutos: detras del sondeo de cobros, que arranca a los 30 s.
  vigilar('stripe_disputas', 'Disputas de Stripe: traerlas y avisar', () => vuelta(), TICK_MS,
    { alArrancarMs: 2 * 60 * 1000 });
  logger.info({ tickMs: TICK_MS }, 'Disputas de Stripe: sondeo iniciado');
}
