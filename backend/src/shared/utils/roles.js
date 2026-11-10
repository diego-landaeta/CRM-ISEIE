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
  // «Mis preferencias» lee el catálogo del menú para «Mi vista», como el tutor
  // (más abajo). Es solo la lista de nombres; sin ella, 403 al abrirla (#631).
  /^\/api\/permissions\/system-defaults\/?$/,
  /^\/api\/users\/mis-avisos\/?$/,
  /^\/api\/users\/\d+\/(?:avatar|views)\/?$/,
];

export function colaboradorPuede(ruta) {
  const limpia = String(ruta || '').split('?')[0];
  return RUTAS_DEL_COLABORADOR.some((re) => re.test(limpia));
}

/**
 * Lo unico que puede pedir un tutor (#187): «solo sus consultas y sus metricas;
 * nada de ventas, finanzas ni prospectos. Se comprueba en el servidor, no solo
 * en el menu». Antes, aunque el menu no se lo enseñara, un tutor podia leer por
 * la API los prospectos y las ventas de su campus (/api/leads y /api/conversions
 * solo piden token).
 *
 * Es lo que pide hoy su pantalla —Mis cursos, sus comisiones, su perfil, los
 * avisos— y nada mas. Sus cosas en /api/tutores ya se recortan en el
 * controlador: un tutor solo ve lo suyo.
 */
export const RUTAS_DEL_TUTOR = [
  /^\/api\/auth(?:\/|$)/,
  /^\/api\/tutores(?:\/|$)/,
  // Sus consultas de alumnos (#188): el controlador le deja solo las suyas.
  /^\/api\/consultas(?:\/|$)/,
  // Sus cursos pendientes (#336): el servicio le deja solo los que tiene asignados.
  /^\/api\/cursos-pendientes(?:\/|$)/,
  // Su tablero de tutores (Diego, 04/11): el servicio le deja ver solo lo suyo y lo
  // de su equipo de tutores; lo de desarrollo, no (no es de ese equipo).
  /^\/api\/tasks(?:\/|$)/,
  /^\/api\/notifications(?:\/|$)/,
  /^\/api\/novedades(?:\/|$)/,
  // Los mensajes internos entre usuarios del CRM (la campana de «Mensajes»).
  /^\/api\/mensajes(?:\/|$)/,
  // Si le esta sonando una llamada: lo pregunta la cabecera a cualquiera.
  /^\/api\/whatsapp\/sonando\/?$/,
  /^\/api\/permissions\/system-defaults\/?$/,
  /^\/api\/users\/mis-avisos\/?$/,
  /^\/api\/users\/\d+\/(?:avatar|views)\/?$/,
];

/** Las listas cerradas, por rol. Quien solo tiene roles de aqui, solo pide lo suyo. */
const RUTAS_POR_ROL = {
  colaborador: RUTAS_DEL_COLABORADOR,
  tutor: RUTAS_DEL_TUTOR,
};

/** Tutor y NADA MAS. A quien ademas es gestora no se le cierra nada. */
export function soloEsTutor(user) {
  const suyos = rolesDe(user);
  return suyos.length > 0 && suyos.every((r) => r === 'tutor');
}

export function tutorPuede(ruta) {
  const limpia = String(ruta || '').split('?')[0];
  return RUTAS_DEL_TUTOR.some((re) => re.test(limpia));
}

/**
 * Si todos los roles de la persona tienen lista cerrada (colaborador, tutor o
 * los dos), devuelve si esta ruta esta en alguna de SUS listas. Si tiene algun
 * rol sin lista (gestora, admin…), null: no se le recorta nada aqui.
 */
