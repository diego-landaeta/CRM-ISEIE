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
  // 'proforma' = presupuesto no fiscal. 'normal' = factura. (rectificativa va por su ruta)
  tipo: z.enum(['normal', 'proforma']).optional(),
  // true = factura BORRADOR (preliminar sin numero fiscal; datos fiscales opcionales)
  borrador: z.boolean().optional(),
  serie: z.string().max(10).optional(),
  fechaEmision: z.string().optional(),
  clienteNombre: z.string().min(1, 'Nombre cliente requerido'),
  // En proforma los datos fiscales del cliente son opcionales (un presupuesto no
  // exige NIF ni dirección). En factura se exigen vía superRefine (abajo).
  clienteNif: z.string().optional().nullable(),
  clienteDireccion: z.string().optional().nullable(),
  clienteCiudad: z.string().optional().nullable(),
  clienteCp: z.string().optional().nullable(),
  clientePais: z.string().min(1, 'País requerido'),
  // Email tolerante: si viene vacío, '—' o con formato inválido → null (no bloquea
  // la emisión de la factura/proforma; muchos clientes no tienen email cargado).
  clienteEmail: z.preprocess(
    (v) => {
      if (typeof v !== 'string') return v ?? null;
      const t = v.trim();
      return (t && t.includes('@') && t.includes('.')) ? t : null;
    },
    z.string().optional().nullable(),
  ),
  clienteTelefono: z.string().optional().nullable(),
  items: z.array(itemSchema).min(1, 'Al menos un item'),
  ivaPct: z.number().min(0).max(100).optional(),
  ivaIncluido: z.boolean().optional(),
  notas: z.string().optional(),
  leyendaIva: z.string().optional(),
  metodoPago: z.enum(['transferencia', 'tarjeta', 'tarjeta_stripe', 'efectivo', 'bizum', 'fraccionado', 'otro']),
  piePago: z.string().optional(),
  issuerId: z.number().int().positive().optional(),
  // Moneda de la factura (opcional). Importes manuales en esa divisa, SIN conversión
  // automática. Por defecto EUR. Ej: 'USD', 'MXN', 'COP', 'CRC', 'ARS'.
  moneda: z.string().trim().min(3).max(8).optional(),
  // Doble moneda MANUAL. Si la factura va en divisa distinta del euro, el importe en
  // EUROS es obligatorio y es el que manda en la contabilidad (total). El importe en
  // divisa se guarda aparte solo para mostrarlo: "1.000,00 USD (920,00 €)".
  totalEur: z.number().nonnegative().optional().nullable(),
}).superRefine((d, ctx) => {
  const enDivisa = d.moneda && String(d.moneda).toUpperCase() !== 'EUR';
  if (enDivisa && (d.totalEur === undefined || d.totalEur === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['totalEur'],
      message: 'Indica el importe total en euros (obligatorio al facturar en otra divisa).' });
  }
  if (d.tipo === 'proforma') return; // presupuesto: datos fiscales opcionales
  if (d.borrador === true) return;   // borrador: se completa antes de emitir
  for (const [field, msg] of [
    ['clienteNif', 'NIF/CIF requerido'],
    ['clienteDireccion', 'Dirección requerida'],
    ['clienteCiudad', 'Ciudad requerida'],
    ['clienteCp', 'Código postal requerido'],
  ]) {
    if (!d[field] || !String(d[field]).trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: msg });
    }
  }
});

export const issuerSchema = z.object({
  projectId: z.number().int().positive().optional().nullable(),
  razonSocial: z.string().min(1, 'Razón social requerida'),
  nif: z.string().min(1, 'NIF requerido'),
  direccion: z.string().optional().nullable(),
  ciudad: z.string().optional().nullable(),
  cp: z.string().optional().nullable(),
  pais: z.string().optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  telefono: z.string().optional().nullable(),
  iban: z.string().optional().nullable(),
  serie: z.string().max(10).optional().nullable(),
  logoUrl: z.string().optional().nullable(),
  pieDefault: z.string().optional().nullable(),
  esDefault: z.boolean().optional(),
  activo: z.boolean().optional(),
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
