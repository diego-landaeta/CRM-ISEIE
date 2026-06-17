import { z } from 'zod';

const PAYMENT_METHODS = ['transferencia', 'tarjeta', 'efectivo', 'fraccionado'];

export const createConversionSchema = z.object({
  lead_id: z.number().int().positive('lead_id requerido'),
  project_id: z.number().int().positive('project_id requerido'),
  producto_contratado: z.string().min(1, 'Producto requerido').max(255),
  producto_contratado_id: z.number().int().positive().nullable().optional(),
  importe_total: z.number().positive('Importe debe ser positivo'),
  importe_pagado: z.number().min(0).default(0),
  metodo_pago: z.enum(PAYMENT_METHODS).optional().nullable(),
  fecha_compromiso_pago: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato fecha: YYYY-MM-DD').optional().nullable(),
  fecha_conversion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato fecha: YYYY-MM-DD').optional(),
  notas_pago: z.string().max(2000).optional().nullable(),
}).refine((d) => d.importe_pagado <= d.importe_total, {
  message: 'importe_pagado no puede ser mayor que importe_total',
  path: ['importe_pagado'],
});

export const updateConversionSchema = z.object({
  producto_contratado: z.string().min(1).max(255).optional(),
  producto_contratado_id: z.number().int().positive().nullable().optional(),
  importe_total: z.number().positive().optional(),
  metodo_pago: z.enum(PAYMENT_METHODS).nullable().optional(),
  fecha_compromiso_pago: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  fecha_conversion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notas_pago: z.string().max(2000).nullable().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'Al menos un campo requerido' });

export const createPaymentSchema = z.object({
  importe: z.number().positive('Importe debe ser positivo'),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato fecha: YYYY-MM-DD').optional(),
  notas: z.string().max(500).optional().nullable(),
});

export const listConversionsSchema = z.object({
  projectId: z.coerce.number().int().positive().optional(),
  leadId: z.coerce.number().int().positive().optional(),
  responsableId: z.coerce.number().int().positive().optional(),
  pendiente: z.enum(['true', 'false']).optional(),
  vencido: z.enum(['true', 'false']).optional(),
  // Conversions sin importe (importe_total = 0) — generalmente backfill que las
  // gestoras deben completar con el importe real de la venta.
  pendingBilling: z.enum(['true', 'false']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
