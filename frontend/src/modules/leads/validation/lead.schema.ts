import { z } from 'zod';

export const leadSchema = z.object({
  // Nombre opcional a nivel de schema — el form muestra error si el checkbox
  // "sin nombre" no esta marcado Y el campo esta vacio. Si "sin nombre" esta
  // marcado, handleFormSubmit genera "Anónimo (tel ...)" automaticamente.
  nombre: z.string().max(200).optional().or(z.literal('')),
  // Email opcional: si viene, debe ser válido; vacío también acepta
  email: z.string().email('Email no valido').optional().or(z.literal('')),
  telefono: z.string().optional().or(z.literal('')),
  origen: z.enum(['meta_ads', 'google_ads', 'tiktok_ads', 'organico', 'chatgpt_ia', 'whatsapp', 'referido', 'directo'], {
    required_error: 'Selecciona un origen',
  }),
  estado: z.enum(['nuevo', 'por_contactar', 'contactado', 'en_seguimiento', 'convertido', 'no_interesado', 'proxima_convocatoria']).optional(),
  producto_interes: z.string().optional(),
  pais: z.string().optional(),
  notas: z.string().optional(),
}).refine(
  (data) => (data.email && data.email.length > 0) || (data.telefono && data.telefono.length > 0),
  { message: 'Debes poner al menos email o teléfono (uno de los dos)', path: ['email'] }
);

export type LeadFormData = z.infer<typeof leadSchema>;
export type LeadOrigenSchema = LeadFormData['origen'];
export type LeadEstadoSchema = NonNullable<LeadFormData['estado']>;

export const PAIS_OPTIONS: readonly string[] = [
  'Espana', 'Mexico', 'Colombia', 'Argentina', 'Chile', 'Peru',
  'Ecuador', 'Venezuela', 'Bolivia', 'Uruguay', 'Paraguay',
  'Costa Rica', 'Panama', 'Rep. Dominicana', 'Guatemala',
  'Portugal', 'Brasil', 'Estados Unidos', 'Alemania', 'Francia', 'Italia', 'Otro',
] as const;

export interface OptionLabel<T extends string = string> {
  value: T;
  label: string;
}

export const ORIGEN_OPTIONS: readonly OptionLabel<LeadOrigenSchema>[] = [
  { value: 'meta_ads', label: 'Meta Ads' },
  { value: 'google_ads', label: 'Google Ads' },
  { value: 'tiktok_ads', label: 'TikTok Ads' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'organico', label: 'Orgánico' },
  { value: 'chatgpt_ia', label: 'ChatGPT IA' },
  { value: 'referido', label: 'Referido' },
  { value: 'directo', label: 'Directo' },
] as const;

export const ESTADO_OPTIONS: readonly OptionLabel<LeadEstadoSchema>[] = [
  { value: 'nuevo', label: 'Nuevo' },
  { value: 'por_contactar', label: 'Por contactar' },
  { value: 'contactado', label: 'Contactado' },
  { value: 'en_seguimiento', label: 'En seguimiento' },
  { value: 'convertido', label: 'Convertido' },
  { value: 'no_interesado', label: 'No interesado' },
  { value: 'proxima_convocatoria', label: 'Próxima convocatoria' },
] as const;
