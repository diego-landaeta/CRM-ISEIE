// Metas de venta + estadísticas por gestor.
import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { comoLista, SIN_PRUEBAS, campusDeLaPersona } from '../../shared/utils/ambito.js';
import { alcanceComercial, dentroDelAlcance } from '../../shared/utils/roles.js';

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
export async function getGestoresStats({
  projectId = null, projectIds = null, periodo = null, from = null, to = null,
} = {}) {
  // periodo='all' → todas las ventas (sin filtro de mes). Default = mes actual.
  const allTime = periodo === 'all';
  const per = allTime ? null : (periodo || currentPeriodo());
  // Las FECHAS mandan sobre el mes: si la pantalla mira un dia, la tabla tiene
  // que enseñar ESE dia y no el mes entero. Las metas siguen siendo mensuales.
  const porFechas = Boolean(from && to);
  const params = [];

  // Un campus o una lista (los suyos): `comoLista` deja los dos casos en una.
  const lista = comoLista(projectId, projectIds);
  const projectFilter = lista
    ? `AND c.project_id = ANY($${params.push(lista)}::int[])`
    // Sin proyecto elegido, «todos» no incluye el de pruebas: ventas
    // inventadas no pueden aparecer en el total de nadie. Hoy ISEIE no tiene
    // ninguno, pero se escribe igual que en el CRM hermano.
    : `AND ${SIN_PRUEBAS('c.project_id')}`;
  const idxProyecto = lista ? params.length : null;
  /*
    Quien sale en la tabla: quien trabaja en ese proyecto.

    CON *EXISTS* Y NO CON *JOIN*: un JOIN devuelve una fila por cada asignacion
    y, al agrupar y sumar, cada venta se contaria tantas veces como asignaciones
    tenga la persona. Aqui no se notaba porque solo hay un proyecto, pero en el
    CRM hermano --con sociedades de siete campus-- las 2 ventas de una gestora
    salian como 14. Se escribe igual en los dos para que no vuelva a pasar.
  */
  const userProjectJoin = lista
    ? `AND EXISTS (SELECT 1 FROM user_projects up
                    WHERE up.user_id = u.id AND up.active = TRUE
                      AND up.project_id = ANY($${idxProyecto}::int[]))`
    : '';

  let dateFilter = '';
  if (porFechas) {
    dateFilter = `AND c.fecha_conversion >= $${params.push(from)}`
      + ` AND c.fecha_conversion <= $${params.push(to)}`;
  } else if (!allTime) {
    dateFilter = `AND TO_CHAR(c.fecha_conversion, 'YYYY-MM') = $${params.push(per)}`;
  }

  /*
    Quien RECIBE LEADS en estos proyectos. Es la misma regla que el reparto
    (lead.model.js): disponible, sin colaboraciones, y si es admin o superadmin
    solo con `recibe_leads` marcado en el proyecto.

    Diego: «solo los gestores que reciben leads en esos proyectos que aparezcan».
    La tabla sacaba a todos los admins y superadmins a cero, y a quien lleva
    colaboraciones: seis filas para dos personas que venden.
  */
  const RECIBE = `(u.is_available = TRUE
        AND NOT COALESCE(u.gestor_colaboraciones, false)
        AND EXISTS (SELECT 1 FROM user_projects up
                     WHERE up.user_id = u.id AND up.active = TRUE
                       AND ${idxProyecto ? `up.project_id = ANY($${idxProyecto}::int[])` : SIN_PRUEBAS('up.project_id')}
                       AND (u.role = 'gestor' OR (u.role IN ('admin','superadmin') AND up.recibe_leads = TRUE))))`;

  const { rows: stats } = await query(
    `SELECT u.id AS user_id, u.nombre, u.email, u.role, u.is_available,
            ${RECIBE} AS recibe_leads,
            -- SUM(peso) y no COUNT(*): una venta repartida entre dos vale media
            -- para cada una. Asi la suma de la tabla sigue dando el total real
            -- de la empresa en vez de contar la misma venta dos veces.
            COALESCE(SUM(c.peso), 0)::numeric AS ventas,
            COUNT(*) FILTER (WHERE c.compartida)::int AS compartidas,
            COALESCE(SUM(c.importe_total * c.peso), 0)::numeric AS facturado,
            COALESCE(SUM(c.importe_pagado * c.peso), 0)::numeric AS cobrado
     FROM users u
     -- La venta es de QUIEN LA VENDIO, no de quien lleva la ficha, y puede ser
     -- de DOS personas a la vez.
     --
     -- Iba por leads.responsable_id a secas, y eso ignora vendedora_id: una
     -- venta que cerro otra persona se le apuntaba a la gestora del prospecto.
     -- Ese COALESCE estaba repetido por todo el CRM y de ahi venia que varias
     -- pantallas dieran numeros distintos para la misma pregunta. Ahora la
     -- regla vive UNA sola vez, en la vista conversion_reparto: una fila por
     -- venta y gestora, con su peso, y SUM(peso)=1 por venta siempre.
     LEFT JOIN conversion_reparto c ON c.vendedora_id = u.id
       ${dateFilter}
       ${projectFilter}
     WHERE u.active = TRUE AND u.role IN ('gestor', 'admin', 'superadmin')
       ${userProjectJoin}
     GROUP BY u.id, u.nombre, u.email, u.role, u.is_available, u.gestor_colaboraciones
     ORDER BY ventas DESC, facturado DESC`,
    params
  );

  // Metas: solo si NO es vista all-time (metas son siempre mensuales)
  let goalByUser = {};
  if (!allTime) {
    const goalsParams = [per];
    const projectGoalFilter = lista
      ? `AND (g.project_id = ANY($2::int[]) OR g.project_id IS NULL)` : '';
    const { rows: goals } = await query(
      `SELECT g.user_id, g.meta_ventas, g.meta_facturacion, g.notas, g.set_by_user_id,
              su.nombre AS set_by_nombre
       FROM sales_goals g
       LEFT JOIN users su ON su.id = g.set_by_user_id
       WHERE g.periodo_yyyymm = $1 ${projectGoalFilter}`,
      lista ? [...goalsParams, lista] : goalsParams
    );
    goalByUser = Object.fromEntries(goals.map((g) => [g.user_id, g]));
  }

  return {
    periodo: per,
    // Lo que de verdad se ha contado, para que la pantalla no titule un mes
    // cuando esta enseñando un dia.
    desde: porFechas ? from : null,
    hasta: porFechas ? to : null,
    project_id: projectId,
    // Quien no recibe leads aqui Y no vendio en el periodo, fuera. Quien vendio
    // se queda aunque ya no reciba: su venta es real y no se esconde.
    gestores: stats.filter((s) => s.recibe_leads || Number(s.ventas) > 0).map((s) => {
      const g = goalByUser[s.user_id] || null;
      const ventas = Number(s.ventas);
      const facturado = Number(s.facturado);
      return {
        user_id: s.user_id,
        nombre: s.nombre,
        email: s.email,
        role: s.role,
        is_available: s.is_available,
        recibe_leads: Boolean(s.recibe_leads),
        // Puede traer media venta (3,5) cuando alguna esta repartida. La
        // pantalla solo enseña el decimal cuando lo hay.
        ventas,
        // Cuantas de esas ventas comparte con otra persona. Es metrica de la
        // gestora, no de la empresa: la venta sigue siendo una.
        compartidas: Number(s.compartidas) || 0,
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
 * ¿Puede `actor` tocar la meta de `userId` en `projectId` (null = la de todos sus campus)?
 *
 *   · superadmin: cualquiera.
 *   · admin y gestor: solo en SUS campus. Un campus que no es suyo no vale, y un admin solo
 *     toca metas de gente con la que comparte algún campus (antes, un admin de CEDIA podía
 *     fijar o borrar la meta de cualquiera de otra empresa, con solo cambiar el id).
 *   · el gestor, además, solo la suya (eso ya lo comprueba quien llama).
 */
async function puedeTocar(actor, { userId, projectId }) {
  if (actor.role === 'superadmin') return true;
  const mios = await campusDeLaPersona(actor.userId);
  if (!mios.length) return false;
  if (projectId != null && !mios.includes(Number(projectId))) return false;
  if (Number(userId) === Number(actor.userId)) return true;
  const { rows } = await query(
    `SELECT 1 FROM user_projects WHERE user_id = $1 AND active = true AND project_id = ANY($2::int[]) LIMIT 1`,
    [userId, mios]);
  return rows.length > 0;
}

/**
 * UPSERT de meta para un usuario.
 * - Si actor.role === 'gestor', solo puede setear su propia meta.
 * - Admin: la de la gente de sus campus, y solo en sus campus. Superadmin: cualquiera.
 */
export async function setGoal({ user_id, project_id = null, periodo_yyyymm, meta_ventas, meta_facturacion, notas = null }, actor) {
  if (!actor) throw new AppError('Auth requerida', 401, 'AUTH_REQUIRED');
  // Con equipo comercial (09/11/2026): la suya y las de sus gestoras.
  if (!dentroDelAlcance(await alcanceComercial(actor), user_id)) {
    throw new AppError('Un gestor solo puede setear su propia meta', 403, 'FORBIDDEN');
  }
  if (!(await puedeTocar(actor, { userId: user_id, projectId: project_id }))) {
    throw new AppError('Esa meta no es de tus campus', 403, 'FORBIDDEN');
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
  const { rows: [meta] } = await query(`SELECT user_id, project_id FROM sales_goals WHERE id = $1`, [id]);
  // Una meta que no es de tus campus es «no encontrada», igual que una que no existe: no se
  // le dice a nadie qué ids hay en otra empresa.
  const suya = meta && dentroDelAlcance(await alcanceComercial(actor), meta.user_id);
  if (!suya || !(await puedeTocar(actor, { userId: meta.user_id, projectId: meta.project_id }))) {
    throw new AppError('Meta no encontrada o sin permisos', 404, 'NOT_FOUND');
  }
  await query(`DELETE FROM sales_goals WHERE id = $1`, [id]);
  return { deleted: true };
}
