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

export const createProductSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  nombre: z.string().min(1).max(200),
  descripcion: z.string().max(2000).optional(),
  categoria_id: z.number().int().positive().nullable().optional(),
  subcategoria_id: z.number().int().positive().nullable().optional(),
  ...pricingFields,
});

export const updateProductSchema = z.object({
  nombre: z.string().min(1).max(200).optional(),
  descripcion: z.string().max(2000).optional(),
  categoria_id: z.number().int().positive().nullable().optional(),
  subcategoria_id: z.number().int().positive().nullable().optional(),
  ...pricingFields,
  ...richFields,
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Al menos un campo debe ser proporcionado',
});

export const projectIdParamSchema = z.object({
  projectId: z.coerce.number().int().positive(),
});
