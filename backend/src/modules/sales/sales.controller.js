import * as salesService from './sales.service.js';
import * as reportModel from '../reports/report.model.js';
import * as goalsService from './sales.goals.js';
import { createSaleSchema } from './sales.validation.js';
import { AppError } from '../../shared/utils/AppError.js';

export async function create(req, res, next) {
  try {
    const parsed = createSaleSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    }
    const result = await salesService.createSale(parsed.data, req.user);
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function topProducts(req, res, next) {
  try {
    const projectId = req.query.projectId ? parseInt(req.query.projectId) : null;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const days = req.query.days ? parseInt(req.query.days) : null; // null = all-time
    // Rango de fechas explícito YYYY-MM-DD (hoy/semana/mes/personalizado). Se ignora si el formato no es válido.
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const from = dateRe.test(req.query.from || '') ? req.query.from : null;
    const to = dateRe.test(req.query.to || '') ? req.query.to : null;
    let responsableId = req.query.responsableId ? parseInt(req.query.responsableId) : null;
    // Gestor: forzar su propio responsableId (no puede consultar el de otros)
    if (req.user.role === 'gestor') responsableId = req.user.userId;
    const result = await salesService.getTopProducts({ projectId, limit, days, from, to, responsableId });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

// GET /api/sales/gestores-stats?periodo=YYYY-MM&projectId=N — ventas + metas por gestor
export async function gestoresStats(req, res, next) {
  try {
    const projectId = req.query.projectId ? parseInt(req.query.projectId) : null;
    const periodo = req.query.periodo || null;
    const result = await goalsService.getGestoresStats({ projectId, periodo });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

// GET /api/sales/my-stats — el propio gestor consulta su progreso
export async function myStats(req, res, next) {
  try {
    const projectId = req.query.projectId ? parseInt(req.query.projectId) : null;
    const periodo = req.query.periodo || null;
    const result = await goalsService.getMyStats(req.user.userId, { projectId, periodo });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

// POST /api/sales/goals — gestor setea su propia meta, admin puede setear cualquier
export async function setGoal(req, res, next) {
  try {
    const { user_id, project_id, periodo_yyyymm, meta_ventas, meta_facturacion, notas } = req.body || {};
    if (!user_id) throw new AppError('user_id requerido', 400, 'MISSING_USER');
    const result = await goalsService.setGoal({
      user_id: parseInt(user_id),
      project_id: project_id ? parseInt(project_id) : null,
      periodo_yyyymm,
      meta_ventas: Number(meta_ventas),
      meta_facturacion: Number(meta_facturacion),
      notas: notas || null,
    }, req.user);
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

// DELETE /api/sales/goals/:id
export async function deleteGoal(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) throw new AppError('ID invalido', 400, 'INVALID_ID');
    const result = await goalsService.deleteGoal(id, req.user);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

// --- Vistas agregadas de Ventas -------------------------------------------
function filtrosDeQuery(req) {
  const dateRe2 = /^\d{4}-\d{2}-\d{2}$/;
  let responsableId = req.query.responsableId ? parseInt(req.query.responsableId) : null;
  // Gestor: solo lo suyo, ignorando lo que pida por query.
  if (req.user.role === 'gestor') responsableId = req.user.userId;
  return {
    projectId: req.query.projectId ? parseInt(req.query.projectId) : null,
    from: dateRe2.test(req.query.from || '') ? req.query.from : null,
    to: dateRe2.test(req.query.to || '') ? req.query.to : null,
    responsableId,
    search: (req.query.search || '').trim() || null,
    page: req.query.page,
    limit: req.query.limit,
  };
}

// GET /api/sales/resumen
export async function resumenVentas(req, res, next) {
  try {
    res.json({ success: true, data: await salesService.getResumenVentas(filtrosDeQuery(req)) });
  } catch (err) { next(err); }
}

// GET /api/sales/por-asesora
export async function ventasPorAsesora(req, res, next) {
  try {
    res.json({ success: true, data: await salesService.getVentasPorAsesora(filtrosDeQuery(req)) });
  } catch (err) { next(err); }
}

// GET /api/sales/por-cliente
export async function ventasPorCliente(req, res, next) {
  try {
    const r = await salesService.getVentasPorCliente(filtrosDeQuery(req));
    res.json({
      success: true,
      data: r.clientes,
      pagination: { total: r.total, page: r.page, limit: r.limit, totalPages: r.totalPages },
    });
  } catch (err) { next(err); }
}

// GET /api/sales/desglose?projectId&from&to — de que se compone lo vendido.
export async function desglose(req, res, next) {
  try {
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const data = await salesService.getDesglose({
      projectId: req.query.projectId ? parseInt(req.query.projectId) : null,
      from: dateRe.test(req.query.from || '') ? req.query.from : null,
      to: dateRe.test(req.query.to || '') ? req.query.to : null,
      // Una gestora ve su propio reparto, no el del proyecto entero.
      responsableId: req.user.role === 'gestor' ? req.user.userId
        : (req.query.responsableId ? parseInt(req.query.responsableId) : null),
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// GET /api/sales/paises — de donde vienen las ventas y los leads.
// Se reusa el ranking de los informes en vez de escribir aqui otra definicion
// de pais: es la que ya esta verificada y la que salta de prefijo telefonico.
export async function paises(req, res, next) {
  try {
    const f = filtrosDeQuery(req);
    const hoy = new Date().toISOString().slice(0, 10);
    const data = await reportModel.paisesMasVendidos({
      projectId: f.projectId,
      from: f.from || `${new Date().getFullYear()}-01-01`,
      to: f.to || hoy,
      asesoraId: f.responsableId,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// GET /api/sales/serie?projectId&from&to — serie del periodo, el anterior para
// comparar, y el historial mes a mes. Una gestora solo ve lo suyo: el recorte
// lo pone filtrosDeQuery, no el cliente.
export async function serieVentas(req, res, next) {
  try {
    res.json({ success: true, data: await salesService.getSerieVentas(filtrosDeQuery(req)) });
  } catch (err) { next(err); }
}
