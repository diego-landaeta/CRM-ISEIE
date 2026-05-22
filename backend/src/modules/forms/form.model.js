import crypto from 'crypto';
import { query } from '../../shared/config/db.js';

export async function findAll(projectId, kind = null) {
  if (kind) {
    // COALESCE para tratar NULL legacy como 'form'
    const { rows } = await query(
      `SELECT * FROM form_templates WHERE project_id = $1 AND COALESCE(kind, 'form') = $2 ORDER BY created_at DESC`,
      [projectId, kind]
    );
    return rows;
  }
  const { rows } = await query(`SELECT * FROM form_templates WHERE project_id = $1 ORDER BY created_at DESC`, [projectId]);
  return rows;
}
export async function findById(id) {
  const { rows } = await query(`SELECT * FROM form_templates WHERE id = $1`, [id]);
  return rows[0] || null;
}
export async function findByEmbed(embedId) {
  const { rows } = await query(
    `SELECT f.*, p.nombre as project_nombre, p.emoji as project_emoji, p.logo_url as project_logo, p.producto_label, p.producto_label_plural
       FROM form_templates f JOIN projects p ON p.id = f.project_id WHERE f.embed_id = $1 AND f.active = true`,
    [embedId]
  );
  return rows[0] || null;
}
export async function create(data) {
  // Prefijo del embed_id según kind+modo: frm/whk/mlh
  const isWebhook = data.kind === 'webhook';
  const isMailOnly = isWebhook && data.webhook_mode === 'email';
  const prefix = !isWebhook ? 'frm' : (isMailOnly ? 'mlh' : 'whk');
  const embedId = `${prefix}_${crypto.randomBytes(10).toString('hex')}`;
  // Webhooks arrancan en modo escucha por defecto (estilo Make/Zapier)
  const startsListening = isWebhook;
  const { rows } = await query(
    `INSERT INTO form_templates (project_id, embed_id, nombre, template_kind, kind, webhook_mode, destination, schema, config, field_mapping, active, awaiting_sample, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
    [data.project_id, embedId, data.nombre, data.template_kind || 'contacto_basico',
     data.kind || 'form', data.webhook_mode || 'both', data.destination || 'lead',
     JSON.stringify(data.schema || {}), JSON.stringify(data.config || {}),
     JSON.stringify(data.field_mapping || {}),
     data.active !== false, startsListening, data.created_by || null]
  );
  return rows[0];
}
export async function update(id, fields) {
  const allowed = ['nombre', 'template_kind', 'schema', 'config', 'active', 'kind', 'webhook_mode', 'field_mapping', 'destination', 'default_product_id', 'url_match_enabled'];
  const jsonbFields = new Set(['schema', 'config', 'field_mapping']);
  const sets = []; const params = []; let idx = 1;
  for (const k of allowed) if (fields[k] !== undefined) {
    sets.push(`${k} = $${idx++}`);
    params.push(jsonbFields.has(k) ? JSON.stringify(fields[k]) : fields[k]);
  }
  if (!sets.length) return null;
  sets.push(`updated_at = NOW()`); params.push(id);
  const { rows } = await query(`UPDATE form_templates SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, params);
  return rows[0];
}
export async function remove(id) { await query(`DELETE FROM form_templates WHERE id = $1`, [id]); }

// Historial de eventos: cada submission queda registrada con su payload + resultado
export async function logEvent({ form_template_id, source, payload, status, result_type, result_id, error_message, ip_address }) {
  try {
    await query(
      `INSERT INTO form_template_events (form_template_id, source, payload, status, result_type, result_id, error_message, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [form_template_id, source, JSON.stringify(payload || {}), status, result_type || null, result_id || null, error_message || null, ip_address || null]
    );
  } catch { /* silencioso - no bloquear el handler si falla el log */ }
}

export async function listEvents(form_template_id, limit = 50) {
  const { rows } = await query(
    `SELECT id, source, payload, status, result_type, result_id, error_message, ip_address, created_at
     FROM form_template_events
     WHERE form_template_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [form_template_id, limit]
  );
  return rows;
}
export async function incrementSubmissions(id) {
  await query(`UPDATE form_templates SET submissions_count = submissions_count + 1, updated_at = NOW() WHERE id = $1`, [id]);
}

export async function setListenMode(id, awaiting) {
  const sets = ['awaiting_sample = $2'];
  if (awaiting) sets.push('sample_payload = NULL', 'sample_received_at = NULL');
  const { rows } = await query(`UPDATE form_templates SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`, [id, awaiting]);
  return rows[0];
}

export async function saveSample(id, payload) {
  const { rows } = await query(
    `UPDATE form_templates SET sample_payload = $2, sample_received_at = NOW(), awaiting_sample = false, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, JSON.stringify(payload)]
  );
  return rows[0];
}
