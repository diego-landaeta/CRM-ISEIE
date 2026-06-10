import { z } from 'zod';

export const createProjectSchema = z.object({
  nombre: z.string().min(1).max(200),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Slug solo minusculas, numeros y guiones').min(1).max(100),
  type: z.enum(['crm', 'ia']).default('crm'),
  emoji: z.string().max(10).optional().nullable(),
  meta_account_id: z.string().max(100).optional().nullable(),
  google_account_id: z.string().max(100).optional().nullable(),
  gsc_property: z.string().max(255).optional().nullable(),
  dias_alerta_inactividad: z.number().int().min(1).max(365).default(3),
  producto_label: z.string().max(50).optional(),
  producto_label_plural: z.string().max(50).optional(),
});

export const updateProjectSchema = z.object({
  nombre: z.string().min(1).max(200).optional(),
  type: z.enum(['crm', 'ia']).optional(),
  emoji: z.string().max(10).nullable().optional(),
  logo_url: z.string().url('URL inválida').max(2000).nullable().optional(),
  meta_account_id: z.string().max(100).nullable().optional(),
  google_account_id: z.string().max(100).nullable().optional(),
  gsc_property: z.string().max(255).nullable().optional(),
  dias_alerta_inactividad: z.number().int().min(1).max(365).optional(),
  active: z.boolean().optional(),
  producto_label: z.string().max(50).optional(),
  producto_label_plural: z.string().max(50).optional(),
  modules: z.record(z.string(), z.boolean()).optional(),
  lead_base_fields_config: z.record(z.string(), z.object({
    required: z.boolean().optional(),
    visible: z.boolean().optional(),
  })).optional(),
  lead_columns: z.array(z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    visible: z.boolean(),
  })).optional(),
  external_panels: z.array(z.object({
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(80),
    url: z.string().url().max(2000),
    icon: z.string().max(50).optional().nullable(),
    open_in: z.enum(['iframe', 'tab']).optional(),
  })).max(20).optional(),
  sidebar_labels: z.record(z.string().min(1).max(80), z.string().min(1).max(80)).optional(),
  theme_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Hex inválido (#rrggbb)').nullable().optional(),
  auto_email_documents: z.boolean().optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'Al menos un campo' });
