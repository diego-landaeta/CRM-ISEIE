/**
 * QUÉ PUEDE UNA PERSONA, Y DE DÓNDE LE VIENE (#423). Sin base de datos.
 *
 * Antes había dos respuestas: `resolvePermission` (la de los guardias) y
 * `buildPermissionsMap` (la de /auth/me y Tareas), y no coincidían —con un rol
 * a medida, una miraba los roles de más y la otra no—. Ahora las dos salen de
 * aquí, y la ficha de cada persona enseña lo mismo que deciden los guardias.
 *
 * El orden, de menos a más fuerza:
 *   1. Sus roles: el principal (o el rol fijo del que parte su rol a medida)
 *      y los de más. Basta con que UNO traiga el permiso: añadir un rol nunca
 *      quita. Cada rol con lo que se le haya cambiado en Configuración › Roles.
 *   2. Su rol a medida, si está ACTIVO: lo que dice ahí manda sobre su rol.
 *   3. Sus excepciones: lo que se le haya dado o quitado a ella.
 *   4. `nunca`: lo que su rol no puede tener de ninguna manera (un tutor no
 *      usa el MCP). Solo si TODOS sus roles están en la lista: a una gestora
 *      que además es tutora no se le quita lo de gestora. Y `nuncaPrincipal`:
 *      lo que su rol PRINCIPAL veta aunque tenga otros (un tutor con un rol de
 *      más sigue sin WhatsApp ni MCP, como antes de #423). Y lo `soloPrincipal`
 *      (WhatsApp, MCP) lo trae de serie solo el rol principal.
 * El superadmin lo tiene todo, siempre, salvo su WhatsApp si se le ha quitado a él
 * por persona (una excepción `whatsapp.*` en «no»; Diego, 26/10/2026).
 *
 * `origen` de cada clave, para la ficha:
 *   { tipo: 'superadmin' }
 *   { tipo: 'rol', rol }                el valor de serie de ese rol
 *   { tipo: 'ajuste_rol', rol }         lo cambiado a ese rol en Roles
 *   { tipo: 'rol_a_medida', id, nombre }
 *   { tipo: 'excepcion' }
 *   { tipo: 'nunca', roles }
 *   { tipo: 'ninguno' }                 nadie se lo da
 */
import { ACCIONES, valoresPorDefecto, vetada } from './catalogo.js';
import { comoLista } from '../../shared/utils/roles.js';

const SERIE = valoresPorDefecto();

/**
 * @param {object} p
 * @param {string} p.role
 * @param {string[]|string} [p.roles_extra]
 * @param {{id, label, base_role, permissions, active}|null} [p.customRole]
 * @param {Object<string, boolean>} [p.excepciones]   { 'leads.delete': true }
 * @param {{role, resource, action, allowed}[]} [p.ajustesRol]  filas de la 197
 * @returns {{ mapa: Object<string, boolean>, origenes: Object<string, object> }}
 */
export function resolverPermisos({ role, roles_extra = [], customRole = null, excepciones = {}, ajustesRol = [] }) {
  const mapa = {};
  const origenes = {};
  if (role === 'superadmin') {
    for (const x of ACCIONES) {
      // Lo único que se le quita al superadmin: su WhatsApp, si se le ha quitado a él
      // por persona (Diego, 26/10/2026: «Carlos y Vladys siguen sin WhatsApp»; antes
      // era la casilla «Usa WhatsApp» de su ficha). Ninguna otra excepción le resta.
      if (x.clave.startsWith('whatsapp.') && excepciones[x.clave] === false) {
        mapa[x.clave] = false; origenes[x.clave] = { tipo: 'excepcion' };
        continue;
      }
      mapa[x.clave] = true; origenes[x.clave] = { tipo: 'superadmin' };
    }
    return { mapa, origenes };
  }

  const medida = customRole && customRole.active !== false ? customRole : null;
  const principal = medida ? (medida.base_role || 'gestor') : role;
  const roles = [...new Set([principal, ...comoLista(roles_extra)].filter((r) => r && r !== 'superadmin'))];
  const todosSusRoles = [...new Set([role, ...comoLista(roles_extra)].filter(Boolean))];

  const ajuste = {};
  for (const f of ajustesRol) ajuste[`${f.role}|${f.resource}.${f.action}`] = f.allowed;

  for (const x of ACCIONES) {
    const k = x.clave;
    let valor = false;
    let origen = { tipo: 'ninguno' };
    // WhatsApp y MCP: de serie, solo el rol principal (`soloPrincipal`).
    for (const r of (x.soloPrincipal ? roles.filter((y) => y === principal) : roles)) {
      const cambiado = ajuste[`${r}|${k}`];
      const v = cambiado !== undefined ? cambiado : SERIE[r]?.[k] === true;
      if (v) { valor = true; origen = cambiado !== undefined ? { tipo: 'ajuste_rol', rol: r } : { tipo: 'rol', rol: r }; break; }
    }
    if (medida && medida.permissions && k in medida.permissions) {
      valor = medida.permissions[k] === true;
      origen = { tipo: 'rol_a_medida', id: medida.id, nombre: medida.label };
    }
    if (k in excepciones) {
      valor = excepciones[k] === true;
      origen = { tipo: 'excepcion' };
    }
    if (valor && vetada(x, role, comoLista(roles_extra))) {
      valor = false;
      origen = { tipo: 'nunca', roles: todosSusRoles };
    }
    mapa[k] = valor;
    origenes[k] = origen;
  }
  return { mapa, origenes };
}

/** Lo que trae un rol fijo, con lo cambiado en Roles: `{ clave: bool }`. */
export function permisosDelRol(rol, ajustesRol = []) {
  if (rol === 'superadmin') return Object.fromEntries(ACCIONES.map((x) => [x.clave, true]));
  return resolverPermisos({ role: rol, ajustesRol }).mapa;
}

/** Lo que trae un rol a medida: su rol base y sus diferencias. */
export function permisosDelRolAMedida(customRole, ajustesRol = []) {
  return resolverPermisos({ role: customRole.base_role || 'gestor', customRole: { ...customRole, active: true }, ajustesRol }).mapa;
}
