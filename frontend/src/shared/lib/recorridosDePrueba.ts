import type { PasoRecorrido } from '@/shared/components/ui/RecorridoGuiado';
import { tienePermiso, type Permiso } from '@/shared/lib/recorridosCobros';

/**
 * RECORRIDOS PARA PROBAR LAS FUNCIONES NUEVAS DE STAGING (CRM#856 · CRM-ISEIE#522).
 *
 * Diego, 17/11: «tiene que haber tutorial de todo eso para probarlo y necesito que
 * tenga paridad en ambos CRM» y «no tiene que escribir el tutorial, sino que haga
 * un tutorial guiado». El mismo `RecorridoGuiado` del tablero, lanzado con el botón
 * «Ver cómo funciona» de cada pantalla (`VerComoFunciona`).
 *
 * A diferencia de los de cobros (`recorridosCobros.ts`), estos NUNCA se abren solos:
 * son para probar, se abren cuando alguien pulsa el botón (lo del 27/10: un recorrido
 * abierto solo encima de una ficha se tragaba los clics).
 *
 *  · Cada paso apunta a un `data-recorrido` de su pantalla (nunca a un texto). La
 *    prueba `recorridosDePrueba.test.jsx` comprueba que sigue en el código.
 *  · Cada recorrido dice qué es cada cosa y qué hacer, lo que tiene que fallar a
 *    propósito («A propósito: …») y termina con cómo dejarlo limpio (datos «[PRUEBA]»).
 *  · Sin el permiso del recorrido no se ofrece; un paso con permiso propio no sale a
 *    quien no lo tiene. Con la función apagada en el servidor, el botón lo dice.
 *
 * IGUAL EN LOS DOS CRM (paridad): mismos pasos y mismo texto.
 */

export type IdRecorridoDePrueba = 'cobros-paypal' | 'extractos-banco' | 'informe-mensual' | 'monitask';

export interface PasoDePrueba extends PasoRecorrido {
  /** Sin este permiso (o ninguno de la lista), el paso no sale. */
  permiso?: Permiso;
}

export interface RecorridoDePrueba {
  id: IdRecorridoDePrueba;
  titulo: string;
  /** La issue de la función que se prueba. */
  issue: string;
  /** Sin este permiso, ni botón ni recorrido. */
  permiso: Permiso;
  /** El interruptor del servidor que la enciende (si lo tiene). */
  interruptor?: string;
  /** Los ficheros de la pantalla donde viven sus `data-recorrido` (para la prueba). */
  pantalla: string[];
  pasos: PasoDePrueba[];
}

/** Lo que dice el botón con la función apagada en este servidor. */
export const APAGADA = 'Esta función está apagada: la enciende Diego.';

/** La clave del navegador (la marca `RecorridoGuiado` al abrirse; aquí no abre nada sola). */
export const claveRecorridoDePrueba = (id: IdRecorridoDePrueba, userId?: number | string | null) =>
  `recorrido-prueba-${id}-v1${userId != null ? `-u${userId}` : ''}`;

/** Los pasos que esa persona puede ver. */
export const pasosDePruebaPara = (r: RecorridoDePrueba, can: (p: string) => boolean): PasoRecorrido[] =>
  r.pasos.filter((p) => tienePermiso(p.permiso, can)).map(({ donde, titulo, texto }) => ({ donde, titulo, texto }));

/** Con la función apagada, un solo cartel que lo dice. */
export const pasosApagada = (r: RecorridoDePrueba): PasoRecorrido[] => [{
  titulo: `${r.titulo}: apagada`,
  texto: `${APAGADA} Cuando esté encendida en este servidor, este mismo botón te lleva paso a paso por la pantalla.`,
}];

const anclaje = (nombre: string) => `[data-recorrido="${nombre}"]`;

const REPETIR = 'Para repasarlo, «Ver cómo funciona».';

