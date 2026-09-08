import { z } from 'zod';

// Los canales que el documento nombra. Es una lista cerrada porque de ella
// depende que el paso sepa por donde se arranca —«se arranca con llamada por
// centralita virtual; si falla, WhatsApp»— y un canal inventado dejaria ese
// orden sin significado.
export const CANALES = ['llamada', 'whatsapp', 'email', 'wasapi'];

const vacioEsNulo = (v) => (v === '' || Number.isNaN(v) ? null : v);

const diaOpcional = z.preprocess(
  vacioEsNulo,
  z.coerce.number().int().min(0).max(365).nullable().optional()
);

export const crearPasoSchema = z.object({
  // Minusculas, numeros y guion bajo: es un identificador, no un titulo.
  clave: z.string().min(1).max(60).regex(/^[a-z0-9_]+$/,
    'La clave solo admite minúsculas, números y guión bajo'),
  nombre: z.string().min(1).max(160),
  orden: z.coerce.number().int().min(1).max(999).optional(),
  cuando: z.string().max(120).nullable().optional().or(z.literal('')),
  dia_desde: diaOpcional,
  dia_hasta: diaOpcional,
  canales: z.array(z.enum(CANALES)).max(6).optional(),
  es_seguimiento: z.coerce.boolean().optional(),
  nota: z.string().max(2000).nullable().optional().or(z.literal('')),
}).refine(
  (d) => d.dia_desde == null || d.dia_hasta == null || d.dia_hasta >= d.dia_desde,
  { message: 'El día final no puede ser anterior al inicial', path: ['dia_hasta'] }
);

export const editarPasoSchema = z.object({
  nombre: z.string().min(1).max(160).optional(),
  orden: z.coerce.number().int().min(1).max(999).optional(),
  cuando: z.string().max(120).nullable().optional().or(z.literal('')),
  dia_desde: diaOpcional,
  dia_hasta: diaOpcional,
  canales: z.array(z.enum(CANALES)).max(6).optional(),
  es_seguimiento: z.coerce.boolean().optional(),
  nota: z.string().max(2000).nullable().optional().or(z.literal('')),
  activo: z.coerce.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, {
  message: 'Hay que mandar al menos un campo',
});

export const reordenarSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(50),
});

// Mover de fecha o saltarse un paso de la agenda de alguien (#89).
export const ajustarPasoSchema = z.object({
  estado: z.enum(['pendiente', 'saltado']).optional(),
  fecha_prevista: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha va como AAAA-MM-DD').optional(),
  nota: z.string().trim().max(500).optional(),
}).refine((d) => d.estado || d.fecha_prevista || d.nota, {
  message: 'Hay que cambiar algo: el estado, la fecha o la nota',
});
