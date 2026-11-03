/**
 * CÓMO SE DECIDÍA QUIÉN PASA, ANTES DE #423. Copia congelada.
 *
 * Esto NO lo usa el CRM para nada. Es la vara de medir del «antes»: el script
 * `scripts/comparar-permisos.mjs` y las pruebas evalúan aquí lo que una persona
 * podía hacer hasta hoy, y en el catálogo nuevo lo que puede ahora. Si las dos
 * respuestas no coinciden, es una diferencia, y una diferencia o está aprobada
 * por Diego (`cambios-aprobados.js`) o es un fallo.
 *
 * Por eso no importa nada del código vivo —ni `roleGuard`, ni
 * `resolvePermission`, ni los valores por defecto—: si la fase 4 los cambia, el
 * «antes» tiene que seguir diciendo lo mismo. Los valores por defecto salen de
 * la foto `defaults-antes-423.js`.
 *
 * Una PERSONA aquí es un objeto plano, el que arma `perfilDesdeFilas`:
 *
 *   { id, role, roles_extra: [], active,
 *     custom_role: { id, active, base_role, permissions } | null,
 *     excepciones: { 'leads.delete': true, … },         // user_permission_overrides
 *     ajustesRol: [{ role, resource, action, allowed }],  // role_permission_overrides (197)
 *     factura_manager, editar_fechas_factura, gestor_colaboraciones, usa_mcp,
 *     usa_whatsapp }                                       // null = encendido (como la base)
 */
import { SYSTEM_ROLE_DEFAULTS, ALL_RESOURCES } from './defaults-antes-423.js';

export const DEFAULTS_ANTES = SYSTEM_ROLE_DEFAULTS;
export const RECURSOS_ANTES = ALL_RESOURCES;

export const ROLES_DEL_SISTEMA = ['superadmin', 'admin', 'gestor', 'soporte', 'project_manager', 'tutor', 'colaborador'];

// ─── Roles (shared/utils/roles.js) ──────────────────────────────────────────

export function comoLista(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.startsWith('{')) {
    return v.slice(1, -1).split(',').map((x) => x.trim().replace(/^"|"$/g, '')).filter(Boolean);
  }
  return [];
}

export function rolesDe(u) {
  return [...new Set([u.role, ...comoLista(u.roles_extra)].filter(Boolean))];
}

/** Rol principal o añadido. */
export function tieneRol(u, ...roles) {
  const suyos = new Set(rolesDe(u));
  return roles.some((r) => suyos.has(r));
}

/** Solo el rol principal: lo que miran casi todas las comprobaciones a mano. */
export const esRol = (u, ...roles) => roles.includes(u.role);

export function soloEsColaborador(u) {
  const suyos = rolesDe(u);
  return suyos.length > 0 && suyos.every((r) => r === 'colaborador');
}

const RUTAS_DEL_COLABORADOR = [
  /^\/api\/auth(?:\/|$)/,
  /^\/api\/tasks(?:\/|$)/,
  /^\/api\/facturas-colaborador\/mias(?:\/|$)/,
  /^\/api\/notifications(?:\/|$)/,
  /^\/api\/users\/mis-avisos\/?$/,
  /^\/api\/users\/\d+\/(?:avatar|views)\/?$/,
];

/** La ruta del inventario («/api/users/:id/avatar») como una URL de verdad. */
export const urlDeEjemplo = (ruta) => ruta.replace(/:[A-Za-z_]+(?:\([^)]*\))?/g, '1');

export function colaboradorPuede(ruta) {
  const limpia = urlDeEjemplo(String(ruta || '')).split('?')[0];
  return RUTAS_DEL_COLABORADOR.some((re) => re.test(limpia));
}

// El tutor, lo suyo (#187, en staging desde el 22/10): copia de RUTAS_DEL_TUTOR.
const RUTAS_DEL_TUTOR = [
  /^\/api\/auth(?:\/|$)/,
  /^\/api\/tutores(?:\/|$)/,
  /^\/api\/consultas(?:\/|$)/,
  /^\/api\/notifications(?:\/|$)/,
  /^\/api\/novedades(?:\/|$)/,
  /^\/api\/mensajes(?:\/|$)/,
  /^\/api\/whatsapp\/sonando\/?$/,
  /^\/api\/permissions\/system-defaults\/?$/,
  /^\/api\/users\/mis-avisos\/?$/,
  /^\/api\/users\/\d+\/(?:avatar|views)\/?$/,
];

const RUTAS_POR_ROL = { colaborador: RUTAS_DEL_COLABORADOR, tutor: RUTAS_DEL_TUTOR };

/**
 * `rutaDeRolCerrado` (shared/utils/roles.js) tal cual: si TODOS sus roles tienen
 * lista cerrada (colaborador, tutor), la ruta tiene que estar en alguna; si
 * tiene otro rol, no se le corta nada. `null` = no aplica.
 */
