import type { RecorridoCobros } from '@/shared/lib/recorridosCobros';
import { FINAL_RECORRIDO as FINAL, anclaje } from '@/shared/lib/recorridosComun';

/**
 * LOS RECORRIDOS DEL BLOQUE COMERCIAL QUE FALTABAN (#619, tanda G; gemela de
 * CRM#941). Diego, 19/11: «las que son así, dáselas a Ángel CEDIA». En el
 * orden de la issue, lo que quedaba de Comercial después de Prospectos,
 * Clientes (tandas B y C) y Proceso comercial (tanda F):
 *
 *  · Convocatorias: las becas, a quién le debemos respuesta y su embudo.
 *  · Revisión de duplicados: los repetidos que entran por webhook, uno a uno.
 *  · Buscar duplicados: el repaso de toda la base de un campus, por grupos.
 *  · Solicitud de admisión: lo que llega del formulario de admisión (solo el
 *    listado; Certificaciones y Diplomas son de Certifex y van aparte).
 *
 * El mismo modelo que `recorridosCobros.ts`, que es donde se registran: allí se
 * suman a `RECORRIDOS_COBROS`, y así `VerRecorrido`, el botón «Recorrido» de la
 * cabecera (por sus `rutas`) y las pruebas de siempre (la de los anclajes y la
 * de 375 px) los ven sin tocar nada más. Ninguno se abre solo (#1012).
 *
 *  · Cada paso apunta a un `data-recorrido` de su pantalla; lo que no está en ese
 *    momento (nadie espera respuesta, no hay duplicados, un campus fijo arriba)
 *    se salta solo.
 *  · El permiso de cada recorrido es el de la pantalla en el menú; el de un
 *    paso, el del botón que explica.
 *  · Lo que se ve distinto en el PC y en el móvil (la tabla y las tarjetas) se
 *    señala por la caja que lo contiene, no por una de las dos.
 *
 * Solo importa TIPOS de `recorridosCobros` (se borran al compilar): así no hay un
 * ciclo de módulos entre los dos ficheros.
 *
 * IGUAL EN LOS DOS CRM (paridad): mismos ids, anclajes y textos. Solo cambian
 * las rutas (aquí `/leads/…` y `/matriculas`, en el 360 `/prospectos/…` y
 * `/clientes/matriculas`) y lo de `EN_ESTE_CRM`, justo debajo.
 */

/**
 * Lo único que cambia entre los dos CRM. Aquí Convocatorias va siempre con el
 * campus de arriba. En el 360, con una empresa o «Todos» arriba, junta todos
 * sus campus y cada beca sale con el suyo.
 */
const EN_ESTE_CRM = {
  convocatoriasFiltro: 'Con «Todas», el embudo suma todas las becas; elige una para ver solo la suya. Todo es del campus elegido arriba.',
};

export type IdRecorridoGestoraE =
  | 'convocatorias'
  | 'revision-duplicados'
  | 'buscar-duplicados'
  | 'solicitud-admision';

type RecorridoGestoraE = Omit<RecorridoCobros, 'id'> & { id: IdRecorridoGestoraE };

