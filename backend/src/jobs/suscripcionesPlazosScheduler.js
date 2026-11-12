import { logger } from '../shared/utils/logger.js';
import { vigilar } from './latido.js';
import { vuelta } from '../modules/stripe-payments/suscripciones.service.js';

/**
 * Ventas a plazos (#747): cada 3 horas, lo que no llega por un cargo nuevo.
 *
 *   · Busca la suscripción de los cargos ya asociados que no se han mirado (las
 *     suscripciones que ya estaban en marcha cuando se estrenó esto), de 60 en 60.
 *   · Revisa las ventas con suscripción abierta: si el último cobro se apuntó a
 *     mano en el CRM y no por Stripe, también se cierra.
 *
 * Cancelar de verdad depende de SUSCRIPCION_CIERRE_ACTIVO (ver el servicio). Este
 * trabajo solo se apaga del todo con SUSCRIPCIONES_PLAZOS_DISABLED=1.
 */
const TICK_MS = 3 * 60 * 60 * 1000;

export function startSuscripcionesPlazosScheduler() {
  if (process.env.SUSCRIPCIONES_PLAZOS_DISABLED === '1') {
    logger.info('Ventas a plazos: revisión de suscripciones desactivada (SUSCRIPCIONES_PLAZOS_DISABLED=1)');
    return;
  }
  // La primera vuelta a los 10 minutos del arranque, no al arrancar: la base
  // puede no estar lista todavía.
  vigilar('suscripciones_plazos', 'Ventas a plazos: cerrar suscripciones pagadas', () => vuelta(), TICK_MS,
    { alArrancarMs: 10 * 60 * 1000 });
  logger.info({ tickMs: TICK_MS }, 'Ventas a plazos: revisión de suscripciones iniciada');
}
