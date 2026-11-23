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

/*
  El embudo (CRM#987): el periodo, de un día a otro (AAAA-MM-DD, los dos
  incluidos). Sin fechas, el mes en curso. El campus, como el listado.
*/
const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha va como AAAA-MM-DD')
  // Que exista de verdad: el 30 de febrero no (Date lo pasaría al 2 de marzo).
  .refine((s) => { const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; }, 'Esa fecha no existe');
export const embudoSchema = z.object({
  projectId: id.optional(),
  issuerId: id.optional(),
  projectIds: z.string().regex(/^\d+(,\d+)*$/, 'projectIds: números separados por comas').optional(),
  desde: dia.optional(),
  hasta: dia.optional(),
}).refine((b) => !b.desde || !b.hasta || b.desde <= b.hasta, 'La fecha de inicio no puede ir después de la del final')
  .refine((b) => !b.desde || !b.hasta || (Date.parse(b.hasta) - Date.parse(b.desde)) / 86400000 <= 731, 'Como mucho dos años de una vez');

export const configQuerySchema = z.object({ projectId: id });

/** Las ventas de un prospecto (o del de una venta), para el asistente de crear link. */
export const ventasProspectoSchema = z.object({ leadId: id.optional(), conversionId: id.optional() })
  .refine((b) => b.leadId || b.conversionId, 'Falta el prospecto o la venta');

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
  'cuotas_max', 'monedas', 'moneda_defecto', 'cobro_auto', 'cobro_auto_reintento_dias',
  'aviso_abierto_horas', 'recordatorios'];

export const configBodySchema = z.object({
  projectId: id,
  descuento_max_pct: porcentaje.optional(),
  caducidad_dias: entero('Caducidad por defecto', 1, 365).optional(),
  caducidad_max_dias: entero('Caducidad máxima', 1, 365).optional(),
  cuotas_admitidas: z.boolean({ invalid_type_error: 'Cuotas admitidas: sí o no' }).optional(),
  cuotas_max: entero('Máximo de cuotas', 2, 36).optional(),
  monedas: z.array(moneda).min(1, 'Al menos una moneda').max(20, 'Como mucho 20 monedas').optional(),
  moneda_defecto: moneda.optional(),
  // Cobro automático de las cuotas (309): si el campus lo permite y a los cuántos
  // días se reintenta, una vez, una cuota que falló (0 = no se reintenta).
  cobro_auto: z.boolean({ invalid_type_error: 'Cobro automático: sí o no' }).optional(),
  cobro_auto_reintento_dias: entero('Reintento', 0, 15).optional(),
  // Seguimiento de los que no se pagan (gemela de CRM#984): a las cuántas horas de
  // abrirlo sin pagar se avisa a la gestora, y si se manda el recordatorio de 24 y 72 h.
  aviso_abierto_horas: entero('Aviso a la gestora', 1, 72).optional(),
  recordatorios: z.boolean({ invalid_type_error: 'Recordatorios: sí o no' }).optional(),
}).refine((b) => CAMPOS_DE_CONFIG.some((k) => b[k] !== undefined), 'Falta el descuento');

/*
  Crear un link. Para un prospecto, para una venta o, desde el 20/11 (Carlos:
  «sin nombre de la persona»), para nadie todavía: solo el campus y el curso.
  Con la venta, el prospecto y el campus salen de ella; sin persona, el campus
  que se mande tiene que ser uno de los de quien lo crea (lo mira el
  controlador).

  `modalidad: 'cuotas'` con `num_cuotas` (de 2 al máximo del campus): el link
  cobra la primera cuota y guarda la tarjeta; Stripe cobra las demás solas.

  OTRO IMPORTE, DESCUENTO E INICIAL (CRM#982, Diego 21/11):
    · `precio_original`: el precio antes del descuento (sale del catálogo y se
      puede cambiar). Con `descuento_tipo` ('monto' en € o 'pct') y
      `descuento_valor`, el total es el precio menos el descuento, y `importe`
      tiene que ser ese total al céntimo: el servidor no se fía de la cuenta del
      navegador, la rehace.
    · `inicial` (solo en cuotas): lo que cobra el link al pagarlo. Entonces
      `num_cuotas` son las cuotas de DESPUÉS (de 1 al máximo del campus), sobre lo
      que queda: total menos inicial, en cuotas iguales.
*/
const importeEnEuros = (nombre) => z.preprocess(comoNumero,
  z.number({ invalid_type_error: `${nombre} tiene que ser un número`, required_error: `Falta ${nombre.toLowerCase()}` })
    .finite()
    .positive(`${nombre} tiene que ser mayor que 0`)
    // Stripe no cobra más de 999.999,99 de una vez.
    .max(999999.99, `${nombre} no puede pasar de 999.999,99`)
    .refine(dosDecimales, 'Dos decimales como mucho'));

