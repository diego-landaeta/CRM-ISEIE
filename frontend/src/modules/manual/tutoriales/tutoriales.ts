import type { IdRecorridoCobros, Permiso } from '@/shared/lib/recorridosCobros';

/**
 * AYUDA › TUTORIALES (Diego, 18/11: «tienes que poner los tutoriales»).
 *
 * Los tutoriales que estaban como páginas sueltas en el PC de Diego, dentro del
 * CRM. Cada uno es un `contenido/<id>.md` (ver `TextoTutorial.tsx`) con sus
 * capturas en `img/`, y aquí su ficha: de qué va, para quién y qué permiso pide.
 *
 *  · `permiso`: sin él (o sin ninguno de la lista), el tutorial no sale en la
 *    lista ni se abre por su dirección. La gestora ve los suyos; los de
 *    configuración, solo quien ve o configura integraciones o los links de pago.
 *  · `recorridos`: el botón «Ver recorrido» del tutorial lleva a la pantalla que
 *    explica y abre allí su recorrido guiado (`recorridosCobros.ts`). Sale solo si
 *    la persona tiene el permiso de ese recorrido.
 *
 * IGUAL EN LOS DOS CRM (paridad): los mismos tutoriales, con el mismo id y el mismo
 * permiso. Solo cambia lo de `EN_ESTE_CRM` (las direcciones de las pantallas) y,
 * en el texto, lo que una pantalla tiene en un CRM y no en el otro.
 */

/** Las direcciones de las pantallas en ESTE CRM (en ISEIE, otras). */
const EN_ESTE_CRM = {
  prospectos: '/leads',
  ventas: '/ventas',
  facturas: '/accounting/facturas',
  integraciones: '/accounting/integrations',
  pagosStripe: '/accounting/pagos-stripe',
  disputas: '/accounting/disputas',
};

export type Tema = 'cobros' | 'configuracion';

export const TEMAS: Record<Tema, { titulo: string; resumen: string }> = {
  cobros: {
    titulo: 'Ventas, cobros y links de pago',
    resumen: 'Para el día a día: cobrar con un link, apuntar ventas y cuotas, y qué hacer con una factura emitida.',
  },
  configuracion: {
    titulo: 'Configuración de integraciones',
    resumen: 'Para quien conecta el CRM con Stripe, PayPal, el banco, Brevo, Moodle, Meta y lo demás. ISEIE es un solo campus: lo que va campus a campus, aquí se hace una vez.',
  },
};

export interface RecorridoDelTutorial {
  id: IdRecorridoCobros;
  /** La pantalla donde vive el recorrido. */
  ruta: string;
  /** Qué hacer al llegar, si el recorrido vive dentro de una ficha. */
  alLlegar?: string;
}

export interface Tutorial {
  id: string;
  titulo: string;
  resumen: string;
  tema: Tema;
  /** Para quién es, en pocas palabras. */
  para: string;
  /** Sin este permiso (o ninguno de la lista), no sale. */
  permiso: Permiso;
  recorridos?: RecorridoDelTutorial[];
}

/** Ver o configurar integraciones, o configurar los links de pago. */
const CONFIGURACION: Permiso = ['integrations.view', 'integrations.edit', 'links_pago.configurar'];

