import type { RecorridoCobros } from '@/shared/lib/recorridosCobros';
import { FINAL_RECORRIDO as FINAL, anclaje } from '@/shared/lib/recorridosComun';

/**
 * LOS RECORRIDOS DEL DÍA A DÍA, CUARTA TANDA (#619, tanda F; gemela de
 * CRM#941). Después de la tanda E (`recorridosGestoraC.ts`):
 *
 *  · Tutores: la lista y la ficha del tutor, que es la misma pantalla (no hay
 *    `/tutores/:id`: la ficha sale a la derecha al pulsar uno). Un solo
 *    recorrido; los pasos de la ficha que aún no está (sus formaciones, sus
 *    consultas) se saltan solos hasta que se elige un tutor.
 *  · Proceso comercial. Sale del trabajo de la rama `feat/619-recorridos-comercial`
 *    (sin publicar): los mismos anclajes y textos, con `rutas` y el final común.
 *
 * Lo que NO va aquí: la ficha del cliente (`/clients/:id`) ya tiene en main
 * «Avance del alumno» (`avance-alumno`), y otro recorrido de pantalla haría dos
 * «Ver recorrido» en la misma ficha. Comisiones de tutores ya tiene el suyo
 * (`comisiones-tutores`, Finanzas).
 *
 * El mismo modelo que `recorridosCobros.ts`, que es donde se registran: allí se
 * suman a `RECORRIDOS_COBROS`, y así `VerRecorrido`, el botón «Recorrido» de la
 * cabecera (por sus `rutas`) y las pruebas de siempre los ven sin tocar nada más.
 * Ninguno se abre solo (#1012).
 *
 * Solo importa TIPOS de `recorridosCobros` (se borran al compilar): así no hay un
 * ciclo de módulos entre los dos ficheros.
 *
 * IGUAL EN LOS DOS CRM (paridad): mismos ids, anclajes y textos. Solo cambian
 * las rutas (aquí `/leads/proceso`, en el 360 `/prospectos/proceso`) y lo de
 * `EN_ESTE_CRM`, justo debajo.
 */

/**
 * Lo único que cambia entre los dos CRM. Aquí la lista de Tutores avisa de todo
 * lo que le falta a cada uno para cobrar («falta IBAN», «falta DNI»…), y el
 * campus del alta se elige en el formulario. En el 360, con una empresa arriba,
 * «Nuevo tutor» trae al lado el desplegable del campus y la lista solo avisa
 * del IBAN.
 */
const EN_ESTE_CRM = {
  tutoresNuevo: 'Da de alta a alguien con sus datos, su contraseña y sus cursos, cada uno con su porcentaje y desde cuándo. El campus en el que entra se elige en el propio formulario.',
  tutoresLista: 'Cada tutor con cuántos cursos lleva y de qué marcas es. En ámbar, lo que le falta para poder pagarle (IBAN, banco, DNI…). «Aún no ha entrado», que no ha estrenado su cuenta. Pulsa uno para abrir su ficha.',
};

export type IdRecorridoGestoraD =
  | 'tutores'
  | 'proceso-comercial';

type RecorridoGestoraD = Omit<RecorridoCobros, 'id'> & { id: IdRecorridoGestoraD };

