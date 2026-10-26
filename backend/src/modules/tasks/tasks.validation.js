import { z } from 'zod';

export const PRIORIDADES_VALIDAS = ['baja', 'media', 'alta'];

/**
 * Valida de forma estricta fechas de calendario (AAAA-MM-DD) o marcas ISO 8601 completas.
 * Comprueba que el año, mes y día existan realmente en el calendario (rechaza días como 2026-02-31 o textos inválidos).
 */
export function isValidIsoDate(val) {
  if (typeof val !== 'string') return false;
  const str = val.trim();
  if (!str) return false;

  // 1. Formato solo día: AAAA-MM-DD
  const dateOnlyMatch = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(str);
  if (dateOnlyMatch) {
    const y = parseInt(dateOnlyMatch[1], 10);
    const m = parseInt(dateOnlyMatch[2], 10);
    const d = parseInt(dateOnlyMatch[3], 10);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  // 2. Formato ISO completo con hora
  const isoMatch = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(?:Z|[+-](\d{2}):?(\d{2}))?$/.exec(str);
  if (!isoMatch) return false;

  const y = parseInt(isoMatch[1], 10);
  const m = parseInt(isoMatch[2], 10);
  const d = parseInt(isoMatch[3], 10);
  const dtUtc = new Date(Date.UTC(y, m - 1, d));
  if (dtUtc.getUTCFullYear() !== y || dtUtc.getUTCMonth() !== m - 1 || dtUtc.getUTCDate() !== d) {
    return false;
  }

  const parsed = Date.parse(str);
  return !Number.isNaN(parsed);
}

export function isValidIsoDay(val) {
  if (typeof val !== 'string') return false;
  const str = val.trim();
  const dateOnlyMatch = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(str);
  if (!dateOnlyMatch) return false;
  const y = parseInt(dateOnlyMatch[1], 10);
  const m = parseInt(dateOnlyMatch[2], 10);
  const d = parseInt(dateOnlyMatch[3], 10);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const fecha = z.string().trim().refine(isValidIsoDate, {
  message: 'Fecha límite (due_date) inválida',
});

const dia = z.string().trim().refine(isValidIsoDay, {
  message: 'Fecha inválida: usa AAAA-MM-DD con un día existente en el calendario',
});

const id = z.number().int().positive();

// La clave de una columna: la de las 4 fijas o la de una propia. Que exista y
// este activa lo comprueba el servicio contra task_columns.
const columna = z.string().trim().min(1).max(50).regex(/^[a-z0-9_]+$/, 'Columna inválida');

// Los colores que sabe pintar el tablero (columnas, áreas y proyectos propios).
export const COLORES_TABLERO = ['gray', 'blue', 'yellow', 'green', 'purple', 'rose'];
const colorTablero = z.enum(COLORES_TABLERO, { message: `Color inválido: usa ${COLORES_TABLERO.join(', ')}` });

// En la query string todo llega como texto: «false» tiene que ser falso.
const booleanoDeQuery = z.enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'El título es obligatorio').max(255, 'Máximo 255 caracteres'),
  description: z.string().trim().max(10000, 'Máximo 10.000 caracteres').optional().nullable(),
  status: columna.default('por_hacer'),
  priority: z.enum(PRIORIDADES_VALIDAS).default('media'),
  due_date: fecha.optional().nullable(),
  project_id: id.optional().nullable(),
  external_project_id: id.optional().nullable(),
  area_id: id.optional().nullable(),
  assigned_to: id.optional().nullable(),
  // Quien la supervisa (26/10/2026). Lo pone quien tiene «Asignar».
  supervisor_id: id.optional().nullable(),
}).refine((d) => !(d.project_id && d.external_project_id), {
  message: 'No puedes asignar un proyecto del catálogo y un proyecto propio a la vez',
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1, 'El título no puede estar vacío').max(255).optional(),
  description: z.string().trim().max(10000).optional().nullable(),
  priority: z.enum(PRIORIDADES_VALIDAS).optional(),
  due_date: fecha.optional().nullable(),
  project_id: id.optional().nullable(),
  external_project_id: id.optional().nullable(),
  area_id: id.optional().nullable(),
  assigned_to: id.optional().nullable(),
  supervisor_id: id.optional().nullable(),
}).refine((d) => Object.keys(d).length > 0, {
  message: 'No se envió ningún campo para actualizar',
}).refine((d) => !(d.project_id && d.external_project_id), {
  message: 'No puedes asignar un proyecto del catálogo y un proyecto propio a la vez',
});

export const moveTaskSchema = z.object({
  status: columna,
  prev_id: id.optional().nullable(),
  next_id: id.optional().nullable(),
});

export const returnTaskSchema = z.object({
  comment: z.string().trim().min(1, 'El motivo de la devolución es obligatorio').max(5000),
});

