/**
 * Tipos compartidos del CRM. Reflejan los schemas Zod del backend
 * (backend/src/modules/{leads,projects,users,conversions,...}/*.validation.js).
 *
 * Pilot de TypeScript (CRM-207). Nuevas migraciones a TS deben:
 * 1. Importar de aquí los tipos compartidos.
 * 2. Extender este archivo con tipos nuevos cuando aparezcan.
 * 3. Mantener nombres en singular (`Lead`, no `Leads`).
 */

export type LeadStatus =
  | 'nuevo'
  | 'por_contactar'
  | 'contactado'
  | 'en_seguimiento'
  | 'convertido'
  | 'no_interesado';

export type LeadOrigen =
  | 'meta_ads'
  | 'google_ads'
  | 'tiktok_ads'
  | 'organico'
  | 'referido'
  | 'directo'
  | 'web'
  | 'whatsapp'
  | 'chatgpt_ia'
  | 'otro';

export type UserRole = 'superadmin' | 'admin' | 'gestor' | 'soporte' | 'tutor';

export type ProjectType = 'crm' | 'ia';

export interface Project {
  id: number;
  nombre: string;
  slug: string;
  type: ProjectType;
  active: boolean;
  emoji?: string | null;
  logo_url?: string | null;
  dias_alerta_inactividad: number;
  meta_account_id?: string | null;
  google_account_id?: string | null;
  gsc_property?: string | null;
  producto_label: string;
  producto_label_plural: string;
  modules?: Record<string, boolean>;
  webhook_api_key?: string;
  lead_columns?: Array<{ key: string; label: string; visible: boolean }>;
  lead_base_fields_config?: Record<string, { required?: boolean; visible?: boolean }>;
}

export interface User {
  id: number;
  nombre: string;
  email: string;
  role: UserRole;
  custom_role_id?: number | null;
  active?: boolean;
  project_ids?: number[];
  projects?: number[];
  last_login_at?: string | null;
  permissions?: Record<string, boolean>;
}

export interface Lead {
  id: number;
  project_id: number;
  proyecto_nombre?: string;
  nombre: string;
  email: string;
  telefono?: string | null;
  /** El usuario de WhatsApp, cuando no hay numero o ademas del numero. */
  whatsapp_usuario?: string | null;
  estado: LeadStatus;
  status?: LeadStatus;
  origen?: LeadOrigen | null;
  canal?: LeadOrigen | string | null;
  canal_detectado?: LeadOrigen | null;
  producto_interes?: string | null;
  producto_interes_id?: number | null;
  producto_nombre?: string | null;
  producto_precio?: number | string | null;
  producto_moneda?: string | null;
  valor_oportunidad?: 'alto' | 'medio' | 'bajo' | null;
  deleted_at?: string | null;
  deleted_reason?: 'spam' | 'test' | 'duplicado_manual' | 'otro' | null;
  deleted_motivo?: string | null;
  deleted_by?: number | null;
  responsable_id?: number | null;
  responsable_nombre?: string | null;
  pais?: string | null;
  // Datos fiscales (globales del cliente; se rellenan al completar una factura).
  identificacion_fiscal?: string | null;
  direccion_fiscal?: string | null;
  ciudad_fiscal?: string | null;
  codigo_postal_fiscal?: string | null;
  pais_fiscal?: string | null;
  fecha_solicitud?: string | null;
  created_at: string;
  updated_at?: string;
  notas?: string | null;
  lead_duplicado_de?: number | null;
  custom_fields?: Record<string, unknown>;
  statusHistory?: Array<{
    id?: number | string;
    status_nuevo?: string;
    status_anterior?: string;
    changed_by_nombre?: string;
    changed_at?: string;
  }>;
  last_interaction_at?: string | null;
  next_reminder_at?: string | null;
  dias_inactivo?: number | null;
  dias_alerta_inactividad?: number | null;
  reincidente?: boolean | null;
  es_propuesto?: boolean | null;
  propuesto_de?: number | null;
  has_pending_spam_report?: boolean | null;
  gestor?: string | null;
  utms?: Utms | null;
  // UTMs pueden venir embebidos directamente en el lead segun endpoint
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  landing_url?: string | null;
  // Algunos endpoints de detalle inyectan interacciones/recordatorios
  interactions?: Interaction[];
  reminders?: Reminder[];
}

export interface Client {
  id: number;
  project_id: number;
  nombre: string;
  email: string;
  telefono?: string | null;
  responsable_id?: number | null;
  responsable_nombre?: string | null;
  programas?: string[];
  total_cuotas: number;
  cuotas_pagadas: number;
  cuotas_pendientes: number;
  total_pagos: number;
  proximo_vencimiento?: string | null;
  last_interaction_at?: string | null;
  origen?: LeadOrigen | null;
  notas?: string | null;
}

export type ConversionEstado = 'pagado' | 'pendiente' | 'parcial' | 'reembolsado';

export interface Conversion {
  id: number;
  project_id: number;
  lead_id: number;
  producto_id?: number | null;
  producto_nombre?: string | null;
  // El backend usa varios nombres en distintos endpoints
  importe?: number | string;
  importe_total?: number | string;
  cobrado?: number | string;
  importe_pagado?: number | string;
  pendiente?: number | string;
  metodo_pago?: string | null;
  estado: ConversionEstado;
  fecha_conversion?: string;
  fecha_compra?: string;
  fecha_pago?: string | null;
  created_at?: string;
  notas?: string | null;
}

export interface Interaction {
  id: number;
  lead_id: number;
  tipo: 'llamada' | 'email' | 'whatsapp' | 'nota';
  nota?: string | null;
  fecha: string;
  created_by_nombre?: string;
}

export interface Reminder {
  id: number;
  lead_id: number;
  fecha_recordatorio: string;
  nota?: string | null;
  completado: boolean;
  created_by_nombre?: string;
}

export interface Utms {
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  canal_detectado?: LeadOrigen | null;
  landing_url?: string | null;
}

/**
 * Forma estándar de respuesta API. El backend siempre devuelve esta estructura.
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  pagination?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
