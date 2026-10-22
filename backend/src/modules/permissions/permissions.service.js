import * as model from './permissions.model.js';
import { SYSTEM_ROLE_DEFAULTS, ALL_RESOURCES } from './permissions.defaults.js';
import { SYSTEM_ROLE_VIEWS, DASHBOARD_WIDGETS_CATALOG, SIDEBAR_ITEMS_CATALOG } from './role-views.defaults.js';
import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
// Un array de un ENUM puede llegar como texto crudo: se entiende en un sitio.
import { comoLista } from '../../shared/utils/roles.js';

/**
 * Los permisos por defecto de un rol del sistema con lo que se le haya cambiado
 * desde Configuración › Roles (tabla role_permission_overrides, migración 211;
 * en MultiCRM la 197). `filas` son las excepciones ya leídas; se filtran por el rol.
 */
export function defaultsDelRol(role, filas = [], respaldo = null) {
  const out = { ...(SYSTEM_ROLE_DEFAULTS[role] || respaldo || {}) };
  for (const f of filas) {
    if (f.role === role) out[`${f.resource}.${f.action}`] = f.allowed;
  }
  return out;
}

// Resuelve si un usuario tiene permiso para resource.action
// Orden de prioridad: superadmin → override personal → custom_role.permissions
// → lo cambiado en Roles para su rol (211) → SYSTEM_ROLE_DEFAULTS
export async function resolvePermission(userId, role, customRoleId, resource, action, rolesExtra = []) {
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
    const filas = await model.getRoleOverrides([baseRole]);
    return defaultsDelRol(baseRole, filas)[key] ?? false;
  }

  // 3. Rol fijo del sistema, y los añadidos: basta con que uno lo permita.
  const todos = [role, ...comoLista(rolesExtra)];
  const filas = await model.getRoleOverrides(todos);
  return todos.some((r) => defaultsDelRol(r, filas)[key] === true);
}

// Calcula el mapa completo de permisos para un usuario (para devolver en /auth/me)
/**
 * El mapa de permisos de un usuario. CON VARIOS ROLES, MANDA EL QUE MAS DEJA:
 * si se cruzaran al reves, añadir un rol QUITARIA permisos.
 */
