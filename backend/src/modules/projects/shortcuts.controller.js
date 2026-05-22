import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';

// GET /api/projects/:id/queue-state — orden round-robin de gestores + siguiente
export async function getQueueState(req, res, next) {
  try {
    const projectId = parseInt(req.params.id);
    if (isNaN(projectId)) throw new AppError('ID invalido', 400, 'INVALID_ID');

    const { rows: gestores } = await query(
      `SELECT u.id, u.nombre, u.email, u.avatar_url, up.orden_cola, u.active
       FROM user_projects up
       JOIN users u ON u.id = up.user_id
       WHERE up.project_id = $1 AND up.active = true
         AND u.active = true
         AND u.role IN ('admin', 'gestor')
       ORDER BY up.orden_cola, u.id`,
      [projectId]
    );

    const { rows: state } = await query(
      `SELECT last_assigned_index, last_assigned_user_id, updated_at
       FROM project_queue_state WHERE project_id = $1`,
      [projectId]
    );

    const lastIndex = state[0]?.last_assigned_index ?? -1;
    const nextIndex = gestores.length > 0 ? (lastIndex + 1) % gestores.length : null;
    const nextGestor = nextIndex !== null ? gestores[nextIndex] : null;
    const lastGestor = state[0]?.last_assigned_user_id
      ? gestores.find(g => g.id === state[0].last_assigned_user_id) || null
      : null;

    res.json({
      success: true,
      data: {
        gestores,
        last_assigned_at: state[0]?.updated_at || null,
        last_gestor: lastGestor,
        next_gestor: nextGestor,
      },
    });
  } catch (err) { next(err); }
}

// Catálogo fijo de atajos disponibles del CRM hermano. Aquí se expone como
// referencia para el frontend; la persistencia (`projects.shortcuts` JSONB)
// vendrá en una migración posterior cuando se porte el módulo completo.
export const SHORTCUTS_CATALOG = [
  { id: 'new_lead',     label: 'Nuevo prospecto', icon: 'UserPlus',     route: '/leads?new=1' },
  { id: 'new_client',   label: 'Nuevo cliente',   icon: 'Building',     route: '/clientes?new=1' },
  { id: 'new_product',  label: 'Nuevo producto',  icon: 'Package',      route: '/products?new=1' },
  { id: 'new_form',     label: 'Nuevo formulario', icon: 'FileText',    route: '/formularios?new=1' },
  { id: 'new_webhook',  label: 'Nuevo webhook',   icon: 'Webhook',      route: '/webhooks?new=1' },
  { id: 'send_email',   label: 'Enviar email',    icon: 'Envelope',     action: 'open_email_dialog' },
  { id: 'reminder',     label: 'Crear recordatorio', icon: 'Bell',      action: 'open_reminder_dialog' },
  { id: 'note',         label: 'Nueva nota',      icon: 'NotePencil',   action: 'open_note_dialog' },
  { id: 'sync_wc',      label: 'Sincronizar WC',  icon: 'ArrowsClockwise', action: 'sync_woocommerce' },
  { id: 'reports',      label: 'Ver reportes',    icon: 'ChartBar',     route: '/reports' },
];

// GET /api/projects/shortcuts/catalog (todos los autenticados)
export async function getCatalog(req, res) {
  res.json({ success: true, data: SHORTCUTS_CATALOG });
}
