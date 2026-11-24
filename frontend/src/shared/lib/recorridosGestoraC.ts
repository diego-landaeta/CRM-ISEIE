import type { RecorridoCobros } from '@/shared/lib/recorridosCobros';
import { FINAL_RECORRIDO as FINAL, anclaje } from '@/shared/lib/recorridosComun';

/**
 * LOS RECORRIDOS DEL DÍA A DÍA, TERCERA TANDA (#619, tanda E; gemela de
 * CRM#941). Diego, 19/11: «las que son así, dáselas a Ángel CEDIA».
 * Lo que queda de WhatsApp y las pestañas de Consultas, después de la
 * tanda D (`recorridosGestoraB.ts`):
 *
 *  · WhatsApp › Banco de mensajes y WhatsApp › Actividad. El chat, Plantillas y
 *    Conexión ya tienen el suyo, y «¿Cómo se hace?» (Ayuda) ya es una guía: no
 *    se repiten;
 *  · las pestañas de Consultas: Alumnos sin mensajes, Mi carga, Tutores,
 *    Métricas y Respuestas del campus (la bandeja y la consulta tienen los de main,
 *    `consultas-chat` y `consulta-responder`, en `recorridosNovedades301.ts`).
 *
 * El mismo modelo que `recorridosCobros.ts`, que es donde se registran: allí se
 * suman a `RECORRIDOS_COBROS`, y así `VerRecorrido`, el botón «Recorrido» de la
 * cabecera (por sus `rutas`) y las pruebas de siempre los ven sin tocar nada más.
 * Ninguno se abre solo (#681).
 *
 *  · Cada paso apunta a un `data-recorrido` de su pantalla; lo que no está en ese
 *    momento (la tabla sin filas, «Sincronizar ahora» en «Mis alumnos», el
 *    ranking en «Las mías») se salta solo.
 *  · El permiso de cada recorrido es el de la pantalla en el menú (o en su
 *    pestaña de Consultas).
 *
 * Solo importa TIPOS de `recorridosCobros` (se borran al compilar): así no hay un
 * ciclo de módulos entre los dos ficheros.
 *
 * IGUAL EN LOS DOS CRM (paridad): mismos ids, anclajes y textos. Lo único que
 * cambia es Correos: aquí la pantalla aún no está (llega con #750) y su
 * recorrido, 'correos' en MultiCRM, se añade con ella.
 */

export type IdRecorridoGestoraC =
  | 'whatsapp-banco'
  | 'whatsapp-actividad'
  | 'consultas-alumnos'
  | 'consultas-carga'
  | 'consultas-tutores'
  | 'consultas-metricas'
  | 'consultas-respuestas';

type RecorridoGestoraC = Omit<RecorridoCobros, 'id'> & { id: IdRecorridoGestoraC };

