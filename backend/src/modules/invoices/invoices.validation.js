import { z } from 'zod';

const itemSchema = z.object({
  descripcion: z.string().min(1),
  cantidad: z.number().positive().default(1),
  precio_unitario: z.number().nonnegative(),
});

export const createInvoiceSchema = z.object({
  projectId: z.number().int().positive(),
  conversionId: z.number().int().positive().optional(),
  leadId: z.number().int().positive().optional(),
  serie: z.string().max(10).optional(),
  fechaEmision: z.string().optional(),
  clienteNombre: z.string().min(1, 'Nombre cliente requerido'),
  clienteNif: z.string().min(1, 'NIF/CIF requerido'),
  clienteDireccion: z.string().min(1, 'Dirección requerida'),
  clienteCiudad: z.string().min(1, 'Ciudad requerida'),
  clienteCp: z.string().min(1, 'Código postal requerido'),
  clientePais: z.string().min(1, 'País requerido'),
  clienteEmail: z.string().email().optional().nullable(),
  clienteTelefono: z.string().optional().nullable(),
  items: z.array(itemSchema).min(1, 'Al menos un item'),
  ivaPct: z.number().min(0).max(100).optional(),
  ivaIncluido: z.boolean().optional(),
  notas: z.string().optional(),
  leyendaIva: z.string().optional(),
  metodoPago: z.enum(['transferencia', 'tarjeta', 'tarjeta_stripe', 'efectivo', 'bizum', 'fraccionado', 'otro']),
  piePago: z.string().optional(),
});

export const setSequenceSchema = z.object({
  projectId: z.number().int().positive(),
  ano: z.number().int().min(2020).max(2100),
  serie: z.string().max(10).default('A'),
  ultimoNumero: z.number().int().min(0),
});

export const updateConfigSchema = z.object({
  projectId: z.number().int().positive(),
  piePagoDefault: z.string().optional(),
  serieDefault: z.string().max(10).optional(),
  metodoDefault: z.enum(['transferencia', 'tarjeta', 'tarjeta_stripe', 'efectivo', 'bizum', 'fraccionado', 'otro']).optional(),
});
