import { query } from '../../shared/config/db.js';
import { COBRADO_DE } from '../conversions/cobrado.js';
import { ZONA, horaDelDiaAnterior, campusDeLaLista } from './matricula-moodle.config.js';

/**
 * Matrícula automática en Moodle (#767) · las consultas.
 *
 * Las que se llaman desde un cobro reciben `db`: el cliente de la transacción
 * del cobro. Así la matrícula se programa o se cancela A LA VEZ que el pago
 * entra o se va; si el cobro se deshace, la matrícula también.
 */

const ACTIVAS = `('programada', 'lista', 'fallo')`;

/**
 * Cuándo toca matricular: el día anterior al inicio, a la hora configurada en
 * Madrid. Sin fecha de inicio, o si ese momento ya pasó, `base` (al pagar).
 * `base` es NOW() al programar y `created_at` al revisar la fecha: así el
 * valor no se mueve solo cada hora.
 */
export const MOMENTO_SQL = (fecha, base) => {
  const h = horaDelDiaAnterior(); // entero validado (0-23)
  return `CASE WHEN ${fecha} IS NULL THEN ${base}
               ELSE GREATEST(${base}, ((${fecha} - 1) + make_time(${h}, 0, 0)) AT TIME ZONE '${ZONA}') END`;
};

/** Filtro del interruptor por campus. Devuelve [sql, params] a partir de `$n`. */
function filtroDeCampus(aliasProyecto, n) {
  const lista = campusDeLaLista();
  if (!lista.length) return ['', []];
  return [` AND (${aliasProyecto}.id::text = ANY($${n}::text[]) OR lower(${aliasProyecto}.slug) = ANY($${n}::text[]))`, [lista]];
}

/**
 * Programa la matrícula de la venta, si no tiene ya una vigente. Devuelve la
 * fila creada o null (ya había una, la venta no existe o su campus no está en
 * la lista del interruptor).
 */
