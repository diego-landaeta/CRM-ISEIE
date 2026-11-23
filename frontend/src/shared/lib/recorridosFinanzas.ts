import type { RecorridoCobros } from '@/shared/lib/recorridosCobros';
import { FINAL_RECORRIDO as FINAL } from '@/shared/lib/recorridosComun';

/**
 * LOS RECORRIDOS DEL BLOQUE FINANZAS (CRM-ISEIE#619, tercera tanda; gemela de
 * CRM#941). Diego, 19/11: cada pantalla de Finanzas con su «Ver recorrido», como
 * Ventas (#627).
 *
 * El mismo modelo que `recorridosCobros.ts` (de donde se registran: allí se
 * suman a `RECORRIDOS_COBROS`, y así `VerRecorrido` y las pruebas de siempre los
 * ven sin tocar nada más). Van en su propio fichero, como en el 360.
 *
 *  · Cada paso apunta a un `data-recorrido` de su pantalla; lo que no está en ese
 *    momento (una tarjeta sin datos, la vista de calendario estando en la lista,
 *    un aviso sin nada que avisar) se salta solo.
 *  · Nunca un anclaje en algo que tiene dos versiones (tabla en el PC y tarjetas
 *    en el móvil): el recorrido coge la primera, y en el móvil esa está escondida.
 *    Se ancla en lo que envuelve a las dos.
 *  · El permiso de cada recorrido es el de la pantalla en el menú lateral. Ventas
 *    sin formación y Análisis de ventas no están en el menú (se llega desde los
 *    botones de Ventas): llevan el permiso que pide el servidor para sus datos,
 *    `ventas.view_equipo`.
 *  · Primera tanda (#635): Dashboard, Conversiones, Egresos y Cuentas por cobrar.
 *    Segunda (#636): Cuentas por pagar, Comisiones, Comisiones de tutores y
 *    Nóminas. Tercera: Pendientes de facturar, Ventas sin formación y Análisis
 *    de ventas.
 *    «Ingresos», en ISEIE, es Ventas (#627), que ya tiene el suyo.
 *  · Fuera, a propósito: Facturación, Links de pago, Pagos Stripe, Disputas,
 *    Integraciones y Conciliación.
 *
 * Solo importa TIPOS de `recorridosCobros` (se borran al compilar): así no hay un
 * ciclo de módulos entre los dos ficheros.
 *
 * IGUAL EN LOS DOS CRM (paridad): mismos ids, mismos anclajes y mismo texto donde
 * la pantalla es la misma. Lo que en ISEIE es distinto va en `EN_ESTE_CRM`.
 */

/**
 * Lo que en ISEIE es distinto del 360:
 *  · No se elige empresa: las cifras son siempre del campus de arriba (el 360
 *    dice «del campus o la empresa elegidos»).
 *  · Cuentas por cobrar y Nóminas: el 360 las copió de aquí (mismos ids, anclajes
 *    y textos); allí Nóminas lleva un paso más, el de elegir campus.
 *  · Cuentas por pagar no tiene filtro de fechas: solo el estado.
 *  · Comisiones es la pantalla de siempre (periodo en un desplegable, cuatro
 *    cifras, filtro de estado, «Pagar» y las reglas en Roles); el 360 la rehízo
 *    con exportar y cerrar mes. Mismos ids; textos de aquí.
 *  · Comisiones de tutores: sin «Avisar tutor»; solo «Marcar pagado».
 *  · Análisis de ventas: sin el filtro de ventas compartidas; las cifras, del
 *    campus de arriba.
 */