export async function buildPermissionsMap(userId, role, customRoleId, rolesExtra = []) {
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

  // Lo cambiado en Roles (211) para su rol y sus roles de más, de una vez.
  const filas = await model.getRoleOverrides([baseRole, ...comoLista(rolesExtra)]);
  const base = defaultsDelRol(baseRole, filas, SYSTEM_ROLE_DEFAULTS.gestor);

  // Los roles de mas, sumados encima: basta con que UNO lo permita.
  for (const extra of comoLista(rolesExtra)) {
    if (!SYSTEM_ROLE_DEFAULTS[extra] && !filas.some((f) => f.role === extra)) continue;
    const suyos = defaultsDelRol(extra, filas);
    for (const [clave, vale] of Object.entries(suyos)) {
      if (vale === true) base[clave] = true;
    }
  }

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

export async function getSystemDefaults() {
  // Con lo cambiado en Roles ya aplicado: la pantalla enseña lo que manda. Los
  // roles a los que se les da una clave suelta (Diplomas, #223) también.
  const filas = await model.getRoleOverrides([...new Set([
    ...ROLES_EDITABLES, ...Object.values(CLAVES_SUELTAS).flatMap((c) => c.roles),
  ])]);
  return {
    resources: ALL_RESOURCES,
    roles: {
      superadmin: '(acceso total)',
      admin: defaultsDelRol('admin', filas),
      gestor: defaultsDelRol('gestor', filas),
      soporte: defaultsDelRol('soporte', filas),
      colaborador: defaultsDelRol('colaborador', filas),
      // Como en MultiCRM: el project manager parte de los de gestor.
      project_manager: defaultsDelRol('project_manager', filas, SYSTEM_ROLE_DEFAULTS.gestor),
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

/* --- Permisos de Tareas por rol, desde Configuración › Roles (Diego 08/10) --- */

// Roles del sistema a los que se les pueden cambiar los permisos de Tareas: los
// que tienen tablero (ROLES_TAREAS) menos el superadmin, que lo puede todo.
// Gestora, soporte, project manager y tutor no tienen tablero (Diego, 09/10).
export const ROLES_EDITABLES = ['admin', 'colaborador'];
// Solo estas dos (Diego, 08/10: «editar tasks.close y tasks.manage por rol»).
// El resto de claves de Tareas sigue en los valores del rol y en las
// excepciones de cada persona.
export const CLAVES_EDITABLES = ['tasks.close', 'tasks.manage'];

function rolDeLaClave(roleKey) {
  const m = /^custom:(\d+)$/.exec(String(roleKey));
  if (m) return { custom: Number(m[1]) };
  if (!ROLES_EDITABLES.includes(roleKey)) return null;
  return { role: roleKey };
}

/** Los permisos de Tareas editables de un rol, como mandan ahora. */
export async function getRoleTaskPermissions(roleKey) {
  const r = rolDeLaClave(roleKey);
  if (!r) return null;
  let efectivos;
  if (r.custom) {
    const custom = await model.findCustomRoleById(r.custom);
    if (!custom) return null;
    const base = custom.base_role || 'gestor';
    efectivos = { ...defaultsDelRol(base, await model.getRoleOverrides([base]), SYSTEM_ROLE_DEFAULTS.gestor), ...(custom.permissions || {}) };
  } else {
    efectivos = defaultsDelRol(r.role, await model.getRoleOverrides([r.role]), SYSTEM_ROLE_DEFAULTS.gestor);
  }
  return {
    roleKey,
    permissions: Object.fromEntries(CLAVES_EDITABLES.map((k) => [k, efectivos[k] === true])),
  };
}

/**
 * Guarda los permisos de Tareas de un rol. En un rol del sistema se apuntan
 * solo los que se apartan del código (tabla 211); en uno a medida se fusionan
 * en su JSON sin tocar el resto de claves.
 */
export async function saveRoleTaskPermissions(roleKey, permissions, updatedBy) {
  const r = rolDeLaClave(roleKey);
  if (!r) return null;
  if (r.custom) {
    const custom = await model.findCustomRoleById(r.custom);
    if (!custom) return null;
    await model.mergeCustomRolePermissions(r.custom, permissions);
    return getRoleTaskPermissions(roleKey);
  }
  const deFabrica = { ...(SYSTEM_ROLE_DEFAULTS[r.role] || SYSTEM_ROLE_DEFAULTS.gestor) };
  const actuales = defaultsDelRol(r.role, await model.getRoleOverrides([r.role]), SYSTEM_ROLE_DEFAULTS.gestor);
  const deseados = { ...actuales, ...permissions };
  const filas = CLAVES_EDITABLES
    .filter((k) => (deseados[k] === true) !== (deFabrica[k] === true))
    .map((k) => ({ action: k.slice('tasks.'.length), allowed: deseados[k] === true }));
  await model.saveRoleOverrides(r.role, 'tasks', filas, updatedBy);
  return getRoleTaskPermissions(roleKey);
}

/* --- Una clave suelta, por rol y por persona: «Diplomas (Certifex) · Ver» (#223; en MultiCRM, #384) --- */

/*
  Diego (MultiCRM #384, aquí #223): «Adriana, Daniela, Yosbely, Dayana, Mireia y Ana deben de tener
  para ver los de Certifex». Se da desde Configuración › Roles a un rol entero
  (todo «Gestor») o a una persona.

  `roles`: a qué roles del sistema se les puede dar, y de qué rol PRINCIPAL
  tiene que ser una persona para dárselo suelto. Admin y superadmin, no: lo ven
  por su rol, y quitárselo aquí no cambiaría nada. Un tutor tampoco —vería los
  diplomas de los alumnos de sus campus—, ni un colaborador, al que el servidor
  no deja entrar a Certifex. Un rol a medida, siempre.

  Va aparte de los permisos de Tareas a propósito: aquello está probado y
  esto no tiene por qué tocarlo.

  «Diplomas (Certifex) · Emitir» (Diego, 22/10/2026: «que Dayana pueda emitir,
  no la dejan; puede hacerlo»; la misma clave en los dos CRM): a los mismos
  roles y del mismo modo. Revisar, pasar a Pendientes, aprobar y emitir y
  enviar el diploma al alumno, siempre en sus campus; rechazar, corregir y
  revocar siguen siendo de administración.
*/
export const CLAVES_SUELTAS = {
  'diplomas.view': { roles: ['gestor', 'soporte', 'project_manager'] },
  'diplomas.emit': { roles: ['gestor', 'soporte', 'project_manager'] },
};

function laClave(clave) {
  const conf = CLAVES_SUELTAS[clave];
  if (!conf) throw new AppError(`Ese permiso no se cambia desde aquí (${clave})`, 400, 'CLAVE_NO_EDITABLE');
  const i = clave.indexOf('.');
  return { ...conf, resource: clave.slice(0, i), action: clave.slice(i + 1) };
}

function elRol(conf, roleKey) {
  const m = /^custom:(\d+)$/.exec(String(roleKey || ''));
  if (m) return { custom: Number(m[1]) };
  if (!conf.roles.includes(roleKey)) {
    throw new AppError('A ese rol no se le cambia esto: admin y superadmin ya lo tienen por su rol, y tutor y colaborador no lo pueden tener', 400, 'ROLE_NOT_EDITABLE');
  }
  return { role: roleKey };
}

/** Si un rol tiene la clave, como manda ahora (lo cambiado en Roles incluido). */
export async function getClaveDeRol(clave, roleKey) {
  const conf = laClave(clave);
  const r = elRol(conf, roleKey);
  if (r.custom) {
    const custom = await model.findCustomRoleById(r.custom);
    if (!custom) throw new AppError('Ese rol no existe', 404, 'NOT_FOUND');
    const base = custom.base_role || 'gestor';
    const efectivos = {
      ...defaultsDelRol(base, await model.getRoleOverrides([base]), SYSTEM_ROLE_DEFAULTS.gestor),
      ...(custom.permissions || {}),
    };
    return { roleKey, clave, permitido: efectivos[clave] === true };
  }
  const efectivos = defaultsDelRol(r.role, await model.getRoleOverrides([r.role]), SYSTEM_ROLE_DEFAULTS.gestor);
  return { roleKey, clave, permitido: efectivos[clave] === true };
}

/**
 * Dársela o quitársela a un rol entero. En uno del sistema se apunta solo si se
 * aparta del código (tabla de la 211), sin tocar las demás acciones del recurso;
 * en uno a medida se fusiona en su JSON.
 */
export async function setClaveDeRol(clave, roleKey, permitido, updatedBy) {
  const conf = laClave(clave);
  const r = elRol(conf, roleKey);
  if (r.custom) {
    if (!(await model.findCustomRoleById(r.custom))) throw new AppError('Ese rol no existe', 404, 'NOT_FOUND');
    await model.mergeCustomRolePermissions(r.custom, { [clave]: permitido === true });
    return getClaveDeRol(clave, roleKey);
  }
  const deFabrica = SYSTEM_ROLE_DEFAULTS[r.role]?.[clave] === true;
  const otras = (await model.getRoleOverrides([r.role]))
    .filter((f) => f.role === r.role && f.resource === conf.resource && f.action !== conf.action)
    .map(({ action, allowed }) => ({ action, allowed }));
  const filas = (permitido === true) === deFabrica ? otras : [...otras, { action: conf.action, allowed: permitido === true }];
  await model.saveRoleOverrides(r.role, conf.resource, filas, updatedBy);
  return getClaveDeRol(clave, roleKey);
}

const esSuperadmin = (quien) => quien?.role === 'superadmin';

/**
 * Las personas de un rol, con la clave como la tienen: por su rol, o con una
 * excepción suya (`excepcion`: true, false o null si no la hay).
 *
 * Un admin ve solo a quien comparte algún campus con él (#245): no se reparten
 * permisos a la gente de otra empresa. El super admin, a todos.
 */
export async function personasDeLaClave(clave, roleKey, quien) {
  const conf = laClave(clave);
  const r = elRol(conf, roleKey);
  const { rows } = await query(
    `SELECT u.id, u.nombre, u.email, u.role, u.custom_role_id, u.roles_extra::text[] AS roles_extra,
            o.allowed AS excepcion
       FROM users u
       LEFT JOIN user_permission_overrides o
              ON o.user_id = u.id AND o.resource = $1 AND o.action = $2
      WHERE u.active
        AND ${r.custom ? 'u.custom_role_id = $3::int' : 'u.role::text = $3 AND u.custom_role_id IS NULL'}
        AND u.role::text = ANY($5::text[])
        AND ($4::int IS NULL OR EXISTS (
              SELECT 1 FROM user_projects mio
                JOIN user_projects suyo ON suyo.project_id = mio.project_id AND suyo.active
               WHERE mio.user_id = $4 AND mio.active AND suyo.user_id = u.id))
      ORDER BY u.nombre`,
    [conf.resource, conf.action, r.custom ?? r.role, esSuperadmin(quien) ? null : quien?.userId ?? -1, conf.roles]
  );
  return Promise.all(rows.map(async (u) => ({
    id: u.id,
    nombre: u.nombre,
    email: u.email,
    excepcion: u.excepcion === null || u.excepcion === undefined ? null : u.excepcion === true,
    puede: await resolvePermission(u.id, u.role, u.custom_role_id, conf.resource, conf.action, u.roles_extra),
  })));
}

/**
 * Dársela (`true`), quitársela (`false`) o dejarla como diga su rol (`null`) a
 * una persona. Solo cambia ESA clave: las demás excepciones suyas se quedan
 * como estaban (el PUT de /users/:id/permissions las sustituye todas).
 */
export async function setClaveDePersona(clave, userId, permitido, quien) {
  const conf = laClave(clave);
  const { rows: [u] } = await query(
    'SELECT id, role, custom_role_id, roles_extra::text[] AS roles_extra FROM users WHERE id = $1', [userId]);
  const esDeLosSuyos = u && (esSuperadmin(quien) || (await query(
    `SELECT 1 FROM user_projects mio
       JOIN user_projects suyo ON suyo.project_id = mio.project_id AND suyo.active
      WHERE mio.user_id = $1 AND mio.active AND suyo.user_id = $2 LIMIT 1`,
    [quien?.userId ?? -1, userId])).rows.length > 0);
  if (!esDeLosSuyos) throw new AppError('Usuario no encontrado', 404, 'NOT_FOUND');
  if (['superadmin', 'admin'].includes(u.role)) {
    throw new AppError('Ya lo tiene por su rol: no hace falta dárselo', 400, 'YA_LO_TIENE');
  }
  if (!conf.roles.includes(u.role)) {
    throw new AppError('A una persona con ese rol no se le puede dar esto', 400, 'ROLE_NOT_EDITABLE');
  }
  await model.setUserOverride(userId, conf.resource, conf.action, permitido);
  return {
    id: u.id,
    excepcion: permitido,
    puede: await resolvePermission(u.id, u.role, u.custom_role_id, conf.resource, conf.action, u.roles_extra),
  };
}
