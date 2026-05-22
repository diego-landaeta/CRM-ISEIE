import { query } from '../../shared/config/db.js';

export async function findAll({ projectId, estado, search, page = 1, limit = 50 }) {
  const conditions = ['m.project_id = $1'];
  const params = [projectId];
  let idx = 2;
  if (estado) { conditions.push(`m.estado = $${idx++}`); params.push(estado); }
  if (search) {
    conditions.push(`(l.nombre ILIKE $${idx} OR l.email ILIKE $${idx} OR m.dni ILIKE $${idx})`);
    params.push(`%${search}%`);
    idx++;
  }
  const where = 'WHERE ' + conditions.join(' AND ');
  const offset = (page - 1) * limit;
  const { rows: cnt } = await query(`SELECT COUNT(*) FROM matriculas m LEFT JOIN leads l ON l.id = m.lead_id ${where}`, params);
  const total = parseInt(cnt[0].count);
  const { rows } = await query(
    `SELECT m.*, l.nombre as lead_nombre, l.email as lead_email, l.telefono as lead_telefono,
            c.importe_total, c.producto_contratado, u.nombre as validated_by_nombre
     FROM matriculas m
     LEFT JOIN leads l ON l.id = m.lead_id
     LEFT JOIN conversions c ON c.id = m.conversion_id
     LEFT JOIN users u ON u.id = m.validated_by
     ${where}
     ORDER BY m.created_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset]
  );
  return { matriculas: rows, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function findById(id) {
  const { rows } = await query(
    `SELECT m.*, l.nombre as lead_nombre, l.email as lead_email,
            c.importe_total, c.producto_contratado, u.nombre as validated_by_nombre
     FROM matriculas m
     LEFT JOIN leads l ON l.id = m.lead_id
     LEFT JOIN conversions c ON c.id = m.conversion_id
     LEFT JOIN users u ON u.id = m.validated_by
     WHERE m.id = $1`, [id]);
  return rows[0] || null;
}

export async function findByConversion(conversionId) {
  const { rows } = await query(`SELECT * FROM matriculas WHERE conversion_id = $1`, [conversionId]);
  return rows[0] || null;
}

export async function create(data) {
  const dedupe = data.dedupe_key || data.dni || null;
  const { rows } = await query(
    `INSERT INTO matriculas (project_id, conversion_id, lead_id, dni, titulo, notas, datos_admision, source, dedupe_key, estado, webhook_received_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [data.project_id, data.conversion_id || null, data.lead_id || null,
     data.dni || null, data.titulo || null, data.notas || null,
     data.datos_admision ? JSON.stringify(data.datos_admision) : null,
     data.source || 'manual', dedupe,
     data.estado || (data.source === 'webhook' ? 'solicitud_admision' : 'pendiente'),
     data.source === 'webhook' ? new Date() : null]
  );
  return rows[0];
}

export async function findByDedupe(projectId, dedupeKey) {
  if (!dedupeKey) return null;
  const { rows } = await query(`SELECT * FROM matriculas WHERE project_id = $1 AND dedupe_key = $2`, [projectId, dedupeKey]);
  return rows[0] || null;
}

export async function update(id, fields) {
  const allowed = ['dni', 'titulo', 'notas', 'dni_doc_url', 'dni_doc_key', 'titulo_doc_url', 'titulo_doc_key', 'firma_url', 'firma_key'];
  const sets = []; const params = []; let idx = 1;
  for (const k of allowed) {
    if (fields[k] !== undefined) { sets.push(`${k} = $${idx++}`); params.push(fields[k]); }
  }
  if (!sets.length) return null;
  sets.push(`updated_at = NOW()`);
  params.push(id);
  const { rows } = await query(`UPDATE matriculas SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, params);
  return rows[0];
}

export async function setEstado(id, estado, userId, motivo = null) {
  const { rows } = await query(
    `UPDATE matriculas
       SET estado = $1, motivo_rechazo = $2,
           validated_by = $3, validated_at = NOW(), updated_at = NOW()
     WHERE id = $4 RETURNING *`,
    [estado, estado === 'rechazada' ? motivo : null, userId, id]
  );
  return rows[0];
}

export async function remove(id) {
  await query(`DELETE FROM matriculas WHERE id = $1`, [id]);
}

export async function getStats(projectId) {
  const { rows } = await query(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE estado = 'pendiente') as pendientes,
       COUNT(*) FILTER (WHERE estado = 'validada') as validadas,
       COUNT(*) FILTER (WHERE estado = 'rechazada') as rechazadas
     FROM matriculas WHERE project_id = $1`, [projectId]);
  return rows[0];
}