export const TIPOS_DE_DESCUENTO = ['monto', 'pct'];

/**
 * El total de un precio con su descuento, en céntimos y con enteros (como lo
 * guarda la venta). `monto`: euros (o la moneda del link); `pct`: porcentaje con
 * dos decimales. `{ total, descuento }` en unidades, o null si el descuento pasa
 * del precio. Lo usa también el asistente (la misma cuenta, en el frontal).
 */
export function totalConDescuento({ precio, tipo, valor }) {
  const precioC = Math.round(Number(precio) * 100);
  let descC = 0;
  if (tipo === 'monto') descC = Math.round(Number(valor) * 100);
  else if (tipo === 'pct') descC = Math.round((precioC * Math.round(Number(valor) * 100)) / 10000);
  if (!(precioC > 0) || descC < 0 || descC > precioC) return null;
  return { total: (precioC - descC) / 100, descuento: descC / 100 };
}

/*
  LAS CUOTAS CON SU FECHA (Diego, 23/11/2026: «el link de pago debe dejar crear
  cuotas y elegir las fechas sí o sí»). Con inicial, la gestora puede mandar
  `cuotas`: una fila por cuota de después de la inicial, con su importe (repartido
  a partes iguales y editable) y su fecha (una al mes de serie, editable). Tantas
  como `num_cuotas`, que entre todas sumen lo que queda tras la inicial y cada una
  después de la anterior. Que la primera sea de mañana en adelante lo mira el
  servicio (necesita el día de hoy en Madrid).
*/
const fechaDeCuota = z.string({ required_error: 'Falta la fecha de la cuota', invalid_type_error: 'La fecha va como AAAA-MM-DD' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha va como AAAA-MM-DD')
  // Que exista de verdad: el 30 de febrero no (Date lo pasaría al 2 de marzo).
  .refine((s) => { const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; }, 'Esa fecha no existe');
const cuotaDelPlan = z.object({ importe: importeEnEuros('El importe de la cuota'), vence: fechaDeCuota });
const centimos = (n) => Math.round(Number(n) * 100);

export const crearSchema = z.object({
  leadId: id.optional(),
  conversionId: id.optional(),
  projectId: id.optional(),
  productId: id,
  importe: importeEnEuros('El importe'),
  moneda: moneda.optional(),
  caducidad_dias: entero('Caducidad', 1, 365).optional(),
  modalidad: z.enum(['unico', 'cuotas']).optional().default('unico'),
  // Sin inicial (los links de antes del 21/11): de 2 en adelante, la primera la cobra el link.
  // Con inicial: las de después, de 1 en adelante. El máximo de cada campus lo mira el servicio.
  num_cuotas: entero('Número de cuotas', 1, 36).optional(),
  precio_original: importeEnEuros('El precio').optional(),
  descuento_tipo: z.enum(TIPOS_DE_DESCUENTO, {
    errorMap: () => ({ message: 'El descuento va en € («monto») o en % («pct»)' }),
  }).optional(),
  descuento_valor: z.preprocess(comoNumero,
    z.number({ invalid_type_error: 'El descuento tiene que ser un número' })
      .finite()
      .min(0, 'El descuento no puede ser negativo')
      .refine(dosDecimales, 'Dos decimales como mucho')).optional(),
  inicial: importeEnEuros('La inicial').optional(),
  cuotas: z.array(cuotaDelPlan).min(1, 'Falta alguna cuota').max(36, 'Como mucho 36 cuotas').optional(),
}).refine((b) => b.leadId || b.conversionId || b.projectId, 'Falta el campus, el prospecto o la venta')
  .refine((b) => b.modalidad !== 'cuotas' || b.num_cuotas, 'Di en cuántas cuotas')
  .refine((b) => b.modalidad === 'cuotas' || !b.num_cuotas, 'Las cuotas solo van con «cuotas»')
  .refine((b) => b.modalidad === 'cuotas' || b.inicial === undefined, 'La inicial solo va con «cuotas»')
  .refine((b) => b.modalidad !== 'cuotas' || b.inicial !== undefined || !(b.num_cuotas < 2), 'Sin inicial, de 2 cuotas en adelante')
  .refine((b) => b.inicial === undefined || Math.round(b.inicial * 100) < Math.round(b.importe * 100),
    'La inicial tiene que ser menor que el total')
  .refine((b) => b.cuotas === undefined || (b.modalidad === 'cuotas' && b.inicial !== undefined),
    'Las fechas de las cuotas van con «inicial + cuotas»')
  .refine((b) => b.cuotas === undefined || b.cuotas.length === b.num_cuotas, 'Tiene que haber una fecha por cuota')
  .refine((b) => b.cuotas === undefined || b.inicial === undefined
    || b.cuotas.reduce((t, c) => t + centimos(c.importe), 0) === centimos(b.importe) - centimos(b.inicial),
  'Las cuotas no suman lo que queda tras la inicial: vuelve a repartirlas')
  .refine((b) => b.cuotas === undefined || b.cuotas.every((c, i) => i === 0 || c.vence > b.cuotas[i - 1].vence),
    'Cada cuota tiene que ir después de la anterior')
  .refine((b) => (b.descuento_tipo === undefined) === (b.descuento_valor === undefined), 'Di el descuento y si es en € o en %')
  .refine((b) => b.descuento_tipo === undefined || b.precio_original !== undefined, 'Con descuento, falta el precio del que sale')
  .refine((b) => b.descuento_tipo !== 'pct' || b.descuento_valor <= 100, 'El descuento no puede pasar del 100 %')
  .refine((b) => b.descuento_tipo !== 'monto' || Math.round(b.descuento_valor * 100) <= Math.round(b.precio_original * 100),
    'El descuento no puede superar el precio')
  .refine((b) => {
    if (b.precio_original === undefined) return true;
    const t = totalConDescuento({ precio: b.precio_original, tipo: b.descuento_tipo, valor: b.descuento_valor });
    return !!t && Math.round(t.total * 100) === Math.round(b.importe * 100);
  }, 'El total no cuadra con el precio y el descuento: vuelve a calcularlo');

/** ¿Se puede crear un link en cuotas en este campus? (el asistente lo pregunta antes). */
export const cuotasQuerySchema = z.object({ projectId: id });

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

// «Generar plan de pago» (Diego, 19/11): la venta y, si se eligen, qué cuotas.
// Sin `cuotaIds`, todas las pendientes que aún no tengan link vivo.
export const planQuerySchema = z.object({ conversionId: id });
export const planBodySchema = z.object({
  conversionId: id,
  cuotaIds: z.array(id).min(1, 'Elige al menos una cuota').max(60).optional(),
  // «Cobrar automáticamente con Stripe en las fechas de las cuotas» (309).
  cobroAutomatico: z.boolean({ invalid_type_error: 'Cobro automático: sí o no' }).optional(),
});

/** Ver o cambiar el cobro automático de una venta (309). */
export const cobroAutoQuerySchema = z.object({ conversionId: id });
export const cobroAutoBodySchema = z.object({
  conversionId: id,
  activo: z.boolean({ required_error: 'Falta decir si se activa', invalid_type_error: 'Activo: sí o no' }),
});