export async function programar(db, conversionId) {
  const [campus, extra] = filtroDeCampus('p', 2);
  const { rows } = await db.query(
    `INSERT INTO matriculas_moodle (conversion_id, lead_id, project_id, programada_para)
     SELECT c.id, c.lead_id, c.project_id, ${MOMENTO_SQL('c.fecha_inicio', 'NOW()')}
       FROM conversions c
       JOIN projects p ON p.id = c.project_id
      WHERE c.id = $1${campus}
        -- Las plataformas de IA no son campus: no tienen Moodle (como en el panel, #335).
        AND COALESCE(p.type::text, '') <> 'ia'
        AND NOT EXISTS (SELECT 1 FROM matriculas_moodle m
                         WHERE m.conversion_id = c.id AND m.estado <> 'cancelada')
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [conversionId, ...extra]
  );
  return rows[0] || null;
}

/**
 * Cancela la matrícula vigente de la venta (la que aún no está hecha en
 * Moodle). Una «hecha» no se toca: quitarle el acceso a quien ya está dentro
 * es una decisión pendiente (qué pasa si deja de pagar).
 */
export async function cancelarVigentes(db, conversionId, motivo) {
  const { rows } = await db.query(
    `UPDATE matriculas_moodle
        SET estado = 'cancelada', cancelada_at = NOW(), motivo = $2,
            proximo_intento_at = NULL, updated_at = NOW()
      WHERE conversion_id = $1 AND estado IN ${ACTIVAS}
      RETURNING id`,
    [conversionId, motivo]
  );
  return rows.map((r) => r.id);
}

/**
 * Si la fecha de inicio de la venta ha cambiado desde que se programó, la
 * matrícula se mueve con ella. Solo las que aún esperan.
 */
export async function ajustarFechas() {
  const { rowCount } = await query(
    `UPDATE matriculas_moodle m
        SET programada_para = x.momento, updated_at = NOW()
       FROM (SELECT m2.id, ${MOMENTO_SQL('c.fecha_inicio', 'm2.created_at')} AS momento
               FROM matriculas_moodle m2 JOIN conversions c ON c.id = m2.conversion_id
              WHERE m2.estado = 'programada') x
      WHERE m.id = x.id AND m.programada_para IS DISTINCT FROM x.momento`
  );
  return rowCount;
}

/** Las que ya toca hacer (o reintentar), con lo que hace falta para hacerlas. */
export async function pendientes(limite = 200) {
  const [campus, extra] = filtroDeCampus('p', 2);
  const { rows } = await query(
    `SELECT m.*, c.id AS venta_id, c.fecha_inicio, c.producto_contratado_id,
            CASE WHEN c.id IS NULL THEN 0 ELSE ${COBRADO_DE('c')} END AS cobrado,
            l.nombre AS alumno_nombre, l.email AS alumno_email,
            p.nombre AS campus_nombre
       FROM matriculas_moodle m
       JOIN projects p ON p.id = m.project_id
       LEFT JOIN conversions c ON c.id = m.conversion_id
       LEFT JOIN leads l ON l.id = m.lead_id
      WHERE m.estado = 'programada'
        AND m.programada_para <= NOW()
        AND (m.proximo_intento_at IS NULL OR m.proximo_intento_at <= NOW())${campus}
      ORDER BY m.programada_para, m.id
      LIMIT $1`,
    [limite, ...extra]
  );
  return rows;
}

/**
 * Los productos de la venta (el de la venta y los de sus líneas) con sus
 * cursos de Moodle. Un producto sin curso sale con `cursos: []`.
 */
export async function productosConCursos(conversionId) {
  const { rows } = await query(
    `WITH prods AS (
       SELECT producto_contratado_id AS product_id FROM conversions
        WHERE id = $1 AND producto_contratado_id IS NOT NULL
       UNION
       SELECT product_id FROM conversion_items
        WHERE conversion_id = $1 AND product_id IS NOT NULL
     )
     SELECT pr.id, pr.nombre,
            COALESCE(json_agg(json_build_object(
                       'project_id', mc.project_id,
                       'curso_moodle_id', mc.curso_moodle_id,
                       'curso_nombre', mc.curso_nombre)
                     ORDER BY mc.project_id, mc.curso_moodle_id)
                     FILTER (WHERE mc.product_id IS NOT NULL), '[]') AS cursos
       FROM prods JOIN products pr ON pr.id = prods.product_id
       LEFT JOIN moodle_cursos_producto mc ON mc.product_id = pr.id
      GROUP BY pr.id, pr.nombre
      ORDER BY pr.id`,
    [conversionId]
  );
  return rows;
}

/** Solo si sigue en el estado que se leyó: dos vueltas a la vez no la pisan. */
export async function marcarLista(id, cursos) {
  const { rows } = await query(
    `UPDATE matriculas_moodle
        SET estado = 'lista', lista_at = NOW(), cursos = $2::jsonb, motivo = NULL,
            intentos = intentos + 1, proximo_intento_at = NULL, updated_at = NOW()
      WHERE id = $1 AND estado = 'programada'
      RETURNING *`,
    [id, JSON.stringify(cursos)]
  );
  return rows[0] || null;
}

/** Fase 2: hecha en Moodle. */
export async function marcarHecha(id, { cursos, moodleUserId = null }) {
  const { rows } = await query(
    `UPDATE matriculas_moodle
        SET estado = 'hecha', hecha_at = NOW(), cursos = $2::jsonb, moodle_user_id = $3,
            motivo = NULL, intentos = intentos + 1, proximo_intento_at = NULL, updated_at = NOW()
      WHERE id = $1 AND estado = 'programada'
      RETURNING *`,
    [id, JSON.stringify(cursos), moodleUserId]
  );
  return rows[0] || null;
}

/**
 * Un intento que no salió. Con intentos de sobra, se reintenta en `minutos`;
 * al llegar al tope, queda en «fallo».
 */
export async function anotarFallo(id, motivo, { maximo, minutos = 60 }) {
  const { rows } = await query(
    `UPDATE matriculas_moodle
        SET intentos = intentos + 1, motivo = $2,
            estado = CASE WHEN intentos + 1 >= $3 THEN 'fallo' ELSE 'programada' END,
            proximo_intento_at = CASE WHEN intentos + 1 >= $3 THEN NULL
                                      ELSE NOW() + make_interval(mins => $4::int) END,
            updated_at = NOW()
      WHERE id = $1 AND estado = 'programada'
      RETURNING *`,
    [id, motivo, maximo, minutos]
  );
  return rows[0] || null;
}

export async function cancelar(id, motivo) {
  const { rows } = await query(
    `UPDATE matriculas_moodle
        SET estado = 'cancelada', cancelada_at = NOW(), motivo = $2,
            proximo_intento_at = NULL, updated_at = NOW()
      WHERE id = $1 AND estado = 'programada'
      RETURNING *`,
    [id, motivo]
  );
  return rows[0] || null;
}

/** Administración del campus: sus admins y los super admin. */
export async function adminsDelCampus(projectId) {
  const { rows } = await query(
    `SELECT DISTINCT u.id FROM users u
      WHERE u.active AND (u.role = 'superadmin'
         OR (u.role = 'admin' AND EXISTS (SELECT 1 FROM user_projects up
                                           WHERE up.user_id = u.id AND up.project_id = $1 AND up.active)))`,
    [projectId]
  );
  return rows.map((r) => r.id);
}
