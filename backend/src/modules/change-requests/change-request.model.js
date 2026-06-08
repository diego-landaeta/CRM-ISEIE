import { query } from '../../shared/config/db.js';

// Genera el siguiente código RFC-NNN para un proyecto (correlativo por proyecto).
// Si projectId es null → RFC general con prefijo distinto (RFC-G-NNN) para
// no chocar con los correlativos de proyectos.
export async function getNextRfcCode(projectId) {
  const isGeneral = projectId == null;
  const pattern = isGeneral ? '^RFC-G-[0-9]+$' : '^RFC-[0-9]+$';
  const prefix = isGeneral ? 'RFC-G-' : 'RFC-';
  const { rows } = await query(
    `SELECT codigo_rfc FROM change_requests
     WHERE ${isGeneral ? 'project_id IS NULL' : 'project_id = $1'}
       AND codigo_rfc ~ $${isGeneral ? '1' : '2'}
     ORDER BY (substring(codigo_rfc from '[0-9]+$'))::int DESC
     LIMIT 1`,
    isGeneral ? [pattern] : [projectId, pattern]
  );
  if (!rows[0]) return `${prefix}001`;
  const lastNum = parseInt(rows[0].codigo_rfc.replace(prefix, ''), 10);
  return `${prefix}${String(lastNum + 1).padStart(3, '0')}`;
}

