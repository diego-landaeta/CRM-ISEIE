import { z } from 'zod';
import { AppError } from '../../shared/utils/AppError.js';
import * as reportes from '../reports/report.model.js';
import { resumenDelDia } from '../reports/resumenDelDia.js';
import * as proceso from '../proceso/proceso.model.js';
import * as feedback from '../feedback/feedback.model.js';
import * as metas from '../sales/sales.goals.js';
import * as metaAds from '../meta-ads/meta-ads.service.js';
import * as egresos from '../expenses/expense.model.js';
import * as porPagar from '../accounts-payable/payable.model.js';
import * as stripe from '../stripe-payments/stripe-payments.model.js';
import * as comisiones from '../commissions/commission.model.js';
import * as duplicados from '../leads/dup-queue.service.js';
import * as model from './mcp.model.js';
import { acotarProyectos, responsableImpuesto } from './mcp.acceso.js';
import { enteroEnv } from './mcp.config.js';
import * as moodle from './mcp.moodle.js';

/**
 * Las herramientas que ve Claude. TODAS son de lectura: no hay ni una que
 * cree, cambie o borre nada, y la prueba `mcpSoloLectura` lo vigila.
 *
 * Cada herramienta recibe el `ambito` de la persona (lo calcula el servidor a
 * partir del token, no lo manda Claude) y los argumentos ya validados con Zod.
 * El `proyecto_id`/`sociedad_id` que mande Claude solo sirve para ESTRECHAR
 * dentro de lo suyo: `acotarProyectos` rechaza lo que no le pertenece.
 */

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato AAAA-MM-DD');

const AMBITO = {
  proyecto_id: z.number().int().positive().optional()
    .describe('Un campus concreto (id de «mis_proyectos»). Sin él: todos los tuyos.'),
  sociedad_id: z.number().int().positive().optional()
    .describe('Una empresa/sociedad (id de «mis_proyectos»): sus campus que sean tuyos.'),
};
const PERIODO = {
  desde: fecha.optional().describe('Fecha inicial, AAAA-MM-DD'),
  hasta: fecha.optional().describe('Fecha final, AAAA-MM-DD'),
};
/**
 * Datos personales (#196): correos y teléfonos salen enmascarados y, en los
 * listados, los clientes como «Pedro S.». Esto los da enteros. Queda en la
 * auditoría (Conexión → MCP → Actividad).
 */
const DATOS_COMPLETOS = {
  datos_completos: z.boolean().optional()
    .describe('true SOLO si la persona necesita el correo, el teléfono o el nombre completo (por ejemplo, para contactar a alguien). Queda registrado.'),
};

const PAGINA = {
  pagina: z.number().int().min(1).max(1000).default(1),
  limite: z.number().int().min(1).max(100).default(25),
};

/** Lo comun a todas: los campus sobre los que se consulta y el dueño impuesto. */
const acotar = (ambito, args) => ({
  projectIds: acotarProyectos(ambito, args),
  responsableId: responsableImpuesto(ambito),
});

/** Ningun informe puede tener la base ocupada mas de esto. */
export const TOPE_INFORME_MS = 8000;

/**
 * Los informes: las MISMAS funciones que Reportes, para que Claude dé el mismo
 * numero que la pantalla. Todas aceptan `projectIds` y `asesoraId`.
 */
