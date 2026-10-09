import * as Pasos from './proceso.model.js';
import { AppError } from '../../shared/utils/AppError.js';

/*
  UN CAMPUS O UNA EMPRESA ENTERA.

  Los pasos se guardan por proyecto, pero los siete campus de CEDIA llevan el
  mismo proceso: el documento comercial es uno solo. Con una empresa puesta se
  lee UNA lista, y lo que se cambia se cambia en todos sus campus a la vez --si
  no, habria que repetir el mismo cambio siete veces y a la septima ya no
  coincide--.

  `projectIds` siempre trae algo: un campus suelto es una lista de uno.
*/
export function listarPasos(projectIds, opciones) {
  const ids = Array.isArray(projectIds) ? projectIds : [projectIds];
  return ids.length > 1
    ? Pasos.listByProjects(ids, opciones)
    : Pasos.listByProject(ids[0], opciones);
}

export async function crearPaso(projectIds, datos) {
  const ids = Array.isArray(projectIds) ? projectIds : [projectIds];
  // Si ya existe en CUALQUIERA de los campus no se crea en ninguno: dejarlo a
  // medias es como se separan los procesos sin que nadie se entere.
  for (const id of ids) {
    const yaEsta = await Pasos.findByClave(id, datos.clave);
    if (yaEsta) throw new AppError(`Ya hay un paso con la clave «${datos.clave}»`, 409);
  }
  const creados = [];
  for (const id of ids) creados.push(await Pasos.create(id, datos));
  // Se devuelve el del primer campus, que es el que la pantalla ya enseñaba.
  return creados[0];
}

// Todo lo que toca un paso pasa por aqui para comprobar que es de este proyecto.
// El id viene de la URL y podria ser el de cualquiera: sin esta comprobacion,
// un admin de un proyecto editaria el proceso de otro escribiendo un numero.
async function suyoOFuera(id, projectIds) {
  const ids = Array.isArray(projectIds) ? projectIds : [projectIds];
  const paso = await Pasos.findById(id);
  if (!paso || !ids.includes(paso.project_id)) throw new AppError('Paso no encontrado', 404);
  return paso;
}

export async function editarPaso(id, projectIds, datos) {
  const ids = Array.isArray(projectIds) ? projectIds : [projectIds];
  const paso = await suyoOFuera(id, ids);
  // En una empresa, el mismo paso vive en cada campus con otro id. Se cambian
  // todos: «el paso 2 de CEDIA» es uno solo para quien lo mira.
  const hermanos = ids.length > 1 ? await Pasos.hermanosDeClave(paso.clave, ids) : [{ id }];
  let mio = null;
  for (const h of hermanos) {
    const r = await Pasos.update(h.id, datos);
    if (h.id === id) mio = r;
  }
  return mio || Pasos.findById(id);
}

export async function reordenarPasos(projectIds, ids) {
  const campus = Array.isArray(projectIds) ? projectIds : [projectIds];
  const mios = await listarPasos(campus, { includeInactive: true });
  const permitidos = new Set(mios.map((p) => p.id));
  const ajenos = ids.filter((id) => !permitidos.has(id));
  if (ajenos.length) throw new AppError(`Esos pasos no son de este proyecto: ${ajenos.join(', ')}`, 400);

  // El orden es del PROCESO, no de un campus: se traduce a claves y se aplica
  // en todos, para que el paso 3 sea el tercero en los siete.
  const porId = new Map(mios.map((p) => [p.id, p]));
  const claves = ids.map((id) => porId.get(id).clave);
  for (const campusId of campus) {
    const suyos = await Pasos.listByProject(campusId, { includeInactive: true });
    const porClave = new Map(suyos.map((p) => [p.clave, p.id]));
    const enOrden = claves.map((c) => porClave.get(c)).filter(Boolean);
    if (enOrden.length) await Pasos.reorder(campusId, enOrden);
  }
  return listarPasos(campus, { includeInactive: true });
}

export async function desactivarPaso(id, projectIds) {
  const ids = Array.isArray(projectIds) ? projectIds : [projectIds];
  const paso = await suyoOFuera(id, ids);
  const hermanos = ids.length > 1 ? await Pasos.hermanosDeClave(paso.clave, ids) : [{ id }];
  let mio = null;
  for (const h of hermanos) {
    const r = await Pasos.deactivate(h.id);
    if (h.id === id) mio = r;
  }
  return mio;
}

// ── LA AGENDA DE CADA PROSPECTO (#89 · #90) ─────────────────────────────────

export function planificarPasosDeLead(leadId) {
  return Pasos.planificarPasosDeLead(leadId);
}

export function pasosDeLead(leadId) {
  return Pasos.pasosDeLead(leadId);
}

export function colaDelDia(opciones) {
  return Pasos.colaDelDia(opciones);
}

/** La base que toca repasar a fin de mes. */
export function baseDeSeguimiento(opciones) {
  return Pasos.baseDeSeguimiento(opciones);
}

/** Cuantos son, sin el tope de la lista. */
export function resumenDeSeguimiento(opciones) {
  return Pasos.resumenDeSeguimiento(opciones);
}

export function resumenDeLaCola(opciones) {
  return Pasos.resumenDeLaCola(opciones);
}

export async function ajustarPaso(id, datos, userId = null) {
  const paso = await Pasos.ajustarPaso(id, datos, userId);
  if (!paso) throw new AppError('Ese paso no existe', 404);
  return paso;
}

export async function anadirSeguimiento(leadId, datos) {
  const paso = await Pasos.anadirSeguimiento(leadId, datos);
  if (!paso) throw new AppError('Ese prospecto no existe', 404);
  return paso;
}
