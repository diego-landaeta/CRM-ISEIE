import { z } from 'zod';

export const webhookLeadSchema = z.object({
  nombre: z.string().min(1, 'Nombre requerido').max(200),
  // Email opcional: Make ya filtra spam y a veces el lead llega sólo por WhatsApp/telefono
  email: z.string().email('Email invalido').transform((v) => v.toLowerCase().trim()).optional().or(z.literal('')),
  telefono: z.string().max(50).optional(),
  producto_interes: z.string().max(255).optional(),
  producto_interes_id: z.coerce.number().int().positive().optional(),
  // SKU del producto (clave universal cuando hay multi-sitio con nombres distintos
  // por idioma). Si viene, gana sobre producto_interes (nombre) y empata con _id.
  producto_interes_sku: z.string().max(100).optional(),
  notas: z.string().max(2000).optional(),
  landing_url: z.string().url().optional().or(z.literal('')),
  utm_source: z.string().max(100).optional(),
  utm_medium: z.string().max(100).optional(),
  utm_campaign: z.string().max(255).optional(),
  utm_content: z.string().max(255).optional(),
  utm_term: z.string().max(255).optional(),
  // Make puede decidir el canal directamente (override de la deteccion automatica)
  canal: z.enum(['meta_ads', 'google_ads', 'tiktok_ads', 'organico', 'chatgpt_ia', 'directo', 'referido', 'whatsapp']).optional(),
  // Asignacion explicita desde Make (saltea round-robin si vienen).
  // Se acepta email o id; si vienen los dos, prioriza id.
  responsable_email: z.string().email().optional().or(z.literal('')),
  responsable_id: z.coerce.number().int().positive().optional(),
  // Idempotency: si Make reintenta, no duplicamos.
  idempotency_key: z.string().min(1).max(200).optional(),
  // Campos custom libres (objeto JSON). Se guardan en leads.custom_fields.
  custom_fields: z.record(z.string(), z.any()).optional(),
}).refine(
  (d) => (d.email && d.email.length > 0) || (d.telefono && d.telefono.length > 0),
  { message: 'Debes proporcionar al menos email o teléfono', path: ['email'] }
);

export const listLeadsSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  status: z.enum(['nuevo', 'por_contactar', 'contactado', 'en_seguimiento', 'convertido', 'no_interesado', 'proxima_convocatoria']).optional(),
  responsableId: z.coerce.number().int().positive().optional(),
  unassigned: z.coerce.boolean().optional(),
  canal: z.enum(['meta_ads', 'google_ads', 'tiktok_ads', 'organico', 'chatgpt_ia', 'directo', 'referido', 'whatsapp']).optional(),
  productId: z.coerce.number().int().positive().optional(),
  search: z.string().max(100).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(20),
  includeConverted: z.coerce.boolean().optional(),
  // Filtro por rango de fechas (sobre fecha_solicitud o created_at)
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato dateFrom: YYYY-MM-DD').optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato dateTo: YYYY-MM-DD').optional(),
  // Orden: value (default), recent, urgency
  sort: z.enum(['value', 'recent', 'urgency', 'recent_value']).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  // Vista de papelera: solo leads con deleted_at IS NOT NULL (rol superadmin).
  archived: z.coerce.boolean().optional(),
  // Filtro de duplicados (lead_duplicado_de IS NOT NULL) — solo admin/superadmin.
  duplicated: z.coerce.boolean().optional(),
  // Filtro de reincidentes (reincidente = TRUE) — solo admin/superadmin.
  reincidente: z.coerce.boolean().optional(),
  // "Clientes" = leads con al menos una venta (conversión).
  conConversion: z.coerce.boolean().optional(),
});

export const checkDuplicateSchema = z.object({
  project_id: z.number().int().positive(),
  email: z.string().email().optional().or(z.literal('')).or(z.null()),
  telefono: z.string().max(50).optional().or(z.literal('')).or(z.null()),
}).refine(
  (d) => (d.email && d.email.length > 0) || (d.telefono && d.telefono.length > 0),
  { message: 'Debes proporcionar email o teléfono', path: ['email'] }
);

// Motivo opcional para cambios "neutrales" (avanzar pipeline). Solo es
// obligatorio cuando el destino es 'no_interesado' (que llega por LeadLossDialog
// con motivo siempre rellenado). Refinement valida la combinación.
export const updateStatusSchema = z.object({
  status: z.enum(['nuevo', 'por_contactar', 'contactado', 'en_seguimiento', 'convertido', 'no_interesado', 'proxima_convocatoria']),
  motivo: z.string().max(500).optional().nullable(),
}).refine(
  (data) => data.status !== 'no_interesado' || (data.motivo && data.motivo.trim().length >= 1),
  { message: 'Motivo requerido al marcar como no interesado', path: ['motivo'] }
);

export const createInteractionSchema = z.object({
  tipo: z.enum(['llamada', 'email', 'whatsapp', 'nota']),
  nota: z.string().max(2000).optional(),
  fecha: z.string().datetime().optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/)).optional(),
});

export const updateInteractionSchema = z.object({
  tipo: z.enum(['llamada', 'email', 'whatsapp', 'nota']).optional(),
  nota: z.string().max(2000).optional(),
  fecha: z.string().datetime().optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/)).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'Al menos un campo a actualizar' });

export const createReminderSchema = z.object({
  fecha_recordatorio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato fecha: YYYY-MM-DD'),
  nota: z.string().max(500).optional(),
});

export const reassignSchema = z.object({
  responsable_id: z.number().int().positive('ID de responsable requerido'),
});

export const createLeadManualSchema = z.object({
  project_id: z.number().int().positive('project_id requerido'),
  nombre: z.string().min(1, 'Nombre requerido').max(200),
  // Email opcional ahora (un lead puede venir solo por WhatsApp con teléfono)
  email: z.string().email('Email invalido').transform((v) => v.toLowerCase().trim()).optional().nullable().or(z.literal('')),
  telefono: z.string().max(50).optional().nullable().or(z.literal('')),
  producto_interes_id: z.number().int().positive().optional().nullable(),
  canal: z.enum(['directo', 'referido', 'meta_ads', 'google_ads', 'tiktok_ads', 'organico', 'chatgpt_ia', 'whatsapp']).default('directo'),
  notas: z.string().max(2000).optional().or(z.literal('')),
  custom_fields: z.record(z.string(), z.any()).optional(),
}).refine(
  (data) => (data.email && data.email.length > 0) || (data.telefono && data.telefono.length > 0),
  { message: 'Debes proporcionar al menos email o teléfono', path: ['email'] }
);

export const updateLeadSchema = z.object({
  nombre: z.string().min(1, 'Nombre no puede estar vacio').max(200).optional(),
  email: z.string().email('Email invalido').transform((v) => v.toLowerCase().trim()).nullable().optional().or(z.literal('')),
  telefono: z.string().max(50).nullable().optional(),
  notas: z.string().max(2000).nullable().optional(),
  producto_interes_id: z.number().int().positive().nullable().optional(),
  canal: z.enum(['meta_ads', 'google_ads', 'tiktok_ads', 'organico', 'chatgpt_ia', 'directo', 'referido', 'whatsapp']).optional(),
  custom_fields: z.record(z.string(), z.any()).optional(),
}).refine((data) => Object.keys(data).length > 0, {
  message: 'Al menos un campo debe ser proporcionado',
});
