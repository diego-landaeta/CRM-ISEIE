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
 * Los permisos con los que el servidor contesta a los avisos de WhatsApp
 * (`usaOSupervisa` en whatsapp.routes.js: `/sin-leer` y `/respuesta-llamada`).
 * Una prueba comprueba que no se separan.
 */
export const PERMISOS_DE_LOS_AVISOS = ['whatsapp.usar', 'whatsapp.supervisar'];

/**
 * Si tiene WhatsApp, con el mismo criterio con el que el servidor contesta a los
 * avisos: «Usar su WhatsApp» o «Supervisar WhatsApp» en su mapa de permisos, el
 * que llega con el login y con /auth/me (#423). A quien no, le contesta 403, así
 * que los avisos de mensajes y de llamadas no deben preguntar por él (QA de
 * Diego, 22/10, punto 8: el tutor recibía un 403 cada pocos segundos en
 * `/api/whatsapp/sin-leer`). Ni más ni menos: a quien el servidor contesta, se
 * le pregunta.
 *
 * El mapa tal cual, como `tienePermiso` en el servidor, y no `can()`: `can()` le
 * da todo al superadmin, y un superadmin puede tener su WhatsApp apagado (#503).
 * Sin mapa todavía, no se pregunta. Antes se miraba la casilla «usa WhatsApp» de
 * la ficha, pero desde #423 el servidor no la mira y nadie la actualiza.
 */
export function tieneWhatsapp(permissions: Record<string, boolean> | null | undefined): boolean {
  if (!permissions) return false;
  return PERMISOS_DE_LOS_AVISOS.some((clave) => permissions[clave] === true);
}
