/**
 * Los dos interruptores del registro automático de cobros (#766).
 *
 * APAGADOS DE SERIE en todas partes, también en local y en /testeo: hasta que
 * alguien pone `=1` en el .env, no se monta el sondeo, no se acepta el webhook,
 * no se guarda la integración `paypal` y no se pueden subir extractos. Con el
 * interruptor puesto y sin credenciales, tampoco pasa nada: el sondeo solo mira
 * los campus que tienen la integración guardada.
 *
 *   PAYPAL_COBROS_ACTIVO=1          PayPal: sondeo, webhook y su tarjeta
 *   SANTANDER_EXTRACTOS_ACTIVO=1    subir extractos del banco y su bandeja
 *
 * Son funciones y no constantes para que las pruebas pasen el entorno que quieran.
 */
export function paypalActivo(env = process.env) {
  return env.PAYPAL_COBROS_ACTIVO === '1' || env.PAYPAL_COBROS_ACTIVO === 'true';
}

export function santanderActivo(env = process.env) {
  return env.SANTANDER_EXTRACTOS_ACTIVO === '1' || env.SANTANDER_EXTRACTOS_ACTIVO === 'true';
}
