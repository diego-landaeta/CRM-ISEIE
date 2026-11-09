import * as model from './accounting.model.js';
import { proyectosDelAmbito } from '../../shared/utils/ambito.js';
import { accountingDashboardSchema } from './accounting.validation.js';
import { AppError } from '../../shared/utils/AppError.js';
import { alcanceComercial, alcanceDeLider, personasDentro } from '../../shared/utils/roles.js';

// GET /accounting/receivable — cuentas por cobrar con filtros gestora/proyecto/periodo.
// El gestor solo ve las suyas (se fuerza su responsableId).
export async function receivable(req, res, next) {
  try {
    const projectId = req.query.projectId ? Number(req.query.projectId) : null;
    let responsableId = req.query.responsableId ? Number(req.query.responsableId) : null;
    // seguridad; con equipo comercial (09/11/2026), las suyas y las de sus gestoras
    const alcance = await alcanceComercial(req.user);
    if (alcance) responsableId = personasDentro(alcance, responsableId);
    const from = req.query.from || null;
    const to = req.query.to || null;
    const data = await model.getReceivable({ projectId, responsableId, from, to });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// ---------- DASHBOARD ----------

export async function dashboard(req, res, next) {
  try {
    const parsed = accountingDashboardSchema.safeParse(req.query);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    // El ambito se resuelve igual que en el resto de pantallas de cifras.
    const { projectId, projectIds } = await proyectosDelAmbito(req);
    // Una administradora que lleva equipo comercial (QA del 09/11/2026): lo de
    // gestoras, solo lo suyo y lo de su equipo; egresos y balance, no (son de
    // la empresa). Una admin sin equipo y el superadmin, como siempre; quien
    // más tiene `accounting.view` de serie (project manager), también.
    const personas = await alcanceDeLider(req.user);
    const stats = await model.getDashboardStats({ ...parsed.data, projectId, projectIds, personas });
    res.json({ success: true, data: stats });
  } catch (err) { next(err); }
}