export const RECORRIDOS_DE_PRUEBA: Record<IdRecorridoDePrueba, RecorridoDePrueba> = {
  // ─── Finanzas › PayPal y banco › PayPal (#766) ──────────────────────────────
  'cobros-paypal': {
    id: 'cobros-paypal',
    titulo: 'Cobros de PayPal',
    issue: 'CRM#766',
    permiso: 'cobros_externos.view',
    interruptor: 'PAYPAL_COBROS_ACTIVO',
    pantalla: ['modules/accounting/pages/CobrosExternosPage.tsx'],
    pasos: [
      {
        titulo: 'Cobros de PayPal',
        texto: 'Lo que se cobra por PayPal entra solo: si el CRM encuentra su venta, lo registra en ella y pasa a la cola de facturación. Aquí ves lo que entró y enlazas lo que no encontró su venta. Son {pasos} pasos.',
      },
      {
        donde: anclaje('cobros-pestanas'),
        titulo: 'PayPal y banco',
        texto: 'Dos pestañas: PayPal, que entra solo, y Banco, donde se sube el extracto. Este recorrido es el de PayPal; el del banco sale con el mismo botón en su pestaña.',
      },
      {
        donde: anclaje('paypal-filtro'),
        titulo: 'Qué cobros ver',
        texto: 'Abre con «Sin registrar en una venta»: lo que falta por hacer. «Registrados en su venta» enseña los que ya entraron, con el enlace a su venta, y «Todos», todo.',
      },
      {
        donde: anclaje('paypal-sincronizar'),
        permiso: 'cobros_externos.edit',
        titulo: 'Traerlos ahora',
        texto: '«Sincronizar» pide ahora a PayPal los cobros del campus elegido arriba y dice cuántos leyó y cuántos registró. A propósito: con «Todos los proyectos» o una empresa elegida, sale apagado. Elige un campus y vuelve a probar.',
      },
      {
        donde: anclaje('paypal-tabla'),
        titulo: 'Cada cobro',
        texto: 'Fecha, cliente (su nombre en el CRM si lo encontró), importe y estado. Un reembolso sale con un menos delante y el estado «Reembolso». En «Venta», el enlace a su venta si ya está registrado.',
      },
      {
        donde: anclaje('paypal-enlazar'),
        permiso: 'cobros_externos.edit',
        titulo: 'Enlazar a mano',
        texto: 'Si no encontró su venta, escribe el número de venta y pulsa «Enlazar»: el cobro se registra en ella. Prueba con una venta «[PRUEBA]». A propósito: un número de venta que no existe tiene que dar «No se ha podido enlazar».',
      },
      {
        titulo: 'Y dejarlo limpio',
        texto: `Si registraste un cobro en una venta «[PRUEBA]», quítalo en la ficha de esa venta, en «Pagos registrados», para que no se facture. ${REPETIR}`,
      },
    ],
  },

  // ─── Finanzas › PayPal y banco › Banco (extractos) (#766) ───────────────────
  'extractos-banco': {
    id: 'extractos-banco',
    titulo: 'Extractos del banco',
    issue: 'CRM#766',
    permiso: 'cobros_externos.view',
    interruptor: 'SANTANDER_EXTRACTOS_ACTIVO',
    pantalla: ['modules/accounting/pages/CobrosExternosPage.tsx'],
    pasos: [
      {
        titulo: 'Extractos del banco',
        texto: 'Los abonos del banco no entran solos: se sube el extracto y el CRM busca de qué venta es cada uno. Con un único candidato que casa en nombre e importe, lo registra solo; si duda, lo deja aquí para que decidas. Son {pasos} pasos.',
      },
      {
        donde: anclaje('cobros-pestanas'),
        titulo: 'La pestaña del banco',
        texto: 'Estás en «Banco (extractos)». La de PayPal tiene su propio recorrido, con este mismo botón.',
      },
      {
        donde: anclaje('banco-subir'),
        permiso: 'cobros_externos.edit',
        titulo: 'Subir un extracto',
        texto: 'Elige un campus arriba y sube el Norma 43 (el «Cuaderno 43» de la banca online) o el CSV de movimientos. Solo se leen los abonos. Súbelo dos veces: la segunda no duplica nada y dice 0 abonos nuevos.',
      },
      {
        donde: anclaje('banco-subir'),
        permiso: 'cobros_externos.edit',
        titulo: 'Lo que tiene que fallar',
        texto: 'A propósito: sube un fichero que no sea un extracto (un PDF o una foto). Tiene que decir «No se ha podido subir» sin crear nada. Y sin un campus elegido arriba, «Elegir fichero» sale apagado.',
      },
      {
        donde: anclaje('banco-estados'),
        titulo: 'Las cuatro bandejas',
        texto: '«A revisar»: tiene candidatos y hay que decidir. «Sin candidato»: no se parece a ninguna venta. «Registrados»: ya están en su venta, solos o a mano. «Descartados»: no son de un alumno, como las liquidaciones de Stripe o PayPal.',
      },
      {
        donde: anclaje('banco-acciones'),
        permiso: 'cobros_externos.edit',
        titulo: 'Decidir un abono',
        texto: 'Pulsa «Es de…» con su venta (✓✓: casan nombre e importe), escribe otro número de venta y «Enlazar», o «Descartar» si no es de ningún alumno. Lo registrado pasa a la cola de facturación.',
      },
      {
        titulo: 'Y dejarlo limpio',
        texto: `Prueba con ventas «[PRUEBA]». Si registraste un abono en una, quita el pago en su ficha, en «Pagos registrados». Lo que no sea de nadie, «Descartar». ${REPETIR}`,
      },
    ],
  },

  // ─── Análisis › Reportes › Informe mensual (#772) ───────────────────────────
  'informe-mensual': {
    id: 'informe-mensual',
    titulo: 'Informe mensual y ZIP de facturas',
    issue: 'CRM#772',
    permiso: 'reports.informe_mensual',
    pantalla: ['modules/reports/components/InformeMensual.tsx'],
    pasos: [
      {
        donde: anclaje('informe-mensual'),
        titulo: 'Informe mensual para la gestoría',
        texto: 'El mes natural, por equipo y por comercial: ventas, cobrado (pagos registrados con fecha en el mes), facturado (por fecha de emisión) y vendido. Es lo que se manda a la gestoría. Son {pasos} pasos.',
      },
      {
        donde: anclaje('informe-mes'),
        titulo: 'El mes',
        texto: 'Abre con el mes pasado, que es el que se cierra. Cambia el mes para ver otro: las cifras se recalculan solas.',
      },
      {
        donde: anclaje('informe-empresa'),
        titulo: 'La empresa',
        texto: '«Todas mis empresas» suma las que tienes. Elige una para ver solo la suya y para poder bajar su ZIP.',
      },
      {
        donde: anclaje('informe-excel'),
        titulo: 'El Excel',
        texto: '«Excel» baja el informe del mes que ves, por equipo y por comercial. Ábrelo y comprueba que su total es el de la fila «Total» de aquí.',
      },
      {
        donde: anclaje('informe-zip'),
        titulo: 'El ZIP de facturas',
        texto: 'Los PDF de las facturas emitidas ese mes por una empresa, con su listado y el informe. A propósito: con «Todas mis empresas» sale apagado, porque el ZIP es de una sola empresa. Elige una y vuelve a probar.',
      },
      {
        donde: anclaje('informe-envio'),
        titulo: 'El envío automático',
        texto: 'Encendido, el CRM lo manda solo a la gestoría el día y a la hora que dice aquí. Si dice «apagado», esa parte la enciende Diego; mientras, el informe y el ZIP se bajan aquí a mano.',
      },
      {
        donde: anclaje('informe-tablas'),
        titulo: 'Por equipo y por comercial',
        texto: 'Cada equipo con cuántos comerciales tiene, y cada comercial con su equipo. En el móvil se ven Ventas y Cobrado; en pantallas más anchas, también Facturado y Vendido.',
      },
      {
        titulo: 'Y dejarlo limpio',
        texto: `Aquí solo se mira y se descarga: no cambia nada en el CRM. Borra de tu equipo los Excel y ZIP de prueba, que llevan datos de alumnos. ${REPETIR}`,
      },
    ],
  },

  // ─── Equipo de Desarrollo › Actividad (Monitask, #236) ──────────────────────
  monitask: {
    id: 'monitask',
    titulo: 'Actividad del equipo (Monitask)',
    issue: 'CRM#236',
    permiso: 'monitask.view',
    interruptor: 'MONITASK_ACTIVO',
    pantalla: ['modules/monitask/pages/MonitaskActividadPage.tsx'],
    pasos: [
      {
        titulo: 'Actividad del equipo',
        texto: 'Lo que registra Monitask de cada persona: horas, horas activas, % de actividad, proyectos y tareas, y el cotejo con las horas de sus facturas. Sin capturas de pantalla. Son {pasos} pasos.',
      },
      {
        donde: anclaje('monitask-sin-conectar'),
        titulo: 'Sin conectar',
        texto: 'Monitask no está conectado: lo que ves es lo último que se trajo. Se conecta en Integraciones › Monitask.',
      },
      {
        donde: anclaje('monitask-pestanas'),
        titulo: 'Tres pestañas',
        texto: '«Actividad»: horas por persona. «Cotejo con facturas»: horas facturadas frente a horas de Monitask, por mes. «Personas», solo para quien configura Monitask: quién del CRM es cada usuario de Monitask.',
      },
      {
        donde: anclaje('monitask-sincronizacion'),
        titulo: 'Última sincronización',
        texto: 'Cuándo se trajeron los datos por última vez. Se traen solos; quien configura Monitask puede pedirlo ya en «Personas» › «Sincronizar ahora».',
      },
      {
        donde: anclaje('monitask-filtros'),
        titulo: 'Fechas, persona y proyecto',
        texto: 'Abre con este mes. Cambia las fechas o usa los atajos, busca a alguien por nombre o correo y filtra por proyecto o web. A propósito: pon un «Desde» posterior al «Hasta»; tiene que avisar de que «desde» va antes que «hasta».',
      },
      {
        donde: anclaje('monitask-tabla'),
        titulo: 'Cada persona',
        texto: 'Horas, horas activas, % de actividad, días y proyectos. Debajo del nombre, con quién del CRM está emparejada: «Sin emparejar» no entra en el cotejo. Pulsa una fila para ver sus días y tareas.',
      },
      {
        titulo: 'Y dejarlo limpio',
        texto: `Aquí solo se mira. Si para probar emparejaste a alguien a mano en «Personas», déjalo como estaba. ${REPETIR}`,
      },
    ],
  },
};
