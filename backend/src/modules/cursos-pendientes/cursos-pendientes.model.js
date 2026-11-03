import { query } from '../../shared/config/db.js';

/**
 * Cursos pendientes (#336): SQL de las tablas `cursos_pendientes*` (migración 217).
 * Las reglas —quién puede qué, qué transiciones valen, los avisos— viven en
 * `cursos-pendientes.service.js`. Aquí solo se lee y se escribe.
 */

/**
 * «Retrasado» NO es un estado: sale solo cuando la fecha comprometida ya pasó y
 * el curso no está publicado. Se calcula al leer, con el día de la zona de la app.
 */
const TZ = process.env.APP_TIMEZONE || 'Europe/Madrid';
const HOY = `(now() AT TIME ZONE '${TZ}')::date`;

const COLUMNAS = `
  c.id, c.project_id, p.nombre AS campus, c.product_id, c.nombre, c.url_prevista, c.tipo,
  c.tutor_id, ut.nombre AS tutora, c.estado, c.fecha_solicitud, c.fecha_comprometida, c.fecha_publicacion,
  c.veces_movida_fecha, c.avance_foto, c.avance_video, c.avance_modulos, c.url_publicada, c.notas,
  c.created_at, c.updated_at,
  (c.fecha_comprometida IS NOT NULL AND c.fecha_comprometida < ${HOY}
     AND c.estado IN ('pendiente_asignar', 'asignado', 'en_desarrollo')) AS retrasado,
  CASE WHEN c.fecha_comprometida IS NULL THEN NULL ELSE (c.fecha_comprometida - ${HOY}) END AS dias_para_la_fecha,
  (SELECT count(*)::int FROM cursos_pendientes_alumnas a WHERE a.curso_id = c.id AND a.estado = 'en_espera') AS alumnas_esperando,
  (SELECT count(*)::int FROM cursos_pendientes_alumnas a WHERE a.curso_id = c.id) AS alumnas_total`;

const DESDE = `
  FROM cursos_pendientes c
  JOIN projects p ON p.id = c.project_id
  LEFT JOIN users ut ON ut.id = c.tutor_id`;

/**
 * La lista. `projectIds`: los campus permitidos (null = todos). `tutorId`: solo
 * los de una tutora (una tutora solo ve los suyos, y lo impone el servicio).
 */
export async function listar({ projectIds = null, tutorId = null, estado = null, abiertos = null, soloRetrasados = false, tipo = null }) {
  const params = [];
  const cond = [];
  if (projectIds) { params.push(projectIds); cond.push(`c.project_id = ANY($${params.length}::int[])`); }
  if (tutorId) { params.push(tutorId); cond.push(`c.tutor_id = $${params.length}`); }
  if (estado) { params.push(estado); cond.push(`c.estado = $${params.length}`); }
  if (tipo) { params.push(tipo); cond.push(`c.tipo = $${params.length}`); }
  if (abiertos === true) cond.push(`c.estado NOT IN ('cerrado', 'cancelado')`);
  if (abiertos === false) cond.push(`c.estado IN ('cerrado', 'cancelado')`);
  if (soloRetrasados) cond.push(`c.fecha_comprometida < ${HOY} AND c.estado IN ('pendiente_asignar', 'asignado', 'en_desarrollo')`);
  const { rows } = await query(
    `SELECT ${COLUMNAS} ${DESDE}
      ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
      ORDER BY (c.estado IN ('cerrado', 'cancelado')), c.fecha_comprometida NULLS LAST, c.created_at`,
    params
  );
  return rows;
}

export async function porId(id) {
  const { rows } = await query(`SELECT ${COLUMNAS} ${DESDE} WHERE c.id = $1`, [id]);
  return rows[0] || null;
}

/**
 * Los contadores de cada campus, INCLUIDOS los que no tienen ninguno (con 0): que
 * se vea que está al día. Solo los de `projectIds`.
 */
export async function resumenPorCampus({ projectIds = null, tutorId = null }) {
  const params = [];
  const cond = [`NOT p.es_prueba`];
  if (projectIds) { params.push(projectIds); cond.push(`p.id = ANY($${params.length}::int[])`); }
  let filtroTutor = '';
  if (tutorId) { params.push(tutorId); filtroTutor = `AND c.tutor_id = $${params.length}`; }
  const { rows } = await query(
    `SELECT p.id AS project_id, p.nombre AS campus,
            count(c.id) FILTER (WHERE c.estado NOT IN ('cerrado', 'cancelado'))::int AS abiertos,
            count(c.id) FILTER (WHERE c.fecha_comprometida < ${HOY} AND c.estado IN ('pendiente_asignar', 'asignado', 'en_desarrollo'))::int AS retrasados,
            count(c.id) FILTER (WHERE c.estado = 'pendiente_asignar')::int AS sin_tutora,
            COALESCE(SUM((SELECT count(*) FROM cursos_pendientes_alumnas a WHERE a.curso_id = c.id AND a.estado = 'en_espera')
                         ) FILTER (WHERE c.estado NOT IN ('cerrado', 'cancelado')), 0)::int AS alumnas_esperando
       FROM projects p
       LEFT JOIN cursos_pendientes c ON c.project_id = p.id ${filtroTutor}
      WHERE ${cond.join(' AND ')} AND p.active
      GROUP BY p.id, p.nombre
      ORDER BY p.nombre`,
    params
  );
  return rows;
}

