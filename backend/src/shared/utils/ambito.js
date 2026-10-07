import { query } from '../config/db.js';
import { AppError } from './AppError.js';

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

  SIEMPRE DENTRO DE LO TUYO (#245, 06/10). Antes esto solo miraba lo que
  llegaba en la URL: sin campus ni empresa devolvía «todo el CRM», y con el
  `issuerId` de otra empresa la daba entera. Así Mireia, admin de CEDIA, veía en
  Tutores a un profesor de ICTESS con su IBAN y su DNI. Ahora el ámbito se
  recorta por los campus de la persona (`user_projects`): «Todos» son SUS
  campus, una empresa son SUS campus de esa empresa, y un campus que no es suyo
  es un 403. Super admin y soporte siguen viéndolo todo: el mismo criterio que
  el middleware `projectAccess`.
*/

/** Quien ve el CRM entero. El mismo criterio que `projectAccess`: por el rol principal. */
export function veTodoElCrm(user) {
  return ['superadmin', 'soporte'].includes(user?.role);
}

/** Los campus de una persona (sus `user_projects` activos). */
export async function campusDeLaPersona(userId) {
  if (!userId) return [];
  const { rows } = await query(
    'SELECT project_id FROM user_projects WHERE user_id = $1 AND active = true ORDER BY project_id', [userId]);
  return rows.map((r) => Number(r.project_id));
}

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
  const projectId = req.query?.projectId ? Number(req.query.projectId) : null;
  let pedido;
  if (!issuerId) {
    pedido = { projectId, projectIds: null };
  } else {
    const { rows } = await query(
      'SELECT id FROM projects WHERE sociedad_emisora_id = $1 ORDER BY id', [issuerId]);
    // Una sociedad sin proyectos NO puede acabar significando «todos»: sería
    // enseñar de más justo cuando se pidió acotar. Se devuelve una lista que no
    // casa con nada y la pantalla sale vacía, que es la respuesta honesta.
    pedido = { projectId: null, projectIds: rows.length ? rows.map((r) => Number(r.id)) : [-1] };
  }
  if (veTodoElCrm(req.user)) return pedido;

  // El resto, solo dentro de sus campus (#245). Lo mismo que arriba: quedarse
  // sin ninguno es una lista que no casa con nada, nunca «todos».
  const mios = await campusDeLaPersona(req.user?.userId);
  const soloMios = (ids) => {
    const quedan = ids.filter((id) => mios.includes(Number(id)));
    return quedan.length ? quedan : [-1];
  };
  if (issuerId) return { projectId: null, projectIds: soloMios(pedido.projectIds) };
  if (projectId) {
    if (!mios.includes(projectId)) throw new AppError('No tienes acceso a ese campus', 403, 'FORBIDDEN');
    return pedido;
  }
  return { projectId: null, projectIds: mios.length ? mios : [-1] };
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
