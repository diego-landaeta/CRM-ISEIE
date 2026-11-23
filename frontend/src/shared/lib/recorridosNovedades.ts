import type { RecorridoCobros } from '@/shared/lib/recorridosCobros';
import { FINAL_RECORRIDO as FINAL } from '@/shared/lib/recorridosComun';

/**
 * LOS RECORRIDOS DE LAS NOVEDADES DEL 18/11 (CRM-ISEIE#611, tanda A; gemela de
 * CRM#928). Diego, 19/11: «el tutorial no es con imágenes, es un tutorial guiado
 * de la app, como el del tablero».
 *
 *  1. El menú por bloques (#587; #534 en el 360).
 *  2. El Dashboard como «Hoy» (#590; #884 en el 360).
 *  3. Ventas repetidas (#577; #902 en el 360): el aviso al registrar y
 *     «Posibles repetidas».
 *  4. Las cuotas en la ficha de la venta (gemela de CRM#892): cada cobro salda
 *     su cuota, cuota ya pagada y cobro de más.
 *
 * La tanda B (facturas de las vendedoras, Mi campus, Incidencias y Prospectos)
 * va en `recorridosNovedadesB.ts`. Las dos se suman a `RECORRIDOS_COBROS`, como
 * las de Finanzas: así `VerRecorrido` y las pruebas de siempre las ven.
 *
 *  · Cada paso apunta a un `data-recorrido` de su pantalla; lo que no está en
 *    ese momento (un bloque del menú que esa persona no tiene, «Lo que toca»
 *    sin nada pendiente o fuera de /staging, una venta sin cobrar de más) se
 *    salta solo.
 *  · El permiso de cada recorrido es el de su pantalla; el de cada paso, el del
 *    botón o la tarjeta que señala.
 *
 * Solo importa TIPOS de `recorridosCobros` (se borran al compilar): así no hay
 * un ciclo de módulos entre los dos ficheros.
 *
 * IGUAL EN LOS DOS CRM (paridad con CRM#928): mismos ids, anclajes y textos.
 * Solo cambia lo de `EN_ESTE_CRM`, justo debajo.
 */

/** Lo único que cambia entre los dos CRM: en ISEIE no se elige empresa, solo el campus. */
const EN_ESTE_CRM = {
  ambito: 'Vale para el campus que tengas elegido arriba.',
};

export type IdRecorridoNovedades =
  | 'menu-bloques'
  | 'hoy-dashboard'
  | 'ventas-repetidas'
  | 'venta-cuotas';

type RecorridoNovedades = Omit<RecorridoCobros, 'id'> & { id: IdRecorridoNovedades };

const anclaje = (nombre: string) => `[data-recorrido="${nombre}"]`;


