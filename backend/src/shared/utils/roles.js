import { AppError } from '../utils/AppError.js';

/*
  QUE ROLES TIENE UNA PERSONA.

  Diego, 22/09: «necesitamos que se pueda colocar mas de un rol a un usuario».
  El caso real es quien lleva prospectos Y ademas da clase: antes habia que
  elegir, y lo que no se eligiera se perdia.

  `users.role` sigue siendo el rol PRINCIPAL y no cambia de significado: lo
  miran 149 sitios del CRM y tocarlo seria mover los permisos de todo a ciegas.
  Lo que hay ademas es `users.roles_extra`, una lista que SOLO SUMA.

  Todo lo que pregunte «puede esta persona hacer X» pasa por aqui, para que no
  haya dos respuestas distintas segun quien pregunte.
*/

/**
 * La lista de roles de mas, venga como venga.
 *
 * Postgres devuelve un array de un ENUM como TEXTO crudo --«{admin,tutor}»--
 * salvo que se pida `::text[]`. Si una consulta se deja el casteo, sin esto el
 * rol añadido se perderia en silencio: la persona seguiria sin poder entrar y
 * no habria ni un error que mirar.
 */
export function comoLista(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string' && v.startsWith('{')) {
    return v.slice(1, -1).split(',').map((x) => x.trim().replace(/^"|"$/g, '')).filter(Boolean);
  }
  return [];
}

/** Todos los roles de quien viene en la peticion: el principal y los de mas. */
export function rolesDe(user) {
  if (!user) return [];
  const extra = user.roles_extra !== undefined ? comoLista(user.roles_extra) : comoLista(user.roles);
  return [...new Set([user.role, ...extra].filter(Boolean))];
}

/** Si tiene ese rol, sea el principal o uno añadido. */
export function tieneRol(user, ...roles) {
  const suyos = new Set(rolesDe(user));
  return roles.some((r) => suyos.has(r));
}

/**
 * Colaborador y NADA MAS (#210, fase 5).
 *
 * El recorte solo vale para quien es unicamente colaborador: a quien ademas es
 * gestora, cerrarle Prospectos seria quitarle lo que ya tenia.
 */
export function soloEsColaborador(user) {
  const suyos = rolesDe(user);
  return suyos.length > 0 && suyos.every((r) => r === 'colaborador');
}

/**
 * Lo unico que puede pedir un colaborador. Todo lo demas —prospectos, ventas,
 * finanzas, WhatsApp— responde 403 aunque la ruta solo pida `verifyToken`.
 * Lista cerrada a proposito: un modulo nuevo queda fuera hasta que alguien
 * decida que el colaborador lo necesita.
 */
export const RUTAS_DEL_COLABORADOR = [
  /^\/api\/auth(?:\/|$)/,
  /^\/api\/tasks(?:\/|$)/,
  // «Mi factura» (#202): solo lo suyo. Lo de administración, nunca. (El enlace
  // público y las descargas firmadas no pasan por `verifyToken`: no llegan aquí.)
  /^\/api\/facturas-colaborador\/mias(?:\/|$)/,
  /^\/api\/notifications(?:\/|$)/,
  // Meta Ads, solo ver y solo con su permiso (`meta_ads.view`, 26/10/2026): la
  // guardia de la ruta lo mira; sin él, 403 igual.
  /^\/api\/meta-ads(?:\/|$)/,
  /^\/api\/users\/mis-avisos\/?$/,
  /^\/api\/users\/\d+\/(?:avatar|views)\/?$/,
];

export function colaboradorPuede(ruta) {
  const limpia = String(ruta || '').split('?')[0];
  return RUTAS_DEL_COLABORADOR.some((re) => re.test(limpia));
}

/**
 * Deja la lista de añadidos como debe guardarse.
 *
 * Sin repetidos, sin el rol principal --estaria dos veces-- y SIN superadmin:
 * que un rol de mas pueda dar acceso total es justo la puerta que nadie
 * recordaria haber abierto. Superadmin se pone como rol principal o no se pone.
 */
export function limpiaRolesExtra(extra, principal) {
  extra = comoLista(extra);
  const fuera = new Set([principal, 'superadmin']);
  return [...new Set(extra.filter((r) => r && !fuera.has(r)))];
}

/** Para los guardias: el error de siempre, en un solo sitio. */
export function sinPermiso() {
  return new AppError('No tienes permisos para esta accion', 403, 'FORBIDDEN');
}
