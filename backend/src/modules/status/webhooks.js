/**
 * El último golpe de cada webhook que entra.
 *
 * Parte de #26, que pide «Stripe — último cobro recibido y último webhook». Lo
 * primero ya estaba en `stripe_payments`; lo segundo no estaba en ninguna
 * parte: el webhook contesta y se olvida, y lo único que queda es una línea de
 * pino que nadie lee.
 *
 * Y hay un caso que merece verse en pantalla más que ningún otro. Cuando un
 * proyecto no tiene el secreto configurado, el webhook se RECHAZA con un 400:
 *
 *     logger.error({ projectId: pid }, 'Webhook de Stripe RECHAZADO: ...')
 *
 * Está bien rechazado —sin firma, esa URL sería un formulario público para
 * inventar cobros— y no se pierde dinero, porque el sondeo los recoge cada
 * cinco minutos. Pero hoy eso solo se descubre entrando por SSH a leer logs,
 * que es justo la pregunta que esta pantalla viene a quitar de en medio.
 *
 * En memoria, igual que el pulso de las tareas y por el mismo motivo: una tabla
 * serían tres migraciones sin aplicar en vez de dos, y esto no diría nada hasta
 * que alguien las corriera. Se pierde al reiniciar, y la pantalla ya enseña
 * cuánto lleva el servidor arriba para poder interpretarlo.
 */

const ultimos = new Map();

/**
 * @param {string} fuente     'stripe', 'meta'...
 * @param {'aceptado'|'rechazado'|'error'} resultado
 * @param {string} [motivo]   solo cuando no se acepta
 */
export function anotaWebhook(fuente, resultado, motivo = null) {
  const previo = ultimos.get(fuente) || { aceptados: 0, rechazados: 0 };
  ultimos.set(fuente, {
    cuando: Date.now(),
    resultado,
    // Sin datos del evento: ni importes, ni correos, ni el cuerpo. Solo si
    // entró y por qué no, que es lo que #26 permite enseñar.
    motivo: motivo ? String(motivo).slice(0, 200) : null,
    aceptados: previo.aceptados + (resultado === 'aceptado' ? 1 : 0),
    rechazados: previo.rechazados + (resultado === 'aceptado' ? 0 : 1),
  });
}

export function ultimoWebhook(fuente) {
  const w = ultimos.get(fuente);
  if (!w) return null;
  return { ...w, cuando: new Date(w.cuando).toISOString() };
}

export const _internos = { ultimos };
