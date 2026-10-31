import { z } from 'zod';

// Facturas de colaboradores (#202). Lo que llega de la pantalla de
// administración, comprobado aquí y no como 500 en la base.

export const AREAS = ['soporte', 'desarrollo', 'wordpress', 'seo', 'contenido', 'otra'];

const id = z.number().int().positive().max(2147483647);

// El primer día de un mes: «2026-09-01». Se acepta «2026-09» y se completa.
const mes = z.string().trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])(-01)?$/, 'Mes inválido: usa AAAA-MM')
  .transform((v) => (v.length === 7 ? `${v}-01` : v));

const importe = z.number().nonnegative('El importe no puede ser negativo').max(9999999999.99).nullable();
const tarifa = z.number().nonnegative('La tarifa no puede ser negativa').max(99999999.99).nullable();
const pct = z.number().min(0, 'El porcentaje va de 0 a 100').max(100, 'El porcentaje va de 0 a 100').nullable();

// Cómo cobra de esa empresa («Añadido 01/10 (tarde)»): fijo, por hora o por
// proyecto (por horas). Sin modalidad, como las fichas de la primera parte.
export const MODALIDADES = ['fijo', 'hora', 'proyecto'];

// En qué moneda se acuerda y se factura (247, 31/10): Andrea factura a CEDIA en dólares.
export const MONEDAS = ['EUR', 'USD'];

const empresa = z.object({
  issuer_id: id,
  importe_acordado: importe.optional(),
  moneda: z.enum(MONEDAS, { message: 'Moneda inválida: EUR o USD' }).optional(),
  modalidad: z.enum(MODALIDADES, { message: `Modalidad inválida: ${MODALIDADES.join(', ')}` }).nullable().optional(),
  importe_fijo: importe.optional(),
  tarifa_hora: tarifa.optional(),
  iva_pct: pct.optional(),
  irpf_pct: pct.optional(),
}).superRefine((e, ctx) => {
  if (!e.modalidad) return;
  const falta = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });
  // «Según la ficha del colaborador»: sin ellos no se puede calcular. El 0 vale.
  if (e.iva_pct == null) falta('iva_pct', 'Pon el IVA % de su factura (0 si factura desde fuera)');
  if (e.irpf_pct == null) falta('irpf_pct', 'Pon el IRPF % de su factura (0 si no lleva)');
  if (e.modalidad === 'fijo' && e.importe_fijo == null) falta('importe_fijo', 'Pon el importe fijo de cada mes');
  if (e.modalidad !== 'fijo' && e.tarifa_hora == null) falta('tarifa_hora', 'Pon su tarifa por hora');
});

// Un texto opcional: vacío se guarda como null, pero si NO llega se queda sin
// tocar (undefined). Antes se convertía en null también cuando no llegaba, y un
// cambio de solo el nombre borraba el NIF y las notas.
const textoOpcional = (max) => z.string().trim().max(max, `Demasiado largo: ${max} caracteres como mucho`).nullable().optional()
  .transform((v) => (v === undefined ? undefined : v || null));

const base = {
  nombre: z.string().trim().min(2, 'El nombre es obligatorio').max(200, 'El nombre es demasiado largo'),
  email: z.string().trim().toLowerCase().email('Correo inválido').max(255, 'El correo es demasiado largo'),
  nif: textoOpcional(30),
  area: z.enum(AREAS, { message: `Área inválida: ${AREAS.join(', ')}` }),
  notas: textoOpcional(5000),
  user_id: id.optional().nullable(),
  alta_desde: mes.optional().nullable(),
};

export const crearColaboradorSchema = z.object({
  ...base,
  area: base.area.default('otra'),
  empresas: z.array(empresa).min(1, 'Elige al menos una empresa a la que factura'),
});

export const editarColaboradorSchema = z.object({
  nombre: base.nombre.optional(),
  email: base.email.optional(),
  nif: base.nif,
  area: base.area.optional(),
  notas: base.notas,
  user_id: base.user_id,
  alta_desde: base.alta_desde,
  empresas: z.array(empresa).min(1, 'Elige al menos una empresa a la que factura').optional(),
}).refine((d) => Object.values(d).some((v) => v !== undefined), { message: 'No se envió ningún campo para cambiar' });

export const bajaSchema = z.object({
  desde: mes,
});

// Volver a darlo de alta, desde un mes («desde qué mes entra», definición del 01/10).
export const altaSchema = z.object({
  desde: mes,
});

export const listarColaboradoresSchema = z.object({
  issuerId: z.coerce.number().int().positive().optional(),
  estado: z.enum(['activos', 'de_baja', 'todos']).default('activos'),
  q: z.string().trim().max(100, 'La búsqueda es demasiado larga').optional(),
});

// ─── Las facturas del mes ───

/**
 * El importe tal como lo escribe la persona, a número (texto con punto decimal).
 *   «1.234,56», «1,234.56» → con los dos, el decimal es el que va último.
 *   «600,50», «12,500»     → solo coma: es el decimal (12,5).
 *   «1.200», «12.500»      → solo punto y separa grupos de tres: miles.
 *   «600.50», «600»        → si no, el punto es el decimal.
 * Se aplica una sola vez, en el servidor: la pantalla manda lo escrito tal cual.
 */
