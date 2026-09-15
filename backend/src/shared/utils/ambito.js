import { query } from '../config/db.js';

/*
  De qué va lo que se está mirando: un proyecto, una sociedad entera, o todo.

  Carlos: «ahora solo se puede por proyecto, tengo que tener la opción de que
  sea por empresa — seleccionar CEDIA y que se vuelquen todos los datos de
  todos los campus asociados».

  Esto vivía dentro del módulo de informes y ha tenido que salir: Diego lo pidió
  en TODAS las pantallas de cifras, no solo en Reportes. Tenerlo aquí evita que
  cada módulo se lo monte a su manera, que es como acaban dando cifras distintas
  para la misma pregunta.

  NO HACE FALTA MODELO NUEVO: la sociedad ya vive en
  `projects.sociedad_emisora_id`, que apunta a `invoice_issuers`. Se traduce la
  sociedad a su lista de proyectos y el resto de la consulta no se entera.

  QUÉ PANTALLAS DEBEN USARLO. Las de cifras —ventas, cobros, comisiones,
  matrículas, informes—, donde sumar varios campus significa algo. Las de
  configuración NO: un webhook, un formulario o una plantilla se montan PARA UN
  PROYECTO, y «el webhook de CEDIA» no existe. Ahí el muro de «elige un
  proyecto» es la respuesta correcta, no un fallo.
*/

/**
 * Resuelve el ámbito que pide la petición.
 *
 * Devuelve `{ projectId, projectIds }` para pasárselo tal cual al modelo:
 *
 *   una sociedad  →  { projectId: null, projectIds: [1, 2, 3, …] }
 *   un proyecto   →  { projectId: 7,    projectIds: null }
 *   todo          →  { projectId: null, projectIds: null }
 */
export async function proyectosDelAmbito(req) {
  const issuerId = req.query?.issuerId ? Number(req.query.issuerId) : null;
  if (!issuerId) {
    return {
      projectId: req.query?.projectId ? Number(req.query.projectId) : null,
      projectIds: null,
    };
  }
  const { rows } = await query(
    'SELECT id FROM projects WHERE sociedad_emisora_id = $1 ORDER BY id', [issuerId]);
  // Una sociedad sin proyectos NO puede acabar significando «todos»: sería
  // enseñar de más justo cuando se pidió acotar. Se devuelve una lista que no
  // casa con nada y la pantalla sale vacía, que es la respuesta honesta.
  return { projectId: null, projectIds: rows.length ? rows.map((r) => r.id) : [-1] };
}

/**
 * Los dos casos —un proyecto o una lista— reducidos a una sola lista, que es
 * lo que entiende `= ANY($n::int[])`.
 *
 * Devuelve `null` cuando no hay que acotar por proyecto: eso es «todo», y el
 * que llama decide qué hacer con ello.
 */
export function comoLista(projectId, projectIds) {
  if (Array.isArray(projectIds) && projectIds.length) return projectIds.map(Number);
  if (projectId) return [Number(projectId)];
  return null;
}

/**
 * «Todos» no incluye los proyectos de pruebas.
 *
 * Se usa donde `comoLista` devuelve null: un proyecto de pruebas elegido a dedo
 * se ve entero, pero cinco prospectos inventados no pueden aparecer en el total
 * de nadie.
 */
export const SIN_PRUEBAS = (col = 'project_id') =>
  `${col} NOT IN (SELECT id FROM projects WHERE es_prueba)`;
