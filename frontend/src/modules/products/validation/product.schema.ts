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
  label: z.string().min(1, 'Escribe la etiqueta del enlace'),
  url: z.string().url('La URL no es válida: cópiala entera, empezando por https://'),
  tipo: z.enum(['completo', 'dos_cuotas', 'tres_cuotas', 'personalizado']),
});

export type PaymentLink = z.infer<typeof paymentLinkSchema>;

// Sin mensaje propio, zod contesta en inglés y sin decir qué hacer
// («Invalid input», «Number must be greater than or equal to 0») (#106).
const MSG_ENTERO = 'Escribe un número entero, 0 o mayor';
const ENTERO = { errorMap: () => ({ message: MSG_ENTERO }) };

export const productSchema = z.object({
  // Vacío no es «demasiado corto»: falta (visto en la prueba a mano, #106).
  nombre: z.string().min(1, 'Falta el nombre').min(2, 'El nombre debe tener al menos 2 caracteres'),
  descripcion: z.string().optional().or(z.literal('')),
  // multipleOf: los céntimos que antes comprobaba el navegador (step="0.01").
  precio: z.coerce.number().nonnegative('El precio no puede ser negativo').multipleOf(0.01, 'Como mucho 2 decimales (céntimos)').optional().or(z.nan()),
  moneda: z.string().optional().or(z.literal('')),
  stripe_link: z.string().max(500, 'Como mucho 500 caracteres').optional().or(z.literal('')),
  sku: z.string().optional().or(z.literal('')),
  duracion: z.string().optional().or(z.literal('')),
  url_info: z.string().max(500, 'Como mucho 500 caracteres').optional().or(z.literal('')),
  categoria_id: z.union([z.number(), z.string()]).optional().or(z.literal('')),
  subcategoria_id: z.union([z.number(), z.string()]).optional().or(z.literal('')),
  // Campos del scraper / WC ricos
  horas: z.string().optional().or(z.literal('')),
  num_modulos: z.union([z.coerce.number().int(MSG_ENTERO).nonnegative(MSG_ENTERO), z.literal(''), z.nan()], ENTERO).optional(),
  modalidad: z.string().optional().or(z.literal('')),
  fecha_inicio_texto: z.string().optional().or(z.literal('')),
  // Convocatoria (#86). Aquí solo van los dos extremos: las ocupadas y las
  // libres las cuenta el servidor desde las ventas y no se envían nunca.
  plazas_totales: z.union([z.coerce.number().int(MSG_ENTERO).nonnegative(MSG_ENTERO), z.literal(''), z.nan()], ENTERO).optional(),
  plazas_ocupadas_previas: z.union([z.coerce.number().int(MSG_ENTERO).nonnegative(MSG_ENTERO), z.literal(''), z.nan()], ENTERO).optional(),
  fecha_cierre_convocatoria: z.string().optional().or(z.literal('')),
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