export async function create({ projectId, codigoRfc, titulo, solicitanteUserId, descripcionResumida, objetivoIntencion, motivoNegocio, beneficiosKpi, beneficiosComercial, beneficiosOperacion, modificaAlcance, modificaCronograma, modificaCostos, modificaRiesgos }) {
  const { rows } = await query(
    `INSERT INTO change_requests
      (project_id, codigo_rfc, titulo, solicitante_user_id,
       descripcion_resumida, objetivo_intencion, motivo_negocio,
       beneficios_kpi, beneficios_comercial, beneficios_operacion,
       modifica_alcance, modifica_cronograma, modifica_costos, modifica_riesgos)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [projectId, codigoRfc, titulo, solicitanteUserId,
     descripcionResumida || null, objetivoIntencion || null, motivoNegocio || null,
     beneficiosKpi || null, beneficiosComercial || null, beneficiosOperacion || null,
     !!modificaAlcance, !!modificaCronograma, !!modificaCostos, !!modificaRiesgos]
  );
  // Crear las 3 filas de aprobación vacías (CEO, PM, DEV) para que la UI las muestre
  // como pendientes desde el principio.
  await query(
    `INSERT INTO change_request_approvals (change_request_id, rol)
     VALUES ($1, 'ceo'), ($1, 'pm'), ($1, 'dev')
     ON CONFLICT (change_request_id, rol) DO NOTHING`,
    [rows[0].id]
  );
  return rows[0];
}

export async function listForUser({ projectId = null, userId, role, estado = null }) {
  const conditions = ['1=1'];
  const params = [];
  if (projectId) { params.push(projectId); conditions.push(`r.project_id = $${params.length}`); }
  // Roles con visibilidad total
  const fullVisibility = ['superadmin', 'admin', 'project_manager'];
  if (!fullVisibility.includes(role)) {
    params.push(userId);
    conditions.push(`r.solicitante_user_id = $${params.length}`);
  }
  if (estado) { params.push(estado); conditions.push(`r.estado = $${params.length}`); }
  const { rows } = await query(
    `SELECT r.id, r.codigo_rfc, r.titulo, r.estado, r.created_at, r.fecha_solicitud,
            r.project_id, p.nombre AS proyecto_nombre, p.slug AS proyecto_slug,
            u.nombre AS solicitante_nombre, u.email AS solicitante_email,
            (SELECT COUNT(*) FROM change_request_attachments WHERE change_request_id = r.id)::int AS n_attachments
     FROM change_requests r
     LEFT JOIN projects p ON p.id = r.project_id
     LEFT JOIN users u ON u.id = r.solicitante_user_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY r.created_at DESC
     LIMIT 200`,
    params
  );
  return rows;
}

export async function getById(id) {
  const { rows } = await query(
    `SELECT r.*, p.nombre AS proyecto_nombre, p.slug AS proyecto_slug,
            u.nombre AS solicitante_nombre, u.email AS solicitante_email
     FROM change_requests r
     LEFT JOIN projects p ON p.id = r.project_id
     LEFT JOIN users u ON u.id = r.solicitante_user_id
     WHERE r.id = $1`,
    [id]
  );
  if (!rows[0]) return null;
  const rfc = rows[0];
  const { rows: approvals } = await query(
    `SELECT a.id, a.rol, a.decision, a.firma_at, a.comentarios,
            CASE WHEN a.firma_data IS NOT NULL THEN TRUE ELSE FALSE END AS has_firma,
            a.user_id, u.nombre AS user_nombre, u.email AS user_email
     FROM change_request_approvals a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.change_request_id = $1
     ORDER BY CASE a.rol WHEN 'ceo' THEN 1 WHEN 'pm' THEN 2 WHEN 'dev' THEN 3 END`,
    [id]
  );
  const { rows: attachments } = await query(
    `SELECT id, file_name, mime_type, size_bytes, uploaded_at
     FROM change_request_attachments
     WHERE change_request_id = $1 ORDER BY uploaded_at DESC`,
    [id]
  );
  return { ...rfc, approvals, attachments };
}

// Devuelve la firma_data (base64) de una aprobación específica. Separada para
// no traer la imagen completa en cada listado/detalle (puede ser grande).
export async function getApprovalSignature(approvalId) {
  const { rows } = await query(
    `SELECT firma_data FROM change_request_approvals WHERE id = $1`,
    [approvalId]
  );
  return rows[0]?.firma_data || null;
}

const ALLOWED_FIELDS = [
  'titulo', 'estado',
  'modifica_alcance', 'modifica_cronograma', 'modifica_costos', 'modifica_riesgos',
  'descripcion_resumida', 'objetivo_intencion', 'motivo_negocio',
  'beneficios_kpi', 'beneficios_comercial', 'beneficios_operacion',
  'opciones_consideradas', 'impacto_alcance', 'impacto_tiempo', 'impacto_costo', 'impacto_riesgos',
  'recomendacion_decision', 'recomendacion_justif',
  'plan_alcance', 'plan_hitos', 'plan_responsables',
  'baseline_alcance', 'baseline_cronograma', 'baseline_costos',
];

export async function update(id, patch) {
  const sets = [];
  const vals = [];
  let i = 1;
  for (const f of ALLOWED_FIELDS) {
    if (patch[f] === undefined) continue;
    sets.push(`${f} = $${i++}`);
    vals.push(f === 'opciones_consideradas' ? JSON.stringify(patch[f] || []) : patch[f]);
  }
  if (!sets.length) return await getById(id);
  sets.push('updated_at = NOW()');
  vals.push(id);
  await query(
    `UPDATE change_requests SET ${sets.join(', ')} WHERE id = $${i}`,
    vals
  );
  return await getById(id);
}

export async function setApproval({ rfcId, rol, userId, decision, firmaData, comentarios }) {
  await query(
    `UPDATE change_request_approvals
     SET decision = $1, firma_data = $2, firma_at = NOW(), user_id = $3, comentarios = $4
     WHERE change_request_id = $5 AND rol = $6`,
    [decision, firmaData || null, userId, comentarios || null, rfcId, rol]
  );
}

export async function addAttachment({ rfcId, filePath, fileName, mimeType, sizeBytes, uploadedBy }) {
  const { rows } = await query(
    `INSERT INTO change_request_attachments
       (change_request_id, file_path, file_name, mime_type, size_bytes, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [rfcId, filePath, fileName, mimeType || null, sizeBytes || null, uploadedBy]
  );
  return rows[0];
}

export async function getAttachment(id) {
  const { rows } = await query(`SELECT * FROM change_request_attachments WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function deleteAttachment(id) {
  const { rows } = await query(`DELETE FROM change_request_attachments WHERE id = $1 RETURNING file_path`, [id]);
  return rows[0]?.file_path || null;
}

export async function remove(id) {
  await query(`DELETE FROM change_requests WHERE id = $1`, [id]);
}

// Listas de emails para notificaciones (todos los users de un rol).
export async function listUsersByRole(role) {
  const { rows } = await query(
    `SELECT id, nombre, email FROM users WHERE role = $1 AND active = TRUE`,
    [role]
  );
  return rows;
}
