/**
 * Quién está en el proceso comercial: los prospectos que ENTRARON desde el
 * 01/09/2026, y nadie más.
 *
 * Diego, 30/09/2026: «se ajustaron los procesos comerciales de leads
 * anteriores; no pueden ajustarse solos porque sí». Primero dijo «desde el
 * 29»; viendo la cola con los de agosto, lo dejó en septiembre: «todos es de
 * este mes de septiembre». Agosto fuera; septiembre, dentro.
 *
 * Lo que pasaba: el 08/09 se escribió la agenda de golpe a los que habían
 * entrado desde el 09/08, y desde entonces a cada uno que entraba. Al montar el
 * proceso el 29/09, esos prospectos viejos aparecieron en la cola del día como
 * atrasados y sus pasos iban venciendo con la fecha: 1.392 en la cola de ISEIE
 * el 30/09.
 *
 * Con esto, los de antes quedan FUERA de todo el proceso: no se les escribe
 * agenda, no salen en la cola ni en sus contadores, la ficha no les enseña
 * pasos y el filtro «paso» de Prospectos no los encuentra. Se trabajan como
 * antes, a mano. (En MultiCRM, además, su estado deja de moverse solo; aquí
 * ese automatismo no existe.)
 *
 * NO SE BORRA NADA de la base: la agenda que ya tenían sigue ahí, sin usarse.
 * Para deshacerlo basta con cambiar la fecha.
 *
 * La entrada es la misma que usa la agenda para contar los días:
 * `fecha_solicitud`, o el alta si no la hay. Así un prospecto cargado hoy con
 * una solicitud de agosto es de agosto, que es cuando pidió información.
 */

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Desde qué día (AAAA-MM-DD). Se puede cambiar con PROCESO_INICIO en el .env;
 * sin ella, el 01/09/2026. Se lee en cada llamada y no al cargar, para que los
 * tests puedan moverla.
 */
export function inicioDelProceso() {
  const env = process.env.PROCESO_INICIO;
  return FECHA.test(env || '') ? env : '2026-09-01';
}

/**
 * Condición SQL, verdadera si el prospecto entró en el proceso.
 * La medianoche es la de Madrid, que es donde trabaja el equipo.
 *
 * @param {string} a  alias de `leads` en la consulta que la usa
 */
export const EN_EL_PROCESO = (a = 'l') =>
  `(COALESCE(${a}.fecha_solicitud, ${a}.created_at) >= TIMESTAMPTZ '${inicioDelProceso()} 00:00 Europe/Madrid')`;