export const INFORMES = {
  resumen_general: {
    descripcion: 'Leads por estado y canal, y las ventas CERRADAS en el periodo (por fecha de venta) con lo que se declara pagado en ellas. No es el dinero que entró en el periodo: para eso, «cobros_mensuales» (solo super admin y admin).',
    ejecutar: reportes.overview,
    // `overview` no aplicaba `asesoraId` hasta el 19/10/2026 (ver su
    // comentario: «Tu semana» de las gestoras). Ya lo aplica, pero esto sigue
    // siendo solo para admin, como la pantalla (`roleGuard` en /overview): la
    // gestora tiene su propio resumen. Lo vigila `mcpAmbito.test.js`.
    soloAdmin: true,
  },
  resumen_mensual: {
    descripcion: 'Prospectos, ventas y dinero mes a mes, por mes de VENTA (no de cobro): «cobrado» es lo que se declara pagado en las ventas de ese mes, como en «resumen_general». Para el dinero que entró en cada mes, usa «cobros_mensuales».',
    ejecutar: reportes.resumenMensual,
  },
  ventas_por_asesora: {
    descripcion: 'Cada venta con su asesora, fecha e importe.',
    ejecutar: reportes.ventasPorAsesoraReport,
  },
  tasa_de_cierre: {
    descripcion: 'Porcentaje de prospectos que acaban comprando.',
    ejecutar: reportes.tasaDeCierre,
  },
  seguimiento: {
    descripcion: 'Tiempos de primer contacto y seguimiento de los prospectos.',
    ejecutar: reportes.seguimientoYTiempos,
  },
  cobros_mensuales: {
    descripcion: 'Dinero cobrado mes a mes: cada pago registrado, por su FECHA DE COBRO (la base de Finanzas). Es la respuesta a «cuánto dinero entró en tal mes».',
    ejecutar: reportes.cobrosMensuales,
  },
  paises: {
    descripcion: 'Países que más compran.',
    ejecutar: reportes.paisesMasVendidos,
  },
  formaciones: {
    descripcion: 'Formaciones (productos) más vendidas.',
    ejecutar: reportes.formacionesMasVendidas,
  },
  // ── Lo comercial del día a día (#325) ─────────────────────────────────────
  // Las MISMAS funciones que las pantallas de origen, para que las cifras
  // cuadren. Todas devuelven números agregados: ningún nombre ni contacto de
  // cliente, salvo el `cliente` de «pendientes_de_facturar», que sale abreviado.
  dashboard_hoy: {
    descripcion: 'Ayer y hoy, como el Dashboard: prospectos que entraron, contactados, ventas y prospectos sin tocar.',
    ejecutar: ({ projectIds, asesoraId }) => resumenDelDia({ projectIds, asesoraId }),
  },
  cola_del_dia: {
    descripcion: 'La cola del proceso comercial en cifras, como «La cola del día»: atrasados, para hoy, para mañana y esta semana.',
    ejecutar: ({ projectIds, asesoraId }) => proceso.resumenDeLaCola({ projectIds, asesoraId }),
  },
  proceso_comercial: {
    descripcion: 'El proceso comercial en cifras: cuántos prospectos hay en cada paso (1–4 y los que se añaden a mano), cuántos van atrasados y la fecha del siguiente. '
      + 'Los mismos prospectos que «cola_del_dia», repartidos por paso.',
    ejecutar: ({ projectIds, asesoraId }) => proceso.resumenPorPaso({ projectIds, asesoraId }),
  },
  seguimiento_fin_de_mes: {
    descripcion: 'Prospectos por antigüedad (este mes, 1–3, 3–6 y más de 6 meses) y cuántos no se han contactado nunca, como «Seguimiento de fin de mes».',
    ejecutar: ({ projectIds, asesoraId }) => proceso.resumenDeSeguimiento({ projectIds, asesoraId }),
  },
  feedback: {
    descripcion: 'Encuestas de feedback de Reportes: enviadas y respondidas, motivos de no compra, por disparador, campus, gestora y mes. Acepta desde y hasta.',
    ejecutar: ({ projectIds, asesoraId, from, to }) => feedback.panel({ projectIds, gestoraId: asesoraId, desde: from, hasta: to }),
  },
  pendientes_de_facturar: {
    descripcion: 'Cobros que todavía no tienen factura (cliente abreviado, curso, último cobro e importe), como «Pendientes de facturar». Acepta desde y hasta (por fecha de cobro).',
    ejecutar: ({ projectIds, from, to }) => reportes.ventasSinFacturaEnRango({ projectIds, from, to }),
    // La pantalla es de administración: una gestora no la ve, y aquí tampoco.
    soloAdmin: true,
  },
  metas_gestoras: {
    descripcion: 'La meta de ventas y de facturación de cada gestora y su avance en el periodo (solo super admin y admin). Acepta desde y hasta.',
    ejecutar: ({ projectIds, from, to }) => metas.getGestoresStats({ projectIds, from: from || null, to: to || null }),
    soloAdmin: true,
  },
  // ── Administración y dinero (#325): solo super admin y admin ───────────────
  egresos: {
    descripcion: 'Los gastos por categoría y periodo, como «Egresos» (incluye los de la empresa y los generales). Acepta desde y hasta (solo super admin y admin).',
    ejecutar: ({ projectIds, from, to }) => egresos.resumenExpenses({ projectIds, from, to }),
    soloAdmin: true,
  },
  cuentas_por_pagar: {
    descripcion: 'Facturas de proveedores: total facturado, pagado, pendiente y vencidas, como «Cuentas por pagar». Acepta desde y hasta, por fecha de factura (solo super admin y admin).',
    ejecutar: ({ projectIds, from, to }) => porPagar.getStats({ projectIds, from, to }),
    soloAdmin: true,
  },
  pagos_stripe: {
    descripcion: 'Los cobros de Stripe del periodo: correctos y fallidos, disputados, reembolsados, cuántos no están asociados a un cliente y el total cobrado, como «Pagos Stripe». Acepta desde y hasta (solo super admin y admin).',
    ejecutar: ({ projectIds, from, to }) => stripe.getStats({ projectIds, from, to }),
    soloAdmin: true,
  },
  comisiones_gestoras: {
    descripcion: 'Las comisiones de las gestoras por ventas: total, pagadas y pendientes del periodo (solo super admin y admin). Las de los tutores van en «comisiones_tutores».',
    ejecutar: ({ projectIds, from, to }) => comisiones.getStats({ projectIds, from, to }),
    soloAdmin: true,
  },
  duplicados: {
    descripcion: 'La cola de prospectos duplicados: pendientes de revisar, aprobados, fusionados y descartados, de tus campus (solo super admin y admin).',
    ejecutar: async ({ projectIds }) => {
      const total = { pending: 0, approved: 0, merged: 0, rejected: 0 };
      for (const id of projectIds) {
        const c = await duplicados.counts(id);
        for (const k of Object.keys(total)) total[k] += Number(c[k] || 0);
      }
      return { pendientes: total.pending, aprobados: total.approved, fusionados: total.merged, descartados: total.rejected };
    },
    soloAdmin: true,
  },
  // ── Lo que faltaba, parte 2 (#325) ─────────────────────────────────────────
  // Todas devuelven cifras y listas cortas. Sin correos, teléfonos ni textos de
  // mensajes; los clientes que aparecen (solo en «whatsapp») salen abreviados.
  matriculas: {
    descripcion: 'La pantalla de Matrículas en cifras: cuántas hay por estado (pendientes, validadas, rechazadas…), por producto, por campus y por mes de alta. '
      + 'Acepta desde y hasta (por fecha de alta). Una gestora solo cuenta las de sus ventas.',
    ejecutar: ({ projectIds, asesoraId, from, to }) => model.resumenMatriculas({ projectIds, asesoraId, from, to }),
  },
  catalogo_completo: {
    descripcion: 'El catálogo por dentro, por campus: formaciones activas e inactivas, cuántas no tienen SKU o lo repiten o no tienen precio, el árbol de categorías '
      + 'con sus formaciones y las últimas importaciones de WooCommerce (solo super admin y admin). Para precios y fichas usa «listar_formaciones» y «resumen_catalogo».',
    ejecutar: ({ projectIds }) => model.catalogoCompleto({ projectIds }),
    soloAdmin: true,
  },
  correos: {
    descripcion: 'Los correos del CRM en cifras, como la pantalla Correos: enviados, recibidos, frenados (los que el freno de pruebas no dejó salir) y fallidos, '
      + 'por campus, tipo y mes, más las secuencias de correo y cómo van. No da asuntos, destinatarios ni textos. Acepta desde y hasta (solo super admin y admin).',
    ejecutar: ({ projectIds, from, to }) => model.resumenCorreos({ projectIds, from, to }),
    soloAdmin: true,
  },
  whatsapp: {
    descripcion: 'WhatsApp en cifras: mensajes enviados y recibidos por gestora, campus, tipo de mensaje, mes y prospecto, y cuántas conversaciones y números distintos hay. '
      + 'Nunca da el texto de los mensajes ni los números de teléfono; los grupos no cuentan. Acepta desde y hasta. Una gestora solo cuenta su sesión y sus prospectos.',
    ejecutar: ({ projectIds, asesoraId, from, to }) => model.resumenWhatsapp({ projectIds, asesoraId, from, to }),
  },
  solicitudes_y_avisos: {
    descripcion: 'Las solicitudes de cambio (RFC) por estado y campus con las últimas quince, y los avisos de la campana que TÚ tienes sin leer (los que piden hacer algo y los que solo informan). '
      + 'Acepta desde y hasta (por fecha de solicitud). Una gestora solo ve las solicitudes que ha pedido ella.',
    ejecutar: async ({ projectIds, asesoraId, from, to, quien }) => ({
      solicitudes: await model.resumenSolicitudes({ projectIds, asesoraId, from, to }),
      avisos_pendientes: await model.avisosPendientes(quien),
    }),
  },
  nominas: {
    descripcion: 'Las nóminas, como la pantalla de Nóminas: planes de cada persona, periodos mensuales con su total y estado, y horas trabajadas. '
      + 'Sin fechas, el último año. Acepta desde y hasta (solo super admin y admin).',
    ejecutar: ({ projectIds, from, to }) => model.nominasDe({ projectIds, from, to }),
    soloAdmin: true,
  },
  // Diego, 08/10: «en los reportes el ranking de gestora es por lo cobrado» (antes, del 30/09 al 08/10, por lo facturado).
  // El mismo calculo que «Cómo voy» (`miPuesto`), para que
  // Claude no conteste «la mejor comercial» con otra medida.
  //
  // Solo super admin y admin: el puesto se calcula con los numeros de TODO el
  // equipo, y por Claude una gestora no saca cifras de nadie mas (lo vigila
  // `mcpAmbito.test.js`). Su puesto lo ve en «Cómo voy».
  ranking_gestoras: {
    descripcion: 'El ranking de gestoras, que se mide por lo COBRADO: los pagos registrados en el periodo, por su fecha de cobro. '
      + 'Es la respuesta a «quién es la mejor comercial» (solo super admin y admin).',
    ejecutar: ({ projectIds, from, to }) => reportes.miPuesto({ userId: 0, projectIds, from, to, esJefe: true }),
    soloAdmin: true,
  },
};

