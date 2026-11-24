import type { UserRole } from '@/shared/types';

/*
  QUÉ ROLES TIENE QUIEN ESTÁ DENTRO.

  Diego, 22/09: «necesitamos que se pueda colocar más de un rol a un usuario».
  El caso real es quien lleva prospectos y además da clase: antes había que
  elegir, y lo que no se eligiera se perdía.

  `user.role` sigue siendo el rol PRINCIPAL —es el que sale en las listas y el
  que mira medio CRM— y `roles_extra` son los de más, que solo SUMAN. Las dos
  preguntas se hacen aquí para que no haya dos respuestas distintas según qué
  pantalla pregunte.
*/

/**
 * Con quien se puede preguntar.
 *
 * El rol llega como texto suelto en varias pantallas --el usuario de la sesion
 * se teclea a mano en unas cuantas-- asi que se acepta `string` y se compara.
 * Exigir el tipo cerrado obligaba a tocar diez ficheros para nada.
 */
type Quien = { role?: string | null; roles_extra?: string[] | null };

/** Todos sus roles: el principal primero. */
export function rolesDe(user: Quien | null | undefined): UserRole[] {
  if (!user?.role) return [];
  const extra = Array.isArray(user.roles_extra) ? user.roles_extra : [];
  return [...new Set<UserRole>([user.role as UserRole, ...(extra as UserRole[])])];
}

/** Si tiene ese rol, sea el principal o uno añadido. */
export function tieneRol(user: Quien | null | undefined, ...roles: UserRole[]): boolean {
  const suyos = new Set(rolesDe(user));
  return roles.some((r) => suyos.has(r));
}

/**
 * Tutor y NADA MÁS.
 *
 * El menú del tutor no es un permiso, es un recorte: se le enseña lo suyo y se
 * le esconde el resto. Ese recorte solo vale para quien es únicamente tutor —
 * a quien además lleva prospectos, esconderle Prospectos sería justo el fallo
 * que se viene a arreglar.
 */
export function soloEsTutor(user: Quien | null | undefined): boolean {
  const suyos = rolesDe(user);
  return suyos.length === 1 && suyos[0] === 'tutor';
}

/**
 * Colaborador y NADA MÁS (#210, fase 5): solo ve su tablero de Tareas. El corte
 * de verdad lo hace el servidor (`verifyToken`); esto evita pintarle pantallas
 * que le responderían 403.
 */
export function soloEsColaborador(user: Quien | null | undefined): boolean {
  const suyos = rolesDe(user);
  return suyos.length > 0 && suyos.every((r) => r === 'colaborador');
}

/**
 * Tutor redactor y NADA MÁS (CRM#708): su tablero, su factura del mes, sus
 * consultas y sus cursos. El corte de verdad lo hace el servidor
 * (`RUTAS_DEL_TUTOR_REDACTOR`); esto evita pintarle pantallas que le
 * responderían 403.
 */
export function soloEsTutorRedactor(user: Quien | null | undefined): boolean {
  const suyos = rolesDe(user);
  return suyos.length > 0 && suyos.every((r) => r === 'tutor_redactor');
}

/** Los roles que dan clase: donde se pregunta «¿es tutor?», el redactor también cuenta. */
export const ROLES_DE_TUTOR: UserRole[] = ['tutor', 'tutor_redactor'];

/**
 * Los permisos con los que la RUTA deja pasar a los avisos de WhatsApp
 * (`usaOSupervisa` en whatsapp.routes.js: `/sin-leer` y `/respuesta-llamada`).
 * Una prueba comprueba que no se separan.
 */
export const PERMISOS_DE_LOS_AVISOS = ['whatsapp.usar', 'whatsapp.supervisar'];

/**
 * El que de verdad hace falta para el aviso de mensajes: «Usar su WhatsApp».
 * La ruta deja pasar también a quien solo supervisa, pero `/sin-leer` sin
 * `usuarioId` es la línea PROPIA y el controlador (`usuarioObjetivo`) pide
 * `whatsapp.usar`; a quien solo supervisa le contestaba 403 `SIN_WHATSAPP`
 * (errores de producción del 23/11).
 */
export const PERMISO_DEL_AVISO = 'whatsapp.usar';

/**
 * Si se le pregunta por sus avisos de WhatsApp (mensajes sin leer y llamadas):
 * con «Usar su WhatsApp» en su mapa de permisos, el que llega con el login y con
 * /auth/me (#423), y sin la casilla «usa WhatsApp» apagada en su ficha. A quien
 * no, el servidor le contesta 403, así que no se le pregunta (QA de Diego,
 * 22/10, punto 8: el tutor recibía un 403 cada pocos segundos en
 * `/api/whatsapp/sin-leer`; 23/11: quien solo supervisa, o con la casilla apagada).
 *
 * El mapa tal cual, como `tienePermiso` en el servidor, y no `can()`: `can()` le
 * da todo al superadmin, y un superadmin puede tener su WhatsApp apagado (#503).
 * Sin mapa todavía, no se pregunta. La casilla (`usa_whatsapp === false`) ya
 * apaga el permiso en el servidor (permissions/casillas.js); mirarla aquí cubre
 * el mapa de antes de apagarla.
 */
export function tieneWhatsapp(
  permissions: Record<string, boolean> | null | undefined,
  user?: { usa_whatsapp?: boolean | null } | null,
): boolean {
  if (!permissions) return false;
  if (user?.usa_whatsapp === false) return false;
  return permissions[PERMISO_DEL_AVISO] === true;
}

/**
 * ¿Es SOLO tutora redactora? Como el menú (Sidebar): sin otro rol que se lo dé.
 * La redactora cobra por su factura del mes, no por comisiones: no ve «Mis cursos y
 * comisiones» (Diego, 24/11/2026). Una tutora que además es redactora sí la ve.
 */
export function esSoloRedactora(user: { role?: string; roles_extra?: string[] } | null | undefined): boolean {
  const suyos = [user?.role, ...(Array.isArray(user?.roles_extra) ? user.roles_extra : [])].filter(Boolean);
  return suyos.length > 0 && suyos.every((r) => r === 'tutor_redactor');
}
