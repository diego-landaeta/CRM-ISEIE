import type { PasoRecorrido } from '@/shared/components/ui/RecorridoGuiado';

/**
 * LOS RECORRIDOS DE STRIPE Y DE LOS COBROS (Diego, 18/11: «deben haber tutorial
 * guiado como en el tablero de tareas»).
 *
 * El mismo `RecorridoGuiado` del tablero: carteles que señalan, paso a paso, lo que
 * la persona tiene delante. Cada pantalla lo lanza con `VerRecorrido`, que lo abre
 * solo la primera vez que esa persona entra y deja el botón «Ver recorrido» para
 * repetirlo.
 *
 *  · Cada paso apunta a un `data-recorrido` de su pantalla (nunca a un texto). La
 *    prueba `recorridosCobros.test.jsx` comprueba que sigue estando en el código.
 *  · `permiso` en el recorrido: sin él no se ofrece. En un paso: sin él, ese paso no
 *    sale (no se explica un botón que esa persona no tiene). Con una lista, basta
 *    uno de ellos.
 *  · Lo que no está en pantalla en ese momento (no hay cargos sueltos, no hay
 *    huecos en la serie) se salta solo, como en el tablero.
 *
 * Desde el #619 (19/11, gemela de CRM#941) también los de las demás pantallas,
 * empezando por Ventas: el mismo modelo, el mismo botón y la misma prueba a 375 px.
 *
 * IGUAL EN LOS DOS CRM (paridad): mismos pasos y mismo texto. Solo cambia lo de
 * `EN_ESTE_CRM`, justo debajo: lo que una pantalla tiene en un CRM y no en el otro.
 */

/**
 * Lo único que cambia entre los dos CRM (ISEIE no tiene «Todos» ni empresas en Pagos Stripe).
 * En Ventas (ISEIE: Finanzas › Ingresos), la barra de filtros no lleva empresa, proyecto
 * ni «solo compartidas», y «Nueva venta» es un botón, no un desplegable con tres modos.
 */
const EN_ESTE_CRM = {
  pagosDeTodos: '',
  sincronizarConCampus: '',
  ventasFiltros: 'Elige el curso y, si llevas equipo, de quién ver las ventas. El campus se elige arriba, en el menú. Abre con este mes: cambia las fechas o usa «Rápido». «Quitar filtros» lo deja como al entrar.',
  ventasNueva: 'Para registrar una venta a mano: buscas al cliente, eliges el producto y pones el importe, cómo paga y, si es a plazos, sus cuotas. Al guardarla sale en la lista.',
};

export type Permiso = string | string[];

export interface PasoCobros extends PasoRecorrido {
  /** Sin este permiso (o ninguno de la lista), el paso no sale. */
  permiso?: Permiso;
}

export type IdRecorridoCobros =
  | 'integraciones-stripe'
  | 'link-de-pago'
  | 'cargos-sin-enlazar'
  | 'anular-factura'
  | 'pagos-stripe'
  | 'disputas-stripe'
  | 'ventas';

export interface RecorridoCobros {
  id: IdRecorridoCobros;
  /** Para quién es y de qué va (el texto del botón lo dice todo). */
  titulo: string;
  /** Sin este permiso (o ninguno de la lista), ni botón ni recorrido. */
  permiso?: Permiso;
  /** Los ficheros de la pantalla donde viven sus `data-recorrido` (para la prueba). */
  pantalla: string[];
  pasos: PasoCobros[];
}

/** ¿Tiene el permiso (o alguno de la lista)? Sin permiso pedido, sí. */
export const tienePermiso = (permiso: Permiso | undefined, can: (p: string) => boolean) =>
  !permiso || (Array.isArray(permiso) ? permiso.some((p) => can(p)) : can(permiso));

/** Los pasos que esa persona puede ver. */
export const pasosPara = (r: RecorridoCobros, can: (p: string) => boolean): PasoRecorrido[] =>
  r.pasos.filter((p) => tienePermiso(p.permiso, can)).map(({ donde, titulo, texto }) => ({ donde, titulo, texto }));

/**
 * La clave del navegador: de cada recorrido Y de cada persona. Se marca al abrirse,
 * así que no vuelve a salir solo; para verlo otra vez, «Ver recorrido».
 */
