/**
 * Las 12 funciones que el CRM pide al servicio web del Moodle de un campus, por
 * grupo (CRM#925), y lo que «Probar conexión» guarda de ellas en la tarjeta.
 *
 * La lista buena vive en el servidor (`GRUPOS_DE_FUNCIONES` de
 * `backend/src/shared/services/moodle.client.js`): esta es la del tutorial. Si
 * cambia allí, cambia aquí. No hay forma de compartirla: una corre en el servidor
 * y esta en el navegador.
 */

export type ClaveDeGrupo = 'base' | 'mi_campus' | 'consultas' | 'notas';

export interface GrupoDeFunciones {
  clave: ClaveDeGrupo;
  titulo: string;
  /** Para qué las usa el CRM, en una frase. */
  para: string;
  funciones: string[];
}

export const GRUPOS_DE_FUNCIONES_MOODLE: GrupoDeFunciones[] = [
  {
    clave: 'base', titulo: 'Conexión',
    para: 'comprobar el token y que cada tutor es usuario del campus',
    funciones: ['core_webservice_get_site_info', 'core_user_get_users_by_field'],
  },
  {
    clave: 'mi_campus', titulo: 'Mi campus',
    para: 'en «Tutores › Mi campus», los cursos, alumnos, tareas, entregas y el temario de cada tutor',
    funciones: [
      'core_enrol_get_users_courses', 'core_enrol_get_enrolled_users',
      'mod_assign_get_assignments', 'mod_assign_get_submissions', 'mod_assign_get_grades',
      'core_course_get_contents',
    ],
  },
  {
    clave: 'consultas', titulo: 'Consultas',
    para: 'leer los mensajes de los alumnos, con «Leer las consultas» marcado',
    funciones: ['core_message_get_conversations', 'core_message_get_conversation_messages'],
  },
  {
    clave: 'notas', titulo: 'Notas y avisos',
    para: 'las notas en la ficha del alumno y el aviso de entregas sin corregir',
    funciones: ['gradereport_user_get_grade_items', 'core_course_get_courses_by_field'],
  },
];

/** Lo que guarda «Probar conexión» en `config_public.funciones`. */
export interface FuncionesProbadas {
  grupos: { clave: ClaveDeGrupo; titulo: string; total: number; faltan: string[] }[] | null;
  /** «Puede descargar archivos» del servicio; null si el Moodle no lo dice. */
  descargas: boolean | null;
}

export interface Falta { clave: ClaveDeGrupo | 'descargas'; titulo: string; faltan: string[] }

/** Lo que falta de verdad: las de Consultas solo con «Leer las consultas» marcado. */
export function faltasDeFunciones(funciones: FuncionesProbadas | null | undefined, consultas: boolean): Falta[] {
  const grupos = Array.isArray(funciones?.grupos) ? funciones.grupos : [];
  const faltas: Falta[] = grupos
    .filter((g) => Array.isArray(g.faltan) && g.faltan.length > 0 && (g.clave !== 'consultas' || consultas))
    .map((g) => ({ clave: g.clave, titulo: g.titulo, faltan: g.faltan }));
  if (funciones?.descargas === false) faltas.push({ clave: 'descargas', titulo: 'Puede descargar archivos', faltan: [] });
  return faltas;
}
