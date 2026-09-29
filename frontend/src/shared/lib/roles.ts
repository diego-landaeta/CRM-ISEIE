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