export function rutaDeRolCerrado(user, ruta) {
  const suyos = rolesDe(user);
  if (!suyos.length || !suyos.every((r) => RUTAS_POR_ROL[r])) return null;
  const limpia = String(ruta || '').split('?')[0];
  return suyos.some((r) => RUTAS_POR_ROL[r].some((re) => re.test(limpia)));
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


/*
  «SOLO LO SUYO»: el ALCANCE comercial (Diego, 02/11/2026: «arréglalo tú de una vez»).

  Antes se decidía con `req.user.role === 'gestor'`, el rol PRINCIPAL. Así un
  project manager —que el catálogo trata «como una gestora»— y quien tiene la
  gestora como rol añadido veían todos los prospectos, ventas, conversiones y
  facturas de su campus en vez de solo los suyos.

  Es solo lo suyo quien no tiene ningún rol que vea el campus entero (super
  admin, admin, soporte) y tiene alguno comercial propio (gestora, project
  manager), sea el principal o uno añadido. Un admin con la gestora añadida
  sigue viéndolo todo; un tutor con la gestora añadida, solo lo suyo.

  Es ALCANCE (qué datos ve), no la puerta (si entra): esa la deciden los
  permisos del catálogo (#423).
*/
const VEN_TODO_EL_CAMPUS = ['superadmin', 'admin', 'soporte'];
const COMERCIAL_PROPIO = ['gestor', 'project_manager'];

export function soloLoSuyo(user) {
  const suyos = rolesDe(user);
  if (suyos.some((r) => VEN_TODO_EL_CAMPUS.includes(r))) return false;
  return suyos.some((r) => COMERCIAL_PROPIO.includes(r));
}


/*
  EL EQUIPO COMERCIAL DE UNA ADMINISTRADORA (Carlos, 09/11/2026).

  «Raquel pasa a ser administradora como Daniela: no recibe leads y puede ver
  los leads y la gestión de las diferentes compañeras. Daniela puede ver todas.
  Raquel podrá ver sus comerciales asignadas (pueden variar).»

  Hasta ahora había dos alcances: todo el campus o solo lo suyo. Este es el
  tercero: lo suyo Y lo de las gestoras que tiene a su cargo (tabla
  `equipo_comercial`, migración 274). Quién lleva a quién lo decide quien
  tenga el permiso `equipos.gestionar`.

  `alcanceComercial(user)` devuelve:
    · null  → sin límite por persona: ve todo lo de sus campus.
    · [ids] → solo lo de esas personas (la primera, ella misma).

  Orden de las reglas:
    1. Super admin o soporte → null, siempre.
    2. Con equipo a su cargo → [ella, ...sus gestoras], sea cual sea su rol.
    3. Solo lo suyo (gestora, project manager) → [ella].
    4. El resto (una admin sin equipo, como Daniela) → null.

  El recorte por campus/empresa (`shared/utils/ambito.js`) se aplica ADEMÁS:
  esto solo dice de QUIÉN, no DÓNDE.

  Se calcula una vez por petición: la respuesta se guarda pegada al objeto
  `req.user`, que es nuevo en cada petición. Cambiar el equipo surte efecto en
  la siguiente, sin caché que vaciar.
*/
const alcancePorPeticion = new WeakMap();

/** Los ids de las gestoras que tiene a su cargo esa persona (vacío si ninguna). */
export async function gestorasACargo(liderId) {
  const id = Number(liderId);
  if (!Number.isInteger(id) || id <= 0) return [];
  // Import tardío: este fichero lo usan pruebas puras que no deben abrir la base.
  const { query } = await import('../config/db.js');
  const r = await query(
    'SELECT gestora_id FROM equipo_comercial WHERE lider_id = $1 ORDER BY gestora_id', [id]);
  return (r?.rows || []).map((f) => Number(f.gestora_id));
}

async function calcularAlcance(user) {
  if (tieneRol(user, 'superadmin', 'soporte')) return null;
  const id = Number(user.userId ?? user.id);
  const equipo = await gestorasACargo(id);
  if (equipo.length) return [id, ...equipo.filter((g) => g !== id)];
  if (soloLoSuyo(user)) return [id];
  return null;
}

export function alcanceComercial(user) {
  if (!user || typeof user !== 'object') return Promise.resolve(null);
  let p = alcancePorPeticion.get(user);
  if (!p) {
    p = calcularAlcance(user);
    alcancePorPeticion.set(user, p);
    // Un fallo de la base no se queda guardado para el resto de la petición.
    p.catch(() => alcancePorPeticion.delete(user));
  }
  return p;
}

/**
 * A quién se recorta una consulta que además trae un filtro por persona.
 *
 *   · Sin alcance (ve todo): lo que pida, o nadie en concreto.
 *   · Con alcance: lo que pida si está dentro; si no pide o pide a alguien de
 *     fuera, todo su alcance (lo de fuera se ignora, como hasta ahora se
 *     ignoraba el `responsableId` que mandaba una gestora).
 *
 * Devuelve null (sin filtro) o una lista de ids para `campo = ANY($n::int[])`.
 */
export function personasDentro(alcance, pedido) {
  const n = pedido != null && pedido !== '' ? Number(pedido) : null;
  const valido = Number.isInteger(n) && n > 0 ? n : null;
  if (!alcance) return valido ? [valido] : null;
  if (valido && alcance.includes(valido)) return [valido];
  return alcance;
}

/**
 * El alcance SOLO si lleva un equipo comercial (QA del 09/11/2026); null si no.
 *
 * Para las pantallas que una gestora sigue viendo como siempre (el panel
 * «Último lead de cada gestora», la cola de facturación, el selector de
 * WhatsApp, los desplegables de gestora…) pero que a una líder le enseñaban
 * todo el campus. Una gestora sola tiene alcance `[ella]`; una líder,
 * `[ella, ...sus gestoras]`, y nunca está en su propio equipo
 * (`NO_A_SI_MISMA`), así que «más de uno» es «lleva equipo».
 */
export async function alcanceDeLider(user) {
  const alcance = await alcanceComercial(user);
  return Array.isArray(alcance) && alcance.length > 1 ? alcance : null;
}

/** Si esa persona entra en el alcance (null = entra cualquiera). */
export function dentroDelAlcance(alcance, personaId) {
  if (!alcance) return true;
  return personaId != null && alcance.includes(Number(personaId));
}
