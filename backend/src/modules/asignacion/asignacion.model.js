import { query } from '../../shared/config/db.js';

/*
  SQL de la asignación de leads por actividad (migración 230, CRM#513).

  Los destinos cifrados (`destinoN_cifrado`, `_iv`, `_tag`) solo salen de aquí
  por `conDestinos`, que es lo que usa el envío. Hacia la pantalla, solo su cola.
*/

const COLUMNAS = `
  d.id, d.nombre, d.activo, d.ambito, d.issuer_id, d.project_id, d.ventana_min,
  d.destino1_tipo, d.destino1_cola, d.destino2_tipo, d.destino2_cola, d.clave_cola,
  d.creado_por, d.actualizado_por, d.created_at, d.updated_at,
  p.nombre AS proyecto, s.razon_social AS empresa,
  (SELECT MAX(x.created_at) FROM asignacion_decisiones x WHERE x.destino_id = d.id AND NOT x.prueba) AS ultima_decision_at,
  (SELECT COUNT(*)::int FROM asignacion_decisiones x
    WHERE x.destino_id = d.id AND NOT x.prueba AND x.estado = 'fallido'
      AND x.created_at > NOW() - INTERVAL '30 days') AS fallidos_30_dias`;

const DESDE = `
  FROM asignacion_destinos d
  LEFT JOIN projects p ON p.id = d.project_id
  LEFT JOIN invoice_issuers s ON s.id = d.issuer_id`;

/** Las configuraciones que ve una persona: `misCampus` null = super admin, todas. */
export async function listar({ misCampus = null } = {}) {
  if (!misCampus) {
    const { rows } = await query(`SELECT ${COLUMNAS} ${DESDE} ORDER BY d.ambito, p.nombre NULLS LAST, s.razon_social NULLS LAST, d.id`);
    return rows;
  }
  const { rows } = await query(
    `SELECT ${COLUMNAS} ${DESDE}
      WHERE (d.ambito = 'campus' AND d.project_id = ANY($1::int[]))
         OR (d.ambito = 'empresa' AND NOT EXISTS (
               SELECT 1 FROM projects px WHERE px.sociedad_emisora_id = d.issuer_id AND px.active
                  AND NOT (px.id = ANY($1::int[]))))
      ORDER BY d.ambito, p.nombre NULLS LAST, s.razon_social NULLS LAST, d.id`,
    [misCampus]
  );
  return rows;
}

export async function porId(id) {
  const { rows } = await query(`SELECT ${COLUMNAS} ${DESDE} WHERE d.id = $1`, [id]);
  return rows[0] || null;
}

