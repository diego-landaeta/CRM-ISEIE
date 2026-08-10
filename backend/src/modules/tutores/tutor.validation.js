import { z } from 'zod';

// Una fecha en formato ISO. Se acepta como texto y se deja que Postgres la
// convierta: hacerlo en JS con new Date() mete la zona horaria del servidor y
// una colaboracion que empieza el 1 acaba empezando el 31 del mes anterior.
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato AAAA-MM-DD');

export const altaTutorSchema = z.object({
  nombre: z.string().min(2, 'El nombre es obligatorio'),
  email: z.string().email('Correo no valido'),
  projectIds: z.array(z.number().int()).min(1, 'Elige al menos un proyecto'),
  dniNif: z.string().max(32).optional().nullable(),
  iban: z.string().max(40).optional().nullable(),
  telefono: z.string().max(32).optional().nullable(),
  notas: z.string().optional().nullable(),
});

export const perfilSchema = z.object({
  dniNif: z.string().max(32).optional().nullable(),
  iban: z.string().max(40).optional().nullable(),
  telefono: z.string().max(32).optional().nullable(),
  notas: z.string().optional().nullable(),
});

export const colaboracionSchema = z.object({
  tutorId: z.number().int(),
  productId: z.number().int(),
  // El porcentaje es obligatorio a proposito, sin valor por defecto silencioso:
  // que alguien se deje el campo y acabe cobrando el 10% sin haberlo decidido
  // es justo el tipo de error que luego cuesta dinero y discusiones.
  pct: z.number().min(0, 'El porcentaje no puede ser negativo').max(100, 'Como mucho el 100%'),
  desde: fecha,
  hasta: fecha.optional().nullable(),
  notas: z.string().optional().nullable(),
}).refine((d) => !d.hasta || d.hasta >= d.desde, {
  message: 'La fecha de fin no puede ser anterior a la de inicio',
  path: ['hasta'],
});

export const editarColaboracionSchema = z.object({
  pct: z.number().min(0).max(100).optional(),
  desde: fecha.optional(),
  hasta: fecha.optional().nullable(),
  activa: z.boolean().optional(),
  notas: z.string().optional().nullable(),
});

export const ajustesSchema = z.object({
  aplicaDesde: fecha.optional(),
  pctPorDefecto: z.number().min(0).max(100).optional(),
});