const EN_ESTE_CRM = {
  dashboard: 'Lo que entra, lo que sale y lo que falta por cobrar, del campus elegido arriba. Son {pasos} pasos.',
  conversiones: 'Las ventas registradas del campus elegido arriba: cuánto entra este mes y cómo han ido los últimos seis. Son {pasos} pasos.',
  egresos: 'Los gastos del campus elegido arriba (y los de toda la empresa): cuánto, en qué y de quién. Son {pasos} pasos.',
  pagarFiltrosTitulo: 'Por estado',
  pagarFiltros: 'Todas, o solo las pendientes, las pagadas en parte, las pagadas o las canceladas.',
  comisiones: 'Lo que gana cada gestora por las ventas que cierra, según las reglas que pone administración. Si eres gestora, ves solo las tuyas. Son {pasos} pasos.',
  comisionesPeriodo: 'Elige qué ver: el mes actual, el pasado, el año en curso o todo.',
  comisionesTarjetas: '«Total a pagar»: lo pendiente del periodo. «Pagado en periodo»: lo ya pagado. «Comisiones»: cuántas hay. «Importe medio»: lo que deja cada una.',
  comisionesEstadoTitulo: 'Por estado',
  comisionesEstado: 'Todas, o solo las pendientes, las pagadas o las canceladas.',
  comisionesLista: 'Cada comisión con la gestora, el cliente, el producto, la base, el % y lo que cobra. Cuando ya se ha transferido, «Pagar» la marca como pagada.',
  comisionesReglas: 'Qué % cobra cada gestora por cada producto; sin regla, nada. Se ponen en Configuración › Roles: al cerrar una venta, la comisión se crea sola.',
  comtutores: 'Cada tutor cobra un porcentaje de lo cobrado de sus formaciones, mes a mes. Aquí ves cuánto se le debe y se apunta como pagado. Son {pasos} pasos.',
  comtutoresPeriodo: 'Elige el mes del que quieres ver las comisiones (y, si hay varios, el campus).',
  comtutoresFilaTitulo: 'Marcar pagado',
  comtutoresFila: 'Cuando ya se le ha hecho la transferencia, «Marcar pagado» apunta como pagado lo de ese tutor en el mes.',
  pendientesCuantas: 'Las ventas sin importe del campus elegido arriba. Cada una que completas sale de la lista.',
  analisis: 'Las ventas del campus elegido arriba, de tres maneras: un resumen, por asesora y por cliente. Son {pasos} pasos.',
  analisisFiltros: 'Valen para las tres vistas: fechas (con atajos como «Este mes») y una búsqueda por cliente, email o programa. «Quitar filtros» los quita todos.',
};

export type IdRecorridoFinanzas =
  | 'finanzas-dashboard'
  | 'conversiones'
  | 'egresos'
  | 'por-cobrar'
  | 'por-pagar'
  | 'comisiones'
  | 'comisiones-tutores'
  | 'nominas'
  | 'pendientes-facturar'
  | 'ventas-sin-formacion'
  | 'analisis-ventas';

type RecorridoFinanzas = Omit<RecorridoCobros, 'id'> & { id: IdRecorridoFinanzas };

const anclaje = (nombre: string) => `[data-recorrido="${nombre}"]`;


/**
 * En el orden del menú: Dashboard, Conversiones, Egresos, Cuentas por cobrar,
 * Cuentas por pagar, Comisiones, Nóminas y Pendientes de facturar. Comisiones de
 * tutores, que en el menú está en Tutores, va con las comisiones; Ventas sin
 * formación y Análisis de ventas, que se abren desde Ventas, al final.
 */
