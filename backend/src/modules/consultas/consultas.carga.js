/*
  CONSULTAS DE ALUMNOS · FASE 3 (#189): «Mi carga de trabajo» y el panel de
  tutores para administración.

  Cada tutor escribe en qué está trabajando y un nivel (baja · media · alta ·
  completa). Se guarda cada cambio (historial) y, al lado, el CRM pone sus datos
  reales: alumnos activos, consultas abiertas y alumnos sin mensajes. Si pasa
  el plazo sin actualizarla (una semana, decisión 9), se marca «desactualizada».
*/
import { query } from '../../shared/config/db.js';

export const NIVELES = ['baja', 'media', 'alta', 'completa'];
export const DIAS_CARGA = Number(process.env.CONSULTAS_CARGA_DIAS || 7);

/** Los datos reales de unos tutores: alumnos activos, consultas abiertas y alumnos sin mensajes. */
export async function datosReales(tutorIds, projectIds = null) {
  if (!tutorIds.length) return new Map();
  const p = [tutorIds];
  const enCampus = (col) => (projectIds ? `AND ${col} = ANY($2::int[])` : '');
  if (projectIds) p.push(projectIds);
  const { rows } = await query(
    `SELECT u.id AS tutor_id,
            (SELECT COUNT(DISTINCT (ta.project_id, ta.alumno_moodle_id))::int FROM tutor_alumnos ta
              WHERE ta.tutor_id = u.id AND ta.activo ${enCampus('ta.project_id')}) AS alumnos_activos,
            (SELECT COUNT(*)::int FROM consultas c
              WHERE c.tutor_id = u.id AND c.estado = 'abierta' ${enCampus('c.project_id')}) AS consultas_abiertas,
            (SELECT COUNT(DISTINCT (ta.project_id, ta.alumno_moodle_id))::int FROM tutor_alumnos ta
              WHERE ta.tutor_id = u.id AND ta.activo AND NOT ta.con_conversacion ${enCampus('ta.project_id')}
                AND NOT EXISTS (SELECT 1 FROM consultas c2 WHERE c2.project_id = ta.project_id
                                  AND c2.alumno_moodle_id = ta.alumno_moodle_id AND c2.tutor_id = ta.tutor_id)) AS alumnos_sin_mensajes
       FROM users u WHERE u.id = ANY($1::int[])`, p);
  return new Map(rows.map((r) => [Number(r.tutor_id), {
    alumnos_activos: r.alumnos_activos, consultas_abiertas: r.consultas_abiertas, alumnos_sin_mensajes: r.alumnos_sin_mensajes,
  }]));
}

const desactualizada = (fecha) => !fecha || (Date.now() - new Date(fecha).getTime()) > DIAS_CARGA * 86400000;

/** «Mi carga de trabajo»: la de ahora, el historial y los datos reales. */
export async function cargaDe(tutorId) {
  const { rows } = await query(
    `SELECT c.id, c.nivel, c.texto, c.created_at, u.nombre AS por
       FROM tutor_carga c LEFT JOIN users u ON u.id = c.creado_por
      WHERE c.tutor_id = $1 ORDER BY c.created_at DESC, c.id DESC LIMIT 30`, [tutorId]);
  const actual = rows[0] || null;
  const reales = (await datosReales([tutorId])).get(Number(tutorId));
  return {
    actual,
    historial: rows,
    desactualizada: desactualizada(actual?.created_at),
    diasPlazo: DIAS_CARGA,
    datosReales: reales,
  };
}

export async function guardarCarga(tutorId, { nivel, texto }, porQuien) {
  await query(
    'INSERT INTO tutor_carga (tutor_id, nivel, texto, creado_por) VALUES ($1, $2, $3, $4)',
    [tutorId, nivel, texto || null, porQuien || null]);
  return cargaDe(tutorId);
}

/**
 * El panel de tutores: los tutores de esos campus (por campus o por empresa),
 * con su carga y sus datos reales. `projectIds` null = todos.
 */
export async function panelDeTutores(projectIds = null) {
  const { rows } = await query(
    `WITH suyos AS (
       SELECT up.user_id AS tutor_id, up.project_id FROM user_projects up WHERE up.active
       UNION
       SELECT te.tutor_id, p.id FROM tutor_empresas te
         JOIN projects p ON p.sociedad_emisora_id = te.issuer_id AND p.active
     )
     SELECT u.id, u.nombre, u.email,
            -- El «No disponible» de Consultas (223), no el del reparto de prospectos.
            u.consultas_disponible AS disponible, u.consultas_no_disponible_motivo AS motivo_no_disponible,
            ARRAY_AGG(DISTINCT pr.nombre ORDER BY pr.nombre) AS campus,
            ARRAY_AGG(DISTINCT COALESCE(ii.alias, ii.razon_social)) FILTER (WHERE ii.id IS NOT NULL) AS empresas,
            (SELECT row_to_json(x) FROM (SELECT c.nivel, c.texto, c.created_at FROM tutor_carga c
               WHERE c.tutor_id = u.id ORDER BY c.created_at DESC, c.id DESC LIMIT 1) x) AS carga
       FROM users u
       JOIN suyos s ON s.tutor_id = u.id
       JOIN projects pr ON pr.id = s.project_id
       LEFT JOIN invoice_issuers ii ON ii.id = pr.sociedad_emisora_id
      WHERE u.active AND (u.role = 'tutor' OR 'tutor' = ANY(COALESCE(u.roles_extra, '{}')::text[]))
        ${projectIds ? 'AND s.project_id = ANY($1::int[])' : ''}
      GROUP BY u.id
      ORDER BY u.nombre`, projectIds ? [projectIds] : []);
  const reales = await datosReales(rows.map((r) => Number(r.id)), projectIds);
  return rows.map((r) => ({
    ...r,
    id: Number(r.id),
    desactualizada: desactualizada(r.carga?.created_at),
    ...(reales.get(Number(r.id)) || { alumnos_activos: 0, consultas_abiertas: 0, alumnos_sin_mensajes: 0 }),
  }));
}

/**
 * Campus con el Moodle conectado y leyendo consultas que NO tienen ningún tutor
 * que pueda recibirlas (matriculado, activo y disponible). Como «Sin tutor» de
 * comisiones, pero para las consultas.
 */
export async function campusSinTutor(projectIds = null) {
  const { rows } = await query(
    `SELECT p.id, p.nombre AS campus, COALESCE(ii.alias, ii.razon_social) AS empresa
       FROM project_integrations pi
       JOIN projects p ON p.id = pi.project_id AND p.active
       LEFT JOIN invoice_issuers ii ON ii.id = p.sociedad_emisora_id
      WHERE pi.provider = 'moodle' AND pi.active AND pi.encrypted_value IS NOT NULL
        ${projectIds ? 'AND p.id = ANY($1::int[])' : ''}
        AND NOT EXISTS (
          SELECT 1 FROM tutor_campus tc JOIN users u ON u.id = tc.tutor_id
           WHERE tc.project_id = p.id AND tc.estado = 'activa' AND u.active AND u.consultas_disponible
             AND (EXISTS (SELECT 1 FROM user_projects up WHERE up.user_id = u.id AND up.project_id = p.id AND up.active)
                  OR EXISTS (SELECT 1 FROM tutor_empresas te WHERE te.tutor_id = u.id AND te.issuer_id = p.sociedad_emisora_id)))
      ORDER BY p.nombre`, projectIds ? [projectIds] : []);
  return rows;
}
