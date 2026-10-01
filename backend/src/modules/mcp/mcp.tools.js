import { z } from 'zod';
import { AppError } from '../../shared/utils/AppError.js';
import * as reportes from '../reports/report.model.js';
import * as model from './mcp.model.js';
import { acotarProyectos, responsableImpuesto } from './mcp.acceso.js';

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
    descripcion: 'Leads por estado y canal, conversiones y dinero cobrado del periodo (solo super admin y admin).',
    ejecutar: reportes.overview,
    // `overview` acepta `asesoraId` pero NO lo aplica: en la pantalla solo lo
    // ven los admin (`roleGuard` en /overview). A quien ve solo lo suyo le
    // daria los totales de todo el campus. Lo vigila `mcpAmbito.test.js`.
    soloAdmin: true,
  },
  resumen_mensual: {
    descripcion: 'Lo mismo desglosado mes a mes.',
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
    descripcion: 'Dinero cobrado mes a mes.',
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
  // Diego, 30/09: «el ranking de gestoras será por montos facturados; así es
  // como se medirá». El mismo calculo que «Cómo voy» (`miPuesto`), para que
  // Claude no conteste «la mejor comercial» con otra medida.
  //
  // Solo super admin y admin: el puesto se calcula con los numeros de TODO el
  // equipo, y por Claude una gestora no saca cifras de nadie mas (lo vigila
  // `mcpAmbito.test.js`). Su puesto lo ve en «Cómo voy».
  ranking_gestoras: {
    descripcion: 'El ranking de gestoras, que se mide por lo FACTURADO: facturas emitidas en el periodo, IVA incluido, y los abonos restan. '
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

async function conTope(promesa, ms, nombre) {
  let reloj;
  const tope = new Promise((_, rechazar) => {
    reloj = setTimeout(() => rechazar(new AppError(`El informe «${nombre}» tardó más de ${ms / 1000} s y se cortó. Prueba con un periodo más corto.`, 504, 'MCP_LENTO')), ms);
  });
  try {
    return await Promise.race([promesa, tope]);
  } finally {
    clearTimeout(reloj);
  }
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
    }),
  },
  {
    nombre: 'buscar_prospectos',
    titulo: 'Buscar prospectos',
    descripcion: 'Busca prospectos (leads) por estado, canal, texto (nombre, email o teléfono) y fechas de solicitud. Devuelve una página de resultados y el total.',
    entrada: {
      ...AMBITO,
      estado: z.string().max(40).optional().describe('nuevo, por_contactar, contactado, en_seguimiento, convertido, no_interesado…'),
      canal: z.string().max(40).optional().describe('Canal de captación (meta, google, organico…)'),
      texto: z.string().max(100).optional().describe('Busca en nombre, email o teléfono'),
      ...PERIODO,
      ...PAGINA,
    },
    ejecutar: (ambito, a) => model.buscarProspectos({ ...a, ...acotar(ambito, a) }),
  },
  {
    nombre: 'ver_prospecto',
    titulo: 'Ver un prospecto',
    descripcion: 'Ficha de un prospecto: datos de contacto, origen, últimas interacciones y sus ventas.',
    entrada: { id: z.number().int().positive().describe('Id del prospecto') },
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
    entrada: {
      ...AMBITO,
      ...PERIODO,
      texto: z.string().max(100).optional().describe('Busca en producto o nombre del cliente'),
      pendiente: z.boolean().optional().describe('true: solo con cobro pendiente; false: solo cobradas'),
      ...PAGINA,
    },
    ejecutar: (ambito, a) => model.listarVentas({ ...a, ...acotar(ambito, a) }),
  },
  {
    nombre: 'resumen_ventas',
    titulo: 'Resumen de ventas',
    descripcion: 'Número de ventas, importe vendido, cobrado y pendiente en un periodo, desglosado por campus. '
      + 'Para comparar gestoras no uses esto: se miden por lo facturado, con el informe «ranking_gestoras».',
    entrada: { ...AMBITO, ...PERIODO },
    ejecutar: (ambito, a) => model.resumenVentas({ ...a, ...acotar(ambito, a) }),
  },
  {
    nombre: 'listar_facturas',
    titulo: 'Listar facturas',
    descripcion: 'Facturas con código, estado, cliente, total y empresa emisora. Filtra por estado, tipo, texto y fecha de emisión.',
    entrada: {
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
      + 'Da lo mismo que la pantalla «Cuentas por cobrar» del CRM, que se fía del campo de importe pagado de la venta: si una venta está marcada como pagada '
      + 'pero no tiene pagos registrados, aquí no sale como pendiente y en «listar_ventas» sí. Si las cifras no cuadran, dilo y explica esta diferencia.',
    entrada: {
      ...AMBITO,
      ...PERIODO,
      limite: z.number().int().min(1).max(200).default(50).describe('Máximo de filas de detalle'),
    },
    ejecutar: (ambito, a) => model.cobrosPendientes({ ...a, ...acotar(ambito, a) }),
  },
  {
    nombre: 'listar_tutores',
    titulo: 'Tutores y sus cursos',
    descripcion: 'Los tutores (profesores colaboradores) de tus campus: en qué campus están, qué cursos dan, con qué porcentaje de comisión '
      + 'y desde cuándo. «rige_hoy» dice si ese curso le genera comisión hoy. No incluye DNI, IBAN ni teléfono (solo super admin y admin).',
    entrada: {
      ...AMBITO,
      texto: z.string().max(100).optional().describe('Busca en nombre, email o nombre del curso'),
      incluir_retirados: z.boolean().default(false).describe('true: también los tutores dados de baja'),
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
    descripcion: 'Lo que se le debe y lo ya pagado a cada tutor, mes a mes: base de cálculo, por pagar, pagado y revertido. '
      + 'Los mismos números que la pantalla Comisiones de tutores (solo super admin y admin).',
    entrada: {
      ...AMBITO,
      periodo: z.string().regex(/^\d{4}-\d{2}$/, 'Formato AAAA-MM').optional().describe('Un mes, AAAA-MM. Sin él: todos'),
      tutor_id: z.number().int().positive().optional().describe('Un tutor concreto (id de «listar_tutores»)'),
    },
    ejecutar: async (ambito, a) => {
      const { projectIds } = acotar(ambito, a);
      soloAdministracion(ambito, 'comisiones_tutores');
      return model.comisionesDeTutores({ ...a, projectIds });
    },
  },
  {
    nombre: 'informe',
    titulo: 'Informe del CRM',
    descripcion: 'Ejecuta uno de los informes de Reportes del CRM (mismos números que la pantalla). Tipos: '
      + Object.entries(INFORMES).map(([k, v]) => `${k} (${v.descripcion})`).join('; '),
    entrada: {
      tipo: z.enum(Object.keys(INFORMES)),
      ...AMBITO,
      ...PERIODO,
    },
    ejecutar: async (ambito, a) => {
      if (INFORMES[a.tipo].soloAdmin && ambito.soloLoSuyo) {
        throw new AppError(`El informe «${a.tipo}» es de todo el campus y solo lo ven super admin y admin. Prueba con «resumen_mensual».`, 403, 'MCP_INFORME_SOLO_ADMIN');
      }
      const { projectIds, responsableId } = acotar(ambito, a);
      const params = { projectIds, from: a.desde, to: a.hasta, asesoraId: responsableId || undefined };
      const datos = await conTope(INFORMES[a.tipo].ejecutar(params), TOPE_INFORME_MS, a.tipo);
      return { informe: a.tipo, campus: projectIds, desde: a.desde || null, hasta: a.hasta || null, datos };
    },
  },
];
