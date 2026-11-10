import { proyectosDelAmbito, exigirCampusSuyo } from '../../shared/utils/ambito.js';
import { alcanceDeLider, personasDentro } from '../../shared/utils/roles.js';
import { query } from '../../shared/config/db.js';

// `commissions.reglas` de serie es de soporte; a un admin de empresa se le
// puede dar como excepción, y entonces toca solo las reglas de SUS campus:
// la de otro campus es un 404, como si no existiera.
async function exigirReglaSuya(req, id) {
  const { rows: [r] } = await query('SELECT project_id FROM commission_rules WHERE id = $1', [id]);
  if (!r) throw new AppError('No encontrado', 404, 'NOT_FOUND');
  await exigirCampusSuyo(req, r.project_id);
}
import { AppError } from '../../shared/utils/AppError.js';
import { ruleSchema, ruleUpdateSchema, paySchema } from './commission.validation.js';
import * as model from './commission.model.js';

// ===== RULES (superadmin only via routes) =====
export async function listRules(req, res, next) {
  try {
    // El campus o la empresa los resuelve `proyectosDelAmbito`, siempre dentro
    // de los campus de quien pide (superadmin y soporte, todos).
    const { userId, productId } = req.query;
    const rows = await model.listRules({
      ...(await proyectosDelAmbito(req)),
      userId: userId ? Number(userId) : null,
      productId: productId ? Number(productId) : null,
    });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

export async function createRule(req, res, next) {
  try {
    const parsed = ruleSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || 'Invalid', 400, 'VALIDATION_ERROR');
    await exigirCampusSuyo(req, parsed.data.project_id, 'Proyecto no encontrado');
    const r = await model.createRule(parsed.data);
    res.status(201).json({ success: true, data: r });
  } catch (err) { next(err); }
}

export async function updateRule(req, res, next) {
  try {
    const parsed = ruleUpdateSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || 'Invalid', 400, 'VALIDATION_ERROR');
    await exigirReglaSuya(req, Number(req.params.id));
    const r = await model.updateRule(Number(req.params.id), parsed.data);
    if (!r) throw new AppError('No encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
}

export async function deleteRule(req, res, next) {
  try {
    await exigirReglaSuya(req, Number(req.params.id));
    await model.deleteRule(Number(req.params.id));
    res.json({ success: true });
  } catch (err) { next(err); }
}

// ===== COMMISSIONS =====
export async function listMine(req, res, next) {
  try {
    const { from, to, estado } = req.query;
    const rows = await model.listCommissions({
      userId: req.user.userId,
      estado: estado || null,
      from: from || null,
      to: to || null,
    });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

// Quien lleva un equipo comercial (QA del 09/11/2026): las suyas y las de su
// equipo; pedir a alguien de fuera no ensancha nada (`personasDentro`).
async function deQuien(req) {
  const pedido = req.query.userId ? Number(req.query.userId) : null;
  const lider = await alcanceDeLider(req.user);
  return lider ? personasDentro(lider, pedido) : pedido;
}

export async function listAll(req, res, next) {
  try {
    const { estado, from, to } = req.query;
    const rows = await model.listCommissions({
      userId: await deQuien(req),
      ...(await proyectosDelAmbito(req)),
      estado: estado || null,
      from: from || null,
      to: to || null,
    });
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

export async function statsMine(req, res, next) {
  try {
    const { from, to } = req.query;
    const s = await model.getStats({
      userId: req.user.userId,
      from: from || null,
      to: to || null,
    });
    res.json({ success: true, data: s });
  } catch (err) { next(err); }
}

export async function statsAll(req, res, next) {
  try {
    const { from, to } = req.query;
    const s = await model.getStats({
      userId: await deQuien(req),
      ...(await proyectosDelAmbito(req)),
      from: from || null,
      to: to || null,
    });
    res.json({ success: true, data: s });
  } catch (err) { next(err); }
}

export async function pay(req, res, next) {
  try {
    const parsed = paySchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || 'Invalid', 400, 'VALIDATION_ERROR');
    const c = await model.payCommission(Number(req.params.id), parsed.data.fecha_pago, parsed.data.notas);
    if (!c) throw new AppError('Comision no encontrada o ya pagada', 404, 'NOT_FOUND');
    res.json({ success: true, data: c });
  } catch (err) { next(err); }
}

export async function recalculate(req, res, next) {
  try {
    const r = await model.recalculateCommission(Number(req.params.conversionId));
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
}
