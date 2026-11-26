import type { RecorridoCobros } from '@/shared/lib/recorridosCobros';
import { FINAL_RECORRIDO as FINAL, anclaje } from '@/shared/lib/recorridosComun';

/**
 * LAS PANTALLAS DEL MENÚ QUE SE QUEDARON SIN RECORRIDO (#619, tanda J; gemela
 * de CRM#941). Las tandas D a I cubrieron la lista de la issue; estas no
 * estaban en ella y son de las que más se abren a diario:
 *
 *  · Historial de tareas: lo hecho, quién y cuándo.
 *  · Configurar tablero: columnas, áreas, proyectos propios, equipos y GitHub.
 *  · Reportes: el informe del periodo y lo que se descarga.
 *  · PayPal y banco: los cobros que entran por PayPal y los extractos del banco.
 *  · Novedades: lo que trae cada versión.
 *
 * Correos, que esta tanda traía, se pasó a la tanda E (`recorridosGestoraC.ts`,
 * #782), como en MultiCRM: Diego lo pidió allí.
 *
 * El tablero de Tareas ya tenía el suyo (`recorridoTablero`), y Conciliación ›
 * Facturas y cobros también (`recorridosNovedades301.ts`). Conciliación ›
 * Cargos de Stripe no entra: es «enlazar con Stripe», de Diego y Claude.
 * PayPal y banco tiene además los «Ver cómo funciona» de pruebas
 * (`recorridosDePrueba.ts`), que se quedan: aquellos son para probar la
 * función en staging; este, para el día a día. Comparten anclajes.
 *
 * El mismo modelo que `recorridosCobros.ts`, que es donde se registran: allí se
 * suman a `RECORRIDOS_COBROS`, y así `VerRecorrido`, el botón «Recorrido» de la
 * cabecera (por sus `rutas`) y las pruebas de siempre (la de los anclajes y la
 * de 375 px) los ven sin tocar nada más. Ninguno se abre solo (#681).
 *
 *  · Cada paso apunta a un `data-recorrido` de su pantalla; lo que no está en ese
 *    momento (no hay tareas hechas, la otra pestaña, una función apagada, el
 *    envío de novedades a quien no lo dirige) se salta solo.
 *  · El permiso de cada recorrido es el de la pantalla en el menú; el de un
 *    paso, el del botón que explica.
 *
 * Solo importa TIPOS de `recorridosCobros` (se borran al compilar): así no hay un
 * ciclo de módulos entre los dos ficheros.
 *
 * PARIDAD: mismos ids y anclajes que en MultiCRM. Cambian las rutas (aquí
 * PayPal y banco cuelga de `/accounting`; allí, de `/finanzas`), el permiso de
 * Reportes (aquí `reports.mis_informes`; allí `reports.view`) y lo que se
 * descarga en Reportes (aquí Excel y PDF; allí CSV y PDF).
 */

/** Lo único que cambia en los textos entre los dos CRM. */
const EN_ESTE_CRM = {
  descargar: '«Descargar Excel» baja el resumen, la evolución y el detalle por asesora; «Descargar PDF», lo mismo para enviarlo.',
  cifras: 'Prospectos, ventas, ingresos y tasa de conversión, comparados con el periodo anterior, y debajo la gráfica de su evolución.',
};

export type IdRecorridoGestoraH =
  | 'historial-tareas'
  | 'configurar-tablero'
  | 'reportes'
  | 'cobros-externos'
  | 'novedades';

type RecorridoGestoraH = Omit<RecorridoCobros, 'id'> & { id: IdRecorridoGestoraH };