// El ámbito elegido arriba (#245): una empresa (`issuerId`) o un campus
// (`projectId`). Es el de las PERSONAS que se ven; `project_id`, en cambio,
// filtra por el campus de la propia tarea.
const ambitoQuery = {
  issuerId: z.coerce.number().int().positive().optional(),
  projectId: z.coerce.number().int().positive().optional(),
};

export const ambitoQuerySchema = z.object(ambitoQuery);

export const listTasksQuerySchema = z.object({
  ...ambitoQuery,
  status: columna.optional(),
  assigned_to: z.coerce.number().int().positive().optional(),
  project_id: z.coerce.number().int().positive().optional(),
  external_project_id: z.coerce.number().int().positive().optional(),
  area_id: z.coerce.number().int().positive().optional(),
  priority: z.enum(PRIORIDADES_VALIDAS).optional(),
  search: z.string().trim().max(100).optional(),
  tag: z.string().trim().min(1).max(50).optional(),
  vencidas: booleanoDeQuery.optional(),
  desde: dia.optional(),
  hasta: dia.optional(),
  incluir_archivadas: booleanoDeQuery.optional().default('false'),
}).refine((q) => !q.desde || !q.hasta || q.desde <= q.hasta, {
  message: 'La fecha «desde» no puede ser posterior a «hasta»',
});

export const metricsQuerySchema = z.object({
  ...ambitoQuery,
  project_id: z.coerce.number().int().positive().optional(),
  area_id: z.coerce.number().int().positive().optional(),
});

export const addChecklistItemSchema = z.object({
  title: z.string().trim().min(1, 'El título del elemento no puede estar vacío').max(255),
});

export const updateChecklistItemSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  is_completed: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'No se enviaron campos para actualizar' });

export const addCommentSchema = z.object({
  content: z.string().trim().min(1, 'El comentario no puede estar vacío').max(5000),
});

export const COLORES_ETIQUETA = ['sky', 'rose', 'amber', 'emerald', 'violet', 'slate'];

export const addTagSchema = z.object({
  name: z.string().trim().min(1, 'Nombre de etiqueta obligatorio').max(50),
  color: z.enum(COLORES_ETIQUETA, { message: 'Color de etiqueta inválido' }).default('sky'),
});

// Solo http(s): un «javascript:» guardado aqui se ejecutaria al pulsarlo.
export const addLinkSchema = z.object({
  url: z.string().trim().max(2000).url('Enlace inválido')
    .refine((u) => /^https?:\/\//i.test(u), 'El enlace tiene que empezar por http:// o https://'),
  title: z.string().trim().max(255).optional().nullable(),
});

/* --- Configuración de columnas, áreas y proyectos externos --- */

const ordenEntero = z.number().int().min(0, 'El orden no puede ser negativo').max(2147483647, 'El orden supera el límite permitido');

export const createColumnSchema = z.object({
  key: z.string().trim().min(1).max(50).regex(/^[a-z0-9_]+$/, 'La clave solo puede tener letras minúsculas, números y guiones bajos'),
  name: z.string().trim().min(1, 'El nombre de la columna es obligatorio').max(100),
  color: colorTablero.default('gray'),
  sort_order: ordenEntero.optional(),
});

export const updateColumnSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  color: colorTablero.optional(),
  sort_order: ordenEntero.optional(),
  is_active: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'No se envió ningún campo para actualizar' });

export const reorderColumnsSchema = z.object({
  keys: z.array(z.string().trim().min(1)).min(1, 'Debes enviar la lista de claves'),
});

export const createAreaSchema = z.object({
  name: z.string().trim().min(1, 'El nombre del área es obligatorio').max(100),
  color: colorTablero.default('gray'),
  sort_order: ordenEntero.optional(),
});

export const updateAreaSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  color: colorTablero.optional(),
  sort_order: ordenEntero.optional(),
  is_active: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'No se envió ningún campo para actualizar' });

export const setUserAreasSchema = z.object({
  area_ids: z.array(z.number().int().positive()).max(50),
});

// Quién está en un área: la lista entera, de una vez.
export const setAreaMembersSchema = z.object({
  user_ids: z.array(z.number().int().positive()).max(200),
});

export const createExternalProjectSchema = z.object({
  name: z.string().trim().min(1, 'El nombre del proyecto es obligatorio').max(150),
  description: z.string().trim().max(5000).optional().nullable(),
  url: z.string().trim().max(500).url('Enlace inválido')
    .refine((u) => /^https?:\/\//i.test(u), 'El enlace tiene que empezar por http:// o https://')
    .optional().nullable(),
  color: colorTablero.default('gray'),
});

export const updateExternalProjectSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  description: z.string().trim().max(5000).optional().nullable(),
  url: z.string().trim().max(500).url('Enlace inválido')
    .refine((u) => /^https?:\/\//i.test(u), 'El enlace tiene que empezar por http:// o https://')
    .optional().nullable(),
  color: colorTablero.optional(),
  sort_order: ordenEntero.optional(),
  is_active: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'No se envió ningún campo para actualizar' });
