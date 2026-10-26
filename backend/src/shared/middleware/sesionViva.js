import { query } from '../config/db.js';
import { comoLista } from '../utils/roles.js';

/*
  LA SESIÓN, CONTRA LA BASE (hotfix del 26/10/2026).

  El token de acceso dura 8 horas y lleva el rol DENTRO. Hasta hoy nadie lo
  comparaba con la base: a quien se le cambiaba el rol o se le desactivaba
  seguía entrando con el de antes hasta que caducaba. Le pasó al equipo de
  desarrollo: pasaron de soporte a colaborador y, con la sesión de antes, veían
  todo el CRM y no podían abrir su tablero.

  Ahora, en cada petición con token del CRM, se mira que la persona siga activa
  y con el mismo rol principal, los mismos roles de más y el mismo rol a medida
  que dice el token. Si no, 401 `TOKEN_INVALID`: el frontal renueva el token
  (sale con el rol bueno) y, si su sesión se cerró, vuelve a pedir que entre.

  Solo mira tokens que pasan por `verifyToken`. No toca el MCP (sus propios
  tokens), ni los enlaces firmados de documentos, facturas de colaborador o
  WhatsApp, ni los webhooks: ninguno pasa por aquí.

  Caché corta (30 s) por persona, para no ir a la base en cada petición. Un
  cambio de rol se nota, como mucho, en 30 segundos.
*/

export const CACHE_MS = 30_000;
const cache = new Map();

/** En las pruebas, solo donde se pide: las que simulan la base no traen esta consulta. */
export function comprobarSesion(env = process.env) {
  return env.NODE_ENV !== 'test' || env.COMPROBAR_SESION === '1';
}

/** Solo para las pruebas, y para quien quiera que un cambio se note ya. */
export function olvidarSesiones() {
  cache.clear();
}

async function personaDe(userId, ahora) {
  const guardada = cache.get(userId);
  if (guardada && ahora - guardada.at < CACHE_MS) return guardada.u;
  const { rows } = await query(
    `SELECT role::text AS role, roles_extra::text[] AS roles_extra, custom_role_id, active
       FROM users WHERE id = $1`,
    [userId]
  );
  const u = rows[0] || null;
  cache.set(userId, { u, at: ahora });
  return u;
}

const comoConjunto = (v) => [...new Set(comoLista(v ?? []))].sort();
const mismos = (a, b) => {
  const x = comoConjunto(a);
  const y = comoConjunto(b);
  return x.length === y.length && x.every((r, i) => r === y[i]);
};

/**
 * ¿Sigue valiendo esta sesión? `false` si la persona no existe, está inactiva o
 * su rol (principal, de más o a medida) ya no es el del token.
 */
export async function sesionVigente(decoded, ahora = Date.now()) {
  const id = Number(decoded?.userId);
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  const u = await personaDe(id, ahora);
  if (!u || u.active !== true) return false;
  if (u.role !== decoded.role) return false;
  if (!mismos(u.roles_extra, decoded.roles_extra)) return false;
  if ((u.custom_role_id ?? null) !== (decoded.customRoleId ?? null)) return false;
  return true;
}
