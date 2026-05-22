// CRM-185 fase 2: plantillas de email configurables por proyecto.
// Renderizado de variables tipo {{path.to.var}} con un contexto plano/anidado.

import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';

// Variables disponibles para substitucion. Documentado para el editor.
export const TEMPLATE_VARIABLES = [
  { token: '{{lead.nombre}}',    desc: 'Nombre del lead' },
  { token: '{{lead.email}}',     desc: 'Email del lead' },
  { token: '{{lead.telefono}}',  desc: 'Telefono del lead' },
  { token: '{{lead.producto}}',  desc: 'Producto de interes del lead' },
  { token: '{{project.nombre}}', desc: 'Nombre del proyecto' },
  { token: '{{user.nombre}}',    desc: 'Nombre del usuario que envia' },
];

// Resuelve una ruta tipo "lead.nombre" en un objeto anidado.
function resolvePath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

// Substitucion de {{var}} con sanitizacion minima (las plantillas estan
// guardadas por admin/superadmin de confianza, pero igual escapamos los
// valores dinamicos para evitar XSS si un nombre lleva HTML).
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderTemplate(template, ctx) {
  if (!template) return '';
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const val = resolvePath(ctx, path);
    if (val === undefined || val === null) return '';
    return escapeHtml(val);
  });
}

// CRUD basico
export async function listByProject(projectId, { includeInactive = false } = {}) {
  const sql = includeInactive
    ? `SELECT t.*, u.nombre AS created_by_nombre
       FROM email_templates t LEFT JOIN users u ON u.id = t.created_by
       WHERE t.project_id = $1 ORDER BY t.created_at DESC`
    : `SELECT t.*, u.nombre AS created_by_nombre
       FROM email_templates t LEFT JOIN users u ON u.id = t.created_by
       WHERE t.project_id = $1 AND t.active = true ORDER BY t.created_at DESC`;
  const { rows } = await query(sql, [projectId]);
  return rows;
}

export async function getById(id, projectId) {
  const { rows } = await query(
    `SELECT t.*, u.nombre AS created_by_nombre
     FROM email_templates t LEFT JOIN users u ON u.id = t.created_by
     WHERE t.id = $1`,
    [id]
  );
  const template = rows[0];
  if (!template) throw new AppError('Plantilla no encontrada', 404, 'NOT_FOUND');
  if (template.project_id !== projectId) throw new AppError('Sin acceso', 403, 'FORBIDDEN');
  return template;
}

export async function create({ projectId, userId, name, subject, body_html, description }) {
  const { rows } = await query(
    `INSERT INTO email_templates (project_id, created_by, name, subject, body_html, description)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [projectId, userId, name, subject, body_html, description || null]
  );
  return rows[0];
}

export async function update(id, projectId, data) {
  await getById(id, projectId);
  const allowed = ['name', 'subject', 'body_html', 'description', 'active'];
  const fields = [];
  const values = [];
  let idx = 1;
  for (const k of allowed) {
    if (data[k] !== undefined) { fields.push(`${k} = $${idx++}`); values.push(data[k]); }
  }
  if (fields.length === 0) return getById(id, projectId);
  fields.push(`updated_at = NOW()`);
  values.push(id);
  const { rows } = await query(
    `UPDATE email_templates SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return rows[0];
}

export async function remove(id, projectId) {
  await getById(id, projectId);
  await query(`DELETE FROM email_templates WHERE id = $1`, [id]);
}
