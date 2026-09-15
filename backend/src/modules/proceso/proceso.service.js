import * as Pasos from './proceso.model.js';
import { AppError } from '../../shared/utils/AppError.js';

export function listarPasos(projectId, opciones) {
  return Pasos.listByProject(projectId, opciones);
}

export async function crearPaso(projectId, datos) {
  const yaEsta = await Pasos.findByClave(projectId, datos.clave);
  if (yaEsta) throw new AppError(`Ya hay un paso con la clave «${datos.clave}»`, 409);
  return Pasos.create(projectId, datos);
}

// Todo lo que toca un paso pasa por aqui para comprobar que es de este proyecto.
// El id viene de la URL y podria ser el de cualquiera: sin esta comprobacion,
// un admin de un proyecto editaria el proceso de otro escribiendo un numero.
async function suyoOFuera(id, projectId) {
  const paso = await Pasos.findById(id);
  if (!paso || paso.project_id !== projectId) throw new AppError('Paso no encontrado', 404);
  return paso;
}

export async function editarPaso(id, projectId, datos) {
  await suyoOFuera(id, projectId);
  return Pasos.update(id, datos);
}

export async function reordenarPasos(projectId, ids) {
  const mios = await Pasos.listByProject(projectId, { includeInactive: true });
  const permitidos = new Set(mios.map((p) => p.id));
  const ajenos = ids.filter((id) => !permitidos.has(id));
  if (ajenos.length) throw new AppError(`Esos pasos no son de este proyecto: ${ajenos.join(', ')}`, 400);
  await Pasos.reorder(projectId, ids);
  return Pasos.listByProject(projectId, { includeInactive: true });
}

export async function desactivarPaso(id, projectId) {
  await suyoOFuera(id, projectId);
  return Pasos.deactivate(id);
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

export function resumenDeLaCola(opciones) {
  return Pasos.resumenDeLaCola(opciones);
}

export async function ajustarPaso(id, datos) {
  const paso = await Pasos.ajustarPaso(id, datos);
  if (!paso) throw new AppError('Ese paso no existe', 404);
  return paso;
}
