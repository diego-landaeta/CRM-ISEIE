import { z } from 'zod';

// 'deposito' (depósito bancario) desde el 15/10: con 'transferencia', las dos
// formas de cobro que disparan el webhook de transferencias (migración 206).
export const PAYMENT_METHODS = ['transferencia', 'deposito', 'tarjeta', 'tarjeta_stripe', 'efectivo', 'bizum', 'paypal', 'fraccionado', 'otro'];

/** AAAA-MM-DD y que exista de verdad (ni 2026-02-30 ni «hola»). */
export const fechaReal = (requerida) => z
  .string({ required_error: requerida, invalid_type_error: requerida })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'la fecha va como AAAA-MM-DD')
  .refine((v) => {
    const d = new Date(`${v}T12:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'esa fecha no existe');

/*
 * La fecha de inicio del curso (#767, paso 1). Con ella se programa la
 * matrícula en Moodle: el día anterior. OBLIGATORIA en las dos rutas del
 * formulario que cierra una venta (POST /api/conversions y POST /api/ventas).
 * Los caminos sin nadie delante (compra directa, links de pago, Conciliación,
 * plataformas de IA) crean la venta por el servicio, sin pasar por aquí, y
 * siguen sin ella: entonces la matrícula va con el pago.
 *
 * Una fecha pasada vale: hay ventas de cursos ya empezados. La matrícula se
 * hace entonces al confirmarse el pago (`MOMENTO_SQL` toma la más tardía).
 */
export const FALTA_FECHA_INICIO = 'Falta la fecha de inicio del curso (fecha_inicio): con ella se programa la matrícula en Moodle';
export const fechaInicioCurso = () => fechaReal(FALTA_FECHA_INICIO);

// La referencia del banco de una transferencia o un depósito (nº de operación).
const referencia = z.string().trim().max(120).optional().nullable();

const conversionItemSchema = z.object({
  product_id: z.number().int().positive().optional().nullable(),
  descripcion: z.string().min(1).max(500),
  cantidad: z.number().int().positive().default(1),
  precio_unitario: z.number().nonnegative(),
});

export const createConversionSchema = z.object({
  lead_id: z.number().int().positive('lead_id requerido'),
  project_id: z.number().int().positive('project_id requerido'),
  producto_contratado: z.string().min(1, 'Producto requerido').max(255),
  producto_contratado_id: z.number().int().positive().nullable().optional(),
  importe_total: z.number().positive('Importe debe ser positivo'),
  importe_pagado: z.number().min(0).default(0),
  metodo_pago: z.enum(PAYMENT_METHODS).optional().nullable(),
  metodo_pago_inicial: z.enum(PAYMENT_METHODS).optional().nullable(),
  fecha_compromiso_pago: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato fecha: YYYY-MM-DD').optional().nullable(),
  fecha_conversion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato fecha: YYYY-MM-DD').optional(),
  notas_pago: z.string().max(2000).optional().nullable(),
  // Inicio del curso pactado con el alumno (#767): la matrícula en Moodle va el
  // día anterior. Obligatoria: esta ruta es la del formulario «Nueva venta».
  fecha_inicio: fechaInicioCurso(),
  // Multi-item + IVA + descuento
  items: z.array(conversionItemSchema).optional(),
  iva_pct: z.number().min(0).max(100).optional(),
  iva_incluido: z.boolean().optional(),
  iva_exento: z.boolean().optional(),
  descuento_tipo: z.enum(['none', 'pct', 'monto']).optional(),
  descuento_valor: z.number().min(0).optional(),
  subtotal_bruto: z.number().min(0).optional(),
  // Crear la venta aunque el alumno ya tenga una de este programa (CRM#898).
  forzar: z.boolean().optional(),
}).refine((d) => d.importe_pagado <= d.importe_total + 0.01, {
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
  // Se puede poner o cambiar; null la quita (la matrícula iría con el pago).
  fecha_inicio: fechaInicioCurso().nullable().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'Al menos un campo requerido' });

export const createPaymentSchema = z.object({
  importe: z.number().positive('Importe debe ser positivo'),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato fecha: YYYY-MM-DD').optional(),
  notas: z.string().max(500).optional().nullable(),
  metodo: z.enum(PAYMENT_METHODS).optional().nullable(),
  referencia,
  // Confirmacion explicita cuando de verdad son dos cobros iguales seguidos.
  permitir_duplicado: z.boolean().optional(),
});

// Cobrar una cuota. Antes el controlador leia el cuerpo sin validar: el método
// podia ser cualquier texto.
export const payInstallmentSchema = z.object({
  fecha_cobro: z.string({ required_error: 'fecha_cobro requerida' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato fecha: YYYY-MM-DD'),
  importe_cobrado: z.coerce.number().positive('Importe debe ser positivo').optional().nullable(),
  metodo: z.enum(PAYMENT_METHODS).optional().nullable(),
  notas: z.string().max(500).optional().nullable(),
  referencia,
  // «Apuntarlo igualmente» tras el aviso de posible duplicado (CRM#888).
  confirmar: z.boolean().optional(),
});

// Editar el pago de una cuota ya cobrada: fecha, importe y, desde el 15/10, la
// forma de pago y la referencia.
export const editPaidInstallmentSchema = z.object({
  fecha_cobro: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato fecha: YYYY-MM-DD').optional(),
  importe_cobrado: z.coerce.number().positive('Importe debe ser positivo').optional(),
  metodo: z.enum(PAYMENT_METHODS).optional().nullable(),
  referencia,
}).refine((d) => Object.keys(d).length > 0, { message: 'Indica fecha_cobro, importe_cobrado o metodo' });

// ── Generar el plan de cuotas (CRM#923) ──────────────────────────────────────
// Antes el controlador leía el cuerpo sin validar y el modelo lanzaba un Error
// suelto dentro de la transacción: una cuota mal escrita daba 500 (y ensuciaba
// los avisos de 5xx), y `num_cuotas: "abc"` borraba el plan sin crear otro.

// `fechaReal` está arriba del todo: la usa también la venta (fecha de inicio).

/** Un número, aunque llegue como texto («50»), pero no «abc» ni vacío. */
const numero = (falta, noEs) => z.preprocess(
  (v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v),
  z.number({ required_error: falta, invalid_type_error: noEs }).finite(noEs),
);

const concepto = z.string().max(500).optional().nullable();

// Modo «cuotas a medida»: cada cuota con su importe y su fecha.
export const cuotaAMedidaSchema = z.object({
  importe_previsto: numero('falta el importe (importe_previsto)', 'el importe no es un número').refine((n) => n > 0, 'el importe tiene que ser mayor que 0'),
  fecha_vencimiento: fechaReal('falta la fecha de vencimiento (fecha_vencimiento)'),
});

export const cuotasAMedidaSchema = z.object({
  installments: z.array(cuotaAMedidaSchema).min(1, 'Añade al menos una cuota').max(120, 'Como mucho 120 cuotas'),
  concepto,
});

// Modo automático: N cuotas iguales, mensuales, desde fecha_inicio.
export const cuotasIgualesSchema = z.object({
  num_cuotas: numero('num_cuotas requerido', 'num_cuotas no es un número')
    .refine((n) => Number.isInteger(n) && n >= 1, 'num_cuotas tiene que ser un entero mayor o igual que 1')
    .refine((n) => n <= 120, 'Como mucho 120 cuotas'),
  importe_total: numero('importe_total requerido', 'importe_total no es un número').refine((n) => n > 0, 'importe_total tiene que ser mayor que 0'),
  fecha_inicio: fechaReal('fecha_inicio requerida'),
  concepto,
});

/** «Cuota 2: falta la fecha…» o el mensaje tal cual, para el primer fallo. */
export function mensajeDeCuotas(error) {
  const e = error.errors[0];
  const [campo, i] = e.path;
  return campo === 'installments' && Number.isInteger(i) ? `Cuota ${i + 1}: ${e.message}` : e.message;
}

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
  // Filtro por producto: hasta ahora se hacia en el navegador sobre las filas
  // cargadas, asi que con paginacion dejaba fuera el resto.
  producto: z.string().max(255).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
