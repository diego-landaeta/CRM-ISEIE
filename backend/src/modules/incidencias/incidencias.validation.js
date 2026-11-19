import { z } from 'zod';

/*
  Los valores salen TAL CUAL de los CHECK de la migracion 238: si aqui se
  aceptara uno que la tabla rechaza, el error saldria como un 500 de Postgres
  en vez de como un «ese campo no vale».

  Gravedad y estado son los de Soporte (`soporte.validation.js`), porque Diego
  pidio que fuera «como la seccion de soporte».
*/
const TIPOS = ['capa8', 'fallo_crm', 'dato_mal', 'externo'];
const GRAVEDAD = ['low', 'medium', 'high', 'critical'];
const ESTADO = ['open', 'in_review', 'resolved', 'closed'];
const CRM = ['multicrm', 'iseie'];
const ENTIDAD = ['lead', 'venta', 'factura', 'usuario', 'otro'];

/** Tope de INTEGER: mas alla, Postgres contesta con un error en vez de «no existe». */
const idOpcional = z.coerce.number().int().positive().max(2147483647).optional().nullable();

/** Texto largo opcional: el formulario manda cadena vacia cuando no se rellena. */
const textoLargo = z.string().max(20000).optional().nullable()
  .transform((v) => (v && v.trim() ? v.trim() : null));

const fecha = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Fecha imposible');

const campos = {
  ocurrioAt: fecha.optional(),
  crm: z.enum(CRM).optional(),
  projectId: idOpcional,
  sociedadId: idOpcional,
  tipos: z.array(z.enum(TIPOS)).min(1, 'Elige al menos un tipo').max(TIPOS.length)
    // Repetidos no: «capa 8, capa 8» contaria dos veces en las cifras.
    .transform((t) => [...new Set(t)]),
  causadaPor: idOpcional,
  detectadaPor: idOpcional,
  entidadTipo: z.enum(ENTIDAD).optional().nullable(),
  entidadId: idOpcional,
  quePaso: z.string().trim().min(3, 'Cuenta qué pasó').max(20000),
  impacto: textoLargo,
  comoSeArreglo: textoLargo,
  arregladaPor: idOpcional,
  arregladaAt: fecha.optional().nullable(),
  gravedad: z.enum(GRAVEDAD).optional(),
  estado: z.enum(ESTADO).optional(),
};

/** Campus O empresa: con los dos a la vez no se sabe de cual es. */
const unoDeLosDos = (d) => !(d.projectId && d.sociedadId);
const MSG_UNO = { message: 'Elige el campus o la empresa, no los dos', path: ['projectId'] };

export const crearSchema = z.object(campos)
  .refine(unoDeLosDos, MSG_UNO);

export const editarSchema = z.object(campos).partial()
  .refine(unoDeLosDos, MSG_UNO)
  .refine((d) => Object.keys(d).length > 0, 'No hay nada que cambiar');

export const listarSchema = z.object({
  estado: z.enum(ESTADO).optional(),
  tipo: z.enum(TIPOS).optional(),
  causadaPor: z.coerce.number().int().positive().max(2147483647).optional(),
  projectId: z.coerce.number().int().positive().max(2147483647).optional(),
  issuerId: z.coerce.number().int().positive().max(2147483647).optional(),
  // Con tope: `?page=1e20` hacía un OFFSET imposible y salía un 500.
  page: z.coerce.number().int().positive().max(100000).optional().default(1),
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
});

export const metricasSchema = z.object({
  // Los mismos filtros que la lista: si no, con «Abierta» puesto la lista
  // decía 2 y las cifras 6, y nada lo explicaba.
  estado: z.enum(ESTADO).optional(),
  tipo: z.enum(TIPOS).optional(),
  causadaPor: z.coerce.number().int().positive().max(2147483647).optional(),
  projectId: z.coerce.number().int().positive().max(2147483647).optional(),
  issuerId: z.coerce.number().int().positive().max(2147483647).optional(),
  // Sin `meses`, todo el histórico: así las cifras cuadran con la lista, que
  // tampoco se corta por fecha. Con él, los últimos N meses (el actual incluido).
  meses: z.coerce.number().int().min(1).max(36).optional(),
});

export { TIPOS, GRAVEDAD, ESTADO, CRM, ENTIDAD };
