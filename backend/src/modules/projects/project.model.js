import { query } from '../../shared/config/db.js';
import crypto from 'crypto';

// Las columnas que el arranque de ISEIE dejó fuera «hasta que existieran» ya
// existen (002, 009, 018, 038, 040, 043): el listado y la ficha las devuelven como en
// MultiCRM (paridad, 15/10) y `update` las guarda. Sin ellas, por ejemplo, los atajos
// guardados no volvían a la pantalla de Atajos ni los paneles externos al menú.

export async function findAll({ active }) {
  const where = active === undefined ? '' : `WHERE p.active = ${active === 'true' || active === true}`;
  const { rows } = await query(
    `SELECT p.id, p.nombre, p.slug, p.type, p.emoji, p.logo_key, p.producto_label, p.producto_label_plural,
            p.modules, p.shortcuts, p.external_panels, p.sidebar_labels, p.theme_color, p.auto_email_documents,
            p.logo_url, p.color_cabecera, p.remitente_no_contestar,
            p.webhook_api_key, p.meta_account_id, p.google_account_id,
            p.gsc_property, p.dias_alerta_inactividad, p.active, p.created_at, p.updated_at,
            p.sociedad_emisora_id, s.razon_social AS sociedad_nombre,
            -- País por subdominio (#221, migración 279). Con to_jsonb: sin la
            -- migración sale vacío en vez de tumbar el listado de campus.
            COALESCE(to_jsonb(p) -> 'paises_por_subdominio', '{}'::jsonb) AS paises_por_subdominio
     FROM projects p
     LEFT JOIN invoice_issuers s ON s.id = p.sociedad_emisora_id
     ${where}
     ORDER BY s.razon_social NULLS LAST, p.nombre ASC`
  );
  return rows;
}

export async function findById(id) {
  const { rows } = await query(
    `SELECT id, nombre, slug, type, emoji, logo_key, producto_label, producto_label_plural,
            modules, shortcuts, external_panels, sidebar_labels, theme_color, auto_email_documents,
            logo_url, color_cabecera, remitente_no_contestar,
            webhook_api_key, meta_account_id, google_account_id,
            gsc_property, dias_alerta_inactividad, active, created_at, updated_at,
            COALESCE(to_jsonb(projects) -> 'paises_por_subdominio', '{}'::jsonb) AS paises_por_subdominio
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

// `db` es el pool o el cliente de una transaccion: el alta va en la misma que
// darle el campus a los admins de su empresa (#220, project.service.js).
export async function create(data, db = { query }) {
  const webhookKey = `whk_${data.slug.replace(/-/g, '')}_${crypto.randomUUID()}`;
  const { rows } = await db.query(
    `INSERT INTO projects (nombre, slug, type, emoji, webhook_api_key, meta_account_id,
                           google_account_id, gsc_property, dias_alerta_inactividad, sociedad_emisora_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [data.nombre, data.slug, data.type, data.emoji, webhookKey, data.meta_account_id,
     data.google_account_id, data.gsc_property, data.dias_alerta_inactividad, data.sociedad_emisora_id ?? null]
  );

  // Inicializar round-robin queue si es CRM
  if (data.type === 'crm') {
    await db.query(
      `INSERT INTO project_queue_state (project_id, last_assigned_index) VALUES ($1, 0)
       ON CONFLICT DO NOTHING`,
      [rows[0].id]
    );
  }

  return rows[0];
}

export async function update(id, fields, db = { query }) {
  // Las columnas que el arranque de ISEIE dejó fuera «hasta crearlas» ya existen
  // (009, 002, 018, 040 y 043): se guardan como en MultiCRM. Antes la validación
  // las aceptaba y aquí se tiraban sin avisar. `client_columns` y `product_columns`
  // no están en ISEIE (son la 140 y la 141 de MultiCRM).
  const allowed = ['nombre', 'type', 'emoji', 'meta_account_id', 'google_account_id',
                   'gsc_property', 'dias_alerta_inactividad', 'active',
                   'producto_label', 'producto_label_plural', 'logo_url', 'logo_key', 'modules',
                   'lead_base_fields_config', 'lead_columns', 'external_panels', 'sidebar_labels',
                   'theme_color', 'auto_email_documents', 'sociedad_emisora_id',
                   // La marca en correos y formularios (migraciones 168 y 170).
                   'color_cabecera', 'remitente_no_contestar',
                   // País por subdominio (#221, migración 279).
                   'paises_por_subdominio'];
  const sets = [];
  const params = [];
  let idx = 1;
  const jsonbFields = new Set(['modules', 'lead_base_fields_config', 'lead_columns',
    'external_panels', 'sidebar_labels', 'paises_por_subdominio']);
  for (const k of allowed) {
    if (fields[k] !== undefined) {
      sets.push(`${k} = $${idx++}`);
      params.push(jsonbFields.has(k) ? JSON.stringify(fields[k]) : fields[k]);
    }
  }
  if (!sets.length) return null;
  sets.push(`updated_at = NOW()`);
  params.push(id);
  const { rows } = await db.query(`UPDATE projects SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, params);
  return rows[0];
}

/** La empresa de un campus, bloqueando la fila hasta el final de la transaccion. */
export async function sociedadDelProyecto(id, db = { query }) {
  const { rows } = await db.query('SELECT sociedad_emisora_id FROM projects WHERE id = $1 FOR UPDATE', [id]);
  return rows[0] ? (rows[0].sociedad_emisora_id == null ? null : Number(rows[0].sociedad_emisora_id)) : undefined;
}

// --- Sociedades emisoras (globales, project_id NULL) para el selector de proyecto ---
export async function listSociedades() {
  const { rows } = await query(
    `SELECT id, razon_social, nif, serie, pais
     FROM invoice_issuers
     WHERE project_id IS NULL AND activo = true
     ORDER BY razon_social ASC`
  );
  return rows;
}

export async function createSociedad({ razon_social, serie, nif, pais }) {
  const { rows } = await query(
    `INSERT INTO invoice_issuers (project_id, razon_social, nif, pais, serie, es_default, activo)
     VALUES (NULL, $1, $2, $3, $4, false, true)
     RETURNING id, razon_social, nif, serie, pais`,
    [razon_social, nif || `PENDIENTE-CIF-${(serie || 'X').toUpperCase()}`, pais || 'España', serie || null]
  );
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
