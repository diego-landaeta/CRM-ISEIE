import type { RecorridoCobros } from '@/shared/lib/recorridosCobros';
import { anclaje, FINAL_RECORRIDO as FINAL } from '@/shared/lib/recorridosComun';

/*
  LINKS DE PAGO Y CUOTAS: LOS RECORRIDOS PRINCIPALES (CRM#1012; Diego, 23/11:
  «los principales son los de LINKS DE PAGO y todo lo de las CUOTAS»).

  Uno por pieza, sin repetir lo que explica otro:
   · `links-pago`        Comercial › Links de pago: crear (asistente, pago único,
                         importe distinto y descuento, inicial + cuotas), estado,
                         seguimiento de los no pagados, renovar y anular.
   · `links-asistente`   Dentro del asistente «Crear link de pago», campo a campo
                         (con el aviso de cuando el campus no tiene Stripe conectado).
   · `link-de-pago`      En la ficha de la venta: los botones de cobro (crear link,
                         plan de pago) y la tarjeta «Links de pago».
   · `plan-de-pago`      Dentro de «Generar plan de pago»: un link por cuota y el
                         cobro automático.
   · `cobro-automatico`  En la ficha de la venta: Stripe cobra solas las cuotas.
   · `cola-facturacion`  En Facturas: cada cuota cobrada sale en la cola, una factura
                         por cobro.
  Las cuotas de la ficha (`venta-cuotas`) y los cargos sueltos (`cargos-sin-enlazar`)
  siguen en sus ficheros, completados con lo mismo.

  Ninguno se abre solo: «Recorrido» en la cabecera, o «Ver recorrido» dentro de
  las dos ventanas (el asistente y el plan), porque con una ventana abierta la
  cabecera queda debajo.

  Solo importa TIPOS de `recorridosCobros`: sin ciclo entre los dos ficheros.
*/

export type IdRecorridoLinks =
  | 'links-pago'
  | 'links-asistente'
  | 'link-de-pago'
  | 'plan-de-pago'
  | 'cobro-automatico'
  | 'cola-facturacion';

type RecorridoLinks = Omit<RecorridoCobros, 'id'> & { id: IdRecorridoLinks };

/** Dónde se conecta Stripe para los links (el aviso «Conectar Stripe» de cada sitio). */
const CONECTAR_STRIPE = 'Lo conecta un admin en Configuración › Integraciones › Links de pago (la clave de los links del campus).';

