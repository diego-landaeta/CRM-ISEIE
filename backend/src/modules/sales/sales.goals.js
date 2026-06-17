// Metas de venta + estadísticas por gestor.
import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';

function currentPeriodo() {
  // Server timezone — para CRM single-tenant es suficiente.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Ventas + facturación por gestor para un periodo dado (default: mes actual).
 * Si projectId, filtra a ese proyecto.
 * Devuelve también la meta cuando existe.
 */
export async function getGestoresStats({ projectId = null, periodo = null } = {}) {
  // periodo='all' → todas las ventas (sin filtro de mes). Default = mes actual.
  const allTime = periodo === 'all';
  const per = allTime ? null : (periodo || currentPeriodo());
  const params = allTime ? [] : [per];

  const projectFilter = projectId ? `AND c.project_id = $${params.push(projectId)}` : '';
  const projectGoalFilter = projectId ? `AND (g.project_id = $${params.length} OR g.project_id IS NULL)` : '';
  const userProjectJoin = projectId
    ? `JOIN user_projects up ON up.user_id = u.id AND up.project_id = $${params.length} AND up.active = TRUE`
    : '';

  const dateFilter = allTime ? '' : `AND TO_CHAR(c.fecha_conversion, 'YYYY-MM') = $1`;

  const { rows: stats } = await query(
    `SELECT u.id AS user_id, u.nombre, u.email, u.role, u.is_available,
            COUNT(c.id)::int AS ventas,
            COALESCE(SUM(c.importe_total), 0)::numeric AS facturado,
            COALESCE(SUM(c.importe_pagado), 0)::numeric AS cobrado
     FROM users u
     ${userProjectJoin}
     LEFT JOIN leads l ON l.responsable_id = u.id
     LEFT JOIN conversions c ON c.lead_id = l.id
       ${dateFilter}
       ${projectFilter}
     WHERE u.active = TRUE AND u.role IN ('gestor', 'admin', 'superadmin')
     GROUP BY u.id, u.nombre, u.email, u.role, u.is_available
     ORDER BY ventas DESC, facturado DESC`,
    params
  );

  // Metas: solo si NO es vista all-time (metas son siempre mensuales)
  let goalByUser = {};
  if (!allTime) {
    const goalsParams = [per];
    const { rows: goals } = await query(
      `SELECT g.user_id, g.meta_ventas, g.meta_facturacion, g.notas, g.set_by_user_id,
              su.nombre AS set_by_nombre
       FROM sales_goals g
       LEFT JOIN users su ON su.id = g.set_by_user_id
       WHERE g.periodo_yyyymm = $1 ${projectGoalFilter}`,
      projectId ? [...goalsParams, projectId] : goalsParams
    );
    goalByUser = Object.fromEntries(goals.map((g) => [g.user_id, g]));
  }

  return {
    periodo: per,
    project_id: projectId,
    gestores: stats.map((s) => {
      const g = goalByUser[s.user_id] || null;
      const ventas = Number(s.ventas);
      const facturado = Number(s.facturado);
      return {
        user_id: s.user_id,
        nombre: s.nombre,
        email: s.email,
        role: s.role,
        is_available: s.is_available,
        ventas,
        facturado,
        cobrado: Number(s.cobrado),
        meta_ventas: g ? Number(g.meta_ventas) : null,
        meta_facturacion: g ? Number(g.meta_facturacion) : null,
        meta_set_by: g?.set_by_nombre || null,
        meta_notas: g?.notas || null,
        progreso_ventas_pct: g && g.meta_ventas > 0 ? Math.min(100, Math.round((ventas / Number(g.meta_ventas)) * 100)) : null,
        progreso_facturacion_pct: g && Number(g.meta_facturacion) > 0 ? Math.min(100, Math.round((facturado / Number(g.meta_facturacion)) * 100)) : null,
      };
    }),
  };
}

/**
 * Stats del gestor actual (vista personal del gestor / admin para sí mismo).
 */
export async function getMyStats(userId, { projectId = null, periodo = null } = {}) {
  const per = periodo || currentPeriodo();
  const all = await getGestoresStats({ projectId, periodo: per });
  const me = all.gestores.find((g) => g.user_id === userId);
  return me || { user_id: userId, ventas: 0, facturado: 0, cobrado: 0, meta_ventas: null, meta_facturacion: null, periodo: per };
}

/**
 * UPSERT de meta para un usuario.
 * - Si actor.role === 'gestor', solo puede setear su propia meta.
 * - Admin/superadmin puede setear cualquiera.
 */
export async function setGoal({ user_id, project_id = null, periodo_yyyymm, meta_ventas, meta_facturacion, notas = null }, actor) {
  if (!actor) throw new AppError('Auth requerida', 401, 'AUTH_REQUIRED');
  if (actor.role === 'gestor' && actor.userId !== user_id) {
    throw new AppError('Un gestor solo puede setear su propia meta', 403, 'FORBIDDEN');
  }
  if (!periodo_yyyymm || !/^\d{4}-\d{2}$/.test(periodo_yyyymm)) {
    throw new AppError('periodo_yyyymm requerido formato YYYY-MM', 400, 'INVALID_PERIODO');
  }
  if (meta_ventas == null || meta_ventas < 0) throw new AppError('meta_ventas invalida', 400, 'INVALID_META');
  if (meta_facturacion == null || meta_facturacion < 0) throw new AppError('meta_facturacion invalida', 400, 'INVALID_META');

  const { rows } = await query(
    `INSERT INTO sales_goals (user_id, project_id, periodo_yyyymm, meta_ventas, meta_facturacion, set_by_user_id, notas)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, project_id, periodo_yyyymm)
     DO UPDATE SET meta_ventas = EXCLUDED.meta_ventas,
                   meta_facturacion = EXCLUDED.meta_facturacion,
                   set_by_user_id = EXCLUDED.set_by_user_id,
                   notas = EXCLUDED.notas,
                   updated_at = NOW()
     RETURNING *`,
    [user_id, project_id, periodo_yyyymm, meta_ventas, meta_facturacion, actor.userId, notas]
  );
  return rows[0];
}

export async function deleteGoal(id, actor) {
  if (actor.role === 'gestor') {
    // Gestor solo puede borrar la suya
    const { rowCount } = await query(`DELETE FROM sales_goals WHERE id = $1 AND user_id = $2`, [id, actor.userId]);
    if (rowCount === 0) throw new AppError('Meta no encontrada o sin permisos', 404, 'NOT_FOUND');
  } else {
    const { rowCount } = await query(`DELETE FROM sales_goals WHERE id = $1`, [id]);
    if (rowCount === 0) throw new AppError('Meta no encontrada', 404, 'NOT_FOUND');
  }
  return { deleted: true };
}
