import type { RecorridoCobros } from '@/shared/lib/recorridosCobros';
import { FINAL_RECORRIDO as FINAL } from '@/shared/lib/recorridosComun';

/**
 * LOS RECORRIDOS DE LAS NOVEDADES DEL 18/11, SEGUNDA TANDA (#611; gemela de
 * CRM#928 / CRM#1010). Diego, 19/11: «el tutorial no es con imágenes, es un
 * tutorial guiado de la app, como el del tablero».
 *
 * El mismo modelo que `recorridosCobros.ts`, que es donde se registran: allí se
 * suman a `RECORRIDOS_COBROS`, y así `VerRecorrido` y las pruebas de siempre (la
 * de los anclajes y la de 375 px) los ven sin tocar nada más. Van en su propio
 * fichero para no pisarse con la primera tanda (`recorridosNovedades.ts`: menú,
 * «Hoy», ventas repetidas y cuotas).
 *
 *  · Factura del mes: «Mi factura», de quien sube la suya (colaboradores y las
 *    vendedoras de la lista), y «Facturas de colaboradores», de quien las ve
 *    todas, con el paso de validar solo para quien puede validar.
 *  · Mi campus, de los tutores.
 *  · Incidencias y Prospectos con sus filtros (abre con la lista).
 *
 *  · Cada paso apunta a un `data-recorrido` de su pantalla; lo que no está en ese
 *    momento (un mes ya subido, la vista de cifras estando en la lista) se salta
 *    solo.
 *  · El permiso de cada recorrido es el de la pantalla en el menú y en el
 *    servidor; el de un paso, el del botón que explica.
 *
 * Mismos ids, anclajes y textos que el 360, salvo donde ISEIE es distinto:
 *  · Mi campus: aquí «Mis cursos y comisiones» es un enlace de la cabecera, no una
 *    pestaña: el paso «Las dos pestañas» pasa a ser «Mis cursos y comisiones» y
 *    señala ese enlace (`mi-campus-comisiones`).
 *  · Prospectos: no hay empresas ni filtro de campus dentro de «Filtros» (el
 *    campus se elige arriba, en el menú), así que no va el paso «El filtro de
 *    campus». El buscador está dentro de «Filtros», con los atajos «Vencidos»,
 *    «Hoy» y «Mañana», y no hay «Cuándo toca» encima de la lista: esos dos textos
 *    lo dicen así.
 *
 * Solo importa TIPOS de `recorridosCobros` (se borran al compilar): así no hay un
 * ciclo de módulos entre los dos ficheros.
 */

export type IdRecorridoNovedadesB =
  | 'mi-factura'
  | 'facturas-colaboradores'
  | 'mi-campus'
  | 'incidencias'
  | 'prospectos';

type RecorridoNovedadesB = Omit<RecorridoCobros, 'id'> & { id: IdRecorridoNovedadesB };

const anclaje = (nombre: string) => `[data-recorrido="${nombre}"]`;


