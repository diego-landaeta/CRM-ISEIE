import { query } from '../../shared/config/db.js';

/**
 * Conexión → MCP → Actividad (#195): lo que ha consultado cada uno con Claude.
 *
 * Sale de `mcp_auditoria`, que guarda cada consulta desde la 182. Solo para
 * super admin y admin (lo impone la ruta con `soloRoles`).
 *
 * «Un admin solo ve lo de sus empresas.» Sus empresas son las sociedades de los
 * campus que tiene asignados; ve la actividad de las personas que están en
 * algún campus de esas empresas. Un campus sin empresa cuenta solo por sí
 * mismo. El super admin lo ve todo, también las consultas de alguien ya borrado.
 */

/** Los campus de las empresas de un admin; null = todos (super admin). */
async function campusVisibles(quien) {
  if (quien.role === 'superadmin') return null;
  const { rows } = await query(
    `WITH mios AS (
       SELECT p.id, p.sociedad_emisora_id
         FROM user_projects up JOIN projects p ON p.id = up.project_id
        WHERE up.user_id = $1 AND up.active
     )
     SELECT p.id FROM projects p
      WHERE p.id IN (SELECT id FROM mios)
         OR (p.sociedad_emisora_id IS NOT NULL
             AND p.sociedad_emisora_id IN (SELECT sociedad_emisora_id FROM mios))`,
    [quien.id]
  );
  return rows.map((r) => r.id);
}

/** El WHERE común a la lista y a los filtros: el alcance de quien mira. */
function alcance(campus, params) {
  if (campus === null) return 'TRUE';
  params.push(campus);
  return `a.user_id IN (SELECT up.user_id FROM user_projects up
                         WHERE up.active AND up.project_id = ANY($${params.length}::int[]))`;
}

const TZ = process.env.APP_TIMEZONE || 'Europe/Madrid';

export async function listarActividad(quien, { persona, conexion, desde, hasta, herramienta, resultado, pagina = 1, limite = 50 }) {
  const params = [];
  const cond = [alcance(await campusVisibles(quien), params)];
  const add = (sql, v) => { params.push(v); cond.push(sql.replace('?', `$${params.length}`)); };

  if (persona) add('a.user_id = ?', persona);
  // Conexión: «personal» = las URLs personales; un número = una conexión de
  // Claude (conector de tipo MCP, migración 184).
  if (conexion === 'personal') cond.push('t.connector_id IS NULL');
  else if (conexion) add('t.connector_id = ?', Number(conexion));
  if (desde) add(`(a.created_at AT TIME ZONE '${TZ}')::date >= ?::date`, desde);
  if (hasta) add(`(a.created_at AT TIME ZONE '${TZ}')::date <= ?::date`, hasta);
  if (herramienta) add('a.herramienta = ?', herramienta);
  if (resultado === 'ok') cond.push('a.ok');
  if (resultado === 'error') cond.push('NOT a.ok');

  const where = 'WHERE ' + cond.join(' AND ');
  const desdeTabla = `FROM mcp_auditoria a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN mcp_tokens t ON t.id = a.token_id
       LEFT JOIN project_connectors c ON c.id = t.connector_id`;

  const { rows } = await query(
    `SELECT a.id, a.created_at, a.user_id, u.nombre AS persona, u.email,
            a.token_id, t.nombre AS url_nombre, t.prefijo, t.connector_id, c.label AS conexion,
            a.herramienta, a.parametros, a.ok, a.error, a.duracion_ms, a.ip, a.cliente
       ${desdeTabla}
      ${where}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ${Number(limite)} OFFSET ${(Number(pagina) - 1) * Number(limite)}`,
    params
  );
  const { rows: [{ total }] } = await query(`SELECT COUNT(*)::int AS total ${desdeTabla} ${where}`, params);
  return { total, pagina: Number(pagina), limite: Number(limite), filas: rows };
}

/** Para los desplegables: personas y conexiones que tienen actividad visible. */
export async function opcionesActividad(quien) {
  const params = [];
  const donde = alcance(await campusVisibles(quien), params);
  const [{ rows: personas }, { rows: conexiones }, { rows: herramientas }] = await Promise.all([
    query(
      `SELECT DISTINCT u.id, u.nombre FROM mcp_auditoria a JOIN users u ON u.id = a.user_id
        WHERE ${donde} ORDER BY u.nombre`, params),
    query(
      `SELECT DISTINCT c.id, c.label FROM mcp_auditoria a
         JOIN mcp_tokens t ON t.id = a.token_id JOIN project_connectors c ON c.id = t.connector_id
        WHERE ${donde} ORDER BY c.label`, params),
    query(`SELECT DISTINCT a.herramienta FROM mcp_auditoria a WHERE ${donde} ORDER BY a.herramienta`, params),
  ]);
  return { personas, conexiones, herramientas: herramientas.map((h) => h.herramienta) };
}
