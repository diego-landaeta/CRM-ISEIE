import { z } from 'zod';

const PAYMENT_METHODS = ['transferencia', 'tarjeta', 'efectivo', 'fraccionado'];

// POST /api/sales — registro de venta histórica o del día.
// Por la fecha (< hoy o = hoy) el backend infiere si es retroactiva (etiqueta interna).
// Crea: lead manual + status convertido + conversion + pago si importe_pagado > 0.
export const createSaleSchema = z.object({
  project_id: z.number().int().positive('project_id requerido'),
  // lead_id opcional: si viene, se salta createManualLead y se crea la conversion
  // sobre ese lead (caso "cliente existente, busca y selecciona"). Si no viene,
  // se crea lead nuevo con nombre+email/telefono.
  lead_id: z.number().int().positive().optional().nullable(),
  nombre: z.string().min(1, 'Nombre requerido').max(200).optional(),
  email: z.string().email('Email inválido').transform((v) => v.toLowerCase().trim()).optional().nullable().or(z.literal('')),
  telefono: z.string().max(50).optional().nullable().or(z.literal('')),
  // Documento fiscal para factura (NIF/CIF/NIE/cédula/RFC/etc) — opcional.
  identificacion_fiscal: z.string().max(50).optional().nullable().or(z.literal('')),
  producto_interes_id: z.number().int().positive('Producto requerido'),
  importe_total: z.number().positive('Importe debe ser positivo'),
  importe_pagado: z.number().min(0).optional(),
  metodo_pago: z.enum(PAYMENT_METHODS).optional().nullable(),
  fecha_pago: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato fecha: YYYY-MM-DD'),
  notas: z.string().max(2000).optional().nullable(),
  // Cuotas para pago fraccionado. Validado además en el service que sumen el total.
  installments: z.array(z.object({
    importe_previsto: z.number().positive('Importe de cuota debe ser > 0'),
    fecha_vencimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato fecha de cuota: YYYY-MM-DD'),
  })).optional(),
}).refine(
  (d) => d.lead_id || (d.nombre && ((d.email && d.email.length > 0) || (d.telefono && d.telefono.length > 0))),
  { message: 'Selecciona un cliente existente o proporciona nombre + email/teléfono', path: ['nombre'] }
).refine(
  // Si metodo_pago='fraccionado', exigimos al menos 2 cuotas y que sumen el total.
  (d) => {
    if (d.metodo_pago !== 'fraccionado') return true;
    if (!Array.isArray(d.installments) || d.installments.length < 2) return false;
    const sum = d.installments.reduce((a, it) => a + it.importe_previsto, 0);
    return Math.abs(sum - d.importe_total) < 0.01;
  },
  { message: 'Pago fraccionado requiere ≥2 cuotas que sumen el importe_total', path: ['installments'] }
);
