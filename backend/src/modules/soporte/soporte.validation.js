import { z } from 'zod';

/*
  Las tres enumeraciones salen TAL CUAL del frontal, que ya las tiene escritas
  y usadas en la pantalla (`soporte/lib/tickets.ts`). Se copian en vez de
  inventar otras para que enganchar la interfaz no obligue a tocarla.

  Y son las mismas que los CHECK de la migracion 230: si aqui se aceptara un
  valor que la tabla rechaza, el error saldria como un 500 de Postgres en vez
  de como un «ese campo no vale».
*/
// 'access' (CRM#820): una peticion de acceso. Solo la crea `POST /accesos`, con
// su formulario: por `POST /` se sigue abriendo un bug, una mejora o una
// pregunta (`KIND_DEL_FORMULARIO`), y una peticion sin sus datos no sirve.
const KIND = ['bug', 'feature', 'question', 'access'];
const KIND_DEL_FORMULARIO = ['bug', 'feature', 'question'];
const SEVERITY = ['low', 'medium', 'high', 'critical'];
const ESTADO = ['open', 'in_review', 'resolved', 'closed'];

/** Texto largo opcional: el formulario manda cadena vacia cuando no se rellena. */
const textoLargo = z.string().max(20000).optional().nullable()
  .transform((v) => (v && v.trim() ? v.trim() : null));

export const crearTicketSchema = z.object({
  kind: z.enum(KIND_DEL_FORMULARIO).optional().default('bug'),
  severity: z.enum(SEVERITY).optional().default('medium'),
  // Lo unico que se exige. Un ticket sin titulo no se puede ni listar.
  title: z.string().min(3, 'El titulo es demasiado corto').max(300),
  description: textoLargo,
  steps: textoLargo,
  expected: textoLargo,
  actual: textoLargo,
  whyItMatters: textoLargo,
  url: z.string().max(2000).optional().nullable()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
  // Tope de INTEGER: mas alla, Postgres contesta con un error en vez de «no existe».
  projectId: z.coerce.number().int().positive().max(2147483647).optional().nullable(),
});

export const cambiarEstadoSchema = z.object({
  status: z.enum(ESTADO),
});

export const responderSchema = z.object({
  body: z.string().min(1, 'El mensaje esta vacio').max(20000),
  // Una nota interna no la ve quien abrio el ticket.
  // NO `z.coerce.boolean()`: convierte con Boolean(), asi que la cadena «false»
  // (o cualquier texto) saldria como true. Solo se aceptan los dos valores.
  interna: z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
    .optional().default(false),
});

export const listarSchema = z.object({
  estado: z.enum(ESTADO).optional(),
  kind: z.enum(KIND).optional(),
  projectId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
});

/*
  PEDIR ACCESO O PERMISO (CRM#820)

  Lo que pide el formulario corto: QUE (alta de una persona, un permiso, un
  campus, Claude/MCP u otra cosa), PARA QUIEN si es un alta, el campus y una
  explicacion. No se crea a nadie ni se da nada: solo se apunta.
*/
export const TIPOS_DE_ACCESO = ['alta', 'permiso', 'campus', 'claude', 'otro'];

const textoCorto = (max) => z.string().max(max).optional().nullable()
  .transform((v) => (v && v.trim() ? v.trim() : null));

export const pedirAccesoSchema = z.object({
  tipo: z.enum(TIPOS_DE_ACCESO, { errorMap: () => ({ message: 'Elige qué necesitas' }) }),
  // La clave del catalogo que falta («leads.view»). La rellena sola la pantalla
  // de «No tienes acceso»; desde el menu suele ir vacia.
  permiso: z.string().max(80).optional().nullable()
    .transform((v) => (v && v.trim() ? v.trim() : null))
    .refine((v) => v == null || /^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_]*$/.test(v), 'Esa clave de permiso no tiene buena forma'),
  nombre: textoCorto(200),
  correo: z.string().max(254).optional().nullable()
    .transform((v) => (v && v.trim() ? v.trim().toLowerCase() : null))
    .refine((v) => v == null || z.string().email().safeParse(v).success, 'El correo no es valido'),
  // Un campus suyo (de la lista) o, si no lo tiene —que es justo lo que pide—,
  // escrito.
  projectId: z.coerce.number().int().positive().max(2147483647).optional().nullable(),
  campus: textoCorto(200),
  explicacion: z.string({ required_error: 'Explica qué necesitas' })
    .trim().min(5, 'Explica un poco más qué necesitas').max(4000),
  url: z.string().max(2000).optional().nullable()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
}).superRefine((d, ctx) => {
  // Un alta sin a quien dar de alta no se puede preparar.
  if (d.tipo === 'alta' && !d.nombre) ctx.addIssue({ code: 'custom', path: ['nombre'], message: 'Falta el nombre de la persona' });
  if (d.tipo === 'alta' && !d.correo) ctx.addIssue({ code: 'custom', path: ['correo'], message: 'Falta el correo de la persona' });
});

export const listarAccesosSchema = z.object({
  estado: z.enum(ESTADO).optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
});

/** Gestionar una peticion: su estado y, si se quiere, unas lineas para quien la pidio. */
export const gestionarAccesoSchema = z.object({
  status: z.enum(ESTADO),
  nota: z.string().max(4000).optional().nullable()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
});

export { KIND, KIND_DEL_FORMULARIO, SEVERITY, ESTADO };