export function rutaDeRolCerrado(u, ruta) {
  const suyos = rolesDe(u);
  if (!suyos.length || !suyos.every((r) => RUTAS_POR_ROL[r])) return null;
  const limpia = urlDeEjemplo(String(ruta || '')).split('?')[0];
  return suyos.some((r) => RUTAS_POR_ROL[r].some((re) => re.test(limpia)));
}

// ─── Permisos (permissions.service.js) ──────────────────────────────────────

function defaultsDelRol(role, filas = [], respaldo = null, tabla = DEFAULTS_ANTES) {
  const out = { ...(tabla[role] || respaldo || {}) };
  for (const f of filas) {
    if (f.role === role) out[`${f.resource}.${f.action}`] = f.allowed;
  }
  return out;
}

/**
 * `resolvePermission` tal cual: el que usan `checkPermission` (sin roles de más)
 * y `rolOPermiso` (con ellos). Con un rol a medida NO mira los roles de más, y
 * lo aplica aunque esté desactivado: así era.
 */
export function resolverPermiso(u, clave, conExtras) {
  if (u.role === 'superadmin') return true;
  if (u.excepciones && clave in u.excepciones) return u.excepciones[clave];
  const filas = u.ajustesRol || [];
  if (u.custom_role) {
    const cr = u.custom_role;
    if (cr.permissions && clave in cr.permissions) return cr.permissions[clave];
    const base = cr.base_role || 'gestor';
    return defaultsDelRol(base, filas)[clave] ?? false;
  }
  const todos = [u.role, ...(conExtras ? comoLista(u.roles_extra) : [])];
  return todos.some((r) => defaultsDelRol(r, filas)[clave] === true);
}

/** `buildPermissionsMap` tal cual: lo que devolvía /auth/me y usaba Tareas. */
export function mapaDePermisos(u, tabla = DEFAULTS_ANTES) {
  if (u.role === 'superadmin') {
    const todo = {};
    for (const [r, acciones] of Object.entries(RECURSOS_ANTES)) for (const a of acciones) todo[`${r}.${a}`] = true;
    return todo;
  }
  let baseRole = u.role;
  let suyos = {};
  if (u.custom_role) {
    baseRole = u.custom_role.base_role || 'gestor';
    suyos = u.custom_role.permissions || {};
  }
  const filas = u.ajustesRol || [];
  const base = defaultsDelRol(baseRole, filas, tabla.gestor, tabla);
  for (const extra of comoLista(u.roles_extra)) {
    if (!tabla[extra] && !filas.some((f) => f.role === extra)) continue;
    for (const [k, v] of Object.entries(defaultsDelRol(extra, filas, null, tabla))) if (v === true) base[k] = true;
  }
  return { ...base, ...suyos, ...(u.excepciones || {}) };
}

// ─── Guardias de ruta ───────────────────────────────────────────────────────

/**
 * ¿Pasa esta persona este guardia? `regla` es la que lleva pegada cada guardia
 * (`conRegla`). Devuelve `null` si no se sabe —una regla sin clasificar—, y
 * quien compare tiene que tratarlo como fallo, no como un sí.
 */
export function pasaRegla(u, regla, ruta) {
  switch (regla.tipo) {
    case 'token':
      return rutaDeRolCerrado(u, ruta) !== false;
    case 'roles':
      if (regla.atajoSoporte && tieneRol(u, 'superadmin', 'soporte')) return true;
      return tieneRol(u, ...regla.roles);
    case 'permiso':
      return resolverPermiso(u, regla.clave, regla.conExtras === true);
    case 'permisoAlguno':
      return regla.claves.some((c) => resolverPermiso(u, c, regla.conExtras === true));
    case 'rolOPermiso':
      if (regla.atajoSoporte && tieneRol(u, 'superadmin', 'soporte')) return true;
      if (tieneRol(u, ...regla.roles)) return true;
      // Varias claves (Diplomas: ver O emitir, 22/10): basta con una.
      return [].concat(regla.claves || regla.clave).some((c) => resolverPermiso(u, c, regla.conExtras !== false));
    case 'alcance':
      // Sobre qué campus, no si entra: no se compara (#423, «no se toca»).
      return true;
    default:
      return null;
  }
}

/** ¿Entraba a esta ruta? Todas sus reglas a la vez. `null` si alguna no se sabe. */
export function puedeRuta(u, entrada) {
  if (u.active === false) return false;
  let resultado = true;
  for (const regla of entrada.guardias) {
    const r = pasaRegla(u, regla, entrada.ruta);
    if (r === null) return null;
    if (!r) resultado = false;
  }
  return resultado;
}

// ─── Comprobaciones a mano, dentro de controladores y servicios ─────────────
// Cada una copia la de su fichero. Solo la PUERTA: si además se mira de quién
// es el dato (responsable, campus), eso es alcance y sigue igual.

const ADMIN = ['admin', 'superadmin'];
const ADMIN_Y_SOPORTE = ['admin', 'superadmin', 'soporte'];