/** En el orden de la issue: menú, «Hoy», ventas repetidas y cuotas. */
export const RECORRIDOS_NOVEDADES: Record<IdRecorridoNovedades, RecorridoNovedades> = {
  // ─── 1 · El menú por bloques (#587; #534 en el 360) ─────────────────────────
  'menu-bloques': {
    id: 'menu-bloques',
    rutas: [],
    titulo: 'El menú por bloques',
    pantalla: ['shared/components/layout/Sidebar.jsx'],
    pasos: [
      {
        titulo: 'El menú, por bloques',
        texto: 'Las pantallas de siempre, ordenadas por uso: arriba, lo de cada día. Nadie gana ni pierde ninguna; solo cambian de sitio. Son {pasos} pasos.',
      },
      {
        donde: anclaje('menu-buscar'),
        titulo: 'Si no la encuentras, búscala',
        texto: 'Pulsa aquí (o Ctrl+K) y escribe su nombre: te lleva a cualquier pantalla, esté en el bloque que esté.',
      },
      {
        donde: anclaje('menu-hoy'),
        titulo: 'El bloque Hoy',
        texto: 'Lo de cada mañana: el Dashboard, la cola del día, el seguimiento de fin de mes y WhatsApp. Pulsa el título de un bloque para abrirlo o cerrarlo; se queda como lo dejes.',
      },
      {
        donde: anclaje('menu-comercial'),
        titulo: 'Comercial',
        texto: 'Prospectos, Ventas, Links de pago, Clientes y los duplicados. Ventas ya no está en Finanzas: está aquí.',
      },
      {
        donde: anclaje('menu-academico'),
        titulo: 'Académico',
        texto: 'El catálogo y los tutores: productos, cursos, Mi campus, consultas y diplomas.',
      },
      {
        donde: anclaje('menu-finanzas'),
        titulo: 'Finanzas',
        texto: 'Cobros, facturas, egresos y comisiones, también las de los tutores. Los informes siguen en Análisis.',
      },
      {
        donde: anclaje('menu-configuracion'),
        titulo: 'Configuración',
        texto: 'Integraciones, Moodle, conectores, webhooks y lo de administrar. La ayuda (Novedades, Soporte, Incidencias, Manual) está en Sistema.',
      },
      { titulo: 'Y listo', texto: FINAL },
    ],
  },

  // ─── 2 · El Dashboard como «Hoy» (#590; #884 en el 360) ─────────────────────
  'hoy-dashboard': {
    id: 'hoy-dashboard',
    rutas: ['/dashboard'],
    titulo: 'Hoy',
    pantalla: [
      'shared/pages/DashboardPage.jsx',
      'shared/components/dashboard/CifrasDeHoy.tsx',
      'shared/components/dashboard/ParaHoyYManana.tsx',
    ],
    pasos: [
      {
        titulo: 'Tu día de un vistazo',
        texto: `Lo primero de cada mañana: las cifras del mes, lo que toca hoy y, plegado, todo lo demás. ${EN_ESTE_CRM.ambito} Son {pasos} pasos.`,
      },
      {
        donde: anclaje('hoy-cifras'),
        titulo: 'Las cifras del mes',
        texto: 'Cobrado, facturado, ventas nuevas y prospectos nuevos de este mes. Cobrado y facturado no son lo mismo: cada tarjeta dice debajo qué cuenta. Si llevas el equipo, es lo de todos; si no, lo tuyo.',
      },
      {
        donde: anclaje('hoy-alertas'),
        titulo: 'Las dos alertas',
        texto: 'Prospectos abiertos que no lleva nadie y prospectos sin moverse desde hace días. Pulsa una y se abre Prospectos con esa lista ya filtrada.',
      },
      {
        donde: anclaje('hoy-lo-que-toca'),
        titulo: 'Lo que toca',
        texto: 'Los contactos del proceso comercial: atrasados, para hoy, para mañana y esta semana. Pulsa un tramo y se abre la cola del día con él puesto. Sin nada pendiente, este bloque no sale.',
      },
      {
        donde: anclaje('hoy-plegados'),
        titulo: 'Lo demás, plegado',
        texto: 'El equipo este mes, los productos vendidos, el embudo, ayer y hoy y los prospectos recientes. Ábrelos cuando te hagan falta: cada bloque recuerda cómo lo dejaste.',
      },
      { titulo: 'Y listo', texto: FINAL },
    ],
  },

  // ─── 3 · Ventas repetidas (#577; #902 en el 360) ────────────────────────────
  // En `/ventas` (SalesPage), que es donde está «Posibles repetidas» (en ISEIE
  // «Ingresos» es otra pantalla y no la tiene). El aviso sale dentro de la
  // ventana de la venta: un recorrido no va encima de una ventana (lo del
  // 27/10), así que se explica desde el botón que la abre.
  'ventas-repetidas': {
    id: 'ventas-repetidas',
    rutas: ['/ventas'],
    titulo: 'Ventas repetidas',
    permiso: ['ventas.registrar', 'conversions.edit'],
    pantalla: [
      'modules/sales/pages/SalesPage.tsx',
      'modules/sales/components/PosiblesRepetidasCard.tsx',
    ],
    pasos: [
      {
        titulo: 'Que no se repita una venta',
        texto: 'Una venta del mismo alumno y programa, en el mismo campus, es casi siempre la misma compra apuntada dos veces. Son {pasos} pasos.',
      },
      {
        donde: anclaje('ventas-repetidas-nueva'),
        permiso: 'ventas.registrar',
        titulo: 'El aviso al registrar',
        texto: 'Al guardar una venta, si ese alumno ya tiene una de ese programa, el CRM para y te enseña la que existe: lo cobrado y lo pendiente. Lo normal es apuntar el cobro en ella.',
      },
      {
        donde: anclaje('ventas-repetidas-nueva'),
        permiso: 'ventas.registrar',
        titulo: 'Si de verdad es otra',
        texto: 'Por ejemplo, la vuelve a comprar. Pulsa «Crear otra venta igualmente»: queda apuntado quién la creó y ya no sale como repetida.',
      },
      {
        donde: anclaje('ventas-repetidas-lista'),
        permiso: 'conversions.edit',
        titulo: 'Posibles repetidas',
        texto: 'Ábrela para ver los alumnos con más de una venta del mismo programa. Si son la misma compra, pasa los cobros a una y quita las demás. Una gestora ve solo los grupos con alguna venta suya.',
      },
      { titulo: 'Y listo', texto: FINAL },
    ],
  },

  // ─── 4 · Las cuotas en la ficha de la venta (`/ventas/:id`; CRM#892) ────────
  'venta-cuotas': {
    id: 'venta-cuotas',
    rutas: ['/ventas/:id'],
    titulo: 'Cuotas y cobros de la venta',
    permiso: 'conversions.view',
    pantalla: ['modules/sales/pages/SaleDetailPage.tsx', 'modules/links-pago/components/CobroAutomaticoCuotas.tsx'],
    pasos: [
      {
        titulo: 'Cuotas y cobros',
        texto: 'Cada cobro de esta venta salda su cuota solo, venga de un link de pago, del cobro automático de Stripe o apuntado a mano: no hay que marcar nada. Son {pasos} pasos.',
      },
      {
        donde: anclaje('venta-cuotas'),
        titulo: 'El plan de cuotas',
        texto: 'Cada cuota con su número, su vencimiento y su importe. Los cobros las saldan en orden: uno que paga dos cuotas salda las dos; uno que no llega la salda en parte y el resto sigue pendiente.',
      },
      {
        donde: anclaje('venta-cuotas-estado'),
        titulo: 'En qué está cada una',
        texto: '«Cobrada» con su fecha, «Pendiente» o «Vencida» si pasó la fecha sin cobrarse. «Stripe» al lado: la pagó el alumno con su link o la cobró Stripe sola.',
      },
      // Justo detrás del anterior, sobre la misma tabla: en el PC es más alta que
      // la pantalla y, volviendo a ella desde abajo, la barra fija le tapaba el
      // principio (175 px a 1280 en Playwright).
      {
        donde: anclaje('venta-cuotas'),
        permiso: 'conversions.cobros',
        titulo: 'Cuota ya pagada',
        texto: 'Si registras el pago de una cuota que ya salda otro cobro, el CRM te dice con qué cobro y no apunta nada. Si ese pago ya entró por Stripe, te avisa para que lo enlaces en vez de apuntarlo otra vez.',
      },
      {
        donde: anclaje('venta-cuotas-factura'),
        titulo: 'Su factura',
        texto: 'Cada cuota cobrada pasa a la cola de facturación de Finanzas › Facturas. Cuando se emite, su número sale aquí; con «—», aún espera su turno.',
      },
      {
        donde: anclaje('cobro-automatico'),
        titulo: 'Si Stripe las cobra solas',
        texto: 'Con el cobro automático, esta tarjeta dice cuándo cobrará Stripe cada cuota, cuáles cobró y si alguna falló. Tiene su propio recorrido en «Recorrido» arriba.',
      },
      {
        donde: anclaje('venta-pagos'),
        titulo: 'Una fila por cobro',
        texto: 'Cada cobro con la cuota o cuotas que salda («Cuota 3, 4»), su método y su factura.',
      },
      {
        donde: anclaje('venta-cobrado-de-mas'),
        titulo: 'Cobrado de más',
        texto: 'Sus cobros suman más que la venta. Suele ser un cobro repetido o un importe mal puesto: revísala. Antes de apuntar una cuota que la haría cobrar de más, el CRM pregunta.',
      },
      { titulo: 'Y listo', texto: FINAL },
    ],
  },
};
