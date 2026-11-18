/**
 * EL INTERRUPTOR DE LAS REGLAS NUEVAS (puerta 6, #487; gemela de CRM#848).
 *
 * APAGADO DE SERIE. Sin STRIPE_ASOCIACION_V2_ACTIVA=1 un cargo se asocia
 * exactamente como antes de la puerta 6: por el correo, a la ficha más nueva del
 * campus, solo si está «convertida» y tiene venta. Ni se mira el pedido de la
 * web, ni las fichas duplicadas, ni la suscripción; no se llama a WooCommerce ni
 * a Stripe; y «Sincronizar» reintenta los pendientes con las reglas de siempre.
 *
 * Es dinero y no se puede probar en /testeo (allí las claves de Stripe no se
 * descifran): lo enciende Diego, cuando haya visto qué cargos cambiarían.
 * La compra directa (COMPRA_DIRECTA_ACTIVA) necesita además este encendido.
 *
 * Se lee en cada llamada, no al cargar el módulo: las pruebas lo cambian.
 */
export function asociacionV2Activa(env = process.env) {
  return ['1', 'true'].includes(String(env.STRIPE_ASOCIACION_V2_ACTIVA || '').trim().toLowerCase());
}
