import { query } from '../../shared/config/db.js';
import crypto from 'crypto';

// TODO: las siguientes columnas estan en el CRM hermano pero AUN no existen
// en 001_initial_schema.sql de CRM-ISEIE. Se anadiran en migraciones posteriores
// (ver baseline §8). Hasta entonces se omiten de los SELECT y del UPDATE:
//   - logo_url, logo_key                 (migracion logos por proyecto)
//   - producto_label, producto_label_plural (etiquetas de productos)
//   - shortcuts                          (atajos JSONB)
//   - external_panels                    (paneles externos JSONB)
//   - auto_email_documents               (envio automatico de docs)
//   - lead_base_fields_config            (config de campos base de leads)
//   - lead_columns                       (columnas visibles de leads)

export async function findAll({ active }) {
  const where = active === undefined ? '' : `WHERE p.active = ${active === 'true' || active === true}`;
  const { rows } = await query(
    `SELECT p.id, p.nombre, p.slug, p.type, p.emoji,
            p.modules, p.sidebar_labels, p.theme_color,
            p.webhook_api_key, p.meta_account_id, p.google_account_id,
            p.gsc_property, p.dias_alerta_inactividad, p.active, p.created_at, p.updated_at,
            p.sociedad_emisora_id, s.razon_social AS sociedad_nombre
     FROM projects p
     LEFT JOIN invoice_issuers s ON s.id = p.sociedad_emisora_id
     ${where}
     ORDER BY s.razon_social NULLS LAST, p.nombre ASC`
  );
  return rows;
}

export async function findById(id) {
  const { rows } = await query(
    `SELECT id, nombre, slug, type, emoji,
            modules, sidebar_labels, theme_color,
            webhook_api_key, meta_account_id, google_account_id,
            gsc_property, dias_alerta_inactividad, active, created_at, updated_at
     FROM projects WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function slugExists(slug, excludeId = null) {
  const params = excludeId ? [slug, excludeId] : [slug];
  const clause = excludeId ? 'AND id != $2' : '';
  const { rows } = await query(
    `SELECT id FROM projects WHERE slug = $1 ${clause}`,
    params
  );
  return rows.length > 0;
}

export async function create(data) {
  const webhookKey = `whk_${data.slug.replace(/-/g, '')}_${crypto.randomUUID()}`;
  const { rows } = await query(
    `INSERT INTO projects (nombre, slug, type, emoji, webhook_api_key, meta_account_id,
                           google_account_id, gsc_property, dias_alerta_inactividad)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [data.nombre, data.slug, data.type, data.emoji, webhookKey, data.meta_account_id,
     data.google_account_id, data.gsc_property, data.dias_alerta_inactividad]
  );

  // Inicializar round-robin queue si es CRM
  if (data.type === 'crm') {
    await query(
      `INSERT INTO project_queue_state (project_id, last_assigned_index) VALUES ($1, 0)
       ON CONFLICT DO NOTHING`,
      [rows[0].id]
    );
  }

  return rows[0];
}

export async function update(id, fields) {
  // TODO: cuando se anadan las columnas pendientes (ver cabecera del archivo),
  // re-incluirlas aqui: 'producto_label', 'producto_label_plural', 'logo_url',
  // 'logo_key', 'lead_base_fields_config', 'lead_columns', 'external_panels',
  // 'auto_email_documents'.
  const allowed = ['nombre', 'type', 'emoji', 'meta_account_id', 'google_account_id',
                   'gsc_property', 'dias_alerta_inactividad', 'active',
                   'modules', 'sidebar_labels', 'theme_color'];
  const sets = [];
  const params = [];
  let idx = 1;
  const jsonbFields = new Set(['modules', 'sidebar_labels']);
  // TODO: anadir aqui los JSONB que faltan cuando se creen las columnas:
  //   'lead_base_fields_config', 'lead_columns', 'external_panels'
  for (const k of allowed) {
    if (fields[k] !== undefined) {
      sets.push(`${k} = $${idx++}`);
      params.push(jsonbFields.has(k) ? JSON.stringify(fields[k]) : fields[k]);
    }
  }
  if (!sets.length) return null;
  sets.push(`updated_at = NOW()`);
  params.push(id);
  const { rows } = await query(`UPDATE projects SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, params);
  return rows[0];
}

export async function regenerateWebhookKey(id) {
  const { rows: r1 } = await query(`SELECT slug FROM projects WHERE id = $1`, [id]);
  if (!r1[0]) return null;
  const newKey = `whk_${r1[0].slug.replace(/-/g, '')}_${crypto.randomUUID()}`;
  const { rows } = await query(
    `UPDATE projects SET webhook_api_key = $1, updated_at = NOW() WHERE id = $2 RETURNING webhook_api_key`,
    [newKey, id]
  );
  return rows[0]?.webhook_api_key || null;
}