/** Por menú: Tutores (lista y ficha) y Prospectos › Proceso comercial. */
export const RECORRIDOS_GESTORA_D: Record<IdRecorridoGestoraD, RecorridoGestoraD> = {
  // ─── Tutores › Lista y ficha ───────────────────────────────────────────────
  tutores: {
    id: 'tutores',
    rutas: ['/tutores'],
    titulo: 'Tutores',
    permiso: 'tutores.gestionar',
    pantalla: ['modules/tutores/pages/TutoresPage.tsx'],
    pasos: [
      {
        titulo: 'Quién imparte qué',
        texto: 'Los tutores y las formaciones por las que cobra cada uno: un porcentaje de lo que se cobra de ellas. A la izquierda, la lista; a la derecha, la ficha del que elijas. Son {pasos} pasos.',
      },
      {
        donde: anclaje('tutores-nuevo'),
        titulo: 'Nuevo tutor',
        texto: EN_ESTE_CRM.tutoresNuevo,
      },
      {
        donde: anclaje('tutores-buscar'),
        titulo: 'Buscar y retirados',
        texto: 'Busca por nombre o correo, sin preocuparte de las tildes. Los retirados no salen: la casilla de debajo los enseña, para reactivar a quien se retiró por error.',
      },
      {
        donde: anclaje('tutores-lista'),
        titulo: 'La lista',
        texto: EN_ESTE_CRM.tutoresLista,
      },
      {
        donde: anclaje('tutor-ficha'),
        titulo: 'Su ficha',
        texto: 'Con un tutor elegido, aquí sale lo suyo. Arriba, lo que se hace con él: editar sus datos y su IBAN, cambiar la contraseña (si eres admin), retirarlo y añadirle una formación. Retirar no borra: lo que ya ganó se le sigue debiendo.',
      },
      {
        donde: anclaje('tutor-formaciones'),
        titulo: 'Sus formaciones',
        texto: 'Cada una con su campus, el porcentaje, desde y hasta cuándo cobra, si rige hoy y lo que ya entregó. «Editar» cambia el porcentaje y las fechas sin perder lo pagado; «Desactivar» la apaga sin borrarla; «Quitar» la borra, o solo la desactiva si ya generó comisiones.',
      },
      {
        donde: anclaje('tutor-consultas'),
        titulo: 'Consultas de alumnos',
        texto: 'En qué campus atiende las consultas y si está matriculado en el Moodle de cada uno: sin matrícula, no le llegan las de ese campus. Si se va de vacaciones o está de baja, «Marcar no disponible» pasa sus consultas a otro tutor.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── Prospectos › Proceso comercial ────────────────────────────────────────
  'proceso-comercial': {
    id: 'proceso-comercial',
    rutas: ['/leads/proceso'],
    titulo: 'Proceso comercial',
    permiso: 'proceso.view',
    pantalla: ['modules/proceso/pages/ProcesoPage.tsx'],
    pasos: [
      {
        titulo: 'Los pasos de la venta',
        texto: 'Los pasos por los que pasa cada prospecto, en orden. La cola del día y la ficha de cada persona salen de aquí. Son {pasos} pasos.',
      },
      {
        donde: anclaje('proceso-dias'),
        titulo: 'Cómo se cuentan los días',
        texto: 'Son días desde que entra el prospecto, no días de la semana: quien entra un jueves hace su primer paso el jueves o el viernes.',
      },
      {
        donde: anclaje('proceso-ambito'),
        titulo: 'De qué campus',
        texto: 'De quién es el proceso que ves. Con una empresa arriba, lo que cambies se aplica a todos sus campus; elige «Solo…» para tocar uno. «Ver también los inactivos» enseña los pasos apagados.',
      },
      {
        donde: anclaje('proceso-pasos'),
        titulo: 'Los pasos',
        texto: 'Cada uno con su número, sus días, sus canales en orden (llamada, WhatsApp, correo…) y su nota. «Seguimiento» es el de fin de mes: va sobre toda la base, no sobre la cola del día.',
      },
      {
        donde: anclaje('proceso-plantillas'),
        titulo: 'Plantillas de este paso',
        texto: 'Los mensajes de WhatsApp y el correo del paso, para copiarlos. Aquí salen con «María» de ejemplo; en la cola y en la ficha, con los datos de cada persona.',
      },
      {
        donde: anclaje('proceso-editar'),
        titulo: 'Editar y ordenar',
        texto: 'El lápiz cambia el paso; el ojo lo desactiva (no se borra, deja de verse). Para cambiar el orden, arrastra el paso por los puntos de la izquierda.',
        permiso: 'proceso.configurar_pasos',
      },
      {
        donde: anclaje('proceso-nuevo'),
        titulo: 'Nuevo paso',
        texto: 'Crea un paso con su nombre, sus días y sus canales. Luego arrástralo a su sitio en la lista.',
        permiso: 'proceso.configurar_pasos',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },
};
