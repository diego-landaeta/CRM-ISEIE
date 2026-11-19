import { z } from 'zod';

/** Los estados de un link (CHECK de la migración 314). */
export const ESTADOS = ['creado', 'abierto', 'pagado', 'pagado_parcial', 'caducado', 'anulado'];

// Hasta el máximo de un INTEGER de Postgres: más allá la consulta fallaba con un 500.
const id = z.coerce.number().int().positive().max(2147483647);

/*
  El listado. El campus (`projectId`, `projectIds`, `issuerId`) lo lee
  `listaDelAmbito` directamente de la petición y lo recorta a los campus de
  quien pide; aquí solo se comprueba el formato. `createdBy` se recorta además
  al alcance de la persona: una gestora que pide los de otra recibe los suyos.
*/
export const listarSchema = z.object({
  projectId: id.optional(),
  issuerId: id.optional(),
  projectIds: z.string().regex(/^\d+(,\d+)*$/, 'projectIds: números separados por comas').optional(),
  estado: z.enum(ESTADOS).optional(),
  leadId: id.optional(),
  conversionId: id.optional(),
  createdBy: id.optional(),
  page: z.coerce.number().int().min(1).max(1000000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});

export const idSchema = z.object({ id });

export const configQuerySchema = z.object({ projectId: id });

// Un número o un texto que sea un número (con punto o coma), y nada más. Sin
// `z.coerce`: convertía null y "" en 0 y true en 1 sin avisar.
const comoNumero = (v) => (typeof v === 'string' && /^\s*\d+([.,]\d+)?\s*$/.test(v) ? Number(v.trim().replace(',', '.')) : v);
// Con tolerancia: 2.3 * 100 da 229.99999999999997 en coma flotante.
const dosDecimales = (n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-9;

// Porcentaje sobre el precio del catálogo, con dos decimales como mucho.
const porcentaje = z.preprocess(comoNumero,
  z.number({ invalid_type_error: 'El descuento tiene que ser un número', required_error: 'Falta el descuento' })
    .finite()
    .min(0, 'El descuento no puede ser negativo')
    .max(100, 'El descuento no puede pasar del 100 %')
    .refine(dosDecimales, 'Dos decimales como mucho'));

// Un entero de verdad: ni null, ni "", ni true.
const entero = (nombre, min, max) => z.preprocess(
  (v) => (typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v),
  z.number({ invalid_type_error: `${nombre}: tiene que ser un número entero` })
    .int(`${nombre}: tiene que ser un número entero`)
    .min(min, `${nombre}: como poco ${min}`)
    .max(max, `${nombre}: como mucho ${max}`));

const moneda = z.string({ invalid_type_error: 'La moneda va en código ISO de tres letras (EUR, USD…)' })
  .trim().toUpperCase().regex(/^[A-Z]{3}$/, 'La moneda va en código ISO de tres letras (EUR, USD…)');

/*
  Lo que configura el admin en la tarjeta (fase 2). Todo opcional, pero algo hay
  que mandar; lo que no venga no se toca. Las reglas entre campos (la caducidad
  por defecto no pasa de la máxima, la moneda por defecto está entre las
  admitidas) se miran con lo ya guardado, en el controlador, y la base las
  vuelve a mirar con sus CHECK (migración 315).
*/
const CAMPOS_DE_CONFIG = ['descuento_max_pct', 'caducidad_dias', 'caducidad_max_dias', 'cuotas_admitidas',
  'cuotas_max', 'monedas', 'moneda_defecto'];

export const configBodySchema = z.object({
  projectId: id,
  descuento_max_pct: porcentaje.optional(),
  caducidad_dias: entero('Caducidad por defecto', 1, 365).optional(),
  caducidad_max_dias: entero('Caducidad máxima', 1, 365).optional(),
  cuotas_admitidas: z.boolean({ invalid_type_error: 'Cuotas admitidas: sí o no' }).optional(),
  cuotas_max: entero('Máximo de cuotas', 2, 36).optional(),
  monedas: z.array(moneda).min(1, 'Al menos una moneda').max(20, 'Como mucho 20 monedas').optional(),
  moneda_defecto: moneda.optional(),
}).refine((b) => CAMPOS_DE_CONFIG.some((k) => b[k] !== undefined), 'Falta el descuento');

/*
  Crear un link (fase 2: solo pago único). Para un prospecto o para una venta:
  con la venta, el prospecto y el campus salen de ella. El campus nunca sale de
  lo que mande el navegador.
*/
export const crearSchema = z.object({
  leadId: id.optional(),
  conversionId: id.optional(),
  productId: id,
  importe: z.preprocess(comoNumero,
    z.number({ invalid_type_error: 'El importe tiene que ser un número', required_error: 'Falta el importe' })
      .finite()
      .positive('El importe tiene que ser mayor que 0')
      // Stripe no cobra más de 999.999,99 de una vez.
      .max(999999.99, 'El importe no puede pasar de 999.999,99')
      .refine(dosDecimales, 'Dos decimales como mucho')),
  moneda: moneda.optional(),
  caducidad_dias: entero('Caducidad', 1, 365).optional(),
  modalidad: z.enum(['unico', 'cuotas']).optional().default('unico'),
}).refine((b) => b.leadId || b.conversionId, 'Falta el prospecto o la venta');

export const anularSchema = z.object({
  motivo: z.string({ required_error: 'Falta el motivo', invalid_type_error: 'Falta el motivo' }).trim()
    .min(3, 'Escribe por qué se anula').max(500, 'El motivo, en 500 caracteres como mucho'),
});

export const webhookAccionSchema = z.object({
  projectId: id,
  accion: z.enum(['anadir_eventos', 'activar', 'desactivar'], {
    errorMap: () => ({ message: 'Acción no válida: anadir_eventos, activar o desactivar' }),
  }),
});
