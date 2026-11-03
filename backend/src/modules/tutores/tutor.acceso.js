import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { veTodoElCrm, campusDeLaPersona } from '../../shared/utils/ambito.js';
import * as model from './tutor.model.js';

/**
 * Quién puede tocar qué en Tutores: solo lo de sus campus (#245).
 *
 * `exigirGestion` dice QUIÉN gestiona colaboraciones, pero no DE QUÉ CAMPUS. Sin esto,
 * un admin de CEDIA retiraba a un profesor de ICTESS, borraba su colaboración, revertía o
 * liquidaba sus comisiones o le mandaba el correo de facturación con solo cambiar el id.
 *
 * Todo lo que no es tuyo es «no encontrado», igual que si no existiera: no se confirma qué
 * ids hay en otra empresa. Super admin y soporte lo ven todo (el mismo criterio que
 * `ambito.js`).
 */

const NO_ENCONTRADO = (que) => new AppError(`${que} no encontrado`, 404, 'NOT_FOUND');

/** Los campus de quien pide; `null` si lo ve todo. */
export async function misCampus(req) {
  return veTodoElCrm(req.user) ? null : campusDeLaPersona(req.user.userId);
}

/**
 * Un tutor, solo si comparte algún campus con quien lo pide. Él mismo, siempre.
 * (Antes vivía en el controlador y solo se aplicaba en cinco sitios.)
 */
export async function exigirTutorDeMisCampus(req, tutorId) {
  if (req.user.userId === tutorId || veTodoElCrm(req.user)) return;
  const mios = await campusDeLaPersona(req.user.userId);
  if (!(await model.tieneAlgunCampus(tutorId, mios))) throw NO_ENCONTRADO('Tutor');
}

/** Una formación (un producto), solo si es de uno de mis campus. */
export async function exigirFormacionMia(req, productId) {
  const mios = await misCampus(req);
  if (mios === null) return;
  const { rows } = await query('SELECT project_id FROM products WHERE id = $1', [productId]);
  if (!rows[0] || !mios.includes(Number(rows[0].project_id))) throw NO_ENCONTRADO('Formación');
}

/** Un campus, solo si es mío. */
export async function exigirProyectoMio(req, projectId, que = 'Formación') {
  const mios = await misCampus(req);
  if (mios !== null && !mios.includes(Number(projectId))) throw NO_ENCONTRADO(que);
}

/**
 * Una colaboración, solo si su formación es de mi campus.
 * Devuelve la colaboración (o 404 si no existe: lo mismo que si no es mía).
 */
export async function exigirColaboracionMia(req, id) {
  const c = await model.colaboracionPorId(id);
  if (!c) throw NO_ENCONTRADO('Colaboración');
  await exigirFormacionMia(req, c.product_id).catch(() => { throw NO_ENCONTRADO('Colaboración'); });
  return c;
}

/**
 * Unas comisiones, todas de mis campus. El campus de una comisión es el de su formación
 * (o, si la formación se borró, el de la venta). Una sola ajena y no se toca ninguna.
 */
export async function exigirComisionesMias(req, ids) {
  const mios = await misCampus(req);
  if (mios === null) return;
  const lista = [...new Set((ids || []).map(Number))];
  if (!lista.length) return;
  const { rows } = await query(
    `SELECT tc.id, COALESCE(p.project_id, cv.project_id) AS project_id
       FROM tutor_commissions tc
       LEFT JOIN products p ON p.id = tc.product_id
       LEFT JOIN conversion_payments cp ON cp.id = tc.payment_id
       LEFT JOIN conversions cv ON cv.id = cp.conversion_id
      WHERE tc.id = ANY($1::int[])`, [lista]);
  const mias = new Set(rows.filter((r) => mios.includes(Number(r.project_id))).map((r) => Number(r.id)));
  if (lista.some((id) => !mias.has(id))) throw NO_ENCONTRADO('Comisión');
}

/**
 * `{ projectId, projectIds }` pedidos, recortados a mis campus. Sin nada pedido, todos los
 * míos; un campus que no es mío, un 403 (igual que `proyectosDelAmbito`). Super admin: tal cual.
 */
export async function recortarProyectos(req, { projectId = null, projectIds = null } = {}) {
  const mios = await misCampus(req);
  if (mios === null) return { projectId, projectIds };
  if (projectId && !mios.includes(Number(projectId))) {
    throw new AppError('Ese campus no es tuyo', 403, 'FORBIDDEN');
  }
  if (projectId) return { projectId: Number(projectId), projectIds: null };
  const pedidos = (projectIds || []).map(Number);
  const quedan = pedidos.length ? pedidos.filter((id) => mios.includes(id)) : mios;
  return { projectId: null, projectIds: quedan.length ? quedan : [-1] };
}
