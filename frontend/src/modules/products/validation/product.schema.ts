import { z } from 'zod';

// Tipos de enlace de pago (CRM-140) — coinciden con el enum del backend
export const PAYMENT_LINK_TYPES = [
  { value: 'completo', label: 'Pago completo' },
  { value: 'dos_cuotas', label: '2 cuotas' },
  { value: 'tres_cuotas', label: '3 cuotas' },
  { value: 'personalizado', label: 'Personalizado' },
] as const;

export type PaymentLinkType = typeof PAYMENT_LINK_TYPES[number]['value'];

export const paymentLinkSchema = z.object({
  label: z.string().min(1, 'Etiqueta requerida'),
  url: z.string().url('URL invalida'),
  tipo: z.enum(['completo', 'dos_cuotas', 'tres_cuotas', 'personalizado']),
});

export type PaymentLink = z.infer<typeof paymentLinkSchema>;

export const productSchema = z.object({
  nombre: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  descripcion: z.string().optional().or(z.literal('')),
  precio: z.coerce.number().nonnegative('Precio debe ser >= 0').optional().or(z.nan()),
  moneda: z.string().optional().or(z.literal('')),
  stripe_link: z.string().max(500).optional().or(z.literal('')),
  sku: z.string().optional().or(z.literal('')),
  duracion: z.string().optional().or(z.literal('')),
  url_info: z.string().max(500).optional().or(z.literal('')),
  categoria_id: z.union([z.number(), z.string()]).optional().or(z.literal('')),
  subcategoria_id: z.union([z.number(), z.string()]).optional().or(z.literal('')),
  // Campos del scraper / WC ricos
  horas: z.string().optional().or(z.literal('')),
  num_modulos: z.union([z.coerce.number().int().nonnegative(), z.literal(''), z.nan()]).optional(),
  modalidad: z.string().optional().or(z.literal('')),
  fecha_inicio_texto: z.string().optional().or(z.literal('')),
  presentacion_texto: z.string().optional().or(z.literal('')),
  objetivos_texto: z.string().optional().or(z.literal('')),
  beneficios_texto: z.string().optional().or(z.literal('')),
  dirigido_a_texto: z.string().optional().or(z.literal('')),
  para_que_te_prepara_texto: z.string().optional().or(z.literal('')),
  por_que_estudiar_texto: z.string().optional().or(z.literal('')),
  modulos_texto: z.string().optional().or(z.literal('')),
  metodologia_texto: z.string().optional().or(z.literal('')),
  faqs_texto: z.string().optional().or(z.literal('')),
  profesores_texto: z.string().optional().or(z.literal('')),
});

export type ProductFormData = z.infer<typeof productSchema>;