/**
 * Lo de tutores es de administracion: lo que se le paga a cada profesor no lo
 * ve una gestora, igual que en la pantalla (Tutores pide admin, superadmin o
 * quien lleva las colaboraciones). Se llama DESPUES de acotar, para que un
 * campus ajeno se rechace por ajeno y no por esto.
 */
function soloAdministracion(ambito, herramienta) {
  if (ambito.soloLoSuyo) {
    throw new AppError(`«${herramienta}» es de administración: solo la ven super admin y admin.`, 403, 'MCP_SOLO_ADMIN');
  }
}

/** Un periodo al revés no da «0 de todo»: se le dice a Claude que lo corrija. */
function periodoEnOrden({ desde, hasta }) {
  if (desde && hasta && desde > hasta) {
    throw new AppError(`«desde» (${desde}) es posterior a «hasta» (${hasta}).`, 400, 'MCP_PERIODO_AL_REVES');
  }
}

async function conTope(promesa, ms, nombre, { sujeto = 'El informe', sugerencia = 'Prueba con un periodo más corto.' } = {}) {
  let reloj;
  const tope = new Promise((_, rechazar) => {
    reloj = setTimeout(() => rechazar(new AppError(`${sujeto} «${nombre}» tardó más de ${ms / 1000} s y se cortó. ${sugerencia}`, 504, 'MCP_LENTO')), ms);
  });
  try {
    return await Promise.race([promesa, tope]);
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * Ninguna consulta a Moodle puede tener la herramienta ocupada mas de esto
 * (MCP_MOODLE_TOPE_MS, 25 s): son varias llamadas por red a un servidor ajeno.
 * Al cortar se cancelan tambien las peticiones que sigan en vuelo.
 */
export const topeMoodleMs = () => enteroEnv('MCP_MOODLE_TOPE_MS', 25000);

async function moodleConTope(nombre, trabajo) {
  const control = new AbortController();
  try {
    return await conTope(trabajo(control.signal), topeMoodleMs(), nombre, {
      sujeto: 'La consulta',
      sugerencia: 'Acota con texto, categoria_id o curso_id, o pide menos cursos.',
    });
  } catch (err) {
    control.abort();
    throw err;
  }
}

/**
 * A que apartado de la pantalla Conexion → MCP pertenece cada consulta. El orden de los
 * apartados es el de la primera consulta de cada uno. Una consulta sin grupo sale en «Otras».
 */
export const GRUPO_DE_CONSULTA = Object.freeze({
  mis_proyectos: 'Campus y prospectos',
  buscar_prospectos: 'Campus y prospectos',
  ver_prospecto: 'Campus y prospectos',
  resumen_prospectos: 'Campus y prospectos',
  listar_ventas: 'Ventas, facturas y cobros',
  resumen_ventas: 'Ventas, facturas y cobros',
  listar_facturas: 'Ventas, facturas y cobros',
  resumen_facturas: 'Ventas, facturas y cobros',
  cobros_pendientes: 'Ventas, facturas y cobros',
  listar_tutores: 'Tutores',
  comisiones_tutores: 'Tutores',
  formaciones_sin_tutor: 'Tutores',
  listar_formaciones: 'Catálogo de formaciones',
  resumen_catalogo: 'Catálogo de formaciones',
  ver_formacion: 'Catálogo de formaciones',
  // Consultas que entraron por staging (#235, #203, #325) y no tenian apartado en el panel.
  cuentas_publicitarias: 'Publicidad',
  resumen_publicidad: 'Publicidad',
  campanas_publicitarias: 'Publicidad',
  meta_ads: 'Publicidad',
  actividad_por_comercial: 'Equipo y actividad',
  equipo: 'Equipo y actividad',
  clientes: 'Campus y prospectos',
  moodle_cursos: 'Moodle de los campus',
  moodle_alumnos: 'Moodle de los campus',
  moodle_recursos_externos: 'Moodle de los campus',
  moodle_estructura: 'Moodle de los campus',
  informe: 'Informes',
});

/** De una campaña de la pantalla de Meta, lo que le sirve a Claude (sin ids internos de la cuenta publicitaria). */
function resumirCampana(c) {
  return {
    campana_id: c.campaign_id, nombre: c.nombre, estado: c.effective_status || c.status || null,
    gasto: c.total_spend, impresiones: c.total_impressions, clics: c.total_clicks, ctr: c.ctr,
    leads_meta: c.total_leads, cpl_meta: c.cpl,
    prospectos_crm: c.leads_crm, ventas_crm: c.ventas_crm, cpl_crm: c.cpl_crm,
  };
}

export const HERRAMIENTAS = [
  {
    nombre: 'mis_proyectos',
    titulo: 'Mis campus y empresas',
    descripcion: 'Lista los campus (proyectos) y empresas (sociedades) del CRM a los que tienes acceso, y si ves todo el campus o solo tus propios registros. Úsala primero para conocer los ids.',
    entrada: {},
    ejecutar: async (ambito) => ({
      persona: ambito.nombre,
      rol: ambito.role,
      alcance: ambito.soloLoSuyo
        ? 'Solo tus propios prospectos, ventas y facturas dentro de tus campus.'
        : 'Todos los datos de tus campus.',
      proyectos: ambito.proyectos,
      // Con un solo campus no hay nada que elegir (#220): se dice para que
      // Claude no pregunte «¿de qué campus?» ni pase ids en cada consulta.
      ...(ambito.proyectos.length === 1 ? {
        campus_unico: `Solo tienes un campus, ${ambito.proyectos[0].nombre}: todas las consultas van sobre él sin indicar proyecto_id ni sociedad_id.`,
      } : {}),
    }),
  },
  {
    nombre: 'buscar_prospectos',
    // En esta lista, «nombre» es el de un cliente: sale abreviado (#196).
    listasDeClientes: ['prospectos'],
    titulo: 'Buscar prospectos',
    descripcion: 'Busca prospectos (leads) por estado, canal, texto (nombre, email o teléfono), gestora, programa de interés y fechas de solicitud. Cada fila trae el último contacto, el próximo (según el proceso comercial), el paso en el que va y lo vendido. Devuelve una página de resultados y el total.',
    entrada: { ...DATOS_COMPLETOS,
      ...AMBITO,
      estado: z.string().max(40).optional().describe('nuevo, por_contactar, contactado, en_seguimiento, convertido, no_interesado…'),
      canal: z.string().max(40).optional().describe('Canal de captación (meta, google, organico…)'),
      texto: z.string().max(100).optional().describe('Busca en nombre, email o teléfono'),
      gestora_id: z.number().int().positive().optional().describe('Solo los de una gestora (id de «ventas_por_asesora»). Quien ve solo lo suyo no puede pedir los de otra.'),
      programa: z.string().max(100).optional().describe('Parte del nombre del programa de interés, sin tildes ni mayúsculas (por ejemplo «coaching»)'),
      ...PERIODO,
      ...PAGINA,
    },
    ejecutar: async (ambito, a) => {
      const { gestora_id: gestoraId, ...resto } = a;
      if (gestoraId && ambito.soloLoSuyo && gestoraId !== ambito.userId) {
        throw new AppError('Solo ves tus propios prospectos: no puedes pedir los de otra gestora.', 403, 'MCP_FUERA_DE_AMBITO');
      }
      return model.buscarProspectos({ ...resto, gestoraId, ...acotar(ambito, a) });
    },
  },
  {
    nombre: 'ver_prospecto',
    titulo: 'Ver un prospecto',
    descripcion: 'Ficha de un prospecto: datos de contacto, origen, últimas interacciones y sus ventas.',
    entrada: { ...DATOS_COMPLETOS, id: z.number().int().positive().describe('Id del prospecto') },
    ejecutar: async (ambito, a) => {
      const r = await model.verProspecto({ id: a.id, ...acotar(ambito, {}) });
      if (!r) throw new AppError(`El prospecto ${a.id} no existe o no tienes acceso a él.`, 404, 'MCP_NO_ENCONTRADO');
      return r;
    },
  },
  {
    nombre: 'resumen_prospectos',
    titulo: 'Resumen de prospectos',
    descripcion: 'Cuántos prospectos hay por estado, por canal y por campus en un periodo.',
    entrada: { ...AMBITO, ...PERIODO },
    ejecutar: (ambito, a) => model.resumenProspectos({ ...a, ...acotar(ambito, a) }),
  },
  {
    nombre: 'listar_ventas',
    titulo: 'Listar ventas',
    descripcion: 'Ventas (conversiones) con importe, lo cobrado y lo pendiente. Filtra por fechas, texto (producto o cliente) y si están pendientes de cobro. '
      + 'Lo cobrado son los PAGOS REGISTRADOS de cada venta; puede no cuadrar con «cobros_pendientes», que usa el campo de importe pagado de la venta.',
    entrada: { ...DATOS_COMPLETOS,
      ...AMBITO,
      ...PERIODO,
      texto: z.string().max(100).optional().describe('Busca en producto o nombre del cliente'),
      pendiente: z.boolean().optional().describe('true: solo con cobro pendiente; false: solo cobradas'),
      facturada: z.boolean().optional().describe('true: solo con factura (ni proformas ni canceladas); false: solo sin facturar'),
      vendedora_id: z.number().int().positive().optional().describe('Solo las de una vendedora (su id sale del informe «ventas_por_asesora»). Quien ve solo lo suyo no puede pedir las de otra.'),
      ...PAGINA,
    },
    ejecutar: async (ambito, a) => {
      const { vendedora_id: vendedoraId, ...resto } = a;
      // Una gestora ve solo lo suyo: pedir otra vendedora no ensancha nada, y se le dice.
      if (vendedoraId && ambito.soloLoSuyo && vendedoraId !== ambito.userId) {
        throw new AppError('Solo ves tus propias ventas: no puedes pedir las de otra vendedora.', 403, 'MCP_FUERA_DE_AMBITO');
      }
      return model.listarVentas({ ...resto, vendedoraId, ...acotar(ambito, a) });
    },
  },
  {
    nombre: 'resumen_ventas',
    titulo: 'Resumen de ventas',
    descripcion: 'Número de ventas, importe vendido, cobrado y pendiente en un periodo, desglosado por campus. '
      + 'Para comparar gestoras no uses esto: se miden por lo cobrado, con el informe «ranking_gestoras».',
    entrada: { ...AMBITO, ...PERIODO },
    ejecutar: (ambito, a) => model.resumenVentas({ ...a, ...acotar(ambito, a) }),
  },
  {
    nombre: 'listar_facturas',
    titulo: 'Listar facturas',
    descripcion: 'Facturas con código, estado, cliente, total y empresa emisora. Filtra por estado, tipo, texto y fecha de emisión.',
    entrada: { ...DATOS_COMPLETOS,
      ...AMBITO,
      estado: z.enum(['borrador', 'emitida', 'enviada', 'pagada', 'cancelada']).optional(),
      tipo: z.enum(['normal', 'proforma', 'rectificativa']).optional(),
      texto: z.string().max(100).optional().describe('Busca en nombre del cliente o código de factura'),
      ...PERIODO,
      ...PAGINA,
    },
    ejecutar: (ambito, a) => model.listarFacturas({ ...a, ...acotar(ambito, a) }),
  },
  {
    nombre: 'resumen_facturas',
    titulo: 'Resumen de facturas',
    descripcion: 'Total facturado y cobrado, y facturas por estado, en un periodo de emisión.',
    entrada: { ...AMBITO, ...PERIODO },
    ejecutar: (ambito, a) => model.resumenFacturas({ ...a, ...acotar(ambito, a) }),
  },
  {
    nombre: 'cobros_pendientes',
    titulo: 'Cobros pendientes',
    descripcion: 'Cuentas por cobrar: cuotas y ventas pendientes con su vencimiento, y cuánto está vencido. Las fechas filtran por vencimiento. '
      + 'Ojo: el Dashboard («cobros vencidos») cuenta solo VENTAS con saldo y fecha de pago pasada, y esto cuenta cuotas e importes: no es un error que no coincidan. '
      + 'Da lo mismo que la pantalla «Cuentas por cobrar» del CRM, que se fía del campo de importe pagado de la venta: si una venta está marcada como pagada '
      + 'pero no tiene pagos registrados, aquí no sale como pendiente y en «listar_ventas» sí. Si las cifras no cuadran, dilo y explica esta diferencia.',
    entrada: { ...DATOS_COMPLETOS,
      ...AMBITO,
      ...PERIODO,
      // 100 como máximo: es el tope de filas de cualquier respuesta (#196).
      limite: z.number().int().min(1).max(100).default(50).describe('Máximo de filas de detalle (hasta 100)'),
      gestora_id: z.number().int().positive().optional().describe('Solo los cobros de una gestora (id de «ventas_por_asesora»). Quien ve solo lo suyo no puede pedir los de otra.'),
    },
    ejecutar: async (ambito, a) => {
      const { gestora_id: gestoraId, ...resto } = a;
      if (gestoraId && ambito.soloLoSuyo && gestoraId !== ambito.userId) {
        throw new AppError('Solo ves tus propios cobros: no puedes pedir los de otra gestora.', 403, 'MCP_FUERA_DE_AMBITO');
      }
      const dondeVa = acotar(ambito, a);
      // A quien ve solo lo suyo se le impone ella misma; quien ve todo el campus puede acotar a una gestora.
      return model.cobrosPendientes({ ...resto, ...dondeVa, responsableId: dondeVa.responsableId || gestoraId || null });
    },
  },
  {
    nombre: 'clientes',
    titulo: 'Clientes',
    descripcion: 'La pantalla de Clientes: quien ha comprado (tiene al menos una venta), con sus productos, gestora, compras, facturado, cobrado, pendiente, cuotas, última compra, próximo vencimiento y último contacto. '
      + 'Arriba van las cuatro cifras de la pantalla (clientes, facturado, cobrado y pendiente de TODOS los que cumplen el filtro) y «cobro»: la salud de cobro y lo que vence hasta mañana, en 7 y en 30 días '
      + '(de todo el campus o de la gestora; no depende del texto ni de las fechas). Las fechas filtran por la última compra. '
      + 'Cobrado y pendiente se fían del campo de importe pagado de la venta, como «cobros_pendientes»: si una venta consta como pagada sin pagos registrados, aquí aparece cobrada. '
      + 'Sin correos ni teléfonos; el cliente sale con nombre abreviado salvo con datos_completos.',
    entrada: { ...DATOS_COMPLETOS,
      ...AMBITO,
      ...PERIODO,
      texto: z.string().max(100).optional().describe('Busca en nombre, correo o teléfono del cliente'),
      gestora_id: z.number().int().positive().optional().describe('Solo los clientes de una gestora (id de «ventas_por_asesora»). Quien ve solo lo suyo no puede pedir los de otra.'),
      ...PAGINA,
    },
    ejecutar: async (ambito, a) => {
      const { gestora_id: gestoraId, desde, hasta, ...resto } = a;
      if (gestoraId && ambito.soloLoSuyo && gestoraId !== ambito.userId) {
        throw new AppError('Solo ves tus propios clientes: no puedes pedir los de otra gestora.', 403, 'MCP_FUERA_DE_AMBITO');
      }
      return model.clientesDe({ ...resto, gestoraId, desde, hasta, ...acotar(ambito, a) });
    },
  },
  {
    nombre: 'listar_tutores',
    titulo: 'Tutores y sus cursos',
    descripcion: 'Los tutores (profesores colaboradores) de tus campus: en qué campus están, qué cursos dan, con qué porcentaje de comisión '
      + 'y desde cuándo. «rige_hoy» dice si ese curso le genera comisión hoy. De cada curso, lo entregado (foto corporativa, vídeo y módulos '
      + 'al 25, 50 o 100 %): «entregado» es el mismo texto que la columna Entregado de la pantalla y «falta», lo que queda. '
      + 'No incluye DNI, IBAN ni teléfono (solo super admin y admin).',
    entrada: { ...DATOS_COMPLETOS,
      ...AMBITO,
      texto: z.string().max(100).optional().describe('Busca en nombre, email o nombre del curso'),
      incluir_retirados: z.boolean().default(false).describe('true: también los tutores dados de baja'),
      solo_entregas_pendientes: z.boolean().default(false)
        .describe('true: solo los tutores a los que les falta foto, vídeo o módulos al 100 % en un curso que siguen dando, y solo esos cursos'),
    },
    ejecutar: async (ambito, a) => {
      const { projectIds } = acotar(ambito, a);
      soloAdministracion(ambito, 'listar_tutores');
      return model.tutoresConCursos({ ...a, projectIds });
    },
  },
  {
    nombre: 'comisiones_tutores',
    titulo: 'Comisiones de tutores',
    descripcion: 'Lo que se le debe y lo ya pagado a cada tutor, mes a mes: base de cálculo, generado, por pagar, pagado y revertido. '
      + 'Un mes o un tramo de meses. Los mismos números que la pantalla Comisiones de tutores. '
      + 'Cada fila trae, curso a curso, lo entregado (como la columna Entregado) y «se_puede_pagar»: queda algo por pagar y lo ha entregado todo. '
      + 'Sirve para contestar «¿a quién se le puede pagar ya?» (solo super admin y admin).',
    entrada: {
      ...AMBITO,
      periodo: z.string().regex(/^\d{4}-\d{2}$/, 'Formato AAAA-MM').optional().describe('Un mes, AAAA-MM'),
      desde: z.string().regex(/^\d{4}-\d{2}$/, 'Formato AAAA-MM').optional().describe('Primer mes del tramo, AAAA-MM'),
      hasta: z.string().regex(/^\d{4}-\d{2}$/, 'Formato AAAA-MM').optional().describe('Último mes del tramo, AAAA-MM'),
      tutor_id: z.number().int().positive().optional().describe('Un tutor concreto (id de «listar_tutores»)'),
      solo_entregas_pendientes: z.boolean().default(false)
        .describe('true: solo las filas con algún curso sin foto, sin vídeo o con los módulos por debajo del 100 %; los totales, de esas filas'),
    },
    ejecutar: async (ambito, a) => {
      const { projectIds } = acotar(ambito, a);
      soloAdministracion(ambito, 'comisiones_tutores');
      return model.comisionesDeTutores({ ...a, projectIds });
    },
  },
  {
    nombre: 'formaciones_sin_tutor',
    titulo: 'Formaciones sin tutor',
    descripcion: 'Formaciones que se han vendido y cobrado y que hoy no tiene ningún tutor: lo mismo que la pantalla «Cursos sin tutor». '
      + 'Por defecto, solo las vendidas desde el arranque de las comisiones. Cada una trae «meta», la columna META de la pantalla: '
      + 'no_se_busca, buscando (sin anuncio enganchado), anuncio_activo o anuncio_pausado (con el anuncio, su gasto y sus leads, tal como los dejó la última sincronización con Meta) '
      + 'o anuncio_desaparecido (se apuntó uno y ya no está en Meta). El enganche anuncio-formación lo hace una persona en la pantalla (solo super admin y admin).',
    entrada: {
      ...AMBITO,
      incluir_anteriores_al_corte: z.boolean().default(false).describe('true: también las vendidas antes del arranque de las comisiones'),
    },
    ejecutar: async (ambito, a) => {
      const { projectIds } = acotar(ambito, a);
      soloAdministracion(ambito, 'formaciones_sin_tutor');
      return model.formacionesSinTutorDe({ ...a, projectIds });
    },
  },
  // El catálogo de cada campus (#215, ficha de Diego del 05/10). Lo usan todos
  // los roles con MCP, también las gestoras: lo necesitan para vender y no es
  // información sensible. Nada de ventas ni de `stripe_link`; del tutor, solo
  // el nombre.
  {
    nombre: 'listar_formaciones',
    titulo: 'Formaciones y precios',
    descripcion: 'El catálogo de tus campus: cada formación activa (o también las inactivas con incluir_inactivas) con su SKU, precio, moneda, campus y enlace a la web, como la pantalla de Productos. '
      + 'Busca por nombre sin distinguir mayúsculas ni tildes. Devuelve una página y el total: con muchas, pide un nombre o usa «resumen_catalogo». '
      + 'Si una formación no tiene precio, contesta que en el CRM no consta; no lo deduzcas ni lo inventes. No da ventas.',
    entrada: {
      ...AMBITO,
      texto: z.string().max(100).optional().describe('Parte del nombre de la formación, por ejemplo «psicología clínica»'),
      incluir_inactivas: z.boolean().optional().describe('true: también las formaciones dadas de baja (cada fila dice si está «activa»). Por defecto, solo las activas.'),
      ...PAGINA,
    },
    ejecutar: (ambito, a) => {
      const { incluir_inactivas: incluirInactivas, ...resto } = a;
      return model.listarFormaciones({ ...resto, incluirInactivas: incluirInactivas === true, projectIds: acotar(ambito, a).projectIds });
    },
  },
  {
    nombre: 'resumen_catalogo',
    titulo: 'Resumen del catálogo',
    descripcion: 'Por campus: cuántas formaciones activas hay, el precio mínimo, el máximo y el más habitual (el que más se repite; vacío si ninguno se repite: entonces no lo hay), '
      + 'las monedas, y cuántas no tienen precio o enlace. '
      + 'Úsala para «¿cuánto cuestan los cursos de X?» sin listar cientos de formaciones.',
    entrada: { ...AMBITO },
    ejecutar: (ambito, a) => model.resumenCatalogo({ projectIds: acotar(ambito, a).projectIds }),
  },
  {
    nombre: 'ver_formacion',
    titulo: 'Ficha de una formación',
    descripcion: 'La ficha de una formación (id de «listar_formaciones»): precio, moneda, enlace, categoría, duración, plazas totales y libres, '
      + 'cierre de convocatoria, dossier y el nombre del tutor que la da hoy. Plazas, cierre de convocatoria y dossier están vacíos en casi todo el catálogo: '
      + 'si vienen vacíos, contesta que en el CRM no consta; no lo deduzcas.',
    entrada: { id: z.number().int().positive().describe('Id de la formación') },
    ejecutar: async (ambito, a) => {
      const permitidos = acotar(ambito, {}).projectIds;
      const r = await model.verFormacion(a.id);
      if (!r) throw new AppError(`La formación ${a.id} no existe.`, 404, 'MCP_NO_ENCONTRADO');
      // El mismo 403 que dan las demás herramientas con un campus ajeno.
      if (!permitidos.includes(Number(r.campus_id))) {
        throw new AppError(`No tienes acceso al campus ${r.campus_id}. Usa «mis_proyectos» para ver los tuyos.`, 403, 'MCP_FUERA_DE_AMBITO');
      }
      return r;
    },
  },
  // El Moodle de cada campus (#335). Solo lectura contra la API de servicios web
  // de Moodle; el token de cada campus vive cifrado en las credenciales del CRM
  // (servicio «moodle») y no sale NUNCA. Un campus sin Moodle, con el token
  // caducado o que no responde se dice en «campus_con_error»: jamás es un cero.
  {
    nombre: 'moodle_cursos',
    titulo: 'Cursos del Moodle de cada campus',
    descripcion: 'Los cursos que hay en el Moodle de tus campus (no son las formaciones del catálogo del CRM: es lo que hay montado en la plataforma). '
      + 'Por defecto solo los ACTIVOS (visibles y sin fecha de fin pasada); con estado puedes pedir proximos, terminados, ocultos o todos. '
      + 'Filtra por texto (nombre, sin distinguir tildes) o categoria_id (de «moodle_estructura»; incluye sus subcategorías). Devuelve cuántos cursos tiene cada campus y una página de cursos, cada uno con su categoría, fechas de inicio y fin, si está visible y el número de alumnos. '
      + 'El número de alumnos cuesta una lectura por curso de la página: con_alumnos: false la evita si solo quieres la lista. '
      + 'Si un campus no tiene Moodle configurado, el token no vale o no responde, sale en «campus_con_error» con el motivo: díselo a la persona, no lo des por «cero cursos». '
      + 'La lista puede tener unos minutos; refrescar: true la pide de nuevo.',
    entrada: {
      ...AMBITO,
      estado: z.enum(['activos', 'proximos', 'terminados', 'ocultos', 'todos']).default('activos'),
      texto: z.string().max(100).optional().describe('Parte del nombre del curso'),
      categoria_id: z.number().int().positive().optional().describe('Una categoría de Moodle (id de «moodle_estructura»)'),
      orden: z.enum(['nombre', 'inicio', 'fin', 'categoria']).default('nombre').describe('Por qué se ordenan los cursos (los que no tienen ese dato van al final)'),
      sentido: z.enum(['asc', 'desc']).default('asc').describe('desc: de mayor a menor (p. ej. orden inicio + desc = los más recientes primero)'),
      con_alumnos: z.boolean().default(true).describe('false: no cuenta los alumnos de cada curso (más rápido)'),
      refrescar: z.boolean().optional().describe('true: salta la caché y pregunta a Moodle ahora'),
      ...PAGINA,
    },
    ejecutar: (ambito, a) => moodleConTope('moodle_cursos', (signal) => moodle.moodleCursos(ambito, a, { signal })),
  },
  {
    nombre: 'moodle_alumnos',
    titulo: 'Alumnos por curso en Moodle',
    descripcion: 'Cuántos alumnos hay en los cursos de Moodle de tus campus: matriculados, con matrícula activa, suspendidos, activos (accedieron al curso en los últimos N días, 30 por defecto) y los que nunca han entrado. '
      + 'Elige los cursos con curso_id (de «moodle_cursos»; con él, indica proyecto_id), con categoria_id (de «moodle_estructura»; incluye sus subcategorías) o con texto; sin ninguno, los de todo el campus. Se miran como mucho limite_cursos (10 por defecto) y se dice cuántos quedan fuera. '
      + 'Por defecto solo cifras. «terminados» solo tiene dato si el curso tiene finalización activada Y criterios definidos (criterios_de_finalizacion); si no, viene a null con el motivo en «avisos», no a 0. Cuesta una lectura por alumno: terminados: false la evita. '
      + 'datos_completos: true añade nombre y correo de cada alumno (solo super admin y admin; queda registrado). '
      + 'Si un campus no responde, el token no vale o no tiene Moodle, sale en «campus_con_error»: no es «cero alumnos».',
    entrada: { ...DATOS_COMPLETOS,
      ...AMBITO,
      curso_id: z.number().int().positive().optional().describe('Id del curso en el Moodle del campus (de «moodle_cursos»); exige proyecto_id si tienes varios campus'),
      texto: z.string().max(100).optional().describe('Parte del nombre del curso'),
      categoria_id: z.number().int().positive().optional().describe('Una categoría de Moodle (id de «moodle_estructura»): sus cursos y los de sus subcategorías'),
      estado: z.enum(['activos', 'proximos', 'terminados', 'ocultos', 'todos']).default('activos').describe('Qué cursos mirar; con curso_id se ignora'),
      limite_cursos: z.number().int().min(1).max(25).default(10).describe('Máximo de cursos a consultar en esta petición'),
      terminados: z.boolean().default(true).describe('false: no cuenta quién ha terminado el curso (una lectura por alumno)'),
      dias_actividad: z.number().int().min(1).max(365).default(30).describe('Un alumno es «activo» si accedió al curso en estos días'),
      refrescar: z.boolean().optional().describe('true: salta la caché de la lista de cursos'),
    },
    ejecutar: async (ambito, a) => {
      // El campus ajeno es un 403 antes de tocar nada; luego, los datos
      // personales solo para administración (dentro de moodleAlumnos).
      acotar(ambito, a);
      return moodleConTope('moodle_alumnos', (signal) => moodle.moodleAlumnos(ambito, a, { signal }));
    },
  },
  {
    nombre: 'moodle_recursos_externos',
    titulo: 'Recursos externos de los cursos de Moodle',
    descripcion: 'Los recursos externos de los cursos de Moodle: enlaces (módulos URL y los escritos en las descripciones), YouTube, Vimeo, Google Drive y herramientas externas (LTI), con su tipo y en qué sección están, y un resumen de qué cursos tienen y cuáles no. '
      + 'Elige cursos con curso_id (con proyecto_id), categoria_id (de «moodle_estructura»; incluye sus subcategorías) o texto; se miran como mucho limite_cursos (10 por defecto) y se avisa de los que quedan fuera. '
      + 'comprobar_enlaces: true (solo super admin y admin) comprueba si cada enlace responde (ok, roto, restringido, no_responde…; hasta un tope de enlaces por petición); '
      + 'las direcciones internas o privadas no se comprueban. Los LTI no tienen dirección visible. '
      + 'Un curso sin recursos sale con total 0 SOLO si se ha podido leer; si falla, trae «error». Un campus caído sale en «campus_con_error».',
    entrada: {
      ...AMBITO,
      curso_id: z.number().int().positive().optional().describe('Id del curso en el Moodle del campus (de «moodle_cursos»); exige proyecto_id si tienes varios campus'),
      texto: z.string().max(100).optional().describe('Parte del nombre del curso'),
      categoria_id: z.number().int().positive().optional().describe('Una categoría de Moodle (id de «moodle_estructura»): sus cursos y los de sus subcategorías'),
      estado: z.enum(['activos', 'proximos', 'terminados', 'ocultos', 'todos']).default('activos').describe('Qué cursos mirar; con curso_id se ignora'),
      tipo: z.enum(['youtube', 'vimeo', 'drive', 'lti', 'enlace']).optional().describe('Solo recursos de este tipo (los recuentos siguen siendo del curso entero)'),
      comprobar_enlaces: z.boolean().default(false).describe('true: comprueba si los enlaces responden (solo super admin y admin)'),
      solo_rotos: z.boolean().default(false).describe('true (con comprobar_enlaces): solo los que no responden o están rotos'),
      limite_cursos: z.number().int().min(1).max(25).default(10).describe('Máximo de cursos a leer en esta petición'),
      refrescar: z.boolean().optional().describe('true: salta la caché de la lista de cursos'),
    },
    ejecutar: async (ambito, a) => {
      acotar(ambito, a);
      return moodleConTope('moodle_recursos_externos', (signal) => moodle.moodleRecursosExternos(ambito, a, { signal }));
    },
  },
  {
    nombre: 'moodle_estructura',
    titulo: 'Estructura de Moodle: categorías y contenido de un curso',
    descripcion: 'Sin curso_id: las categorías de cursos del Moodle de tus campus (con su ruta, por ejemplo «Másteres > Psicología») y cuántos cursos tiene cada una; sirve para conocer el categoria_id y filtrar los demás. '
      + 'Con curso_id (de «moodle_cursos»; con él, indica proyecto_id): las secciones del curso y las actividades de cada una (nombre, tipo y si están visibles), para preguntas como «¿qué tiene el módulo 3 de X?». '
      + 'Un campus sin Moodle o caído sale en «campus_con_error».',
    entrada: {
      ...AMBITO,
      curso_id: z.number().int().positive().optional().describe('Id del curso en el Moodle del campus (de «moodle_cursos»): devuelve sus secciones y actividades; exige proyecto_id si tienes varios campus'),
      refrescar: z.boolean().optional().describe('true: salta la caché'),
    },
    ejecutar: (ambito, a) => moodleConTope('moodle_estructura', (signal) => moodle.moodleEstructura(ambito, a, { signal })),
  },
  // Publicidad (#235, ficha de Diego del 05/10 y respuesta del 07/10): lo que
  // ya guarda el CRM de Meta. Solo super admin y admin: el gasto publicitario
  // no lo ve una gestora. Primero `acotar` (un campus ajeno se rechaza por
  // ajeno) y luego `soloAdministracion`, como las de tutores.
  {
    nombre: 'cuentas_publicitarias',
    titulo: 'Cuentas publicitarias',
    descripcion: 'Las cuentas de Meta conectadas en Publicidad: campus, nombre, moneda, cómo va la sincronización (estado y última vez) '
      + 'y si tiene el histórico cargado. Contesta a «¿qué cuentas tenemos conectadas?» (solo super admin y admin).',
    entrada: { ...AMBITO },
    ejecutar: async (ambito, a) => {
      const { projectIds } = acotar(ambito, a);
      soloAdministracion(ambito, 'cuentas_publicitarias');
      return model.cuentasPublicitarias({ projectIds });
    },
  },
  {
    nombre: 'resumen_publicidad',
    titulo: 'Resumen de publicidad',
    descripcion: 'Por campus, en un periodo: gasto en Meta (el mismo que la pantalla Publicidad), impresiones, clics, los «leads» que da Meta '
      + 'y lo que vende la publicidad: prospectos que llegaron por una campaña, cuántos compraron, lo facturado y el coste por venta. '
      + 'De los prospectos que entraron en el periodo, cuenta los que compraron (en cualquier fecha) y lo facturado. Sin fechas, todo el histórico. '
      + '«atribucion» dice qué se puede saber de cada campus: «por_campaña» (las cifras son un MÍNIMO: solo cuentan los prospectos que traen la campaña; '
      + 'una campaña con 0 puede haber traído prospectos sin ella, así que no digas que no vende); '
      + '«no_disponible» o «solo_total_del_campus» (no se puede saber qué vende la publicidad: explica el «motivo» y NUNCA digas que vende 0). '
      + 'En «solo_total_del_campus» compara el gasto con las ventas de todo el campus y dilo así. '
      + 'Si citas los «leads_segun_meta», di siempre que no son fiables (#48) (solo super admin y admin).',
    entrada: { ...AMBITO, ...PERIODO },
    ejecutar: async (ambito, a) => {
      const { projectIds } = acotar(ambito, a);
      soloAdministracion(ambito, 'resumen_publicidad');
      periodoEnOrden(a);
      // Con el mismo tope de tiempo que los informes (QA de Diego, 22/10, punto
      // 10): sin fechas recorre todo el histórico y cruza por `utm_campaign`.
      return conTope(model.resumenPublicidad({ projectIds, desde: a.desde, hasta: a.hasta }), TOPE_INFORME_MS, 'resumen_publicidad');
    },
  },
  {
    nombre: 'campanas_publicitarias',
    titulo: 'Campañas publicitarias',
    descripcion: 'Cada campaña de Meta con gasto o prospectos en el periodo, de la que más gasta a la que menos: estado, objetivo, presupuesto diario, '
      + 'gasto, los «leads» que da Meta, prospectos atribuidos, ventas atribuidas y coste por venta. Sirve para «¿qué campaña funciona mejor?». '
      + 'Los atribuidos son un MÍNIMO: solo cuentan los prospectos que traen la campaña. Sin fechas, todo el histórico. '
      + 'Con «atribucion» distinta de «por_campaña», ese campus no se puede atribuir por campaña: explica el «motivo», no digas que vende 0. '
      + 'Si citas los «leads_segun_meta», di siempre que no son fiables (#48) (solo super admin y admin).',
    entrada: {
      ...AMBITO,
      ...PERIODO,
      // 100 como máximo: es el tope de filas de cualquier respuesta (#196).
      limite: z.number().int().min(1).max(100).default(50).describe('Máximo de campañas (hasta 100)'),
    },
    ejecutar: async (ambito, a) => {
      const { projectIds } = acotar(ambito, a);
      soloAdministracion(ambito, 'campanas_publicitarias');
      periodoEnOrden(a);
      return conTope(model.campanasPublicitarias({ projectIds, desde: a.desde, hasta: a.hasta, limite: a.limite }),
        TOPE_INFORME_MS, 'campanas_publicitarias');
    },
  },
  // Actividad por comercial (#203, parte A; ficha de Diego del 07/10). La usan
  // todos los roles con MCP: a quien solo ve lo suyo se le impone su id y se
  // ve a sí misma.
  {
    nombre: 'actividad_por_comercial',
    titulo: 'Actividad por comercial',
    descripcion: 'Llamadas, WhatsApp y correos registrados en el CRM por cada comercial en un periodo, contados por quien los registró '
      + '(también en fichas de otra), con el día de Madrid. «personas» son las distintas que contactó y «toques», los contactos. '
      + 'Las notas internas no son contactos: van aparte y no cuentan en «toques» ni en «personas». '
      + '«whatsapp» son los WhatsApp apuntados como contacto (los que suman en «toques»); «whatsapp_texto» y «whatsapp_voz» son los mensajes '
      + 'que salieron por WhatsApp, escritos y en nota de voz; los que no tienen autora salen en «Sin asignar». '
      + 'Sin fechas, el día de ayer. Las llamadas son las REGISTRADAS en el CRM: las apuntadas a mano y las que entraron por WhatsApp '
      + 'a su línea (también perdidas o rechazadas); las del móvil que no se apuntan no están. Dilo así («llamadas registradas»), '
      + 'no como que las hizo ella. '
      + 'Ejemplo: «Ayer, Victoria hizo 4 llamadas, Malena 3 y el resto ninguna registrada». '
      + 'Quien no es super admin ni admin solo se ve a sí misma.',
    entrada: { ...AMBITO, ...PERIODO },
    ejecutar: async (ambito, a) => {
      const { projectIds, responsableId } = acotar(ambito, a);
      const desde = a.desde || a.hasta || model.ayerEnMadrid();
      const hasta = a.hasta || (a.desde ? model.hoyEnMadrid() : desde);
      if (desde > hasta) {
        throw new AppError(`«desde» (${desde}) es posterior a «hasta» (${hasta}).`, 400, 'MCP_PERIODO_AL_REVES');
      }
      return model.actividadPorComercial({ projectIds, responsableId, desde, hasta });
    },
  },
  {
    nombre: 'meta_ads',
    titulo: 'Meta Ads',
    descripcion: 'Publicidad de Meta (Facebook e Instagram) de tus campus, como la pantalla «Meta Ads» (solo super admin y admin). Una vista cada vez: '
      + '«campanas» (por campaña: estado, gasto, impresiones, clics, CTR, leads de Meta, prospectos que llegaron al CRM, ventas y coste por lead; es la de por defecto), '
      + '«por_producto» (gasto, prospectos y ventas por formación asociada), «roi» (gasto frente a ventas por campaña) y «evolucion_diaria» (gasto, clics y leads por día). '
      + 'Acepta desde y hasta. Los «leads de Meta» son los que cuenta Meta con su formulario; los «prospectos del CRM» son los que de verdad entraron por esa campaña: pueden no coincidir. '
      + 'Si un campus no tiene Meta conectado, sale vacío con el aviso «sin Meta conectado», no como cero gastado.',
    entrada: {
      ...AMBITO,
      ...PERIODO,
      vista: z.enum(['campanas', 'por_producto', 'roi', 'evolucion_diaria']).default('campanas'),
      limite: z.number().int().min(1).max(100).default(30).describe('Máximo de campañas por campus (por gasto)'),
    },
    ejecutar: async (ambito, a) => {
      const { projectIds } = acotar(ambito, a);
      soloAdministracion(ambito, 'meta_ads');
      const nombres = new Map((ambito.proyectos || []).map((p) => [Number(p.id), p.nombre]));
      const campus = [];
      for (const projectId of projectIds) {
        const base = { projectId, dateFrom: a.desde || null, dateTo: a.hasta || null };
        const cuentas = await metaAds.listAccounts(projectId);
        const entrada = { campus_id: projectId, campus: nombres.get(projectId) || String(projectId) };
        if (!cuentas.length) { campus.push({ ...entrada, aviso: 'sin Meta conectado' }); continue; }
        if (a.vista === 'por_producto') campus.push({ ...entrada, productos: await metaAds.getProductsView(base) });
        else if (a.vista === 'roi') campus.push({ ...entrada, campanas: (await metaAds.getRoi(base)).slice(0, a.limite) });
        else if (a.vista === 'evolucion_diaria') campus.push({ ...entrada, ...(await metaAds.getDashboard(base)) });
        else {
          const filas = await metaAds.listCampaignsForUI(base);
          campus.push({ ...entrada, campanas: filas.slice(0, a.limite).map(resumirCampana), total_campanas: filas.length });
        }
      }
      return { vista: a.vista, desde: a.desde || null, hasta: a.hasta || null, campus };
    },
  },
  {
    nombre: 'equipo',
    titulo: 'Equipo',
    descripcion: 'Quién hay en tus campus: nombre, rol y campus de cada persona, y cuántas hay por rol. Sin correos ni teléfonos. '
      + 'Por defecto solo las activas (solo super admin y admin).',
    entrada: {
      ...AMBITO,
      incluir_inactivos: z.boolean().optional().describe('true: también las personas desactivadas'),
    },
    ejecutar: async (ambito, a) => {
      const { projectIds } = acotar(ambito, a);
      soloAdministracion(ambito, 'equipo');
      return model.equipoDeLosCampus({ projectIds, incluirInactivos: a.incluir_inactivos === true });
    },
  },
  {
    nombre: 'informe',
    titulo: 'Informe del CRM',
    descripcion: 'Ejecuta uno de los informes de Reportes del CRM (mismos números que la pantalla, con el mismo periodo). Sin desde/hasta cubre TODO el histórico; la pantalla de Reportes arranca en «Este mes», así que para cuadrar con ella pasa las fechas del mes. Tipos: '
      + Object.entries(INFORMES).map(([k, v]) => `${k} (${v.descripcion})`).join('; '),
    entrada: { ...DATOS_COMPLETOS,
      tipo: z.enum(Object.keys(INFORMES)),
      ...AMBITO,
      ...PERIODO,
    },
    ejecutar: async (ambito, a) => {
      if (INFORMES[a.tipo].soloAdmin && ambito.soloLoSuyo) {
        throw new AppError(`El informe «${a.tipo}» es de todo el campus y solo lo ven super admin y admin. Prueba con «resumen_mensual».`, 403, 'MCP_INFORME_SOLO_ADMIN');
      }
      const { projectIds, responsableId } = acotar(ambito, a);
      // `quien` es para lo que es de la PERSONA y no del campus (sus avisos sin leer).
      const params = {
        projectIds, from: a.desde, to: a.hasta, asesoraId: responsableId || undefined,
        quien: { userId: ambito.userId, role: ambito.role },
      };
      const datos = await conTope(INFORMES[a.tipo].ejecutar(params), TOPE_INFORME_MS, a.tipo);
      return { informe: a.tipo, campus: projectIds, desde: a.desde || null, hasta: a.hasta || null, datos };
    },
  },
];
