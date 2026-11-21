import type { RecorridoCobros } from '@/shared/lib/recorridosCobros';

/**
 * LOS RECORRIDOS DEL BLOQUE FINANZAS (CRM-ISEIE#619, segunda tanda; gemela de
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
 *  · El permiso de cada recorrido es el de la pantalla en el menú lateral.
 *  · Esta tanda trae cuatro: Dashboard, Conversiones, Egresos y Cuentas por
 *    cobrar. El resto de Finanzas va en otra PR. «Ingresos», en ISEIE, es Ventas
 *    (#627), que ya tiene el suyo.
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
 * Lo que en ISEIE es distinto del 360: no se elige empresa, las cifras son
 * siempre del campus de arriba (el 360 dice «del campus o la empresa elegidos»).
 * «Cuentas por cobrar» aún no está en la tanda del 360: sus ids son de aquí.
 */
const EN_ESTE_CRM = {
  dashboard: 'Lo que entra, lo que sale y lo que falta por cobrar, del campus elegido arriba. Son {pasos} pasos.',
  conversiones: 'Las ventas registradas del campus elegido arriba: cuánto entra este mes y cómo han ido los últimos seis. Son {pasos} pasos.',
  egresos: 'Los gastos del campus elegido arriba (y los de toda la empresa): cuánto, en qué y de quién. Son {pasos} pasos.',
};

export type IdRecorridoFinanzas =
  | 'finanzas-dashboard'
  | 'conversiones'
  | 'egresos'
  | 'por-cobrar';

type RecorridoFinanzas = Omit<RecorridoCobros, 'id'> & { id: IdRecorridoFinanzas };

const anclaje = (nombre: string) => `[data-recorrido="${nombre}"]`;

const FINAL = 'No volverá a salir solo. Para repasarlo, pulsa «Ver recorrido» en esta pantalla cuando quieras.';

/** En el orden del menú: Dashboard, Conversiones, Egresos y Cuentas por cobrar. */
export const RECORRIDOS_FINANZAS: Record<IdRecorridoFinanzas, RecorridoFinanzas> = {
  // ─── Finanzas › Dashboard (/accounting) ────────────────────────────────────
  'finanzas-dashboard': {
    id: 'finanzas-dashboard',
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
};
