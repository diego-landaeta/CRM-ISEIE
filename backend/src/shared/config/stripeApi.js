/**
 * A donde se le pregunta a Stripe.
 *
 * EN PRODUCCION, A STRIPE Y A NADIE MAS. La constante manda y la variable de
 * entorno ni se mira: poder redirigir las llamadas de dinero desde el `.env` de
 * un servidor es exactamente el tipo de palanca que no debe existir alli. Quien
 * pudiera escribir esa variable podria inventarse los cobros de la empresa.
 *
 * Fuera de produccion se puede apuntar a otro sitio con `STRIPE_API_BASE`. Eso
 * es lo que permite probar la conexion ENTERA en local --la clave cifrada, la
 * prueba de conexion, el sondeo, el corte por fecha, el estado del cron--
 * contra un servidor de mentira, sin una credencial de verdad y sin tocar
 * dinero de nadie.
 *
 * Vive en un solo sitio a proposito: hay cinco llamadas a Stripe repartidas por
 * tres modulos, y con la direccion escrita a mano en cada una, cualquier prueba
 * de este tipo cubriria unas si y otras no.
 */
const STRIPE_API = 'https://api.stripe.com';

export function baseDeStripe() {
  if (process.env.NODE_ENV === 'production') return STRIPE_API;
  return process.env.STRIPE_API_BASE || STRIPE_API;
}

/** La direccion completa de un endpoint de Stripe. */
export function urlDeStripe(path) {
  return `${baseDeStripe()}${path}`;
}
