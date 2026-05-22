import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';

const DEFAULT_VIEW = {
  hidden_sidebar_items: [],
  lead_columns_override: null,
  client_columns_override: null,
  dashboard_widgets: [],
  saved_filters: [],
  table_density: 'comfortable',
  theme_preference: null,
  language: 'es',
};

function canEdit(actor, targetUserId) {
  return actor.role === 'superadmin' || actor.id === Number(targetUserId);
}

export async function getViews(req, res, next) {
  try {
    const userId = parseInt(req.params.id);
    const projectId = req.query.projectId ? parseInt(req.query.projectId) : null;
    if (!canEdit(req.user, userId)) throw new AppError('Solo superadmin o el propio user', 403, 'FORBIDDEN');

    const { rows: globalRows } = await query(
      `SELECT * FROM user_views WHERE user_id = $1 AND project_id IS NULL`, [userId]);
    let projectRow = null;
    if (projectId) {
      const { rows } = await query(
        `SELECT * FROM user_views WHERE user_id = $1 AND project_id = $2`, [userId, projectId]);
      projectRow = rows[0] || null;
    }
    // Merge: project override > global > defaults
    const merged = { ...DEFAULT_VIEW, ...(globalRows[0] || {}), ...(projectRow || {}) };
    res.json({ success: true, data: merged });
  } catch (err) { next(err); }
}

export async function setViews(req, res, next) {
  try {
    const userId = parseInt(req.params.id);
    const projectId = req.body?.projectId ? parseInt(req.body.projectId) : null;
    if (!canEdit(req.user, userId)) throw new AppError('Solo superadmin o el propio user', 403, 'FORBIDDEN');

    const fields = req.body || {};
    const allowed = [
      'hidden_sidebar_items', 'lead_columns_override', 'client_columns_override',
      'dashboard_widgets', 'saved_filters', 'table_density', 'theme_preference', 'language',
    ];
    const cols = ['user_id', 'project_id'];
    const values = [userId, projectId];
    let placeholders = ['$1', '$2'];
    let i = 3;
    const updates = [];
    for (const k of allowed) {
      if (fields[k] !== undefined) {
        cols.push(k);
        const isJson = ['hidden_sidebar_items', 'lead_columns_override', 'client_columns_override', 'dashboard_widgets', 'saved_filters'].includes(k);
        if (k === 'hidden_sidebar_items' && Array.isArray(fields[k])) {
          values.push(fields[k]);  // text[]
        } else if (isJson) {
          values.push(JSON.stringify(fields[k]));
        } else {
          values.push(fields[k]);
        }
        placeholders.push(`$${i}`);
        updates.push(`${k} = EXCLUDED.${k}`);
        i++;
      }
    }
    cols.push('updated_at');
    values.push(new Date());
    placeholders.push(`$${i}`);
    updates.push(`updated_at = NOW()`);

    const sql = `INSERT INTO user_views (${cols.join(', ')}) VALUES (${placeholders.join(', ')})
                 ON CONFLICT (user_id, COALESCE(project_id, 0)) DO UPDATE SET ${updates.join(', ')}
                 RETURNING *`;
    const { rows } = await query(sql, values);
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
}