export function normalizarImporte(texto) {
  const t = String(texto).trim().replace(/\s|€|\$/g, '');
  const coma = t.lastIndexOf(',');
  const punto = t.lastIndexOf('.');
  // Con los dos, el decimal es el que va último: «1.234,56» y «1,234.56».
  if (coma >= 0 && punto >= 0) {
    return coma > punto ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  }
  if (coma >= 0) return t.replace(',', '.');
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return t.replace(/\./g, '');
  return t;
}

// Lo que manda el colaborador con el archivo. Llega por multipart: todo texto.
export const subidaSchema = z.object({
  importe: z.string().trim().min(1, 'Escribe el importe de tu factura')
    // Solo cifras, puntos, comas, espacios, «€» y «$»: «0x10» o «1e5» no son un importe (revisión del 10/10).
    .regex(/^[\d.,\s€$]+$/, 'Escribe el importe solo con cifras')
    .transform((v) => Number(normalizarImporte(v)))
    .refine((n) => Number.isFinite(n) && n >= 0 && n <= 9999999999.99, 'Importe inválido'),
  // Si no llega, la de su ficha (247).
  moneda: z.enum(MONEDAS, { message: 'Moneda inválida: EUR o USD' }).optional(),
  numero_factura: z.string().trim().min(1, 'Escribe el número de tu factura').max(60, 'El número de factura es demasiado largo: 60 caracteres como mucho'),
  // El desglose (segunda parte): las horas, si cobra por hora; las líneas
  // (JSON), si cobra por proyecto. Lo comprueba y lo calcula desglose.js.
  horas: z.string().trim().max(20, 'Horas inválidas').optional(),
  // El mismo tope que la subida (multer, fieldSize 10 000): más largo no llega aquí.
  lineas: z.string().max(10_000, 'El desglose es demasiado largo: acorta los encargos o júntalos en menos').optional(),
});

export const delMesSchema = z.object({
  periodo: mes,
  issuerId: z.coerce.number().int().positive().optional(),
  estado: z.enum(['sin_enviar', 'enviado', 'abierto', 'recibida', 'anulada', 'no_enviado', 'caducado']).optional(),
  area: z.enum(AREAS).optional(),
});

// Las pestañas de la segunda parte: «filtrable por colaborador, empresa, mes y estado».
export const VISTAS = ['enviadas', 'por_pagar', 'pagadas', 'historial'];
export const vistaSchema = z.object({
  vista: z.enum(VISTAS, { message: `Pestaña inválida: ${VISTAS.join(', ')}` }),
  issuerId: z.coerce.number().int().positive().max(2147483647).optional(),
  colaboradorId: z.coerce.number().int().positive().max(2147483647).optional(),
  periodo: mes.optional(),
  estado: z.enum(['sin_enviar', 'enviado', 'abierto', 'recibida', 'anulada', 'no_enviado', 'caducado', 'no_cuadra']).optional(),
});

export const costePorCampusSchema = z.object({ periodo: mes, issuerId: z.coerce.number().int().positive().max(2147483647).optional() });

// El ZIP del mes: de una empresa («facturas-colaboradores_2026-09_CEDIA.zip»).
export const zipSchema = z.object({ periodo: mes, issuerId: z.coerce.number().int().positive().max(2147483647) });

export const anularSchema = z.object({
  motivo: z.string().trim().min(3, 'Escribe el motivo de la anulación').max(1000, 'El motivo es demasiado largo: 1000 caracteres como mucho'),
});

// ─── El pago (segunda parte, «Marcar pagada») ───

export const FORMAS_PAGO = ['transferencia', 'bizum', 'paypal', 'efectivo', 'otro'];

/** Hoy en Madrid, «AAAA-MM-DD»: la fecha del pago no puede ser posterior. */
const hoyEnMadrid = () => new Date().toLocaleDateString('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Europe/Madrid' });

// Llega por multipart (con el justificante, si se adjunta): todo texto.
export const pagarSchema = z.object({
  // «Se puede marcar una o varias a la vez»: «12» o «12,13,14».
  ids: z.string().trim().min(1, 'Elige al menos una factura')
    .transform((v) => [...new Set(v.split(',').map((x) => Number(x.trim())))])
    .refine((l) => l.length >= 1 && l.length <= 200 && l.every((n) => Number.isInteger(n) && n > 0 && n <= 2147483647),
      'Facturas inválidas'),
  fecha: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida: usa AAAA-MM-DD')
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), 'Fecha inválida')
    .refine((v) => v <= hoyEnMadrid(), 'La fecha del pago no puede ser posterior a hoy'),
  forma_pago: z.enum(FORMAS_PAGO, { message: `Forma de pago inválida: ${FORMAS_PAGO.join(', ')}` }),
  referencia_pago: z.string().trim().max(100, 'La referencia es demasiado larga: 100 caracteres como mucho').optional().transform((v) => v || null),
});

export const deshacerPagoSchema = z.object({
  motivo: z.string().trim().min(3, 'Escribe por qué se deshace el pago').max(1000, 'El motivo es demasiado largo: 1000 caracteres como mucho'),
});
