import { z } from 'zod';

/*
  Las tres enumeraciones salen TAL CUAL del frontal, que ya las tiene escritas
  y usadas en la pantalla (`soporte/lib/tickets.ts`). Se copian en vez de
  inventar otras para que enganchar la interfaz no obligue a tocarla.

  Y son las mismas que los CHECK de la migracion 230: si aqui se aceptara un
  valor que la tabla rechaza, el error saldria como un 500 de Postgres en vez
  de como un «ese campo no vale».
*/
const KIND = ['bug', 'feature', 'question'];
const SEVERITY = ['low', 'medium', 'high', 'critical'];
const ESTADO = ['open', 'in_review', 'resolved', 'closed'];

/** Texto largo opcional: el formulario manda cadena vacia cuando no se rellena. */
const textoLargo = z.string().max(20000).optional().nullable()
  .transform((v) => (v && v.trim() ? v.trim() : null));

export const crearTicketSchema = z.object({
  kind: z.enum(KIND).optional().default('bug'),
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

export { KIND, SEVERITY, ESTADO };