/** En el orden de la issue: factura del mes (las dos caras), Mi campus, Incidencias y Prospectos. */
export const RECORRIDOS_NOVEDADES_B: Record<IdRecorridoNovedadesB, RecorridoNovedadesB> = {
  // ─── Mi factura (colaboradores y vendedoras) ───────────────────────────────
  'mi-factura': {
    id: 'mi-factura',
    rutas: ['/mi-factura'],
    titulo: 'Mi factura',
    permiso: 'facturas_colaborador.subir',
    pantalla: ['modules/facturas-colaborador/pages/MiFacturaPage.tsx'],
    pasos: [
      {
        titulo: 'Tu factura del mes',
        texto: 'El último día de cada mes sale aquí el mes que tienes que facturar, uno por cada empresa que te paga. Son {pasos} pasos.',
      },
      {
        donde: anclaje('mi-factura-meses'),
        titulo: 'Tus meses',
        texto: 'Cada mes, con su empresa y lo acordado. Si cobras lo que diga tu factura, pone «Sin importe acordado».',
      },
      {
        donde: anclaje('mi-factura-subir'),
        titulo: 'Subir mi factura',
        texto: 'Pulsa, adjunta el PDF y escribe su número y el importe. También puedes subirla desde «Tu enlace», el del correo.',
      },
      {
        donde: anclaje('mi-factura-pago'),
        titulo: 'Revisión y pago',
        texto: 'Al subirla queda «En revisión». Cuando la empresa la valida pasa a «Validada · por pagar», y al pagarla, «Pagada» con su fecha.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── Finanzas › Facturas de colaboradores (validar antes de pagar) ─────────
  'facturas-colaboradores': {
    id: 'facturas-colaboradores',
    rutas: ['/accounting/facturas-colaboradores'],
    titulo: 'Facturas de colaboradores',
    permiso: 'facturas_colaborador.ver_todas',
    pantalla: [
      'modules/facturas-colaborador/pages/FacturasColaboradoresPage.tsx',
      'modules/facturas-colaborador/components/LeyendaFacturas.tsx',
    ],
    pasos: [
      {
        titulo: 'Las facturas del mes',
        texto: 'Colaboradores y vendedoras suben aquí su factura del mes, una por empresa. Primero se valida y después se paga. Son {pasos} pasos.',
      },
      {
        donde: anclaje('facturas-colab-pestanas'),
        titulo: 'Las pestañas',
        texto: '«Del mes», todo el mes. «Enviadas», «Por validar», «Por pagar», «Pagadas» e «Historial», cada momento. «Colaboradores», las fichas.',
      },
      {
        donde: anclaje('facturas-colab-tipo'),
        titulo: 'Quién factura',
        texto: 'Deja solo las de las vendedoras, los colaboradores, el equipo de desarrollo o las tutoras redactoras. Vale para todas las pestañas, y los totales salen del filtro.',
      },
      {
        donde: anclaje('facturas-colab-por-validar'),
        permiso: 'facturas_colaborador.validar',
        titulo: 'Validar antes de pagar',
        texto: 'Aquí esperan las recibidas. Mira el archivo y pulsa «Validar»: solo entonces pasa a «Por pagar». Si algo no cuadra, «Anular» con el motivo.',
      },
      {
        donde: anclaje('facturas-colab-mes'),
        titulo: 'El mes',
        texto: 'Cada persona con lo acordado, el enlace y su factura. «Por validar» marca las que faltan. A la derecha, sus botones.',
      },
      {
        donde: anclaje('facturas-colab-leyenda'),
        titulo: 'Qué es cada cosa',
        texto: 'Qué hace cada botón de la fila y qué quiere decir cada estado. Cada botón sale solo cuando se puede usar.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── Mi campus (tutores) ───────────────────────────────────────────────────
  'mi-campus': {
    id: 'mi-campus',
    rutas: ['/mis-cursos/campus'],
    titulo: 'Mi campus',
    permiso: 'tutores.mis_cursos',
    // La bandeja y el selector de campus viven en su componente (gemela de CRM#1084).
    pantalla: ['modules/tutores/pages/MiCampusPage.tsx', 'modules/tutores/components/BandejaMiCampus.tsx'],
    pasos: [
      {
        titulo: 'Tu campus',
        texto: 'Todo lo que te toca en Moodle, sin entrar en Moodle. Arriba, la cuenta de lo de hoy; «Actualizar» lo vuelve a leer, y en «Mis cursos y comisiones», arriba, tienes tus cursos en el CRM y lo que te corresponde. Son {pasos} pasos.',
      },
      {
        donde: anclaje('mi-campus-selector'),
        titulo: 'Tus campus',
        texto: '¿Estás en varios campus? Míralos todos juntos con «Todos» o pulsa uno o varios para ver solo esos. Se queda guardado para la próxima vez.',
      },
      {
        donde: anclaje('mi-campus-sin-conectar'),
        titulo: 'Campus sin conectar',
        texto: 'En estos campus tu cuenta de Moodle no está unida a la del CRM. Pídeselo a coordinación.',
      },
      {
        donde: anclaje('mi-campus-responder'),
        titulo: 'Por responder',
        texto: 'Las consultas de tus alumnos que esperan respuesta, con su último mensaje. «Responder» abre el cuadro aquí mismo y la respuesta le llega al alumno en Moodle, a tu nombre. «Abrir» lleva a la conversación entera.',
      },
      {
        donde: anclaje('mi-campus-corregir'),
        titulo: 'Por corregir',
        texto: 'Cada entrega sin nota, la más antigua primero. «Corregir» abre esa entrega: ves lo que ha subido el alumno, pones la nota y el comentario, y los ve en Moodle.',
      },
      {
        donde: anclaje('mi-campus-curso'),
        titulo: 'Cada curso',
        texto: 'Púlsalo para abrirlo: lo pendiente de ese curso, todas sus tareas y sus alumnos con el último acceso y el % hecho.',
      },
      {
        donde: anclaje('mi-campus-por-desarrollar'),
        titulo: 'Por desarrollar',
        texto: 'Los cursos que estás preparando: el plazo, el % de módulos y si ya están la foto y el vídeo.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── Incidencias ───────────────────────────────────────────────────────────
  incidencias: {
    id: 'incidencias',
    rutas: ['/incidencias'],
    titulo: 'Incidencias',
    permiso: 'incidencias.view',
    pantalla: ['modules/incidencias/pages/IncidenciasPage.tsx', 'modules/incidencias/components/CifrasIncidencias.tsx'],
    pasos: [
      {
        titulo: 'Lo que salió mal',
        texto: 'Qué pasó, cómo se arregló y quién necesita formación. Una gestora ve solo las suyas. Son {pasos} pasos.',
      },
      {
        donde: anclaje('incidencias-nueva'),
        permiso: 'incidencias.create',
        titulo: 'Nueva incidencia',
        texto: 'Cuándo y dónde pasó, de qué tipo, quién la causó, sobre qué ficha y cómo se arregló. Puedes adjuntar capturas.',
      },
      {
        donde: anclaje('incidencias-vistas'),
        titulo: 'Lista o cifras',
        texto: '«Lista», una a una. «Por persona, tipo y mes», cuántas hay de cada cosa.',
      },
      {
        donde: anclaje('incidencias-filtros'),
        titulo: 'Los filtros',
        texto: 'Por estado, por tipo y por quién la causó. Valen también para las cifras. «Quitar filtros» los quita.',
      },
      {
        donde: anclaje('incidencias-lista'),
        titulo: 'La lista',
        texto: 'Cada una con su tipo, su gravedad y su estado. Pulsa una para abrir su ficha: qué pasó, qué impacto tuvo y cómo se arregló.',
      },
      {
        donde: anclaje('incidencias-cifras'),
        titulo: 'Las cifras',
        texto: 'Cuántas causó cada persona, de cada tipo y por mes. Pulsa un nombre para ver sus incidencias en la lista.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── Prospectos › Lista, con sus filtros ───────────────────────────────────
  prospectos: {
    id: 'prospectos',
    rutas: ['/leads'],
    titulo: 'Prospectos',
    permiso: 'leads.view',
    pantalla: [
      'modules/leads/pages/LeadsPage.tsx',
      'modules/leads/components/LoQueTocaHoyYManana.tsx',
    ],
    pasos: [
      {
        titulo: 'Tus prospectos',
        texto: 'Las personas que han pedido información y aún no han comprado. Una gestora ve solo las suyas. Son {pasos} pasos.',
      },
      {
        donde: anclaje('prospectos-nuevo'),
        permiso: 'leads.create',
        titulo: 'Nuevo prospecto',
        texto: 'Para dar de alta a alguien a mano. Los que llegan de la web entran solos y se reparten entre las gestoras.',
      },
      {
        donde: anclaje('prospectos-vistas'),
        titulo: 'Lista y Equipo',
        texto: 'Se abre en la lista. En «Equipo» están las cifras, cómo vas este mes y el resumen del día.',
      },
      {
        // ISEIE: el buscador va dentro de «Filtros»; el campus se elige arriba, en el menú.
        donde: anclaje('prospectos-filtros'),
        titulo: 'Buscar y filtrar',
        texto: '«Filtros» lo trae todo: el buscador por nombre, correo o teléfono, estado, paso, canal, país, gestor, programa y fechas. Lo puesto sale en píldoras.',
      },
      {
        donde: anclaje('prospectos-lista'),
        titulo: 'La lista',
        texto: 'Pulsa una fila para abrir la ficha rápida. Dentro de «Filtros», «Vencidos», «Hoy» y «Mañana» la dejan en lo que toca.',
      },
      {
        donde: anclaje('prospectos-lo-que-toca'),
        titulo: 'Lo que toca',
        texto: 'Debajo de la lista, a quién hay que escribir o llamar hoy y mañana, según el proceso comercial.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },
};
