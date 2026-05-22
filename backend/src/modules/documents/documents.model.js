import pool from '../../shared/config/db.js';

export async function nextNumber(projectId, type) {
  const { rows } = await pool.query(`
    INSERT INTO document_counters (project_id, type, last_number)
    VALUES ($1, $2, 1)
    ON CONFLICT (project_id, type)
    DO UPDATE SET last_number = document_counters.last_number + 1
    RETURNING last_number
  `, [projectId, type]);
  return rows[0].last_number;
}

// Devuelve el siguiente numero SIN incrementar el contador. Usado por el form
// para mostrar el numero que se asignara y permitir override antes de generar.
export async function peekNextNumber(projectId, type) {
  const { rows } = await pool.query(
    'SELECT last_number FROM document_counters WHERE project_id=$1 AND type=$2',
    [projectId, type]
  );
  return rows[0] ? rows[0].last_number + 1 : 1;
}

// Reposiciona el contador para que la proxima invocacion de nextNumber()
// devuelva exactamente `value`. Permite saltos manuales (e.g., empezar la
// numeracion en 200) sin perder la sucesion automatica posterior.
export async function setNextNumber(projectId, type, value) {
  await pool.query(`
    INSERT INTO document_counters (project_id, type, last_number)
    VALUES ($1, $2, $3)
    ON CONFLICT (project_id, type)
    DO UPDATE SET last_number = $3
  `, [projectId, type, value - 1]);
}

export async function createDocument(doc) {
  const { rows } = await pool.query(`
    INSERT INTO documents (project_id, type, number, client_nombre, client_dni, client_direccion, data, file_path, r2_key, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING *
  `, [doc.project_id, doc.type, doc.number, doc.client_nombre, doc.client_dni,
      doc.client_direccion, JSON.stringify(doc.data), doc.file_path, doc.r2_key || null, doc.created_by]);
  return rows[0];
}

export async function listDocuments(projectId, type) {
  const params = [projectId];
  let where = 'WHERE project_id = $1';
  if (type) { params.push(type); where += ` AND type = $${params.length}`; }
  const { rows } = await pool.query(
    `SELECT * FROM documents ${where} ORDER BY created_at DESC LIMIT 100`, params
  );
  return rows;
}

export async function getDocument(id, projectId) {
  const { rows } = await pool.query(
    'SELECT * FROM documents WHERE id=$1 AND project_id=$2', [id, projectId]
  );
  return rows[0] || null;
}

export async function deleteDocument(id, projectId) {
  await pool.query('DELETE FROM documents WHERE id=$1 AND project_id=$2', [id, projectId]);
}

// Reemplaza el path del archivo en la DB. Usado cuando regeneramos un PDF
// porque el path original (legacy) ya no apunta a un archivo existente.
export async function updateFilePath(id, filePath) {
  await pool.query('UPDATE documents SET file_path=$1 WHERE id=$2', [filePath, id]);
}

// ============================================================
// Audit log (tabla document_audit_log — migracion 038)
// ============================================================

// Registra una accion sobre un documento. No bloquea — los errores se silencian
// para no romper el flujo principal si la tabla no existe (e.g., migracion no
// aplicada en algun entorno).
export async function logAudit({ documentId, action, userId, ip, userAgent, metadata }) {
  try {
    await pool.query(`
      INSERT INTO document_audit_log (document_id, action, user_id, ip, user_agent, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [documentId, action, userId || null, ip || null, userAgent || null, metadata ? JSON.stringify(metadata) : null]);
  } catch (err) {
    // Log a stderr; no propagar — auditoria es best-effort.
    console.warn('[documents] audit log failed:', err.message);
  }
}

// Devuelve historial de auditoria de un documento (mas reciente primero).
export async function getAuditLog(documentId) {
  const { rows } = await pool.query(`
    SELECT al.id, al.action, al.user_id, u.nombre AS user_nombre, al.ip, al.user_agent,
           al.metadata, al.created_at
    FROM document_audit_log al
    LEFT JOIN users u ON u.id = al.user_id
    WHERE al.document_id = $1
    ORDER BY al.created_at DESC
  `, [documentId]);
  return rows;
}