/** La carga de cada tutora: cursos abiertos por tipo (un máster pesa más). */
export async function cargaPorTutora({ projectIds = null }) {
  const params = [];
  let cond = `c.estado NOT IN ('cerrado', 'cancelado') AND c.tutor_id IS NOT NULL`;
  if (projectIds) { params.push(projectIds); cond += ` AND c.project_id = ANY($${params.length}::int[])`; }
  const { rows } = await query(
    `SELECT c.tutor_id, u.nombre AS tutora,
            count(*)::int AS abiertos,
            count(*) FILTER (WHERE c.tipo = 'curso')::int AS cursos,
            count(*) FILTER (WHERE c.tipo = 'diplomado')::int AS diplomados,
            count(*) FILTER (WHERE c.tipo = 'master')::int AS masters,
            count(*) FILTER (WHERE c.fecha_comprometida < ${HOY} AND c.estado IN ('asignado', 'en_desarrollo'))::int AS retrasados
       FROM cursos_pendientes c JOIN users u ON u.id = c.tutor_id
      WHERE ${cond}
      GROUP BY c.tutor_id, u.nombre
      ORDER BY abiertos DESC, u.nombre`,
    params
  );
  return rows;
}

/**
 * Los indicadores de supervisión que se pueden dar ya: el tiempo medio desde la
 * venta hasta que la alumna queda habilitada, y los publicados con alguien sin
 * habilitar más de 48 h. Por campus.
 */
export async function indicadores({ projectIds = null }) {
  const params = [];
  let proyecto = '';
  if (projectIds) { params.push(projectIds); proyecto = `AND c.project_id = ANY($${params.length}::int[])`; }
  const { rows } = await query(
    `SELECT p.id AS project_id, p.nombre AS campus,
            ROUND(AVG(EXTRACT(EPOCH FROM (a.habilitada_at - COALESCE(cv.created_at, a.created_at))) / 86400)
                  FILTER (WHERE a.estado = 'habilitada' AND a.habilitada_at IS NOT NULL)::numeric, 1) AS dias_medios_venta_a_habilitada,
            count(DISTINCT c.id) FILTER (
              WHERE c.estado = 'publicado' AND a.estado = 'en_espera'
                AND (c.fecha_publicacion + 2) < ((now() AT TIME ZONE '${TZ}')::date))::int AS publicados_sin_habilitar
       FROM cursos_pendientes c
       JOIN projects p ON p.id = c.project_id
       LEFT JOIN cursos_pendientes_alumnas a ON a.curso_id = c.id
       LEFT JOIN conversions cv ON cv.id = a.conversion_id
      WHERE true ${proyecto}
      GROUP BY p.id, p.nombre
      ORDER BY p.nombre`,
    params
  );
  return rows;
}

/** Las alumnas de un pendiente, con lo que sale de su ficha y de su venta. */
export async function alumnasDe(cursoId) {
  const { rows } = await query(
    `SELECT a.id, a.curso_id, a.lead_id, l.nombre, l.email, l.telefono,
            a.conversion_id, cv.created_at AS fecha_compra, cv.importe_total AS importe,
            a.estado, a.avisada, a.avisada_at, a.habilitada_at, uh.nombre AS habilitada_por, a.created_at,
            (COALESCE(l.email, '') = '' OR COALESCE(l.telefono, '') = '') AS falta_contacto
       FROM cursos_pendientes_alumnas a
       JOIN leads l ON l.id = a.lead_id
       LEFT JOIN conversions cv ON cv.id = a.conversion_id
       LEFT JOIN users uh ON uh.id = a.habilitada_por
      WHERE a.curso_id = $1
      ORDER BY a.created_at`,
    [cursoId]
  );
  return rows;
}

export async function historialDe(cursoId) {
  const { rows } = await query(
    `SELECT h.id, h.accion, h.detalle, h.motivo, h.created_at, u.nombre AS persona
       FROM cursos_pendientes_historial h LEFT JOIN users u ON u.id = h.user_id
      WHERE h.curso_id = $1 ORDER BY h.created_at DESC, h.id DESC`,
    [cursoId]
  );
  return rows;
}

export async function apuntar(cursoId, userId, accion, detalle = {}, motivo = null, cli = null) {
  const q = cli ? cli.query.bind(cli) : query;
  await q(
    `INSERT INTO cursos_pendientes_historial (curso_id, user_id, accion, detalle, motivo) VALUES ($1, $2, $3, $4, $5)`,
    [cursoId, userId, accion, JSON.stringify(detalle), motivo]
  );
}

/** El pendiente ABIERTO de esa formación en ese campus, si lo hay (por ficha o por nombre). */
export async function abiertoDe({ projectId, productId = null, nombre }) {
  const { rows } = await query(
    `SELECT id FROM cursos_pendientes
      WHERE project_id = $1 AND estado NOT IN ('cerrado', 'cancelado')
        AND (($2::int IS NOT NULL AND product_id = $2) OR lower(nombre) = lower($3))
      ORDER BY id LIMIT 1`,
    [projectId, productId, nombre]
  );
  return rows[0]?.id || null;
}

/** Los dominios del campus: los de los enlaces de sus formaciones. */
export async function dominiosDelCampus(projectId) {
  const { rows } = await query(
    `SELECT DISTINCT lower(substring(url_info from '^https?://([^/:?#]+)')) AS host
       FROM products WHERE project_id = $1 AND COALESCE(url_info, '') <> ''`,
    [projectId]
  );
  return rows.map((r) => String(r.host || '').replace(/^www\./, '')).filter(Boolean);
}

/** Admins del campus (y los super admin) a quienes avisar. */
export async function adminsDelCampus(projectId) {
  const { rows } = await query(
    `SELECT DISTINCT u.id FROM users u
      WHERE u.active AND (u.role = 'superadmin'
         OR (u.role = 'admin' AND EXISTS (SELECT 1 FROM user_projects up WHERE up.user_id = u.id AND up.project_id = $1 AND up.active)))`,
    [projectId]
  );
  return rows.map((r) => r.id);
}
