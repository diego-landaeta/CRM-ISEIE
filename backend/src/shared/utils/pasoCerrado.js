/**
 * Si un paso del proceso comercial está cerrado por los CONTACTOS de la persona.
 *
 * Diego, 29/09/2026: «si registraron 4 interacciones y el proceso le marcó en
 * último, eso está mal: si registra varias interacciones pero en el proceso no
 * marcó el siguiente paso, no puede asumir esos pasos».
 *
 * Antes bastaba con tener tantos contactos como el número del paso: cuatro
 * interacciones apuntadas cerraban los pasos 1 a 4 aunque tocara el 1. Ahora
 * (lo que eligió Diego, «solo el paso que toca»):
 *
 *   · un contacto cierra solo el paso ACTUAL, nunca los siguientes;
 *   · solo si ya ha llegado su día (el contacto es de ese día o posterior);
 *   · como mucho UN paso por día de contacto: cuatro interacciones el mismo
 *     día cierran, como mucho, el paso de ese día.
 *
 * DESDE EL CORTE, NO HACIA ATRÁS (también lo eligió Diego). Recalcular todo con
 * la regla nueva devolvía a la cola 162 personas en MultiCRM y 769 en ISEIE.
 * Así que los contactos APUNTADOS antes de `CORTE` siguen contando como antes
 * —lo que la regla vieja cerró, cerrado se queda— y la regla nueva solo usa los
 * apuntados después. Al subirlo nadie cambia de paso. No se escribe nada en la
 * base: se puede deshacer quitando este fichero.
 *
 * Los pasos marcados a mano (`hecho`) o saltados no gastan contactos: solo los
 * `pendiente` necesitan uno.
 *
 * CÓMO SE COMPRUEBA SIN RECORRER LOS PASOS. Es emparejar, en orden, los pasos
 * pendientes con días distintos de contacto, cada uno en su día o después.
 * Como las fechas de los pasos van creciendo, eso se puede hacer con una cuenta:
 * el paso actual está cerrado si, para CADA paso pendiente `j` hasta él, hay al
 * menos tantos días de contacto desde la fecha de `j` como pasos pendientes hay
 * de `j` al actual.
 *
 * Una sola regla para la cola, sus contadores, la ficha y el filtro de
 * Prospectos: si cada sitio la escribe a su manera, acaban diciendo cosas
 * distintas de la misma persona.
 */

/** Cuándo empezó la regla nueva (UTC). Lo apuntado antes, cuenta como antes. */
export const CORTE = '2026-09-29 17:00:00+00';

// La regla vieja, congelada en el corte: tantos contactos apuntados ANTES del
// corte como el número del paso.
const CERRADO_ANTES = (a) => `((SELECT count(*) FROM lead_interactions li
     WHERE li.lead_id = ${a}.lead_id AND li.tipo <> 'nota'
       AND li.created_at < TIMESTAMPTZ '${CORTE}') >= ${a}.orden)`;

/**
 * @param {string} a  alias de `lead_steps` en la consulta que la usa
 * @returns {string}  una condición SQL, verdadera si el paso está cerrado
 */
export const PASO_CERRADO = (a = 'ls') => `(${CERRADO_ANTES(a)} OR NOT EXISTS (
    SELECT 1 FROM lead_steps pj
     WHERE pj.lead_id = ${a}.lead_id AND pj.estado = 'pendiente' AND pj.orden <= ${a}.orden
       AND NOT ${CERRADO_ANTES('pj')}
       AND (SELECT count(DISTINCT li.fecha::date) FROM lead_interactions li
             WHERE li.lead_id = ${a}.lead_id AND li.tipo <> 'nota'
               AND li.created_at >= TIMESTAMPTZ '${CORTE}'
               AND li.fecha::date >= pj.fecha_prevista)
         < (SELECT count(*) FROM lead_steps pm
             WHERE pm.lead_id = ${a}.lead_id AND pm.estado = 'pendiente'
               AND pm.orden BETWEEN pj.orden AND ${a}.orden
               AND NOT ${CERRADO_ANTES('pm')})
  ))`;