export const RECORRIDOS_FINANZAS: Record<IdRecorridoFinanzas, RecorridoFinanzas> = {
  // ─── Finanzas › Dashboard (/accounting) ────────────────────────────────────
  'finanzas-dashboard': {
    id: 'finanzas-dashboard',
    rutas: ['/accounting'],
    titulo: 'Dashboard de Finanzas',
    permiso: 'accounting.view',
    pantalla: ['modules/accounting/pages/AccountingDashboardPage.tsx'],
    pasos: [
      {
        titulo: 'La caja de un vistazo',
        texto: EN_ESTE_CRM.dashboard,
      },
      {
        donde: anclaje('dashboard-fechas'),
        titulo: 'Las fechas',
        texto: 'Desde y hasta. Todas las cifras de la pantalla se calculan con ellas: cambia una y se recalcula todo.',
      },
      {
        donde: anclaje('dashboard-tarjetas'),
        titulo: 'Las tarjetas',
        texto: '«Ingresos cobrados»: lo que ha entrado. «Facturado»: las facturas emitidas. «Por cobrar» y «Vencido»: lo que deben las ventas y lo que ya pasó de fecha. «Egresos» y «Balance neto»: lo gastado y lo que queda.',
      },
      {
        donde: anclaje('dashboard-evolucion'),
        titulo: 'Evolución mensual',
        texto: 'Ingresos y egresos de los últimos 12 meses, mes a mes. Pasa el ratón por un punto para ver la cifra.',
      },
      {
        donde: anclaje('dashboard-egresos-categoria'),
        titulo: 'Egresos por categoría',
        texto: 'En qué se ha gastado en estas fechas: cada barra es una categoría.',
      },
      {
        donde: anclaje('dashboard-vendedoras'),
        titulo: 'Ventas por vendedora',
        texto: 'Ventas, clientes, lo cobrado y lo pendiente de cada vendedora en estas fechas.',
      },
      {
        donde: anclaje('dashboard-por-cobrar'),
        titulo: 'Cuentas por cobrar',
        texto: 'Las ventas con dinero pendiente, las que antes vencen primero; en rojo, las vencidas. Pulsa una para abrir la ficha del prospecto. «Ver todas» lleva a Cuentas por cobrar.',
      },
      { titulo: 'Y listo', texto: FINAL },
    ],
  },

  // ─── Finanzas › Conversiones (/revenue) ────────────────────────────────────
  conversiones: {
    id: 'conversiones',
    rutas: ['/revenue'],
    titulo: 'Conversiones',
    permiso: 'conversions.view',
    pantalla: ['modules/revenue/pages/RevenuePage.tsx'],
    pasos: [
      {
        titulo: 'Las conversiones',
        texto: EN_ESTE_CRM.conversiones,
      },
      {
        donde: anclaje('conversiones-tarjetas'),
        titulo: 'Este mes',
        texto: 'Lo vendido en el mes en curso, cuántas ventas son y el ticket medio (lo vendido entre el número de ventas). Esta pantalla no tiene filtro de fechas: siempre es este mes.',
      },
      {
        donde: anclaje('conversiones-evolucion'),
        titulo: 'Evolución de ingresos',
        texto: 'Lo vendido cada mes en los últimos seis. Pasa el ratón por la gráfica para ver la cifra de un mes.',
      },
      {
        donde: anclaje('conversiones-lista'),
        titulo: 'Conversiones recientes',
        texto: 'Las 20 últimas ventas, con su importe, la fecha y si se pagó entera («Completo») o solo una parte («Parcial»).',
      },
      { titulo: 'Y listo', texto: FINAL },
    ],
  },

  // ─── Finanzas › Egresos (/expenses; la pantalla es idéntica en los dos CRM) ─
  egresos: {
    id: 'egresos',
    rutas: ['/expenses'],
    titulo: 'Egresos',
    permiso: 'expenses.view',
    pantalla: ['modules/expenses/pages/ExpensesPage.tsx'],
    pasos: [
      {
        titulo: 'Los egresos',
        texto: EN_ESTE_CRM.egresos,
      },
      {
        donde: anclaje('egresos-cifras'),
        titulo: 'Las cifras',
        texto: 'El total de lo que estás filtrando, lo que no es de ningún campus (gastos de la empresa o generales) y la categoría en la que más se gasta.',
      },
      {
        donde: anclaje('egresos-categorias'),
        titulo: 'Por categoría',
        texto: 'Cuánto se lleva cada categoría. Pulsa una para ver solo sus egresos; púlsala otra vez para quitar el filtro.',
      },
      {
        donde: anclaje('egresos-filtros'),
        titulo: 'Los filtros',
        texto: 'Busca por concepto o nota, elige la categoría, si son manuales o automáticos, y las fechas (debajo, atajos: este mes, el pasado o el año). «Quitar filtros» lo deja como al entrar.',
      },
      {
        donde: anclaje('egresos-lista'),
        titulo: 'La lista',
        texto: 'Cada egreso con su fecha, categoría, de quién es e importe. El clip abre el comprobante. Los marcados «auto» los crea el sistema: se corrigen desde su origen, no aquí.',
      },
      {
        donde: anclaje('egresos-csv'),
        titulo: 'Exportar a CSV',
        texto: 'Descarga todos los egresos que cumplen estos filtros, no solo los de esta página.',
      },
      {
        donde: anclaje('egresos-nuevo'),
        titulo: 'Nuevo egreso',
        texto: 'Para apuntar un gasto: concepto, importe, categoría y fecha, y si quieres su comprobante (PDF o imagen).',
        permiso: 'expenses.create',
      },
      { titulo: 'Y listo', texto: FINAL },
    ],
  },

  // ─── Finanzas › Cuentas por cobrar (/accounting/receivable) ────────────────
  'por-cobrar': {
    id: 'por-cobrar',
    rutas: ['/accounting/receivable'],
    titulo: 'Cuentas por cobrar',
    permiso: 'accounting.por_cobrar',
    pantalla: ['modules/accounting/pages/ReceivablePage.tsx'],
    pasos: [
      {
        titulo: 'Lo que falta por cobrar',
        texto: 'Las cuotas y los pagos pendientes de las ventas, con la fecha en que vencen. Son {pasos} pasos.',
      },
      {
        donde: anclaje('cobrar-vista'),
        titulo: 'Lista o calendario',
        texto: 'La lista enseña los cobros pendientes uno a uno; el calendario, cuánto vence cada día del mes.',
      },
      {
        donde: anclaje('cobrar-tarjetas'),
        titulo: 'Las tarjetas',
        texto: 'Cuántos cobros quedan y cuánto suman; y de ellos, los que ya pasaron de fecha (vencidas) y su importe.',
      },
      {
        donde: anclaje('cobrar-filtros'),
        titulo: 'Los filtros',
        texto: 'Proyecto, gestora y fechas de vencimiento. «Este mes», «Próx. mes» y «Todas» cambian las fechas de un clic; «Solo vencidas» deja las que ya pasaron.',
      },
      {
        donde: anclaje('cobrar-lista'),
        titulo: 'La lista',
        texto: 'Cada cobro con su cliente, concepto (y número de cuota), gestora, lo pendiente y cuándo vence; en rojo, los vencidos. Pulsa uno para abrir la ficha del prospecto.',
      },
      {
        donde: anclaje('cobrar-calendario'),
        titulo: 'El calendario',
        texto: 'Cada día, lo que vence y cuántos cobros son. Pulsa un día para ver cuáles; con ◀ ▶ cambias de mes.',
      },
      { titulo: 'Y listo', texto: FINAL },
    ],
  },

  // ─── Finanzas › Cuentas por pagar (/accounting/payable) ────────────────────
  'por-pagar': {
    id: 'por-pagar',
    rutas: ['/accounting/payable'],
    titulo: 'Cuentas por pagar',
    permiso: 'accounts_payable.view',
    pantalla: ['modules/accounts-payable/pages/AccountsPayablePage.tsx'],
    pasos: [
      {
        titulo: 'Lo que se debe',
        texto: 'Las facturas y deudas con proveedores: cuánto se debe, cuánto se ha pagado y cuándo vence. Son {pasos} pasos.',
      },
      {
        donde: anclaje('pagar-tarjetas'),
        titulo: 'Las tarjetas',
        texto: 'Lo facturado por los proveedores, lo pagado, lo pendiente y cuántas facturas han vencido sin pagar.',
      },
      {
        donde: anclaje('pagar-filtros'),
        titulo: EN_ESTE_CRM.pagarFiltrosTitulo,
        texto: EN_ESTE_CRM.pagarFiltros,
      },
      {
        donde: anclaje('pagar-lista'),
        titulo: 'La lista',
        texto: 'Cada factura con su proveedor, concepto, total, pagado, pendiente, vencimiento y estado. El botón € apunta un pago; la papelera la borra.',
      },
      {
        donde: anclaje('pagar-nueva'),
        titulo: 'Nueva factura',
        texto: 'Para apuntar una factura de un proveedor: quién, por qué, cuánto y cuándo hay que pagarla.',
        permiso: 'accounts_payable.create',
      },
      { titulo: 'Y listo', texto: FINAL },
    ],
  },

  // ─── Finanzas › Comisiones (/commissions; en ISEIE, la pantalla de siempre) ─
  comisiones: {
    id: 'comisiones',
    rutas: ['/commissions'],
    titulo: 'Comisiones',
    permiso: 'commissions.view',
    pantalla: ['modules/commissions/pages/CommissionsPage.tsx'],
    pasos: [
      {
        titulo: 'Las comisiones',
        texto: EN_ESTE_CRM.comisiones,
      },
      {
        donde: anclaje('comisiones-periodo'),
        titulo: 'El periodo',
        texto: EN_ESTE_CRM.comisionesPeriodo,
      },
      {
        donde: anclaje('comisiones-tarjetas'),
        titulo: 'Las tarjetas',
        texto: EN_ESTE_CRM.comisionesTarjetas,
      },
      {
        donde: anclaje('comisiones-estado'),
        titulo: EN_ESTE_CRM.comisionesEstadoTitulo,
        texto: EN_ESTE_CRM.comisionesEstado,
      },
      {
        donde: anclaje('comisiones-lista'),
        titulo: 'La lista',
        texto: EN_ESTE_CRM.comisionesLista,
      },
      {
        donde: anclaje('comisiones-reglas'),
        titulo: 'Reglas',
        texto: EN_ESTE_CRM.comisionesReglas,
      },
      { titulo: 'Y listo', texto: FINAL },
    ],
  },

  // ─── Tutores › Comisiones (/tutores/comisiones) ────────────────────────────
  'comisiones-tutores': {
    id: 'comisiones-tutores',
    rutas: ['/tutores/comisiones'],
    titulo: 'Comisiones de tutores',
    permiso: 'tutores.gestionar',
    pantalla: ['modules/tutores/pages/ComisionesTutoresPage.tsx'],
    pasos: [
      {
        titulo: 'Lo que se debe a los tutores',
        texto: EN_ESTE_CRM.comtutores,
      },
      {
        donde: anclaje('comtutores-periodo'),
        titulo: 'El mes',
        texto: EN_ESTE_CRM.comtutoresPeriodo,
      },
      {
        donde: anclaje('comtutores-calcular'),
        titulo: 'Calcular',
        texto: 'Crea las comisiones del mes a partir de los cobros. Se puede repetir: solo añade las de los cobros que aún no tenían la suya.',
      },
      {
        donde: anclaje('comtutores-tarjetas'),
        titulo: 'Las tarjetas',
        texto: 'Lo que queda por pagar, lo ya pagado este mes y lo cobrado de sus formaciones: la base del porcentaje, que va sobre lo cobrado de verdad, nunca sobre lo vendido.',
      },
      {
        donde: anclaje('comtutores-sin-formacion'),
        titulo: 'Cobros sin formación',
        texto: 'Dinero cobrado de ventas que no dicen de qué formación son: nadie cobra comisión por él. Se arregla eligiendo la formación en cada venta.',
      },
      {
        donde: anclaje('comtutores-lista'),
        titulo: 'Los tutores',
        texto: 'Uno por fila, con lo que se le debe. Pulsa su nombre para ver cada cobro, su estado y lo que tiene que facturar.',
      },
      {
        donde: anclaje('comtutores-fila'),
        titulo: EN_ESTE_CRM.comtutoresFilaTitulo,
        texto: EN_ESTE_CRM.comtutoresFila,
        permiso: 'tutores.liquidar',
      },
      { titulo: 'Y listo', texto: FINAL },
    ],
  },

  // ─── Finanzas › Nóminas (/payroll) ─────────────────────────────────────────
  nominas: {
    id: 'nominas',
    rutas: ['/payroll'],
    titulo: 'Nóminas',
    permiso: 'payroll.view',
    pantalla: ['modules/payroll/pages/PayrollPage.tsx'],
    pasos: [
      {
        titulo: 'Las nóminas',
        texto: 'Lo que cobra cada persona del equipo: su plan (fijo, por horas o con comisiones), la nómina de cada mes y las horas. Son {pasos} pasos.',
      },
      {
        donde: anclaje('nominas-pestanas'),
        titulo: 'Las pestañas',
        texto: '«Planes»: cuánto cobra cada uno. «Periodos»: la nómina de cada mes, que se genera, se cierra y se paga. «Horas»: las que se apuntan de quien cobra por horas.',
      },
      {
        donde: anclaje('nominas-planes'),
        titulo: 'Los planes',
        texto: 'Cada persona con su fijo al mes, su precio por hora y si cobra comisiones. «Editar» lo cambia; «Eliminar» quita el plan.',
      },
      {
        donde: anclaje('nominas-anadir'),
        titulo: 'Añadir un plan',
        texto: 'Elige a alguien que todavía no tiene plan para ponerle el suyo.',
        permiso: 'payroll.edit',
      },
      { titulo: 'Y listo', texto: FINAL },
    ],
  },

  // ─── Finanzas › Pendientes de facturar (/accounting/pendiente-facturar) ────
  'pendientes-facturar': {
    id: 'pendientes-facturar',
    rutas: ['/accounting/pendiente-facturar'],
    titulo: 'Pendientes de facturar',
    permiso: 'facturas.view',
    pantalla: ['modules/accounting/pages/PendienteFacturarPage.tsx'],
    pasos: [
      {
        titulo: 'Ventas sin importe',
        texto: 'Ventas registradas sin precio. Mientras no lo tengan, no llegan a Facturación ni cuentan en las cifras. Son {pasos} pasos.',
      },
      {
        donde: anclaje('pendientes-aviso'),
        titulo: 'Por qué están aquí',
        texto: 'El prospecto se marcó como convertido sin apuntar el importe de la venta. Hay que completarlo a mano.',
      },
      {
        donde: anclaje('pendientes-cuantas'),
        titulo: 'Cuántas son',
        texto: EN_ESTE_CRM.pendientesCuantas,
      },
      {
        donde: anclaje('pendientes-lista'),
        titulo: 'La lista',
        texto: 'Cada venta con su cliente, programa, fecha e importe actual. «Completar» abre la venta para poner el importe, lo pagado y el método de pago; el nombre abre la ficha.',
      },
      {
        donde: anclaje('pendientes-paginas'),
        titulo: 'Más páginas',
        texto: 'Si son muchas, van por páginas: «Anterior» y «Siguiente».',
      },
      { titulo: 'Y listo', texto: FINAL },
    ],
  },

  // ─── Ventas sin formación (/ventas/sin-formacion; idéntica en los dos CRM) ─
  'ventas-sin-formacion': {
    id: 'ventas-sin-formacion',
    rutas: ['/ventas/sin-formacion'],
    titulo: 'Ventas sin formación',
    permiso: 'ventas.view_equipo',
    pantalla: ['modules/sales/pages/VentasSinFormacionPage.tsx'],
    pasos: [
      {
        titulo: 'Ventas sin formación',
        texto: 'Ventas cobradas que no dicen de qué curso del catálogo son. Sin eso, su profesor no cobra comisión. Son {pasos} pasos.',
      },
      {
        donde: anclaje('sinformacion-tarjetas'),
        titulo: 'Las tarjetas',
        texto: 'Cuántas son y lo cobrado de ellas, cuántas se pueden cruzar (su texto coincide con un curso) y cuántas hay que mirar a mano.',
      },
      {
        donde: anclaje('sinformacion-aviso'),
        titulo: 'Por qué importa',
        texto: 'Mientras una venta no tenga formación, en los informes sale como «servicio académico» y nadie cobra comisión por ella.',
      },
      {
        donde: anclaje('sinformacion-lista'),
        titulo: 'La lista',
        texto: 'Cada venta con lo que dice y la formación propuesta. «Atar» la une a esa formación, tras confirmarlo; «Abrir» lleva a la venta para elegirla a mano.',
      },
      {
        donde: anclaje('sinformacion-a-mano'),
        titulo: 'Sin candidato único',
        texto: 'Las que no dicen nada o encajan con más de un curso: no se puede adivinar cuál es, hay que revisarlas una a una.',
      },
      { titulo: 'Y listo', texto: FINAL },
    ],
  },

  // ─── Análisis de ventas (/ventas/analisis) ─────────────────────────────────
  'analisis-ventas': {
    id: 'analisis-ventas',
    rutas: ['/ventas/analisis'],
    titulo: 'Análisis de ventas',
    permiso: 'ventas.view_equipo',
    pantalla: ['modules/sales/pages/SalesAnalysisPage.tsx'],
    pasos: [
      {
        titulo: 'Análisis de ventas',
        texto: EN_ESTE_CRM.analisis,
      },
      {
        donde: anclaje('analisis-filtros'),
        titulo: 'Los filtros',
        texto: EN_ESTE_CRM.analisisFiltros,
      },
      {
        donde: anclaje('analisis-vistas'),
        titulo: 'Tres vistas',
        texto: '«Resumen», «Por asesora» y «Por cliente». Cambia aquí: los filtros se mantienen.',
      },
      {
        donde: anclaje('analisis-tarjetas'),
        titulo: 'El resumen',
        texto: 'Ventas y clientes, importe vendido y ticket medio, lo cobrado (y cuántas están liquidadas) y lo que queda por cobrar.',
      },
      {
        donde: anclaje('analisis-cobrado-de-mas'),
        titulo: 'Cobrado de más',
        texto: 'Ventas con más cobrado que su importe. Suele ser un cobro repetido o un importe mal puesto: hay que revisarlas una a una.',
      },
      {
        donde: anclaje('analisis-fraccionado'),
        titulo: 'Cobro fraccionado',
        texto: 'Las ventas a plazos: cuotas cobradas y pendientes, lo que queda por cobrar y lo vencido.',
      },
      {
        donde: anclaje('analisis-tabla'),
        titulo: 'Por asesora o por cliente',
        texto: 'Por asesora: lo vendido, cobrado y pendiente de cada una. Por cliente: lo de cada cliente, con sus cuotas; pulsa uno para abrir su ficha.',
      },
      { titulo: 'Y listo', texto: FINAL },
    ],
  },
};
