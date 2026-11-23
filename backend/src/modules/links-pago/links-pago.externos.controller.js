import { z } from 'zod';
import * as externos from './links-pago.externos.js';
import * as model from './links-pago.externos.model.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { query } from '../../shared/config/db.js';
import { listaDelAmbito, campusDeTodos, campusParaRecortar, exigirCampusSuyo } from '../../shared/utils/ambito.js';

/*
  LOS LINKS CREADOS EN STRIPE Y SUS COBROS POR VINCULAR (CRM-ISEIE#688, gemela de CRM#1019).

  Todo con `links_pago.ver_todos` (las rutas) y SIEMPRE dentro de los campus de
  quien mira: la lista y la bandeja se recortan a sus campus; traer de Stripe,
  buscar ventas y vincular, solo en uno suyo (fuera, 404, como si no existiera).
  Estos links no tienen quien los creó en el CRM: no hay recorte por persona.
*/

const id = z.coerce.number().int().positive().max(2147483647);
const ambitoSchema = z.object({
  projectId: id.optional(),
  issuerId: id.optional(),
  projectIds: z.string().regex(/^\d+(,\d+)*$/, 'projectIds: números separados por comas').optional(),
});
const listaSchema = ambitoSchema.extend({ activos: z.enum(['1', '0']).optional() });
const sincronizarSchema = z.object({ projectId: id });
const buscarSchema = z.object({ cargoId: id, q: z.string().trim().min(2, 'Escribe al menos 2 letras').max(100) });
const vincularSchema = z.object({ id, conversionId: id });

function fallo(parsed) {
  return new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
}

/** Los campus que ve quien mira, recortados a los suyos (como el embudo). */
async function campusQueVe(req) {
  let projectIds = (await listaDelAmbito(req)) || await campusDeTodos(req);
  const campus = await campusParaRecortar(req);
  if (campus) projectIds = projectIds.filter((p) => campus.includes(Number(p)));
  return projectIds.length ? projectIds.map(Number) : [-1];
}

// GET /api/links-pago/externos — los links creados en Stripe de sus campus.
export async function listar(req, res, next) {
  try {
    const parsed = listaSchema.safeParse(req.query);
    if (!parsed.success) throw fallo(parsed);
    const data = await model.listar({ projectIds: await campusQueVe(req), soloActivos: parsed.data.activos === '1' });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// POST /api/links-pago/externos/sincronizar { projectId } — «Traer de Stripe».
export async function sincronizar(req, res, next) {
  try {
    const parsed = sincronizarSchema.safeParse({ projectId: req.projectId ?? req.body?.projectId });
    if (!parsed.success) throw fallo(parsed);
    await exigirCampusSuyo(req, parsed.data.projectId, 'Campus no encontrado');
    const r = await externos.sincronizar(parsed.data.projectId);
    logger.info({ userId: req.user.userId, projectId: parsed.data.projectId, ...r }, 'links de Stripe: traídos a mano');
    res.json({ success: true, data: { project_id: parsed.data.projectId, ...r } });
  } catch (err) { next(err); }
}

// GET /api/links-pago/por-vincular — la bandeja «Cobros de Stripe por vincular».
export async function porVincular(req, res, next) {
  try {
    const parsed = ambitoSchema.safeParse(req.query);
    if (!parsed.success) throw fallo(parsed);
    const filas = await model.porVincular({ projectIds: await campusQueVe(req) });
    const data = filas.map((f) => ({ ...f, motivo_texto: externos.MOTIVOS[f.motivo] || 'Aún no se ha mirado a quién es' }));
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

/** El cobro de la bandeja, si es de uno de sus campus. Si no, 404. */
async function cargoSuyo(req, cargoId) {
  const c = await model.cargo(cargoId);
  if (!c || !c.stripe_link_externo_id) throw new AppError('Cobro no encontrado', 404, 'NOT_FOUND');
  await exigirCampusSuyo(req, c.project_id, 'Cobro no encontrado');
  return c;
}

// GET /api/links-pago/por-vincular/ventas?cargoId=&q= — buscar la venta, en el campus del cobro.
export async function buscarVentas(req, res, next) {
  try {
    const parsed = buscarSchema.safeParse(req.query);
    if (!parsed.success) throw fallo(parsed);
    const c = await cargoSuyo(req, parsed.data.cargoId);
    const data = await model.buscarVentas(Number(c.project_id), parsed.data.q);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// POST /api/links-pago/por-vincular/:id/vincular { conversionId }
export async function vincular(req, res, next) {
  try {
    const parsed = vincularSchema.safeParse({ id: req.params.id, conversionId: req.body?.conversionId });
    if (!parsed.success) throw fallo(parsed);
    await cargoSuyo(req, parsed.data.id);
    const r = await externos.vincular(parsed.data.id, { conversionId: parsed.data.conversionId, userId: Number(req.user.userId) });
    await query(
      'INSERT INTO user_activity_log (user_id, action, details, ip_address) VALUES ($1, $2, $3, $4)',
      [req.user.userId, 'links_pago.vincular_cobro_stripe', JSON.stringify({ stripe_payment_id: parsed.data.id, ...r }), req.ip || null],
    ).catch((err) => logger.warn({ err: err.message }, 'links de Stripe: no se pudo anotar la vinculación'));
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
}