/** Por menú: WhatsApp (Banco y Actividad) y las pestañas de Consultas. */
export const RECORRIDOS_GESTORA_C: Record<IdRecorridoGestoraC, RecorridoGestoraC> = {
  // ─── WhatsApp › Banco de mensajes ──────────────────────────────────────────
  'whatsapp-banco': {
    id: 'whatsapp-banco',
    rutas: ['/whatsapp/banco'],
    titulo: 'Banco de mensajes',
    permiso: ['whatsapp.usar', 'whatsapp.supervisar', 'whatsapp.banco'],
    pantalla: ['modules/whatsapp/pages/BancoPage.tsx'],
    pasos: [
      {
        titulo: 'Todo lo que ha pasado por WhatsApp',
        texto: 'No es el chat: aquí se busca, se audita y se guarda una copia. Sale todo lo guardado, aunque esa sesión ya no esté enlazada. Una gestora ve lo de su número; quien supervisa, lo de sus campus. Son {pasos} pasos.',
      },
      {
        donde: anclaje('wa-banco-vista'),
        titulo: 'Mensajes o por número',
        texto: '«Mensajes», uno por fila. «Por número», un resumen de cada número con cuántos mensajes tiene y desde cuándo.',
      },
      {
        donde: anclaje('wa-banco-filtros'),
        titulo: 'Buscar y filtrar',
        texto: 'Por el texto, por el número y, en «Mensajes», por fechas y por recibidos o enviados. «Quitar filtros» lo deja como al entrar.',
      },
      {
        donde: anclaje('wa-banco-lista'),
        titulo: 'La lista',
        texto: 'Cada mensaje con su fecha, el número, quién es, si se recibió o se envió, el tipo y el texto; en un grupo, debajo, quién lo escribió. En «Por número», pulsa uno para ver sus mensajes.',
      },
      {
        donde: anclaje('wa-banco-descargar'),
        titulo: 'Llevarse una copia',
        texto: 'CSV o Excel con todo lo filtrado, todas las páginas y no solo la que ves. Sin filtros, todo el banco.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── WhatsApp › Actividad ──────────────────────────────────────────────────
  'whatsapp-actividad': {
    id: 'whatsapp-actividad',
    rutas: ['/whatsapp/actividad'],
    titulo: 'Actividad en WhatsApp',
    permiso: 'reports.view',
    pantalla: ['modules/whatsapp/pages/ActividadWhatsappPage.tsx'],
    pasos: [
      {
        titulo: 'Quién responde',
        texto: 'Si cada gestora responde en WhatsApp y lo que apunta en las fichas, del campus o la empresa que eliges arriba. Son {pasos} pasos.',
      },
      {
        donde: anclaje('wa-actividad-periodo'),
        titulo: 'El periodo',
        texto: 'Hoy, los últimos 7 días o los últimos 30.',
      },
      {
        donde: anclaje('wa-actividad-tabla'),
        titulo: 'Una fila por gestora',
        texto: 'Si su número está conectado (o callado desde un día), cuántos le escribieron, a cuántos respondió, cuántos esperan respuesta (en ámbar), cuánto tarda en responder y cuántos mensajes y audios mandó.',
      },
      {
        donde: anclaje('wa-actividad-nota'),
        titulo: 'De dónde sale cada cifra',
        texto: 'Las del chat, de su número conectado en WhatsApp › Conexión: sin número, salen a cero. «Apuntó» son los contactos que registró en la ficha: WhatsApp · llamadas · correos · notas.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── Académico › Consultas › Alumnos sin mensajes ──────────────────────────
  'consultas-alumnos': {
    id: 'consultas-alumnos',
    rutas: ['/consultas/alumnos'],
    titulo: 'Alumnos sin mensajes',
    permiso: ['consultas.view', 'consultas.atender'],
    pantalla: ['modules/consultas/pages/AlumnosSinMensajesPage.tsx'],
    pasos: [
      {
        titulo: 'Los que aún no han hablado con su tutor',
        texto: 'Alumnos matriculados sin ninguna conversación con su tutor, ni en el campus ni en el CRM. Los más antiguos, arriba. Son {pasos} pasos.',
      },
      {
        donde: anclaje('consultas-alumnos-vista'),
        titulo: 'Los tuyos o los de todos',
        texto: 'Si eres tutora y además llevas el equipo: «Mis alumnos» son a los que tienes que escribir tú; «De todos», los de todos los tutores.',
      },
      {
        donde: anclaje('consultas-alumnos-sincronizar'),
        permiso: 'consultas.view',
        titulo: 'Sincronizar ahora',
        texto: 'La lista se pone al día con el campus una vez al día. Esto la lee ahora, por si acaba de matricularse alguien.',
      },
      {
        donde: anclaje('consultas-alumnos-colores'),
        titulo: 'Los días sin contacto',
        texto: 'Se cuentan desde la matrícula: verde al principio, ámbar desde el día 5 y rojo desde el 7.',
      },
      {
        donde: anclaje('consultas-alumnos-lista'),
        titulo: 'La lista',
        texto: 'Cada alumno con su curso, el campus, la matrícula (≈ si es aproximada) y los días. En los tuyos, «Escribir al alumno» le manda un mensaje al campus, lo saca de aquí y queda como una consulta más.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── Académico › Consultas › Mi carga ──────────────────────────────────────
  'consultas-carga': {
    id: 'consultas-carga',
    rutas: ['/consultas/carga'],
    titulo: 'Mi carga de trabajo',
    permiso: 'consultas.atender',
    pantalla: ['modules/consultas/pages/MiCargaPage.tsx'],
    pasos: [
      {
        titulo: 'Cuánto trabajo tienes',
        texto: 'Le cuentas a administración cuánta carga tienes y en qué estás. Actualízala al menos una vez por semana: si no, sale «desactualizada». Son {pasos} pasos.',
      },
      {
        donde: anclaje('consultas-carga-nivel'),
        titulo: 'El nivel',
        texto: 'Baja, media, alta o completa. Con «Completa» no te llegan consultas nuevas si hay otro tutor en el campus.',
      },
      {
        donde: anclaje('consultas-carga-guardar'),
        titulo: 'En qué estás, y guardar',
        texto: 'Arriba, si quieres, en qué estás trabajando: lo lee administración. «Guardar» aunque siga igual, para que conste que está al día.',
      },
      {
        donde: anclaje('consultas-carga-historial'),
        titulo: 'El historial',
        texto: 'Cada cambio que guardas, con su fecha.',
      },
      {
        donde: anclaje('consultas-carga-datos'),
        titulo: 'Tus datos reales',
        texto: 'Lo que cuenta el CRM al lado de lo que tú indicas: tus alumnos activos, tus consultas abiertas y tus alumnos sin mensajes.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── Académico › Consultas › Tutores ───────────────────────────────────────
  'consultas-tutores': {
    id: 'consultas-tutores',
    rutas: ['/consultas/tutores'],
    titulo: 'Tutores de consultas',
    permiso: 'consultas.view',
    pantalla: ['modules/consultas/pages/TutoresConsultasPage.tsx'],
    pasos: [
      {
        titulo: 'Cómo va cada tutor',
        texto: 'La carga que indica cada tutor y lo que cuenta el CRM, de la empresa o el campus que eliges arriba. Son {pasos} pasos.',
      },
      {
        donde: anclaje('consultas-tutores-sin-tutor'),
        titulo: 'Campus sin tutor',
        texto: 'Campus con Moodle conectado sin ningún tutor que reciba sus consultas: entran sin asignar. Se arregla en Tutores, asignándole uno.',
      },
      {
        donde: anclaje('consultas-tutores-tabla'),
        titulo: 'Una fila por tutor',
        texto: 'Su nivel de carga, en qué está y cuándo lo actualizó («Desactualizada» si hace mucho), y al lado sus alumnos activos, sus consultas abiertas y sus alumnos sin mensajes. «No disponible»: no le entran consultas.',
      },
      {
        donde: anclaje('consultas-tutores-fichas'),
        titulo: 'Sus fichas',
        texto: 'Los campus y las empresas de cada tutor se cambian en su ficha, en Tutores.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── Académico › Consultas › Métricas ──────────────────────────────────────
  'consultas-metricas': {
    id: 'consultas-metricas',
    rutas: ['/consultas/metricas'],
    titulo: 'Métricas de consultas',
    permiso: ['consultas.view', 'consultas.atender'],
    pantalla: ['modules/consultas/pages/MetricasConsultasPage.tsx'],
    pasos: [
      {
        titulo: 'Cómo se atienden las consultas',
        texto: 'Lo que más importa es la primera respuesta. Cada cifra da la mediana (un caso suelto no la arrastra) y la media. La tutora ve las suyas; administración, las de la empresa o el campus de arriba. Son {pasos} pasos.',
      },
      {
        donde: anclaje('consultas-metricas-vista'),
        titulo: 'Las tuyas o las de todos',
        texto: 'Si eres tutora y además llevas el equipo: «Las mías» o «De todos», con el ranking.',
      },
      {
        donde: anclaje('consultas-metricas-filtros'),
        titulo: 'Fechas y tutor',
        texto: 'Desde y hasta qué día. En «De todos», también un tutor en concreto.',
      },
      {
        donde: anclaje('consultas-metricas-cifras'),
        titulo: 'Las cifras',
        texto: 'Primera respuesta, resolución hasta el cierre, cuántas en plazo y cuántas esperan. Debajo, cuántas llegaron cada día.',
      },
      {
        donde: anclaje('consultas-metricas-fuera'),
        titulo: 'Fuera de plazo',
        texto: 'Las que se respondieron tarde o siguen sin respuesta pasado el plazo. Pulsa una para abrirla.',
      },
      {
        donde: anclaje('consultas-metricas-alumnos'),
        titulo: 'Los alumnos',
        texto: 'Activos, sin mensajes, el porcentaje ya contactado y cuántos días se tarda en el primer contacto.',
      },
      {
        donde: anclaje('consultas-metricas-ranking'),
        titulo: 'El ranking',
        texto: 'Tutores y campus, con sus consultas, la primera respuesta, cuántas en plazo y cuántas pendientes.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── Académico › Consultas › Respuestas del campus ─────────────────────────
  'consultas-respuestas': {
    id: 'consultas-respuestas',
    rutas: ['/consultas/respuestas'],
    titulo: 'Respuestas del campus',
    permiso: 'consultas.gestionar',
    pantalla: ['modules/consultas/pages/RespuestasCampusPage.tsx'],
    pasos: [
      {
        titulo: 'Respuestas para todas las tutoras',
        texto: 'Las que coordinación deja preparadas para todas las tutoras de un campus («Plazo ampliado», «Dónde está el temario»…). Son las del campus elegido arriba. Son {pasos} pasos.',
      },
      {
        donde: anclaje('consultas-respuestas-nueva'),
        titulo: 'Una nueva',
        texto: 'Un nombre corto y el texto. Escribe {nombre} donde vaya el nombre del alumno: se cambia solo al usarla.',
      },
      {
        donde: anclaje('consultas-respuestas-lista'),
        titulo: 'Las del campus',
        texto: 'El lápiz la cambia y la papelera la borra (pregunta antes). Lo que cambies les llega a todas al momento.',
      },
      {
        titulo: 'Dónde les salen',
        texto: 'En el chat de cada consulta, en «Respuestas guardadas», marcadas «Del campus», junto a las suyas propias.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },
};