export const manual = {
  // invoices.controller.js: isAdmin(req), solo el rol principal, con soporte.
  facturasAdministrar: (u) => esRol(u, ...ADMIN_Y_SOPORTE),
  // invoices.model.js: puedeEmitirFactura. Sin soporte y sin roles de más.
  facturasEmitir: (u) => esRol(u, ...ADMIN) || u.factura_manager === true,
  // create(): una rectificativa, admin o gestora con factura_manager.
  facturasRectificar: (u) => esRol(u, ...ADMIN) || (u.role === 'gestor' && u.factura_manager === true),
  // puedeGestionarFactura: admin, o gestora con factura_manager (sobre las suyas).
  facturasGestionar: (u) => esRol(u, ...ADMIN) || (u.role === 'gestor' && u.factura_manager === true),
  // Cola, corte «al día», cobrar proforma: superadmin o factura_manager. El admin NO.
  facturasCola: (u) => u.role === 'superadmin' || u.factura_manager === true,
  // puedeEditarFechas
  facturasFechas: (u) => esRol(u, ...ADMIN) || u.editar_fechas_factura === true,
  // tutor.controller.js: puedeGestionar. Sin soporte; la casilla vale con cualquier rol.
  tutoresGestionar: (u) => esRol(u, ...ADMIN) || u.gestor_colaboraciones === true,
  // El tutor entra a lo suyo sin gestionar (colaboraciones, simulación, comisiones).
  tutoresLoSuyo: (u) => u.role === 'tutor' || esRol(u, ...ADMIN) || u.gestor_colaboraciones === true,
  tutoresAdministrar: (u) => esRol(u, ...ADMIN),
  soloSuperadmin: (u) => u.role === 'superadmin',
  soloAdmin: (u) => esRol(u, ...ADMIN),
  adminYSoporte: (u) => esRol(u, ...ADMIN_Y_SOPORTE),
  adminConExtras: (u) => tieneRol(u, ...ADMIN),
  adminYSoporteConExtras: (u) => tieneRol(u, ...ADMIN_Y_SOPORTE),
  // mcp.acceso.js: puedeUsarMcp.
  mcpUsar: (u) => {
    if (u.active === false) return false;
    if (esRol(u, ...ADMIN)) return true;
    if (u.role === 'tutor') return false;
    return u.usa_mcp === true;
  },
  // whatsapp: usuarioObjetivo + usaSuWhatsapp. El rol del token (principal) y la casilla.
  whatsappUsar: (u) => esRol(u, 'superadmin', 'admin', 'gestor', 'soporte') && u.usa_whatsapp !== false,
  // Trabajar sobre la sesión de otra persona, y el banco entero.
  whatsappSupervisar: (u) => esRol(u, ...ADMIN),
  // sesionesQuePuedeMirar: el banco. Admin entra aunque tenga la casilla apagada.
  whatsappBanco: (u) => esRol(u, ...ADMIN) || (esRol(u, 'gestor', 'soporte') && u.usa_whatsapp !== false),
  // sales.controller.js: una venta «sin gestora» (resolvePermission, sin roles de más).
  ventaSinGestora: (u) => resolverPermiso(u, 'conversions.sin_gestora', false),
  // Lo que antes no tenía comprobación propia.
  siempre: () => true,
  // auth.controller.js: updateMyEmail.
  soloTutor: (u) => u.role === 'tutor',
  // consultas.controller.js (#188): esAdministracion = veTodoElCrm (rol principal
  // superadmin o soporte) o admin (también como rol de más).
  consultasAdministracion: (u) => esRol(u, 'superadmin', 'soporte') || tieneRol(u, 'admin'),
  // esTutorUsuario: la carga de trabajo y lo suyo, solo el tutor.
  consultasTutor: (u) => tieneRol(u, 'tutor'),
  // exigirGestionDelTutor: administración o la casilla de colaboraciones.
  consultasGestionTutor: (u) => esRol(u, 'superadmin', 'soporte') || tieneRol(u, 'admin') || u.gestor_colaboraciones === true,
};

/** De las filas de la base a una persona de las de arriba. */
export function perfilDesdeFilas(user, { customRole = null, excepciones = [], ajustesRol = [] } = {}) {
  const exc = {};
  for (const e of excepciones) exc[`${e.resource}.${e.action}`] = e.allowed;
  return {
    id: user.id,
    nombre: user.nombre,
    email: user.email,
    role: user.role,
    roles_extra: comoLista(user.roles_extra),
    active: user.active !== false,
    custom_role: customRole,
    excepciones: exc,
    ajustesRol,
    factura_manager: user.factura_manager === true,
    editar_fechas_factura: user.editar_fechas_factura === true,
    gestor_colaboraciones: user.gestor_colaboraciones === true,
    usa_mcp: user.usa_mcp === true,
    usa_whatsapp: user.usa_whatsapp === false ? false : null,
  };
}
