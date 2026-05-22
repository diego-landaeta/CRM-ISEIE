import * as model from './permissions.model.js';
import { SYSTEM_ROLE_DEFAULTS, ALL_RESOURCES } from './permissions.defaults.js';
import { SYSTEM_ROLE_VIEWS, DASHBOARD_WIDGETS_CATALOG, SIDEBAR_ITEMS_CATALOG } from './role-views.defaults.js';
import { query } from '../../shared/config/db.js';

// Resuelve si un usuario tiene permiso para resource.action
// Orden de prioridad: superadmin → override personal → custom_role.permissions → SYSTEM_ROLE_DEFAULTS
export async function resolvePermission(userId, role, customRoleId, resource, action) {
  if (role === 'superadmin') return true;

  const key = `${resource}.${action}`;

  // 1. Override personal (máxima prioridad)
  const overrides = await model.getOverridesByUser(userId);
  const override = overrides.find(o => o.resource === resource && o.action === action);
  if (override !== undefined) return override.allowed;

  // 2. Rol custom
  if (customRoleId) {
    const customRole = await model.findCustomRoleById(customRoleId);
    if (customRole && key in customRole.permissions) {
      return customRole.permissions[key];
    }
    // Si el custom role no define este permiso, cae al base_role
    const baseRole = customRole?.base_role || 'gestor';
    return SYSTEM_ROLE_DEFAULTS[baseRole]?.[key] ?? false;
  }

  // 3. Rol fijo del sistema
  return SYSTEM_ROLE_DEFAULTS[role]?.[key] ?? false;
}

// Calcula el mapa completo de permisos para un usuario (para devolver en /auth/me)
export async function buildPermissionsMap(userId, role, customRoleId) {
  if (role === 'superadmin') {
    const all = {};
    for (const [resource, actions] of Object.entries(ALL_RESOURCES)) {
      for (const action of actions) all[`${resource}.${action}`] = true;
    }
    return all;
  }

  // Base: defaults del rol fijo (o del base_role del custom role)
  let baseRole = role;
  let customPermissions = {};

  if (customRoleId) {
    const customRole = await model.findCustomRoleById(customRoleId);
    if (customRole) {
      baseRole = customRole.base_role || 'gestor';
      customPermissions = customRole.permissions || {};
    }
  }

  const base = { ...(SYSTEM_ROLE_DEFAULTS[baseRole] || SYSTEM_ROLE_DEFAULTS.gestor) };

  // Aplicar overrides del custom role
  const merged = { ...base, ...customPermissions };

  // Aplicar overrides personales del usuario (máxima prioridad)
  const overrides = await model.getOverridesByUser(userId);
  for (const { resource, action, allowed } of overrides) {
    merged[`${resource}.${action}`] = allowed;
  }

  return merged;
}

export async function listCustomRoles() {
  return model.findAllCustomRoles();
}

export async function createCustomRole(data) {
  return model.createCustomRole(data);
}

export async function updateCustomRole(id, data) {
  return model.updateCustomRole(id, data);
}

export async function deleteCustomRole(id) {
  return model.deleteCustomRole(id);
}

export async function getUserPermissions(userId) {
  return model.getOverridesByUser(userId);
}

export async function saveUserPermissions(userId, overrides) {
  return model.saveOverridesForUser(userId, overrides);
}

export function getSystemDefaults() {
  return {
    resources: ALL_RESOURCES,
    roles: {
      superadmin: '(acceso total)',
      admin: SYSTEM_ROLE_DEFAULTS.admin,
      gestor: SYSTEM_ROLE_DEFAULTS.gestor,
      soporte: SYSTEM_ROLE_DEFAULTS.soporte,
    },
    views: SYSTEM_ROLE_VIEWS,
    catalogs: {
      dashboard_widgets: DASHBOARD_WIDGETS_CATALOG,
      sidebar_items: SIDEBAR_ITEMS_CATALOG,
    },
  };
}

// Vista efectiva de un rol (fijo o custom)
export async function getRoleView(roleKey) {
  if (SYSTEM_ROLE_VIEWS[roleKey]) {
    return { view: SYSTEM_ROLE_VIEWS[roleKey], is_system: true, role: roleKey };
  }
  // Custom: buscar por id (roleKey puede ser el id del custom_role)
  const id = parseInt(roleKey);
  if (!isNaN(id)) {
    const { rows } = await query(
      `SELECT id, label, base_role, default_view FROM custom_roles WHERE id = $1`, [id]
    );
    if (rows[0]) {
      const baseView = SYSTEM_ROLE_VIEWS[rows[0].base_role] || SYSTEM_ROLE_VIEWS.gestor;
      return {
        view: { ...baseView, ...(rows[0].default_view || {}) },
        is_system: false,
        role: rows[0].label,
        role_id: rows[0].id,
      };
    }
  }
  return null;
}

export async function setCustomRoleView(roleId, viewData) {
  const { rows } = await query(
    `UPDATE custom_roles SET default_view = $1, updated_at = NOW() WHERE id = $2 RETURNING id, default_view`,
    [JSON.stringify(viewData), roleId]
  );
  return rows[0] || null;
}

// Resuelve la vista efectiva de un usuario (rol/custom_role + override personal del proyecto)
export async function resolveUserView(userId, role, customRoleId, projectId = null) {
  const roleKey = customRoleId ? String(customRoleId) : role;
  const roleData = await getRoleView(roleKey);
  let view = roleData?.view || SYSTEM_ROLE_VIEWS.gestor;

  // Overrides personales del usuario en user_views (global + proyecto)
  try {
    const { rows: gRows } = await query(
      `SELECT hidden_sidebar_items, dashboard_widgets FROM user_views WHERE user_id = $1 AND project_id IS NULL LIMIT 1`,
      [userId]
    );
    if (gRows[0]) {
      if (gRows[0].hidden_sidebar_items?.length) view = { ...view, hidden_sidebar_items: gRows[0].hidden_sidebar_items };
      if (gRows[0].dashboard_widgets?.length) view = { ...view, dashboard_widgets: gRows[0].dashboard_widgets };
    }
    if (projectId) {
      const { rows: pRows } = await query(
        `SELECT hidden_sidebar_items, dashboard_widgets FROM user_views WHERE user_id = $1 AND project_id = $2 LIMIT 1`,
        [userId, projectId]
      );
      if (pRows[0]) {
        if (pRows[0].hidden_sidebar_items?.length) view = { ...view, hidden_sidebar_items: pRows[0].hidden_sidebar_items };
        if (pRows[0].dashboard_widgets?.length) view = { ...view, dashboard_widgets: pRows[0].dashboard_widgets };
      }
    }
  } catch { /* user_views puede no estar disponible, no bloquea */ }

  return view;
}