/** Por el menú: Prospectos › Convocatorias y, en Clientes, duplicados y admisión. */
export const RECORRIDOS_GESTORA_E: Record<IdRecorridoGestoraE, RecorridoGestoraE> = {
  // ─── Prospectos › Convocatorias ────────────────────────────────────────────
  convocatorias: {
    id: 'convocatorias',
    rutas: ['/leads/convocatorias'],
    titulo: 'Convocatorias',
    permiso: 'convocatorias.view',
    pantalla: ['modules/convocatorias/pages/ConvocatoriasPage.tsx'],
    pasos: [
      {
        titulo: 'Las becas, de la oferta a la venta',
        texto: 'Las becas que se ofrecen, a quién se le ofrecieron y en qué acabaron. Cada beca se ofrece desde la ficha del prospecto; aquí se ve el conjunto. Son {pasos} pasos.',
      },
      {
        donde: anclaje('convocatorias-filtro'),
        titulo: 'Una o todas',
        texto: EN_ESTE_CRM.convocatoriasFiltro,
      },
      {
        donde: anclaje('convocatorias-pendientes'),
        titulo: 'Le debemos respuesta',
        texto: 'A quién se le prometió una respuesta para hoy o antes y aún no la tiene. En ámbar, le toca hoy; en rojo, ya va con retraso. Pulsa el nombre para abrir su ficha. Es la cifra que se quiere en cero.',
      },
      {
        donde: anclaje('convocatorias-embudo'),
        titulo: 'De ofrecerla a venderla',
        texto: 'A cuántos se les ofreció, cuántos llenaron la solicitud y cuántos compraron. «De los que la pidieron, compraron» dice si la beca cierra ventas. «Sin preguntar» es trabajo pendiente, no un no.',
      },
      {
        donde: anclaje('convocatorias-lista'),
        titulo: 'Las convocatorias',
        texto: 'Cada beca con sus topes de descuento (formación nueva · ya habilitada) y cuántas veces se ha ofrecido. «Ver también las cerradas» trae las que ya no se ofrecen. Si administras, «Cerrar» o «Reabrir».',
      },
      {
        donde: anclaje('convocatorias-nueva'),
        permiso: 'convocatorias.create',
        titulo: 'Nueva convocatoria',
        texto: 'Crea otra con su nombre y sus topes: hasta dónde puede llegar el descuento en una formación nueva y en una ya habilitada. Se crea en el campus elegido arriba.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── Clientes › Revisión de duplicados ─────────────────────────────────────
  'revision-duplicados': {
    id: 'revision-duplicados',
    rutas: ['/leads/revision-duplicados'],
    titulo: 'Revisión de duplicados',
    permiso: 'leads.duplicados',
    pantalla: ['modules/leads/pages/DupReviewQueuePage.tsx'],
    pasos: [
      {
        titulo: 'Los repetidos que entran',
        texto: 'Prospectos que llegaron por un formulario con el correo o el teléfono de otro que ya estaba. Entraron igual (el formulario nunca se bloquea): aquí decides qué hacer con cada uno. Son {pasos} pasos.',
      },
      {
        donde: anclaje('revision-estados'),
        titulo: 'Pendientes y lo ya decidido',
        texto: '«Pendientes» es lo que queda por decidir. Aprobados, Fusionados y Descartados guardan lo que ya se hizo, con cuántos hay en cada uno. «Refrescar» trae lo último.',
      },
      {
        donde: anclaje('revision-lista'),
        titulo: 'El nuevo frente al original',
        texto: 'A la izquierda, el que acaba de llegar: su producto, su gestora, cuándo llegó y si casa por correo, por teléfono o por los dos. «Reincidente», que ya se repitió antes. A la derecha, el que ya estaba; la flecha abre su ficha.',
      },
      {
        donde: anclaje('revision-decidir'),
        titulo: 'Decidir',
        texto: '«Aprobar» lo deja como prospecto aparte. «Fusionar» lo junta con el original y le pasa su historial. «Descartar» lo manda a la papelera, con un motivo si quieres. «Ver ficha del nuevo» lo abre antes de decidir.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── Clientes › Buscar duplicados ──────────────────────────────────────────
  'buscar-duplicados': {
    id: 'buscar-duplicados',
    rutas: ['/leads/duplicados'],
    titulo: 'Buscar duplicados',
    permiso: 'leads.duplicados',
    pantalla: ['modules/leads/pages/DuplicatesPage.tsx'],
    pasos: [
      {
        titulo: 'Fichas repetidas en la base',
        texto: 'Repasa toda la base del campus, no solo lo que entra por formulario: fichas que comparten correo, teléfono o usuario de WhatsApp con otra. Son {pasos} pasos.',
      },
      {
        donde: anclaje('duplicados-campus'),
        titulo: 'El campus',
        texto: 'Los duplicados se buscan dentro de un campus. Con una empresa o «Todos» arriba, elige aquí cuál.',
      },
      {
        donde: anclaje('duplicados-cifras'),
        titulo: 'Las cifras',
        texto: 'Cuántas personas tienen más de una ficha, cuántas fichas hay en juego, cuántos grupos no ha revisado nadie y cuántos son de tres fichas o más.',
      },
      {
        donde: anclaje('duplicados-filtros'),
        titulo: 'Buscar',
        texto: 'Por nombre, correo, teléfono o número de ficha. «Solo los que nadie ha revisado» quita los grupos ya marcados como duplicado. «Refrescar» vuelve a buscar.',
      },
      {
        donde: anclaje('duplicados-grupo'),
        titulo: 'Cada grupo',
        texto: 'Una persona con todas sus fichas y por qué se juntan. La corona marca la que se queda: la que tiene ventas o, si no, la más antigua. Cámbiala con el círculo, y quita «fusionar» a la que no sea la misma persona.',
      },
      {
        donde: anclaje('duplicados-fusionar'),
        permiso: 'leads.edit',
        titulo: 'Fusionar',
        texto: 'Escribe por qué son la misma persona y pulsa «Fusionar». Todo su historial (interacciones, ventas, matrículas, correos y el chat de WhatsApp) pasa a la que se queda; las demás van a la papelera.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── Clientes › Solicitud de admisión ──────────────────────────────────────
  'solicitud-admision': {
    id: 'solicitud-admision',
    rutas: ['/matriculas'],
    titulo: 'Solicitud de admisión',
    permiso: 'matriculas.view',
    pantalla: ['modules/matriculas/pages/MatriculasPage.tsx'],
    pasos: [
      {
        titulo: 'Lo que llega del formulario',
        texto: 'Las solicitudes del formulario de admisión de la web: quién lo pide, para qué curso y con qué documentos. Son {pasos} pasos.',
      },
      {
        donde: anclaje('admision-pestanas'),
        titulo: 'Las pestañas',
        texto: '«Listado» es lo que ves. Si administras, «Webhooks de admisión» conecta el formulario de cada campus con el CRM. Certificaciones y Diplomas, si te salen, son de Certifex.',
      },
      {
        donde: anclaje('admision-cifras'),
        titulo: 'Las cifras',
        texto: 'El total y cómo van: las recién llegadas (Solicitudes), las pendientes, las validadas y las rechazadas. Cuentan lo del campus o la empresa elegidos arriba.',
      },
      {
        donde: anclaje('admision-filtros'),
        titulo: 'Buscar y filtrar',
        texto: 'Busca por nombre, correo o DNI. «Filtros» trae estado, curso, campus y fechas de llegada; cada filtro puesto sale como una píldora que se quita con su X.',
      },
      {
        donde: anclaje('admision-lista'),
        titulo: 'La lista',
        texto: 'Cada solicitud con su curso, campus, gestora, hora de llegada (de Madrid) y estado. Los iconos son sus documentos: con marca, llegó; con hueco, falta. «Ver venta» abre su venta, si la tiene.',
      },
      {
        donde: anclaje('admision-ver'),
        titulo: 'Abrir una solicitud',
        texto: 'El ojo abre la solicitud entera: sus datos, sus documentos, su prospecto, su venta y su historial. Si puedes cambiar el estado, ahí validas los datos, validas la matrícula o la rechazas con su motivo.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },
};