export const RECORRIDOS_LINKS: Record<IdRecorridoLinks, RecorridoLinks> = {
  // ─── Comercial › Links de pago: la pantalla ──────────────────────────────────
  'links-pago': {
    id: 'links-pago',
    rutas: ['/links-pago'],
    titulo: 'Links de pago',
    permiso: ['links_pago.crear', 'links_pago.ver_todos'],
    pantalla: [
      'modules/links-pago/pages/LinksDePagoPage.tsx',
      'modules/links-pago/components/SeguimientoDelLink.tsx',
    ],
    pasos: [
      {
        titulo: 'Links de pago',
        texto: 'Un link de pago es un enlace de Stripe: el alumno lo abre y paga con tarjeta, y el cobro entra solo en el CRM, en su venta y en su cuota. Aquí los creas y sigues cada uno. Son {pasos} pasos.',
      },
      {
        donde: anclaje('links-pantalla-crear'),
        permiso: 'links_pago.crear',
        titulo: 'Crear link de pago',
        texto: 'Abre el asistente: eliges el curso, si paga de una vez o con inicial y cuotas, y «Crear link». No hace falta el nombre: al pagar, el CRM busca la ficha del alumno por su correo (o la crea) y le apunta la venta a tu nombre.',
      },
      // Los dos recorridos de Diego (21/11, CRM#982): «son dos recorridos, hay que hacerlos».
      {
        donde: anclaje('links-pantalla-unico'),
        permiso: 'links_pago.crear',
        titulo: 'Pago único, con otro importe o descuento',
        texto: 'Sale el precio del curso y lo puedes cambiar por otro importe. O pon un descuento en € o en %: verás el total con el precio de antes tachado. El link cobra ese total y la venta se crea por él. El tope de descuento del campus manda: si te pasas, no deja crear.',
      },
      {
        donde: anclaje('links-pantalla-inicial'),
        permiso: 'links_pago.crear',
        titulo: 'Inicial más cuotas',
        texto: 'El total (también con descuento), la inicial que cobra el link y en cuántas cuotas va lo que queda. Ves cuánto es cada una y desde qué fecha. Al pagar, la inicial es la cuota 1 de la venta, se guarda la tarjeta y Stripe cobra las demás solas, una al mes.',
      },
      {
        titulo: 'Al registrar la venta, sale solo',
        permiso: 'links_pago.crear',
        texto: 'Lo más rápido: al registrar la venta deja marcado «Generar link de pago de Stripe». Si paga de una vez, un link por todo; si va a plazos, un link por cuota con su fecha (y el de la inicial, si la marcas). Al terminar te los da todos para copiar.',
      },
      // El embudo por gestora y por campus (CRM#987).
      {
        donde: anclaje('links-embudo'),
        titulo: 'Cómo van tus links',
        texto: 'Para el periodo que elijas: los links creados, cuántos se abrieron y cuántos se pagaron (con su %), y lo cobrado. En las cuotas que cobra Stripe solo: las cobradas, las que fallaron y las pendientes. Por gestora o por campus; cada uno ve lo suyo.',
      },
      {
        donde: anclaje('links-pantalla-filtros'),
        titulo: 'Por estado',
        texto: '«Pendientes» (aún no lo ha abierto), «Abiertos» (lo abrió y no pagó), «Pagados», «Caducados» y «Anulados». Cada gestora ve los suyos; quien ve los de todos, los de sus campus.',
      },
      {
        donde: anclaje('links-pantalla-estado'),
        titulo: 'Cómo va cada link',
        texto: 'La etiqueta dice en qué está. Al lado, el importe (con el precio tachado si hubo descuento, y el plan si va en cuotas), el alumno, el programa y quién lo creó, cuándo caduca o cuándo se pagó.',
      },
      {
        donde: anclaje('links-pantalla-venta'),
        titulo: 'Su venta',
        texto: '«Venta n.º …» abre la venta a la que va. Si dice «la venta se crea al pagar», aún no hay venta: la crea el CRM cuando entra el pago.',
      },
      {
        donde: anclaje('links-seguimiento-fila'),
        titulo: 'Los que no se pagan',
        texto: 'Debajo de cada link sale su seguimiento: cuándo lo abrió el alumno sin pagar, si se te avisó a ti y los recordatorios que le han llegado por correo a las 24 y a las 72 horas. Si lo abrió y no paga, es el momento de escribirle.',
      },
      {
        donde: anclaje('links-renovar'),
        permiso: 'links_pago.crear',
        titulo: 'Renovar un caducado',
        texto: 'Un link caducado no se puede pagar. «Renovar» crea uno nuevo igual, con un clic, y te lo deja copiado para mandarlo. En los dos queda apuntado cuál renueva a cuál.',
      },
      {
        donde: anclaje('links-pantalla-acciones'),
        titulo: 'Mandar, copiar, abrir o anular',
        texto: '«Copiar mensaje» lo deja listo, con su texto, para pegarlo en WhatsApp o en un correo; con tu WhatsApp conectado en el CRM, «Enviar por WhatsApp» lo manda en su conversación. «Abrir» enseña lo que verá el alumno. Si te equivocaste, «Anular» y escribe por qué: se desactiva en Stripe y queda apuntado quién y cuándo.',
      },
      {
        titulo: 'Cuando lo paga',
        texto: 'No hay que apuntar nada: el cobro entra en su venta, salda su cuota (con la etiqueta Stripe) y va a la cola de facturación de Finanzas › Facturas, una factura por cobro. El link pasa a «Pagado».',
      },
      { titulo: 'Y listo', texto: FINAL },
    ],
  },

  // ─── El asistente «Crear link de pago», campo a campo ────────────────────────
  'links-asistente': {
    id: 'links-asistente',
    rutas: [],
    titulo: 'Crear un link, campo a campo',
    permiso: 'links_pago.crear',
    pantalla: ['modules/links-pago/components/CrearLinkAsistente.tsx'],
    pasos: [
      {
        titulo: 'Crear un link de pago',
        texto: 'Curso, cómo paga y «Crear link». Sin nombre de nadie: al pagar, el CRM encuentra o crea la ficha del alumno y su venta, y te avisa. Son {pasos} pasos.',
      },
      {
        donde: anclaje('links-asistente-sin-clave'),
        titulo: 'Si sale «Todavía no se pueden crear links»',
        texto: `Este campus no tiene Stripe conectado para los links, o la clave no tiene los permisos. ${CONECTAR_STRIPE} Mientras, no se puede crear ninguno.`,
      },
      {
        donde: anclaje('links-asistente-campus'),
        titulo: 'El campus',
        texto: 'Solo sale si llevas más de uno: elige de cuál es el curso. El cobro irá a la cuenta de Stripe de ese campus.',
      },
      {
        donde: anclaje('links-asistente-curso'),
        titulo: 'El curso',
        texto: 'Busca por el nombre. Al lado de cada uno, su precio del catálogo: es el que sale en el importe al elegirlo.',
      },
      {
        donde: anclaje('links-asistente-pago'),
        titulo: 'El importe',
        texto: 'Sale el precio del curso. Puedes poner otro importe; si es más bajo de lo que permite el campus, te dice cuánto y no deja crear: pídeselo a un admin. Si el campus cobra en varias monedas, eliges la moneda.',
      },
      {
        donde: anclaje('links-asistente-descuento'),
        titulo: 'Descuento en € o en %',
        texto: 'Opcional. Escribe el descuento y elige € o %: sale el total con el precio de antes tachado. El link cobra ese total y la venta se crea por él.',
      },
      {
        donde: anclaje('links-asistente-forma'),
        titulo: 'Pago único o inicial + cuotas',
        texto: '«Pago único»: todo de una vez. «Inicial + cuotas»: el link cobra la inicial y guarda la tarjeta; Stripe cobra solas las cuotas siguientes, una al mes.',
      },
      {
        donde: anclaje('links-asistente-cuotas-no'),
        titulo: 'Si no deja cuotas',
        texto: `Te dice por qué: el campus no tiene permitido el cobro automático de cuotas o le falta la clave de los links. ${CONECTAR_STRIPE} Mientras, cobra con «Pago único» o con un plan de pago (un link por cuota) desde la venta.`,
      },
      {
        donde: anclaje('links-asistente-cuotas'),
        titulo: 'La inicial y las cuotas',
        texto: 'La inicial (la cobra el link) y en cuántas cuotas va lo que queda. Debajo, el resumen: «Quedan … en N cuotas de …, una al mes desde el …». Cada cobro de Stripe salda su cuota en la venta.',
      },
      {
        donde: anclaje('links-asistente-para'),
        titulo: 'Para un prospecto o una venta (opcional)',
        texto: 'Despliégalo para atar el link a alguien: busca por nombre, correo o teléfono y elige «Venta nueva» (se crea al pagar) o una venta suya, y entonces el link cobra lo pendiente de esa venta. Desde una ficha ya sale relleno.',
      },
      {
        donde: anclaje('links-asistente-motivos'),
        titulo: 'Lo que falta',
        texto: 'Si «Crear link» no se puede pulsar, aquí está por qué: falta el curso, el importe no cuadra, el descuento se pasa del tope…',
      },
      {
        donde: anclaje('links-asistente-crear'),
        titulo: 'Crear link',
        texto: 'Lo crea en Stripe y te lo enseña: «Copiar», «Abrir» y, si va para un prospecto, «Enviar por WhatsApp» o «Enviar por correo». Caduca a los días que diga el campus; si caduca, se renueva en Links de pago.',
      },
      { titulo: 'Y listo', texto: FINAL },
    ],
  },

  // ─── Ficha de la venta: los botones de cobro y la tarjeta «Links de pago» ────
  'link-de-pago': {
    id: 'link-de-pago',
    rutas: ['/ventas/:id'],
    titulo: 'Cobrar la venta con links de pago',
    permiso: ['links_pago.crear', 'links_pago.ver_todos'],
    pantalla: [
      'modules/links-pago/components/LinksDePagoCard.tsx',
      'modules/links-pago/components/BotonCrearLink.tsx',
      'modules/links-pago/components/AccionesCobroVenta.tsx',
      'modules/links-pago/components/SeguimientoDelLink.tsx',
      'modules/sales/pages/SaleDetailPage.tsx',
    ],
    pasos: [
      {
        titulo: 'Cobrar esta venta con links',
        texto: 'Un link de pago es un enlace de Stripe: el alumno lo abre y paga con tarjeta, y el cobro entra solo en esta venta. Son {pasos} pasos.',
      },
      {
        donde: anclaje('links-crear-cabecera'),
        permiso: 'links_pago.crear',
        titulo: 'Crear link de pago',
        texto: 'Arriba, siempre a mano. Abre el asistente con el alumno y la venta ya puestos: el link cobra lo que queda pendiente, de una vez.',
      },
      {
        donde: anclaje('ventas-plan-pago'),
        permiso: 'links_pago.crear',
        titulo: 'Generar plan de pago',
        texto: 'Si va a plazos: un link por cada cuota pendiente, con su importe y su fecha, o el cobro automático (el alumno paga la primera, guarda la tarjeta y Stripe cobra las demás solas). Dentro tiene su propio «Ver recorrido».',
      },
      {
        donde: anclaje('links-pago'),
        titulo: 'La tarjeta «Links de pago»',
        texto: 'Todos los links de esta venta y cómo van: Pendiente, Abierto, Pagado, Caducado o Anulado.',
      },
      {
        donde: anclaje('links-seguimiento-fila'),
        titulo: 'Si no paga',
        texto: 'Debajo de cada link: si lo abrió sin pagar, si se te avisó y los recordatorios que le han llegado (24 y 72 horas). Un caducado se renueva con «Renovar».',
      },
      {
        donde: anclaje('links-lista'),
        titulo: 'Copiar, abrir o anular',
        texto: '«Copiar» deja el enlace listo para WhatsApp o un correo. Si te equivocaste, «Anular» y escribe por qué.',
      },
      {
        donde: anclaje('venta-cuotas'),
        titulo: 'Cuando el alumno paga',
        texto: 'No apuntas nada: el cobro entra en «Pagos registrados», la cuota se marca cobrada con la etiqueta Stripe y el link pasa a «Pagado». Ese cobro va solo a la cola de facturación.',
      },
      { titulo: 'Y listo', texto: FINAL },
    ],
  },

  // ─── Dentro de «Generar plan de pago» ─────────────────────────────────────────
  'plan-de-pago': {
    id: 'plan-de-pago',
    rutas: [],
    titulo: 'El plan de pago',
    permiso: 'links_pago.crear',
    pantalla: [
      'modules/links-pago/components/PlanDePagoDialog.tsx',
      'modules/links-pago/components/CobroAutomaticoCuotas.tsx',
    ],
    pasos: [
      {
        titulo: 'El plan de pago',
        texto: 'Un link por cada cuota pendiente de la venta, con su importe y su fecha. Cuando el alumno paga uno, se salda ESA cuota. Son {pasos} pasos.',
      },
      {
        donde: anclaje('links-plan-venta'),
        titulo: 'La venta',
        texto: 'De quién es y de qué curso, con el total, lo cobrado y lo pendiente. El plan solo cubre lo pendiente.',
      },
      {
        donde: anclaje('links-plan-sin-cuotas'),
        titulo: 'Si no tiene cuotas',
        texto: 'La venta no está fraccionada. Si va a plazos, crea antes su plan de cuotas en la venta; si es un solo pago, usa «Crear link de pago».',
      },
      {
        donde: anclaje('links-plan-cuotas'),
        titulo: 'Las cuotas',
        texto: 'Cada cuota con su importe y su vencimiento. Si ya tiene link, su número y si el alumno lo abrió, con «Copiar» y «Abrir». Si no, «se crea al generar».',
      },
      {
        donde: anclaje('links-plan-cobro-auto'),
        permiso: 'links_pago.cobro_automatico',
        titulo: 'Cobro automático con Stripe',
        texto: 'Márcalo y no hay que perseguir cada cuota: el alumno paga la primera con su link, guarda la tarjeta y acepta los cobros siguientes; Stripe cobra cada cuota en su fecha del plan. Si cambias una fecha o un importe en la venta, se cambia en Stripe.',
      },
      {
        donde: anclaje('links-plan-cobro-auto-no'),
        permiso: 'links_pago.cobro_automatico',
        titulo: 'Si no se puede activar',
        texto: `Sale el motivo: el cobro automático está apagado, el campus no lo tiene permitido o le falta la clave de los links. ${CONECTAR_STRIPE} Mientras, un link por cuota.`,
      },
      {
        donde: anclaje('cobro-automatico'),
        titulo: 'Ya activo',
        texto: 'La tarjeta guardada y, cuota a cuota, qué hará Stripe: cuándo la cobra, si ya la cobró o si falló (y si se reintenta).',
      },
      {
        donde: anclaje('links-plan-generar'),
        titulo: 'Generar',
        texto: '«Generar los N links» crea uno por cada cuota sin link. Con el cobro automático marcado, «Activar y generar el link de la cuota …»: solo el de la primera, que guarda la tarjeta.',
      },
      {
        donde: anclaje('links-plan-copiar'),
        titulo: 'Copiar todos',
        texto: 'El mensaje para el alumno, listo para pegar: todos los links con su cuota y su fecha. Con el cobro automático, el link de la primera y las fechas en que se cobrarán las demás.',
      },
      {
        titulo: 'Cuando paga cada uno',
        texto: 'El cobro entra en la venta, salda su cuota y va a la cola de facturación: una factura por cuota cobrada.',
      },
      { titulo: 'Y listo', texto: FINAL },
    ],
  },

  // ─── Ficha de la venta: el cobro automático de las cuotas ────────────────────
  'cobro-automatico': {
    id: 'cobro-automatico',
    rutas: ['/ventas/:id'],
    titulo: 'Cobro automático de las cuotas',
    permiso: ['links_pago.crear', 'links_pago.ver_todos'],
    pantalla: [
      'modules/links-pago/components/CobroAutomaticoCuotas.tsx',
      'modules/links-pago/components/AccionesCobroVenta.tsx',
      'modules/sales/pages/SaleDetailPage.tsx',
    ],
    pasos: [
      {
        titulo: 'Que Stripe cobre solas las cuotas',
        texto: 'El alumno paga la primera cuota con su link y guarda su tarjeta; Stripe cobra las demás en las fechas del plan, sin que nadie las persiga. Son {pasos} pasos.',
      },
      {
        donde: anclaje('ventas-plan-pago'),
        permiso: 'links_pago.crear',
        titulo: 'Cómo se activa',
        texto: '«Generar plan de pago», marca «Cobrar automáticamente con Stripe en las fechas de las cuotas» y «Activar y generar el link de la cuota …». Manda al alumno solo ese link.',
      },
      {
        titulo: 'Si el campus no puede',
        texto: `En el plan sale «Cobro automático con Stripe: …» con el motivo, y en el asistente, «Cuotas no disponibles». ${CONECTAR_STRIPE}`,
      },
      {
        donde: anclaje('cobro-automatico'),
        titulo: 'La tarjeta y cada cuota',
        texto: 'La tarjeta guardada (marca y cuatro cifras) y, cuota a cuota: «Stripe la cobrará sola el …», «Cobrada por Stripe» o, si falló, el motivo (sin saldo, tarjeta caducada…) y si se reintenta. Sin tarjeta aún: el alumno no ha pagado la primera.',
      },
      {
        donde: anclaje('cobro-automatico'),
        titulo: 'Si cambias el plan',
        texto: 'Una fecha o un importe cambiados en el plan de cuotas pasan solos a Stripe; mientras, sale «Cambio pendiente de pasar a Stripe». Si Stripe no tiene el plan al día, lo dice y se reintenta cada hora.',
      },
      {
        donde: anclaje('cobro-automatico-quitar'),
        permiso: 'links_pago.cobro_automatico',
        titulo: 'Quitarlo',
        texto: 'Stripe deja de cobrar solas las cuotas de esta venta. La tarjeta se queda guardada por si se vuelve a activar; las cuotas que falten, con su link.',
      },
      {
        donde: anclaje('venta-cuotas'),
        titulo: 'Cada cuota cobrada',
        texto: 'Entra como cobro en la venta, salda su cuota con la etiqueta Stripe y va a la cola de facturación: su factura sale en la columna «Factura».',
      },
      { titulo: 'Y listo', texto: FINAL },
    ],
  },

  // ─── Finanzas › Facturas: cada cuota cobrada, a la cola ──────────────────────
  'cola-facturacion': {
    id: 'cola-facturacion',
    rutas: ['/accounting/facturas'],
    titulo: 'Cuotas cobradas y su factura',
    permiso: 'facturas.view',
    pantalla: ['modules/invoices/components/FacturacionAlDiaCard.tsx'],
    pasos: [
      {
        titulo: 'Cada cuota cobrada, a su factura',
        texto: 'Cada cobro es una factura: una venta en cuotas tiene tantas facturas como cuotas cobradas. Aquí esperan su turno. Son {pasos} pasos.',
      },
      {
        donde: anclaje('cola-facturacion'),
        titulo: 'La cola de facturación',
        texto: 'Todo cobro sin factura, por orden de fecha: la cuota que entra por un link de pago o por el cobro automático de Stripe, y la que apunta una gestora a mano. Arriba, cuántos son y cuánto suman.',
      },
      {
        donde: anclaje('cola-origen'),
        titulo: 'De dónde viene',
        texto: '«Stripe»: la pagó el alumno con un link o la cobró Stripe sola. «Manual»: la apuntó alguien en la venta. Las dos se facturan igual.',
      },
      {
        donde: anclaje('cola-datos-fiscales'),
        titulo: 'Sus datos fiscales',
        texto: 'Debajo del cliente: si la factura puede salir sola o qué le falta (los datos del alumno, por ejemplo).',
      },
      {
        donde: anclaje('cola-motivo'),
        titulo: 'Posible duplicada',
        texto: 'Ya hay una factura de ese cliente por el mismo importe esa semana. Revisa que no sea la misma cuota antes de emitirla.',
      },
      {
        donde: anclaje('cola-generar'),
        permiso: 'facturas.cola',
        titulo: 'Generar factura, en orden',
        texto: 'La fila en verde es la siguiente: se emiten en orden de fecha para que la numeración no se descoloque. La factura de la cuota del 30 espera a las del 29.',
      },
      {
        titulo: 'Y en la venta',
        texto: 'Emitida, la factura sale en la ficha de la venta, en la columna «Factura» de su cuota, y el cobro deja la cola.',
      },
      { titulo: 'Y listo', texto: FINAL },
    ],
  },
};
