import * as model from './apostillas.model.js';
import { AppError } from '../../shared/utils/AppError.js';
import { veTodoElCrm, campusParaRecortar } from '../../shared/utils/ambito.js';
import { alcanceComercial } from '../../shared/utils/roles.js';
import { tienePermiso } from '../../shared/middleware/permissions.js';

/*
  QUIÉN VE Y QUIÉN GESTIONA CADA APOSTILLA (CRM#1130 / CRM-ISEIE#786).

  Diego, 25/11/2026: «lo ven todos los que entran al CRM» (admin, gestoras,
  líder de equipo y soporte; no tutores, colaboradores ni redactoras), y es un
  producto propio que tiene que poder medirse. Gestionarla, «admin y gestoras
  sobre las suyas».

  VER (`apostillas.view`): todas las de SUS campus, también las de los clientes
  de otra gestora. Es lo que pidió Diego para que las cifras del apartado
  cuadren para todos; la ficha del cliente sigue cerrada a quien no lo lleva
  (el enlace le dará su 404 de siempre). Superadmin y soporte, todos los campus.

  GESTIONAR (`apostillas.edit`: estado, quién la lleva, envío, notas y
  documentos): el admin, todas las de sus campus; la gestora, solo las suyas
  —las de sus ventas, sus clientes o las que lleva ella—; la líder de equipo,
  las suyas y las de su equipo (`alcanceComercial`, el mismo alcance que en
  Ventas). Soporte NO las gestiona de serie: da soporte técnico, no lleva el
  trámite. Si algún día hace falta, se le da la casilla en Configuración › Roles
  y entonces gestiona todas.

  LOS DOCUMENTOS (el diploma, la apostilla escaneada) llevan datos personales:
  los descarga quien puede gestionar esa apostilla, y superadmin y soporte. Un
  rol que solo ve, ve que existen pero no los abre.

  CREAR A MANO Y ENLAZAR LAS «SIN ASOCIAR» (`apostillas.asociar`) y los días del
  aviso (`apostillas.config`): administración.
*/

/** Los campus que ve quien pide: null = todos (superadmin y soporte). */
export const campusQueVe = (req) => campusParaRecortar(req);

/**
 * Hasta dónde gestiona: `false` (no gestiona), `null` (todas las de sus
 * campus) o la lista de personas cuyas apostillas lleva.
 */
export async function alcanceDeGestion(req) {
  if (!(await tienePermiso(req, 'apostillas.edit'))) return false;
  if (veTodoElCrm(req.user)) return null;
  return alcanceComercial(req.user);
}

/** ¿La gestiona quien tiene ese alcance? Lo mismo que el filtro `ids` del modelo. */
export function laGestiona(alcance, a) {
  if (alcance === false) return false;
  if (alcance === null) return true;
  return [a.responsable_id, a.vendedora_id, a.lead_responsable_id]
    .some((id) => id != null && alcance.includes(Number(id)));
}

/** Cada fila con lo que puede hacer con ella quien mira (la pantalla enseña o esconde los botones). */
export async function conLoQuePuede(req, filas) {
  const alcance = await alcanceDeGestion(req);
  const todoElCrm = veTodoElCrm(req.user);
  for (const a of [].concat(filas)) {
    a.gestionable = laGestiona(alcance, a);
    a.ve_documentos = a.gestionable || todoElCrm;
  }
  return filas;
}

/**
 * La apostilla, si es de los campus de quien pregunta. Una que no existe y una
 * de otro campus dan EL MISMO 404: con un 403 se sabría cuáles existen.
 */
export async function exigirAcceso(req, id) {
  const a = await model.porId(id);
  const campus = await campusQueVe(req);
  if (!a || (campus && !campus.includes(Number(a.project_id)))) {
    throw new AppError('Apostilla no encontrada', 404, 'NOT_FOUND');
  }
  await conLoQuePuede(req, a);
  return a;
}

/** Como `exigirAcceso`, y además que la pueda gestionar (si no, 403: la ve, pero no es suya). */
export async function exigirGestion(req, id) {
  const a = await exigirAcceso(req, id);
  if (!a.gestionable) {
    throw new AppError('Esta apostilla no es tuya: la gestiona su gestora o administración', 403, 'NO_ES_TUYA');
  }
  return a;
}

/** Que el campus sea de quien pide (para crear a mano y para los ajustes). */
export async function exigirCampus(req, projectId) {
  const campus = await campusQueVe(req);
  if (campus && !campus.includes(Number(projectId))) {
    throw new AppError('Ese campus no es tuyo', 403, 'NO_ES_TUYO');
  }
}