/** Por el menú: Equipo, Finanzas, Análisis y Sistema. */
export const RECORRIDOS_GESTORA_H: Record<IdRecorridoGestoraH, RecorridoGestoraH> = {
  // ─── Equipo de Desarrollo › Historial de tareas ────────────────────────────
  'historial-tareas': {
    id: 'historial-tareas',
    rutas: ['/tareas/historial'],
    titulo: 'Historial de tareas',
    permiso: ['tasks.view_own', 'tasks.view_all'],
    pantalla: ['modules/tasks/pages/TasksHistoryPage.tsx'],
    pasos: [
      {
        titulo: 'Lo que ya está hecho',
        texto: 'Cada tarea que alguien pasó a «Hecha»: quién la hizo, quién la cerró y cuándo. Ves lo mismo que en el tablero: lo tuyo y lo de tu equipo. Son {pasos} pasos.',
      },
      {
        donde: anclaje('historial-filtros'),
        titulo: 'Qué ver',
        texto: 'Busca por el título o la descripción. «Ver» elige entre lo tuyo, lo de tu equipo o todo; y puedes quedarte con una persona o un equipo.',
      },
      {
        donde: anclaje('historial-periodo'),
        titulo: 'El periodo',
        texto: 'Esta semana, este mes o todo. Las flechas van a la semana o al mes de antes o de después. Debajo dice qué periodo ves y cuántas tareas hay.',
      },
      {
        donde: anclaje('historial-integrantes'),
        titulo: 'Por integrante',
        texto: 'Cuántas hizo cada persona en el periodo, tú primero. Pulsa una ficha para ver solo las suyas; otra vez, para quitarlo.',
      },
      {
        donde: anclaje('historial-lista'),
        titulo: 'Las tareas hechas',
        texto: 'Las más recientes arriba, con su equipo, proyecto y área. Pulsa el título para abrir la tarea en el tablero.',
      },
      {
        donde: anclaje('historial-volver'),
        titulo: 'Volver al tablero',
        texto: 'Para seguir con lo que está en marcha. El botón de al lado vuelve a pedir la lista.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── Equipo de Desarrollo › Configurar tablero ─────────────────────────────
  'configurar-tablero': {
    id: 'configurar-tablero',
    rutas: ['/tareas/configurar'],
    titulo: 'Configurar tablero',
    permiso: 'tasks.manage',
    pantalla: ['modules/tasks/pages/TaskBoardConfigPage.tsx'],
    pasos: [
      {
        titulo: 'Cómo es el tablero',
        texto: 'Aquí se decide qué columnas tiene el tablero de tareas, en qué áreas se reparte y qué proyectos propios se pueden elegir. Vale para todo el equipo. Son {pasos} pasos.',
      },
      {
        donde: anclaje('configurar-pestanas'),
        titulo: 'Qué configurar',
        texto: 'Columnas, áreas (con quién está en cada una) y proyectos propios. Si tienes permiso, también los equipos y la conexión con GitHub.',
      },
      {
        donde: anclaje('configurar-nueva'),
        titulo: 'Añadir una columna',
        texto: 'Su nombre y su color, y «Añadir». Sale en el tablero de todos, al final.',
      },
      {
        donde: anclaje('configurar-lista'),
        titulo: 'Ordenar, renombrar o archivar',
        texto: 'Las flechas cambian el orden en el tablero; el lápiz, el nombre y el color. Las cuatro fijas no se archivan, ni una con tareas: primero hay que moverlas. Una archivada se recupera.',
      },
      {
        donde: anclaje('configurar-volver'),
        titulo: 'Volver al tablero',
        texto: 'Los cambios ya están guardados: el tablero sale con ellos.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── Análisis › Reportes ───────────────────────────────────────────────────
  reportes: {
    id: 'reportes',
    rutas: ['/informes'],
    titulo: 'Reportes',
    permiso: 'reports.mis_informes',
    pantalla: ['shared/pages/ReportsPage.jsx'],
    pasos: [
      {
        titulo: 'El informe del periodo',
        texto: 'Cómo va el negocio: actividad del equipo, tasa de cierre, ventas, seguimiento y de dónde vienen los prospectos. Todo con el periodo y el ámbito de arriba. Son {pasos} pasos.',
      },
      {
        donde: anclaje('reportes-periodo'),
        titulo: 'El periodo',
        texto: 'Empieza en «Este mes». Elige otro atajo o pon las fechas a mano: cambian todas las cifras de abajo. Justo debajo dice qué periodo estás viendo.',
      },
      {
        donde: anclaje('reportes-exportar'),
        titulo: 'Descargarlo',
        texto: EN_ESTE_CRM.descargar,
      },
      {
        donde: anclaje('reportes-actividad'),
        titulo: 'Actividad por comercial',
        texto: 'Lo primero que se mira por la mañana: qué hizo cada comercial. Tiene sus propios atajos y empieza en «Ayer».',
      },
      {
        donde: anclaje('reportes-cierre'),
        titulo: 'La tasa de cierre',
        texto: 'De los prospectos que entraron, cuántos compraron. «¿De dónde sale?» enseña la cuenta, para comprobarla sin salir de aquí.',
      },
      {
        donde: anclaje('reportes-cifras'),
        titulo: 'Las cifras del periodo',
        texto: EN_ESTE_CRM.cifras,
      },
      {
        donde: anclaje('reportes-descargas'),
        titulo: 'Reportes descargables',
        texto: 'Más abajo, los detalles en hojas: prospectos, ventas y asesoras, con este mismo periodo. Debajo, el informe del mes y el ZIP de facturas para la gestoría.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── Finanzas › PayPal y banco ─────────────────────────────────────────────
  'cobros-externos': {
    id: 'cobros-externos',
    rutas: ['/accounting/cobros-externos'],
    titulo: 'PayPal y banco',
    permiso: 'cobros_externos.view',
    pantalla: ['modules/accounting/pages/CobrosExternosPage.tsx'],
    pasos: [
      {
        titulo: 'Cobros de PayPal y del banco',
        texto: 'Lo que entra por PayPal se registra solo en su venta. Del banco se sube el extracto y aquí decides los abonos dudosos. Lo registrado pasa a la cola de facturación. Son {pasos} pasos.',
      },
      {
        donde: anclaje('cobros-pestanas'),
        titulo: 'PayPal o banco',
        texto: 'Dos pestañas. Este recorrido explica la que tengas abierta. Si una sale apagada, la enciende Diego en el servidor.',
      },
      {
        donde: anclaje('paypal-filtro'),
        titulo: 'Qué cobros ver',
        texto: 'Empieza en «Sin registrar en una venta»: lo que falta por hacer. También puedes ver los ya registrados, con el enlace a su venta, o todos.',
      },
      {
        donde: anclaje('paypal-sincronizar'),
        permiso: 'cobros_externos.edit',
        titulo: 'Traerlos ahora',
        texto: 'PayPal entra solo; esto lo pide ahora para el campus de arriba. Con «Todos» o una empresa arriba, sale apagado.',
      },
      {
        donde: anclaje('paypal-tabla'),
        titulo: 'Cada cobro',
        texto: 'Fecha, cliente, importe y estado (un reembolso, con un menos delante). Si no encontró su venta, escribe su número y «Enlazar».',
      },
      {
        donde: anclaje('banco-subir'),
        permiso: 'cobros_externos.edit',
        titulo: 'Subir un extracto',
        texto: 'Con un campus arriba, sube el Norma 43 o el CSV de movimientos del banco. Solo se leen los abonos, y subirlo dos veces no duplica nada.',
      },
      {
        donde: anclaje('banco-estados'),
        titulo: 'Los abonos',
        texto: '«A revisar» y «Sin candidato» esperan que decidas: «Es de…» con su venta, otro número de venta o «Descartar». «Registrados» y «Descartados», lo ya hecho.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── Sistema › Novedades ───────────────────────────────────────────────────
  novedades: {
    id: 'novedades',
    rutas: ['/novedades'],
    titulo: 'Novedades',
    permiso: 'novedades.view',
    pantalla: ['modules/novedades/pages/NovedadesPage.tsx'],
    pasos: [
      {
        titulo: 'Lo nuevo de cada versión',
        texto: 'Lo que trae cada versión del CRM, lo mismo que llega por correo y a la campana. Son {pasos} pasos.',
      },
      {
        donde: anclaje('novedades-version'),
        titulo: 'Versión y PDF',
        texto: 'Elige otra versión para ver lo que trajo. «PDF» la baja para leerla o enviarla.',
      },
      {
        donde: anclaje('novedades-resumen'),
        titulo: 'De un vistazo',
        texto: 'De qué va esta versión y cuántas novedades y arreglos trae.',
      },
      {
        donde: anclaje('novedades-envio'),
        titulo: 'Mandarla',
        texto: '«Mandar prueba» te la envía a ti. «Enviar a todo el equipo» manda el aviso y el correo una sola vez; en producción sale sola al subir la versión.',
      },
      {
        donde: anclaje('novedades-indice'),
        titulo: 'Los apartados',
        texto: 'Salta a cada apartado desde aquí, o con las teclas 1 a 9 (y 0, los arreglos).',
      },
      {
        donde: anclaje('novedades-lista'),
        titulo: 'Cada novedad',
        texto: 'Qué cambia y para quién. «Ir» te lleva a su pantalla y «Ver recorrido», si lo tiene, te la enseña paso a paso. Solo salen si esa pantalla es tuya.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },
};
