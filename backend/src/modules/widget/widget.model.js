import { query } from '../../shared/config/db.js';

const DEFAULT_CONFIG = {
  enabled: true,
  welcome_text: '¡Hablamos? 👋',
  message_template: 'Hola, soy {{nombre}} de {{project}}. Quiero información sobre: {{url}}',
  excluded_user_ids: [],
  show_bubble: true,
  bubble_delay_ms: 3000,
};

export async function getConfig(projectId) {
  const { rows } = await query(
    `SELECT pwc.*, p.nombre AS project_nombre, p.slug AS project_slug
     FROM projects p
     LEFT JOIN project_widget_config pwc ON pwc.project_id = p.id
     WHERE p.id = $1`,
    [projectId]
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    project_id: projectId,
    project_nombre: r.project_nombre,
    project_slug: r.project_slug,
    enabled: r.enabled ?? DEFAULT_CONFIG.enabled,
    welcome_text: r.welcome_text || DEFAULT_CONFIG.welcome_text,
    message_template: r.message_template || DEFAULT_CONFIG.message_template,
    excluded_user_ids: r.excluded_user_ids || [],
    show_bubble: r.show_bubble ?? DEFAULT_CONFIG.show_bubble,
    bubble_delay_ms: r.bubble_delay_ms ?? DEFAULT_CONFIG.bubble_delay_ms,
    updated_at: r.updated_at,
  };
}

export async function upsertConfig(projectId, fields) {
  const cur = await getConfig(projectId);
  if (!cur) throw new Error('Proyecto no existe');
  const merged = {
    enabled:           fields.enabled           ?? cur.enabled,
    welcome_text:      fields.welcome_text      ?? cur.welcome_text,
    message_template:  fields.message_template  ?? cur.message_template,
    excluded_user_ids: fields.excluded_user_ids ?? cur.excluded_user_ids,
    show_bubble:       fields.show_bubble       ?? cur.show_bubble,
    bubble_delay_ms:   fields.bubble_delay_ms   ?? cur.bubble_delay_ms,
  };
  await query(
    `INSERT INTO project_widget_config
       (project_id, enabled, welcome_text, message_template, excluded_user_ids, show_bubble, bubble_delay_ms, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
     ON CONFLICT (project_id) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       welcome_text = EXCLUDED.welcome_text,
       message_template = EXCLUDED.message_template,
       excluded_user_ids = EXCLUDED.excluded_user_ids,
       show_bubble = EXCLUDED.show_bubble,
       bubble_delay_ms = EXCLUDED.bubble_delay_ms,
       updated_at = NOW()`,
    [projectId, merged.enabled, merged.welcome_text, merged.message_template, merged.excluded_user_ids,
     merged.show_bubble, merged.bubble_delay_ms]
  );
  return await getConfig(projectId);
}

// Lista usuarios candidatos al widget = SOLO los del proyecto activos
export async function listCandidateUsers(projectId) {
  const { rows } = await query(
    `SELECT u.id, u.nombre, u.email, u.role, u.active,
            u.whatsapp_phone, u.whatsapp_display_name, u.whatsapp_widget_active,
            true AS in_project
     FROM users u
     JOIN user_projects up ON up.user_id = u.id AND up.project_id = $1 AND up.active = true
     WHERE u.active = true
     ORDER BY u.whatsapp_widget_active DESC, u.nombre ASC`,
    [projectId]
  );
  return rows;
}

// Lista usuarios que SI entran al widget (publico)
export async function listActiveWidgetUsers(projectId, excludedIds = []) {
  const { rows } = await query(
    `SELECT u.id, u.nombre, COALESCE(u.whatsapp_display_name, u.nombre) AS display_name,
            u.whatsapp_phone
     FROM users u
     JOIN user_projects up ON up.user_id = u.id AND up.project_id = $1 AND up.active = true
     WHERE u.active = true
       AND u.whatsapp_widget_active = true
       AND u.whatsapp_phone IS NOT NULL
       AND u.whatsapp_phone != ''
       AND NOT (u.id = ANY($2::int[]))
     ORDER BY u.nombre`,
    [projectId, excludedIds]
  );
  return rows;
}

export async function updateUserPhone(userId, { whatsapp_phone, whatsapp_display_name, whatsapp_widget_active }) {
  await query(
    `UPDATE users SET
       whatsapp_phone = COALESCE($2, whatsapp_phone),
       whatsapp_display_name = COALESCE($3, whatsapp_display_name),
       whatsapp_widget_active = COALESCE($4, whatsapp_widget_active),
       updated_at = NOW()
     WHERE id = $1`,
    [userId, whatsapp_phone ?? null, whatsapp_display_name ?? null, whatsapp_widget_active ?? null]
  );
}
