import { z } from 'zod';

const pricingFields = {
  precio: z.number().nonnegative().nullable().optional(),
  moneda: z.string().max(10).optional(),
  stripe_link: z.string().max(500).nullable().optional().or(z.literal('')),
  brochure_url: z.string().max(500).nullable().optional().or(z.literal('')),
  sku: z.string().max(100).nullable().optional().or(z.literal('')),
  duracion: z.string().max(100).nullable().optional().or(z.literal('')),
  url_info: z.string().max(500).nullable().optional().or(z.literal('')),
};

// Campos extraídos por el scraper / ACF (texto libre, todos opcionales)
const richFields = {
  horas: z.string().max(80).nullable().optional().or(z.literal('')),
  num_modulos: z.union([z.coerce.number().int().nonnegative(), z.literal(''), z.null()]).optional(),
  modalidad: z.string().max(80).nullable().optional().or(z.literal('')),
  fecha_inicio_texto: z.string().max(200).nullable().optional().or(z.literal('')),
  presentacion_texto: z.string().max(50000).nullable().optional().or(z.literal('')),
  objetivos_texto: z.string().max(50000).nullable().optional().or(z.literal('')),
  beneficios_texto: z.string().max(50000).nullable().optional().or(z.literal('')),
  dirigido_a_texto: z.string().max(50000).nullable().optional().or(z.literal('')),
  para_que_te_prepara_texto: z.string().max(50000).nullable().optional().or(z.literal('')),
  por_que_estudiar_texto: z.string().max(50000).nullable().optional().or(z.literal('')),
  modulos_texto: z.string().max(80000).nullable().optional().or(z.literal('')),
  metodologia_texto: z.string().max(50000).nullable().optional().or(z.literal('')),
  faqs_texto: z.string().max(50000).nullable().optional().or(z.literal('')),
  profesores_texto: z.string().max(50000).nullable().optional().or(z.literal('')),
};

// #86 · Convocatoria. Solo se guardan los dos extremos: cuántas plazas hay y
// cuántas venían ocupadas de antes. Las ocupadas de verdad y las libres las
// cuenta el modelo desde las ventas, y por eso no se aceptan por aquí: si se
// pudieran teclear, alguien las tecleará y el número dejará de ser cierto.
const vacioEsNulo = (v) => (v === '' || Number.isNaN(v) ? null : v);
// La columna es NOT NULL DEFAULT 0, así que un vacío no puede acabar en null:
// «ninguna» es cero.
//
// `undefined` se deja pasar tal cual, y esa distinción importa: undefined es
// «el cliente no manda este campo» y tiene que seguir siendo undefined para que
// `update()` no lo toque. Si aquí se convirtiera a 0, cada vez que alguien
// guardara un producto por cualquier otro motivo se le borraría el contador.
const vacioEsCero = (v) => (v === undefined ? undefined
  : (v === '' || v === null || Number.isNaN(v) ? 0 : v));

const convocatoriaFields = {
  plazas_totales: z.preprocess(
    vacioEsNulo,
    z.coerce.number().int().nonnegative().max(100000).nullable().optional()
  ),
  plazas_ocupadas_previas: z.preprocess(
    vacioEsCero,
    z.coerce.number().int().nonnegative().max(100000).optional()
  ),
  fecha_cierre_convocatoria: z.preprocess(
    vacioEsNulo,
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe ser una fecha AAAA-MM-DD').nullable().optional()
  ),
};

export const createProductSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  nombre: z.string().min(1).max(200),
  descripcion: z.string().max(2000).optional(),
  categoria_id: z.number().int().positive().nullable().optional(),
  subcategoria_id: z.number().int().positive().nullable().optional(),
  regimen_fiscal_id: z.number().int().positive().nullable().optional(),
  ...pricingFields,
});

export const updateProductSchema = z.object({
  nombre: z.string().min(1).max(200).optional(),
  descripcion: z.string().max(2000).optional(),
  categoria_id: z.number().int().positive().nullable().optional(),
  subcategoria_id: z.number().int().positive().nullable().optional(),
  regimen_fiscal_id: z.number().int().positive().nullable().optional(),
  ...pricingFields,
  ...richFields,
  ...convocatoriaFields,
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Al menos un campo debe ser proporcionado',
});

export const projectIdParamSchema = z.object({
  projectId: z.coerce.number().int().positive(),
});
