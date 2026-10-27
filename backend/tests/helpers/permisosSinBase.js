/**
 * Permisos para las pruebas que van SIN base (#423).
 *
 * Desde que cada ruta pregunta a `puede('clave')`, el mapa de permisos de
 * quien llama se lee de la base. Las pruebas que doblan `db.js` no tienen esa
 * base, así que doblan también `permissions.service.js` con esto: el resolver
 * DE VERDAD (`resolver.js`), alimentado con las personas que cada prueba
 * registra. Así sigue probándose la regla real, no una inventada.
 *
 *   vi.mock('../src/modules/permissions/permissions.service.js',
 *     () => import('./helpers/permisosSinBase.js'));
 *   import { registrar } from './helpers/permisosSinBase.js';
 *   registrar({ userId: 7, role: 'gestor', excepciones: { 'mcp.usar': true } });
 *
 * Quien no está registrado no puede nada (como un id que no existe).
 */
import { resolverPermisos } from '../../src/modules/permissions/resolver.js';
import { excepcionesDeCasillas } from '../../src/modules/permissions/casillas.js';

const personas = new Map();

/** Da de alta (o cambia) a una persona de prueba. Devuelve lo mismo que recibe. */
export function registrar(p) {
  const id = Number(p.userId ?? p.id);
  personas.set(id, {
    id, role: p.role, roles_extra: p.roles_extra || [], active: p.active !== false,
    customRole: p.customRole || null, excepciones: p.excepciones || {}, ajustesRol: p.ajustesRol || [],
    nombre: p.nombre || `persona ${id}`, email: p.email || `p${id}@prueba.test`,
  });
  return p;
}

export function olvidarPersonas() { personas.clear(); }

export async function explicarPermisos(userId) {
  const p = personas.get(Number(userId));
  if (!p) return null;
  const { mapa, origenes } = resolverPermisos(p);
  if (!p.active) for (const k of Object.keys(mapa)) mapa[k] = false;
  return {
    mapa, origenes, customRole: p.customRole, excepciones: p.excepciones,
    persona: { id: p.id, nombre: p.nombre, email: p.email, role: p.role, roles_extra: p.roles_extra, active: p.active },
  };
}

export async function resolvePermission(userId, _role, _custom, resource, action) {
  return (await explicarPermisos(userId))?.mapa[`${resource}.${action}`] === true;
}

export async function buildPermissionsMap(userId) {
  return (await explicarPermisos(userId))?.mapa || {};
}

export async function resolveUserView() { return {}; }

/**
 * Registra a alguien a partir de su fila de `users` (como la devuelve un modelo
 * doblado) y la devuelve tal cual. Las casillas de antes se traducen como lo
 * hace la migración 239: `usa_mcp` → excepción «Usar el MCP», `usa_whatsapp`
 * apagada → «Usar su WhatsApp» quitado, `gestor_colaboraciones` → «Gestionar
 * colaboraciones».
 */
export function conPermisos(fila) {
  if (!fila) return fila;
  const excepciones = { ...excepcionesDeCasillas(fila), ...(fila.excepciones || {}) };
  registrar({ userId: fila.id ?? fila.userId, role: fila.role, roles_extra: fila.roles_extra, active: fila.active, excepciones });
  return fila;
}

export async function explicarPermisosRecordados(userId) { return explicarPermisos(userId); }
export function olvidarPermisos() {}

// Lo que otros módulos leen del servicio al cargarse.
export const CLAVES_EDITABLES = ['tasks.close', 'tasks.manage'];
export const ROLES_EDITABLES = ['admin', 'colaborador'];
export const CLAVES_SUELTAS = { 'diplomas.view': { roles: ['gestor', 'soporte', 'project_manager'] } };