export const TUTORIALES: Tutorial[] = [
  // ─── Ventas, cobros y links de pago ─────────────────────────────────────────
  {
    id: 'links-de-pago',
    titulo: 'Links de pago: crear uno y enviarlo',
    resumen: 'El alumno paga con tarjeta desde un enlace de Stripe y el cobro entra solo en su venta.',
    tema: 'cobros',
    para: 'Gestoras y comerciales',
    permiso: ['links_pago.crear', 'links_pago.ver_todos'],
    recorridos: [{
      id: 'link-de-pago',
      ruta: EN_ESTE_CRM.prospectos,
      alLlegar: 'Abre la ficha de un prospecto o de una venta: el recorrido empieza en la tarjeta «Links de pago».',
    }],
  },
  {
    id: 'ventas-y-cuotas',
    titulo: 'Ventas, cuotas y cargos de Stripe',
    resumen: 'El aviso de venta repetida, cómo se saldan las cuotas y cómo enlazar un cargo de Stripe sin duplicar.',
    tema: 'cobros',
    para: 'Gestoras y administración',
    permiso: ['conversions.create', 'conversions.cobros', 'stripe.edit'],
    recorridos: [{
      id: 'cargos-sin-enlazar',
      ruta: EN_ESTE_CRM.ventas,
      alLlegar: 'Abre una venta: el recorrido empieza en la tarjeta «Cargos de Stripe sin enlazar», que solo sale si la venta tiene alguno.',
    }],
  },
  {
    id: 'anular-factura',
    titulo: 'Facturas emitidas: se anulan, no se borran',
    resumen: 'Por qué una factura con número no se toca, cómo se anula con su motivo y qué es el aviso de números que faltan.',
    tema: 'cobros',
    para: 'Quien ve facturas; anula administración',
    permiso: ['facturas.view', 'facturas.gestionar'],
    recorridos: [{ id: 'anular-factura', ruta: EN_ESTE_CRM.facturas }],
  },

  // ─── Configuración de integraciones ─────────────────────────────────────────
  {
    id: 'configuracion',
    titulo: 'Qué se configura y dónde',
    resumen: 'El mapa de todas las integraciones: dónde está cada una, qué pide y cómo está hoy.',
    tema: 'configuracion',
    para: 'Administración',
    permiso: CONFIGURACION,
  },
  {
    id: 'links-de-pago-instalacion',
    titulo: 'Links de pago: la clave, las reglas y el webhook de un campus',
    resumen: 'La clave de escritura de Stripe, las reglas que puede usar la gestora y el webhook de la cuenta.',
    tema: 'configuracion',
    para: 'Administración',
    permiso: CONFIGURACION,
    recorridos: [{ id: 'integraciones-stripe', ruta: EN_ESTE_CRM.integraciones }],
  },
  {
    id: 'stripe',
    titulo: 'Stripe: clave de lectura, webhook y disputas',
    resumen: 'Cómo entran los cobros de Stripe, el aviso al momento y las disputas.',
    tema: 'configuracion',
    para: 'Administración',
    permiso: CONFIGURACION,
    recorridos: [
      { id: 'integraciones-stripe', ruta: EN_ESTE_CRM.integraciones },
      { id: 'pagos-stripe', ruta: EN_ESTE_CRM.pagosStripe },
      { id: 'disputas-stripe', ruta: EN_ESTE_CRM.disputas },
    ],
  },
  {
    id: 'paypal',
    titulo: 'PayPal: traer los cobros',
    resumen: 'La aplicación REST de la cuenta Business y cómo se pega en el CRM.',
    tema: 'configuracion',
    para: 'Administración',
    permiso: CONFIGURACION,
  },
  {
    id: 'banco-santander',
    titulo: 'Extractos del banco: cobros por transferencia',
    resumen: 'Subir el extracto en Norma 43 o CSV y qué hace el CRM con cada abono.',
    tema: 'configuracion',
    para: 'Administración',
    permiso: CONFIGURACION,
  },
  {
    id: 'facturacion',
    titulo: 'Facturación: empresas, factura automática, auditoría e informe',
    resumen: 'Los datos fiscales de cada empresa, la cola de facturación, la auditoría y el informe a la gestoría.',
    tema: 'configuracion',
    para: 'Administración',
    permiso: CONFIGURACION,
  },
  {
    id: 'facturas-colaboradores',
    titulo: 'Facturas del mes de colaboradores',
    resumen: 'El alta de un colaborador, los correos que salen y la validación antes de pagar.',
    tema: 'configuracion',
    para: 'Administración',
    permiso: CONFIGURACION,
  },
  {
    id: 'monitask',
    titulo: 'Monitask: horas y actividad del equipo',
    resumen: 'La aplicación de Monitask, su dirección de retorno y la conexión en el CRM.',
    tema: 'configuracion',
    para: 'Administración',
    permiso: CONFIGURACION,
  },
  {
    id: 'brevo',
    titulo: 'Brevo: el correo del CRM',
    resumen: 'Las tres claves de Brevo, el remitente verificado y los correos bloqueados.',
    tema: 'configuracion',
    para: 'Administración',
    permiso: CONFIGURACION,
  },
  {
    id: 'whatsapp',
    titulo: 'WhatsApp: enlazar un número',
    resumen: 'Cómo enlaza cada persona su número con el QR, y qué hay detrás.',
    tema: 'configuracion',
    para: 'Administración',
    permiso: CONFIGURACION,
  },
  {
    id: 'moodle',
    titulo: 'Moodle: la conexión de cada campus',
    resumen: 'El token del campus, la conexión del panel de cursos y el plugin del CRM.',
    tema: 'configuracion',
    para: 'Administración',
    permiso: CONFIGURACION,
  },
  {
    id: 'meta-ads',
    titulo: 'Meta Ads: cuentas y tokens',
    resumen: 'El token de usuario del sistema y cómo se conecta una cuenta publicitaria.',
    tema: 'configuracion',
    para: 'Administración',
    permiso: CONFIGURACION,
  },
  {
    id: 'google',
    titulo: 'Google Ads, Analytics y Search Console',
    resumen: 'Todavía no se conecta desde el CRM: qué credenciales se pueden ir preparando.',
    tema: 'configuracion',
    para: 'Administración',
    permiso: CONFIGURACION,
  },
  {
    id: 'tablero-github',
    titulo: 'Tablero de tareas y GitHub',
    resumen: 'El webhook de GitHub, el token de solo lectura y quién es quién.',
    tema: 'configuracion',
    para: 'Administración',
    permiso: CONFIGURACION,
  },
  {
    id: 'certifex',
    titulo: 'Certifex: diplomas y certificaciones',
    resumen: 'Qué pantallas hay, qué permisos piden y qué se pone en el servidor.',
    tema: 'configuracion',
    para: 'Administración',
    permiso: CONFIGURACION,
  },
  {
    id: 'asignacion-leads',
    titulo: 'Asignación de leads con Make',
    resumen: 'Crear una asignación, sus dos escenarios y la clave de entrada.',
    tema: 'configuracion',
    para: 'Administración',
    permiso: CONFIGURACION,
  },
  {
    id: 'copia-diaria',
    titulo: 'Copia diaria de la base',
    resumen: 'La copia cifrada que el CRM puede mandar cada noche.',
    tema: 'configuracion',
    para: 'Administración',
    permiso: CONFIGURACION,
  },
  {
    id: 'otros',
    titulo: 'Otras funciones que se configuran',
    resumen: 'Webhooks de admisión y de prospectos, MCP, conectores, WooCommerce, IA y más.',
    tema: 'configuracion',
    para: 'Administración',
    permiso: CONFIGURACION,
  },
];

/** Todos los permisos que abren algún tutorial: con uno basta para ver la entrada del menú. */
export const PERMISOS_DE_TUTORIALES: string[] = [...new Set(
  TUTORIALES.flatMap((t) => (Array.isArray(t.permiso) ? t.permiso : [t.permiso])),
)];

export const tutorialPorId = (id: string | undefined) => TUTORIALES.find((t) => t.id === id);