export async function conDestinos(id) {
  const { rows } = await query('SELECT * FROM asignacion_destinos WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function porClave(claveHash) {
  const { rows } = await query('SELECT * FROM asignacion_destinos WHERE clave_hash = $1', [claveHash]);
  return rows[0] || null;
}

/** La configuración que manda en un campus: la del campus; si no, la de su empresa; si no, la de todas. */
export async function paraCampus(projectId) {
  const { rows } = await query(
    `SELECT d.* FROM asignacion_destinos d
      WHERE (d.ambito = 'campus' AND d.project_id = $1)
         OR (d.ambito = 'empresa' AND d.issuer_id = (SELECT sociedad_emisora_id FROM projects WHERE id = $1))
         OR d.ambito = 'todas'
      ORDER BY CASE d.ambito WHEN 'campus' THEN 0 WHEN 'empresa' THEN 1 ELSE 2 END
      LIMIT 1`,
    [projectId]
  );
  return rows[0] || null;
}

const CAMPOS = ['nombre', 'activo', 'ambito', 'issuer_id', 'project_id', 'ventana_min',
  'destino1_tipo', 'destino1_cifrado', 'destino1_iv', 'destino1_tag', 'destino1_cola',
  'destino2_tipo', 'destino2_cifrado', 'destino2_iv', 'destino2_tag', 'destino2_cola',
  'clave_hash', 'clave_cola', 'creado_por', 'actualizado_por'];

export async function crear(d) {
  const cols = CAMPOS.filter((k) => d[k] !== undefined);
  const { rows } = await query(
    `INSERT INTO asignacion_destinos (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    cols.map((k) => d[k])
  );
  return Number(rows[0].id);
}

export async function cambiar(id, d) {
  const cols = CAMPOS.filter((k) => d[k] !== undefined && !['ambito', 'issuer_id', 'project_id', 'creado_por'].includes(k));
  if (!cols.length) return porId(id);
  await query(
    `UPDATE asignacion_destinos SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = NOW() WHERE id = $1`,
    [id, ...cols.map((k) => d[k])]
  );
  return porId(id);
}

export async function borrar(id) {
  const { rowCount } = await query('DELETE FROM asignacion_destinos WHERE id = $1', [id]);
  return rowCount > 0;
}

export async function campusDeLaEmpresa(issuerId) {
  const { rows } = await query('SELECT id FROM projects WHERE sociedad_emisora_id = $1 AND active ORDER BY id', [issuerId]);
  return rows.map((r) => Number(r.id));
}

export async function campus(idOSlug) {
  const esId = /^\d+$/.test(String(idOSlug));
  const { rows } = await query(
    `SELECT id, nombre, slug, sociedad_emisora_id FROM projects WHERE ${esId ? 'id = $1' : 'lower(slug) = lower($1)'} AND active`,
    [esId ? Number(idOSlug) : String(idOSlug)]
  );
  return rows[0] || null;
}

export async function existeEmpresa(id) {
  const { rows } = await query('SELECT 1 FROM invoice_issuers WHERE id = $1', [id]);
  return rows.length > 0;
}

export async function personas(ids) {
  const lista = [...new Set((ids || []).map(Number).filter(Boolean))];
  if (!lista.length) return new Map();
  const { rows } = await query(`SELECT id, nombre, email, NULLIF(TRIM(whatsapp_phone), '') AS whatsapp FROM users WHERE id = ANY($1::int[])`, [lista]);
  return new Map(rows.map((r) => [Number(r.id), r]));
}

/* ─── Decisiones (y el envío de cada una) ─── */

export async function decisionPorUid(projectId, uid) {
  const { rows } = await query('SELECT * FROM asignacion_decisiones WHERE project_id = $1 AND uid = $2', [projectId, uid]);
  return rows[0] || null;
}

/**
 * Apunta una decisión. Si ya hay una con ese uid en el campus, devuelve null (la decide quien llegó primero).
 * `sinEnvio`: por qué no va a ningún escenario de Make (un formulario que entró directo al CRM); nace ya
 * cerrada, para que el reenviador no la mande.
 */
export async function crearDecision({ destinoId, projectId, uid, prueba = false, escenario, responsableId = null, leadId = null, motivo, datos, destinoTipo, sinEnvio = null }) {
  const { rows } = await query(
    `INSERT INTO asignacion_decisiones
       (destino_id, project_id, uid, prueba, escenario, responsable_id, lead_id, motivo, datos, destino_tipo, estado, proximo_intento_at, respuesta, enviado_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             CASE WHEN $11::text IS NULL THEN 'pendiente' ELSE 'enviado' END,
             CASE WHEN $11::text IS NULL THEN NOW() END, $11::text, CASE WHEN $11::text IS NOT NULL THEN NOW() END)
     ON CONFLICT (project_id, uid) DO NOTHING
     RETURNING *`,
    [destinoId, projectId, uid, prueba, escenario, responsableId, leadId, JSON.stringify(motivo || {}), JSON.stringify(datos || {}), destinoTipo, sinEnvio]
  );
  return rows[0] || null;
}

export async function ponerLead(id, leadId) {
  await query('UPDATE asignacion_decisiones SET lead_id = $2, updated_at = NOW() WHERE id = $1', [id, leadId]);
}

export async function reclamar(id) {
  const { rows } = await query(
    `UPDATE asignacion_decisiones
        SET estado = 'enviando', intentos = intentos + 1, ultimo_intento_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND estado = 'pendiente' AND (proximo_intento_at IS NULL OR proximo_intento_at <= NOW())
      RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

export async function marcarEnviado(id, { httpStatus = null, respuesta = null }) {
  const { rows } = await query(
    `UPDATE asignacion_decisiones
        SET estado = 'enviado', http_status = $2, respuesta = $3, error = NULL,
            enviado_at = NOW(), proximo_intento_at = NULL, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, httpStatus, respuesta]
  );
  return rows[0] || null;
}

export async function marcarFallo(id, { httpStatus = null, respuesta = null, error, reintentarEnMs = null }) {
  const { rows } = await query(
    `UPDATE asignacion_decisiones
        SET estado = CASE WHEN $5::int IS NULL THEN 'fallido' ELSE 'pendiente' END,
            http_status = $2, respuesta = $3, error = $4,
            proximo_intento_at = CASE WHEN $5::int IS NULL THEN NULL
                                      ELSE NOW() + ($5::int * INTERVAL '1 millisecond') END,
            updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, httpStatus, respuesta, error, reintentarEnMs]
  );
  return rows[0] || null;
}

export async function prepararReenvio(id) {
  const { rows } = await query(
    `UPDATE asignacion_decisiones
        SET estado = 'pendiente', intentos = 0, error = NULL, proximo_intento_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND estado = 'fallido' RETURNING *`,
    [id]
  );
  return rows[0] || null;
}

export async function pendientesQueTocan(limite = 20) {
  const { rows } = await query(
    `SELECT id FROM asignacion_decisiones
      WHERE estado = 'pendiente' AND proximo_intento_at <= NOW()
      ORDER BY proximo_intento_at, id LIMIT $1`,
    [limite]
  );
  return rows.map((r) => Number(r.id));
}

export async function rescatarAtascados(maxIntentos) {
  const { rowCount } = await query(
    `UPDATE asignacion_decisiones
        SET estado = CASE WHEN intentos >= $1 OR prueba THEN 'fallido' ELSE 'pendiente' END,
            proximo_intento_at = CASE WHEN intentos >= $1 OR prueba THEN NULL ELSE NOW() END,
            error = 'Se cortó a mitad del envío (reinicio del servidor)', updated_at = NOW()
      WHERE estado = 'enviando' AND ultimo_intento_at < NOW() - INTERVAL '5 minutes'`,
    [maxIntentos]
  );
  return rowCount;
}

/** El registro de decisiones, para la pantalla. `misCampus` null = todas. */
export async function listarDecisiones({ misCampus = null, destinoId = null, projectId = null, issuerId = null, escenario = null, estado = null, limit = 50 } = {}) {
  const cond = [];
  const params = [];
  const add = (sql, v) => { params.push(v); cond.push(sql.replace('$?', `$${params.length}`)); };
  if (misCampus) add('x.project_id = ANY($?::int[])', misCampus);
  if (destinoId) add('x.destino_id = $?', destinoId);
  if (projectId) add('x.project_id = $?', projectId);
  if (issuerId) add('x.project_id IN (SELECT id FROM projects WHERE sociedad_emisora_id = $?)', issuerId);
  if (escenario) add('x.escenario = $?', escenario);
  if (estado) add('x.estado = $?', estado);
  params.push(limit);
  const { rows } = await query(
    `SELECT x.id, x.destino_id, x.project_id, p.nombre AS proyecto, x.uid, x.prueba, x.escenario,
            x.responsable_id, u.nombre AS responsable, x.lead_id, x.motivo,
            x.datos->>'nombre' AS cliente, x.datos->>'email' AS cliente_email,
            x.estado, x.destino_tipo, x.intentos, x.http_status, x.error, x.enviado_at, x.created_at
       FROM asignacion_decisiones x
       LEFT JOIN projects p ON p.id = x.project_id
       LEFT JOIN users u ON u.id = x.responsable_id
      ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
      ORDER BY x.created_at DESC, x.id DESC
      LIMIT $${params.length}`,
    params
  );
  return rows;
}

export async function decisionPorId(id) {
  const { rows } = await query('SELECT * FROM asignacion_decisiones WHERE id = $1', [id]);
  return rows[0] || null;
}

/* ─── actividad_crm ─── */

export async function apuntarActividad(userId, accion, ruta) {
  await query('INSERT INTO actividad_crm (user_id, accion, ruta) VALUES ($1, $2, $3)', [userId, accion, String(ruta || '').slice(0, 200)]);
}

export async function purgarActividad(dias = 30) {
  const { rowCount } = await query(`DELETE FROM actividad_crm WHERE created_at < NOW() - make_interval(days => $1::int)`, [dias]);
  return rowCount;
}