export const claveRecorrido = (id: IdRecorridoCobros, userId?: number | string | null) =>
  `recorrido-${id}-visto-v1${userId != null ? `-u${userId}` : ''}`;

const anclaje = (nombre: string) => `[data-recorrido="${nombre}"]`;

const FINAL = 'No volverá a salir solo. Para repasarlo, pulsa «Ver recorrido» en esta pantalla cuando quieras.';

export const RECORRIDOS_COBROS: Record<IdRecorridoCobros, RecorridoCobros> = {
  // ─── 1 · Integraciones › Stripe y Links de pago (para admin) ──────────────────
  'integraciones-stripe': {
    id: 'integraciones-stripe',
    titulo: 'Stripe y links de pago',
    permiso: 'integrations.view',
    pantalla: [
      'modules/accounting/pages/IntegrationsPage.tsx',
      'modules/links-pago/components/ConfigLinksPago.tsx',
    ],
    pasos: [
      {
        titulo: 'Stripe de este campus',
        texto: 'Aquí se conecta la cuenta de Stripe de cada campus. Todo lo que ves vale solo para el campus elegido arriba: cambia de campus antes de tocar nada. Son {pasos} pasos.',
      },
      {
        donde: anclaje('stripe-clave'),
        titulo: 'La clave de cada campus',
        texto: 'Pega aquí la clave de Stripe del campus. Usa una clave restringida de solo lectura (empieza por rk_), nunca la secreta (sk_): el CRM solo lee los cobros. Después, «Guardar» y «Probar conexión».',
      },
      {
        donde: anclaje('stripe-webhook'),
        titulo: 'La dirección del webhook',
        texto: 'Ábrelo para ver la dirección que hay que pegar en Stripe. Ya sale completa y bien escrita: pulsa «Copiar» y pégala tal cual. Es opcional: sin webhook, los cobros entran igual cada cinco minutos.',
      },
      {
        donde: anclaje('links-clave'),
        permiso: ['integrations.edit', 'links_pago.configurar'],
        titulo: 'La clave de los links de pago',
        texto: 'Es otra clave, aparte de la de arriba: con esta el CRM crea los links que pagan los alumnos. La crea Diego en Stripe con los permisos de la lista y te la pasa. Pégala, «Guardar» y «Probar conexión».',
      },
      {
        donde: anclaje('links-reglas'),
        permiso: 'links_pago.configurar',
        titulo: 'Las reglas del campus',
        texto: 'Lo que puede elegir la gestora al crear un link: cuánto descuento puede hacer como mucho, cuántos días dura el link, si admite cuotas y cuántas, y en qué monedas se cobra. Cambia lo que haga falta y pulsa «Guardar reglas».',
      },
      {
        donde: anclaje('links-webhook'),
        permiso: 'links_pago.configurar',
        titulo: 'El interruptor del campus',
        texto: 'El aviso de Stripe al CRM cuando el alumno paga. Con «Activar» o «Desactivar» lo enciendes o lo apagas en este campus. Si le faltan eventos, pulsa «Añadir los eventos de los links». Si la cuenta la comparten varios campus, el cambio vale para todos.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── 2 · Crear un link de pago desde la venta (para la gestora) ──────────────
  'link-de-pago': {
    id: 'link-de-pago',
    titulo: 'Crear un link de pago',
    permiso: ['links_pago.crear', 'links_pago.ver_todos'],
    pantalla: [
      'modules/links-pago/components/LinksDePagoCard.tsx',
      'modules/sales/pages/SaleDetailPage.tsx',
    ],
    pasos: [
      {
        donde: anclaje('links-pago'),
        titulo: 'Links de pago',
        texto: 'Un link de pago es un enlace de Stripe: el alumno lo abre y paga con tarjeta. El cobro entra solo en esta venta. Son {pasos} pasos.',
      },
      {
        donde: anclaje('links-crear'),
        permiso: 'links_pago.crear',
        titulo: 'Crear el link',
        texto: 'Elige el curso, el importe (sale lo que queda por cobrar), la moneda y cuántos días dura. Si bajas el precio más de lo que permite el campus, no te deja: pídeselo a un admin.',
      },
      {
        donde: anclaje('links-crear'),
        permiso: 'links_pago.crear',
        titulo: 'Pago único o por cuotas',
        texto: 'Cada link es un pago. Si paga todo de una vez, un solo link con el total. Si paga en cuotas, crea un link por cuota con su importe: cada pago salda la siguiente cuota pendiente.',
      },
      {
        donde: anclaje('links-lista'),
        titulo: 'Copiar y enviar',
        texto: 'Aquí salen los links de esta venta y cómo van: Pendiente, Pagado, Caducado o Anulado. «Copiar» copia el enlace para pegarlo en WhatsApp o en un correo. Si te equivocaste, «Anular» y escribe por qué.',
      },
      {
        donde: anclaje('venta-cuotas'),
        titulo: 'Cuando el alumno paga',
        texto: 'No tienes que apuntar nada: el cobro entra solo en «Pagos registrados» y la cuota se marca como cobrada, con la etiqueta Stripe. El link pasa a «Pagado».',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── 3 · Ficha de la venta › «Cargos de Stripe sin enlazar» ────────────────────
  'cargos-sin-enlazar': {
    id: 'cargos-sin-enlazar',
    titulo: 'Cargos de Stripe sin enlazar',
    permiso: 'stripe.edit',
    pantalla: [
      'modules/sales/components/EnlazarStripeCard.tsx',
      'modules/sales/pages/SaleDetailPage.tsx',
    ],
    pasos: [
      {
        donde: anclaje('cargos-sin-enlazar'),
        titulo: 'Pagos de Stripe sueltos',
        texto: 'Son pagos de Stripe de este alumno que todavía no están unidos a ningún cobro. Pasa cuando el cobro ya se apuntó a mano, con otro importe u otra fecha. Son {pasos} pasos.',
      },
      {
        donde: anclaje('cargo-cobro'),
        titulo: 'Elige su cobro',
        texto: 'Elige el cobro al que corresponde este pago. Sale ya marcado el más parecido: mismo importe y fecha más cercana. Si ese cobro tiene factura, lo verás al lado.',
      },
      {
        donde: anclaje('cargo-enlazar'),
        titulo: 'Enlazar sin duplicar',
        texto: '«Enlazar» une el pago de Stripe con ese cobro y con su factura. No se crea otro cobro ni otra factura: así el alumno no sale debiendo ni se le factura dos veces.',
      },
      {
        donde: anclaje('venta-cobrado-de-mas'),
        titulo: 'Aviso de cobro de más',
        texto: 'Este aviso dice que los pagos suman más que la venta. Suele ser un cobro apuntado dos veces o un importe mal puesto: revísalo antes de enlazar nada.',
      },
      {
        titulo: 'Aviso de cuota ya pagada',
        texto: 'Si vas a cobrar una cuota que ya estaba pagada, el CRM te avisa: «Esta cuota ya está pagada». No la apuntes otra vez; si el pago vino por Stripe, enlázalo aquí.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── 4 · Facturas › Anular ───────────────────────────────────────────────────
  'anular-factura': {
    id: 'anular-factura',
    titulo: 'Anular una factura',
    permiso: 'facturas.gestionar',
    pantalla: [
      'modules/invoices/pages/InvoicesPage.tsx',
      'modules/invoices/components/AvisoHuecosFacturas.tsx',
    ],
    pasos: [
      {
        titulo: 'Una factura emitida no se toca',
        texto: 'Cuando una factura ya tiene número, no se borra ni se cambia: la serie tiene que quedar completa, sin saltos, como pide Hacienda. Si hay un error, se anula. Son {pasos} pasos.',
      },
      {
        donde: anclaje('factura-bloqueada'),
        titulo: 'Editar y borrar, apagados',
        texto: 'Por eso en una factura emitida «Editar» y la papelera salen apagados. Pon el ratón encima y te dice por qué.',
      },
      {
        donde: anclaje('factura-anular'),
        titulo: 'Anular con su motivo',
        texto: 'Pulsa «Anular» y escribe el motivo: cliente equivocado, cobro devuelto, emitida dos veces… Queda apuntado quién la anuló, cuándo y por qué.',
      },
      {
        donde: anclaje('facturas-pestanas'),
        titulo: 'La rectificativa',
        texto: 'Al anularla sale sola su factura rectificativa (un abono): la misma factura en negativo, que la deja a cero. La ves en la pestaña «Abonos». La anulada sigue en la lista con su número y la marca ANULADA.',
      },
      {
        donde: anclaje('facturas-huecos'),
        titulo: 'Números que faltan',
        texto: 'Si en la serie falta algún número, sale este aviso: o falta cargar una factura o alguien se saltó un número. Las anuladas no son un hueco: su número sigue ahí, con su abono.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── 5 · Pagos Stripe (para admin) ───────────────────────────────────────────
  'pagos-stripe': {
    id: 'pagos-stripe',
    titulo: 'Pagos de Stripe',
    permiso: 'stripe.view',
    pantalla: ['modules/accounting/pages/StripePaymentsPage.tsx'],
    pasos: [
      {
        titulo: 'Los pagos de Stripe',
        texto: `Aquí entran los pagos con tarjeta de tus campus, solo de los campus que tienes.${EN_ESTE_CRM.pagosDeTodos} Son {pasos} pasos.`,
      },
      {
        donde: anclaje('stripe-sincronizar'),
        titulo: 'Traer los nuevos',
        texto: `Los pagos entran solos cada cinco minutos. «Sincronizar» trae ahora mismo los de los últimos 30 días.${EN_ESTE_CRM.sincronizarConCampus}`,
      },
      {
        donde: anclaje('stripe-cifras'),
        titulo: 'Lo que hay que mirar',
        texto: 'Los pagos fallidos, las disputas abiertas y los pagos sin asociar a ningún alumno. Si «Sin asociar» dice «Revisar», hay trabajo.',
      },
      {
        donde: anclaje('stripe-filtros'),
        titulo: 'Buscar y filtrar',
        texto: 'Busca por correo, nombre o código de Stripe. En el segundo desplegable, «Sin asociar» deja solo los pagos que faltan por unir a su venta.',
      },
      {
        donde: anclaje('stripe-asociar'),
        permiso: 'stripe.edit',
        titulo: 'Asociar un pago',
        texto: 'Un pago en rojo no está unido a ningún alumno. Pulsa «Asociar», elige su venta y sale su factura. Si dice «Antes del corte», no lo asocies: ya se facturó fuera del CRM.',
      },
      {
        donde: anclaje('stripe-sin-asociar'),
        titulo: 'Un pago sin alumno',
        texto: 'Un pago en rojo no está unido a ningún alumno. Pon el correo del pago en la ficha del alumno y pulsa «Sincronizar»: se une solo.',
      },
      {
        donde: anclaje('stripe-disputa'),
        titulo: 'Un pago en disputa',
        texto: 'El alumno ha reclamado este pago a su banco. Púlsalo para ver el detalle. Todas las disputas, con su plazo, están en «Disputas de Stripe».',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── 5 bis · Disputas de Stripe (para admin) ─────────────────────────────────
  'disputas-stripe': {
    id: 'disputas-stripe',
    titulo: 'Disputas de Stripe',
    permiso: 'stripe.edit',
    pantalla: ['modules/accounting/pages/DisputasStripePage.tsx'],
    pasos: [
      {
        titulo: 'Qué es una disputa',
        texto: 'Una disputa es cuando el alumno reclama un pago a su banco. Stripe retiene ese dinero hasta que se resuelve, y hay un plazo para responder: si no se responde a tiempo, se pierde. Son {pasos} pasos.',
      },
      {
        donde: anclaje('disputas-cifras'),
        titulo: 'Cuántas y cuáles corren prisa',
        texto: 'Las abiertas de tus campus, con su importe, y las que vencen pronto. Esas son las primeras.',
      },
      {
        donde: anclaje('disputas-controles'),
        titulo: 'Por empresa o por campus',
        texto: 'Agrupa las disputas por empresa o por campus, mira las abiertas, las cerradas o todas, y elige cuántos días son «pronto».',
      },
      {
        donde: anclaje('disputas-traer'),
        titulo: 'Traerlas ahora',
        texto: 'Entran solas cada media hora y te llega un aviso. «Traer ahora» las pide a Stripe en el momento, para el campus elegido arriba.',
      },
      {
        donde: anclaje('disputas-responder'),
        titulo: 'Qué hacer con una disputa',
        texto: 'Se responde en Stripe: pulsa «Stripe» en su fila y sube las pruebas (la factura, los correos o mensajes con el alumno, su acceso al campus) antes de la fecha de «Responder antes de». Al lado tienes su venta y su ficha.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── 6 · Finanzas › Ventas (Diego, 19/11, #619 / CRM#941: sustituye a «Tutoriales») ──
  // En ISEIE es la pantalla de Finanzas › Ingresos (/accounting/income). Aquí todavía
  // no se elige empresa, así que «Por proyecto» se salta; el paso se queda por paridad.
  // Lo que no está en ese momento (el reparto por proyecto sin empresa elegida,
  // los avisos cuando no hay nada que avisar, la meta de quien no la tiene) se
  // salta solo.
  ventas: {
    id: 'ventas',
    titulo: 'Ventas',
    permiso: 'ventas.view',
    pantalla: [
      'modules/accounting/pages/IncomePage.tsx',
      'modules/sales/components/MyGoalCard.tsx',
      'modules/sales/components/TopProductsCard.tsx',
    ],
    pasos: [
      {
        titulo: 'Las ventas del periodo',
        texto: 'Aquí ves lo que se vendió y lo que se facturó en unas fechas, y registras ventas nuevas. Se cuentan ventas, no facturas: por eso Facturación puede enseñar más filas en las mismas fechas. Son {pasos} pasos.',
      },
      {
        donde: anclaje('ventas-filtros'),
        titulo: 'Los filtros',
        texto: EN_ESTE_CRM.ventasFiltros,
      },
      {
        donde: anclaje('ventas-tarjetas'),
        titulo: 'Las tarjetas',
        texto: '«Ventas»: las ventas nuevas de esas fechas. «Importe vendido»: lo que suman. «Cobrado de esas ventas»: lo que han pagado hasta hoy, aunque sea fuera de las fechas. No tienen por qué coincidir: una venta a plazos se cobra durante meses.',
      },
      {
        donde: anclaje('ventas-cuotas-facturadas'),
        titulo: 'Cuotas facturadas',
        texto: 'Las facturas de cuotas emitidas en estas fechas, de ventas que pueden ser de meses atrás. Es dinero de algo ya vendido: no es una venta nueva y no se suma con ellas. Son las mismas que ves en Facturación con estas fechas.',
      },
      {
        donde: anclaje('ventas-por-facturar'),
        titulo: 'Ventas por facturar',
        texto: 'Cuántas de estas ventas tienen factura. Si alguna la espera, sale «X por facturar». Pon el ratón encima: te dice cuántas están facturadas, cuántas no necesitan factura y cuántas faltan.',
      },
      {
        donde: anclaje('ventas-por-proyecto'),
        titulo: 'Por proyecto',
        texto: 'Con una empresa elegida, cada campus con sus ventas y sus cuotas facturadas. La fila «Total» es lo de las tarjetas. Pulsa un proyecto para ver solo ese.',
      },
      {
        donde: anclaje('ventas-esperan-factura'),
        titulo: 'Ventas que esperan factura',
        texto: 'Lo único que hay que hacer: ventas con importe que piden factura y no la tienen. Las demás sin factura están marcadas «no requiere factura». «Ir a facturarlas» te lleva a Facturación.',
      },
      {
        donde: anclaje('ventas-facturas-de-antes'),
        titulo: 'Facturas que no son ventas de ahora',
        texto: 'Son cuotas de ventas anteriores: una venta a plazos emite una factura por cada cobro, y cae en el mes en que se cobra. Las dos cifras son correctas. «Ver las cuotas» te dice cuáles son y de qué venta.',
      },
      {
        donde: anclaje('mi-meta'),
        titulo: 'Mi meta del mes',
        texto: 'Tus ventas y lo que has cobrado este mes, frente a tu meta. La barra se pone verde al llegar. La meta la pones tú o tu admin; si no hay, dice «Sin meta configurada».',
      },
      {
        donde: anclaje('programas-mas-vendidos'),
        titulo: 'Programas más vendidos',
        texto: 'Los cinco programas con más ventas en estas fechas. Si arriba eliges una gestora, son los suyos.',
      },
      {
        donde: anclaje('ventas-lista'),
        titulo: 'La lista',
        texto: 'Ventas y cuotas de estas fechas, cada una con su etiqueta: VENTA es nueva; CUOTA, un cobro de una venta anterior; COMPARTIDO, atendida entre dos gestoras. Pulsa una fila para abrir la ficha del prospecto.',
      },
      {
        donde: anclaje('ventas-nueva'),
        titulo: 'Nueva venta',
        texto: EN_ESTE_CRM.ventasNueva,
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },
};
