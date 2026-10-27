import type { PasoRecorrido } from '@/shared/components/ui/RecorridoGuiado';

/**
 * El recorrido del tablero del equipo (Diego, 12/10: «un tutorial guiado, para verlo y
 * todo»). Cada paso señala algo de la pantalla con `data-recorrido`; lo que esa persona
 * no tiene (un colaborador no ve las cifras del equipo ni «Configurar tablero») se salta solo.
 */
export const CLAVE_RECORRIDO_TABLERO = 'tablero-recorrido-visto-v1';

export const PASOS_TABLERO: PasoRecorrido[] = [
  {
    titulo: 'El tablero del equipo de desarrollo',
    texto: 'Aquí van las tareas del equipo —web, SEO, Meta, diseño, Moodle—, cada una con su responsable. Avanzan de «Por hacer» a «En curso», «En revisión» y «Hecha». Solo lo usan superadmin, admin y colaboradores: las gestoras no lo ven. En {pasos} pasos te enseño cada cosa.',
  },
  {
    donde: '[data-recorrido="filtros"]',
    titulo: 'Un solo tablero, con filtros',
    texto: 'Todas las tareas van en el mismo tablero; lo que cambia es lo que filtras: persona, equipo, área, etiqueta, prioridad, campus o proyecto propio. Se combinan, se ven debajo y se quitan con «Quitar filtros».',
  },
  {
    donde: '[data-recorrido="vista"]',
    titulo: 'Qué ves',
    texto: '«Mis tareas» es lo que llevas, supervisas o creaste. «Mi equipo» suma lo de tus equipos, y «Todo», lo que tu permiso te deje ver.',
  },
  {
    donde: '[data-recorrido="periodo"]',
    titulo: 'Por día, semana o mes',
    texto: 'Hoy, Esta semana o Este mes, con las flechas para ir al anterior o al siguiente, o una fecha. Entra lo que se creó, se terminó o vence en ese periodo, y lo que sigue abierto. Debajo, cuántas se crearon y cuántas se terminaron.',
  },
  {
    donde: '[data-recorrido="metricas"]',
    titulo: 'Cifras del equipo',
    texto: 'Por persona o por área: cuántas tareas tiene abiertas, cuántas vencidas y cuántas cerró esta semana. Pulsa a alguien para filtrar el tablero por esa persona.',
  },
  {
    donde: '[data-recorrido="columnas"]',
    titulo: 'Las columnas',
    texto: 'Arrastra una tarjeta para avanzarla o para ordenarla dentro de su columna (en el móvil, ábrela y cambia su estado). Cuando termines una tarea, llévala a «En revisión»: solo quien aprueba la pasa a «Hecha».',
  },
  {
    donde: '[data-recorrido="tarjeta"]',
    titulo: 'Una tarea',
    texto: 'Cada tarjeta dice su prioridad, cuándo se creó y cuándo se terminó, su fecha límite, de quién es y cuánto lleva de su lista. Ábrela para ver y cambiar todo: descripción, lista de comprobación, comentarios, enlaces, etiquetas y el historial de quién hizo qué.',
  },
  {
    donde: '[data-recorrido="nueva"]',
    titulo: 'Crear una tarea',
    texto: 'Título, responsable, fecha límite, prioridad, área y campus o proyecto propio. Un admin solo asigna a gente de sus campus. A quien se la asignas le llega un aviso en la campana y un correo con la marca del campus.',
  },
  {
    donde: 'a[href*="tareas/revisar"]',
    titulo: 'Por revisar',
    texto: 'Las tareas que el equipo dio por terminadas. Apruébalas para pasarlas a «Hecha», o devuélvelas con el motivo: vuelven a «En curso» y el motivo queda como comentario.',
  },
  {
    donde: '[data-recorrido="configurar"]',
    titulo: 'Configurar el tablero',
    texto: 'Las columnas (puedes añadir «Bloqueada», por ejemplo), las áreas y quién va en cada una, y los proyectos propios. Los permisos de cada rol, en Configuración › Roles.',
  },
  {
    titulo: 'Y cada mañana',
    texto: 'Quien tiene tareas para hoy o vencidas recibe un correo con ellas. Los avisos también llegan a la campana. Este recorrido vuelve con el botón «Recorrido» de arriba cuando quieras.',
  },
];
