import { z } from 'zod';

export const crearTokenSchema = z.object({
  nombre: z.string().trim().min(1, 'Ponle un nombre al token (p. ej. «Claude del portátil»)').max(100),
});

export const idSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const accesoSchema = z.object({
  usa_mcp: z.boolean(),
});

/** Filtros de Conexión → MCP → Actividad (#195). */
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato AAAA-MM-DD');
export const actividadSchema = z.object({
  persona: z.coerce.number().int().positive().optional(),
  conexion: z.union([z.literal('personal'), z.coerce.number().int().positive()]).optional(),
  desde: fecha.optional(),
  hasta: fecha.optional(),
  herramienta: z.string().max(60).optional(),
  resultado: z.enum(['ok', 'error']).optional(),
  pagina: z.coerce.number().int().min(1).max(10000).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(50),
});

/** Interruptor de emergencia (#196). */
export const interruptorSchema = z.object({
  apagado: z.boolean(),
  motivo: z.string().trim().max(300).optional(),
});
