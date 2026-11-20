import client from '@/shared/api/client';

/*
  Links de pago (CRM#680). Las llamadas de la ficha (crear, listar, anular) y las de
  la tarjeta de Integraciones (reglas del campus y webhook de la cuenta).
*/

export type EstadoLink = 'creado' | 'abierto' | 'pagado' | 'pagado_parcial' | 'caducado' | 'anulado';

export interface LinkDePago {
  id: number;
  project_id: number;
  lead_id: number | null;
  lead_nombre?: string | null;
  project_nombre?: string | null;
  conversion_id: number | null;
  /** El programa de la venta a la que va el link (si va a una). */
  venta_producto_nombre?: string | null;
  product_id: number | null;
  product_nombre: string | null;
  created_by: number | null;
  creado_por_nombre: string | null;
  precio_catalogo: string | number | null;
  importe: string | number;
  descuento_pct: string | number;
  moneda: string;
  modalidad: 'unico' | 'cuotas';
  estado: EstadoLink;
  url: string | null;
  caduca_el: string | null;
  pagado_el: string | null;
  anulado_por_nombre: string | null;
  anulado_el: string | null;
  motivo_anulacion: string | null;
  created_at: string;
}

export interface ConfigLinks {
  project_id: number;
  descuento_max_pct: number;
  caducidad_dias: number;
  caducidad_max_dias: number;
  cuotas_admitidas: boolean;
  cuotas_max: number;
  monedas: string[];
  moneda_defecto: string;
}

export interface WebhookDeLaCuenta {
  vinculado: boolean;
  existe?: boolean;
  endpoint_id?: string;
  activo?: boolean;
  url?: string | null;
  eventos?: string[];
  faltan: string[];
  comparten?: Array<{ id: number; nombre: string }>;
  cambiado?: boolean;
}

export function listarLinks(params: { leadId?: number; conversionId?: number }) {
  return client.get<LinkDePago[]>('/links-pago', { params: { ...params, limit: 50 } });
}

/** La pantalla «Links de pago»: los del alcance de quien mira, paginados. */
export function listarTodos(params: { estado?: EstadoLink | ''; page?: number; limit?: number; ambito?: { projectId?: number; issuerId?: number } }) {
  const p: Record<string, unknown> = { page: params.page || 1, limit: params.limit || 25, ...(params.ambito || {}) };
  if (params.estado) p.estado = params.estado;
  return client.get<LinkDePago[]>('/links-pago', { params: p });
}

export interface VentaDelProspecto {
  id: number;
  project_id: number;
  producto_contratado_id: number | null;
  producto_nombre: string | null;
  importe_total: number;
  cobrado: number;
  pendiente: number;
  fecha_conversion: string | null;
}

export interface ProspectoDelLink {
  lead: {
    id: number; nombre: string | null; email: string | null; telefono: string | null;
    project_id: number; producto_interes_id: number | null;
  };
  ventas: VentaDelProspecto[];
}

/** El prospecto (o el de una venta) y sus ventas con lo pendiente, para el asistente. */
export function ventasDelProspecto(params: { leadId?: number; conversionId?: number }) {
  return client.get<ProspectoDelLink>('/links-pago/ventas-del-prospecto', { params });
}

export function crearLink(cuerpo: {
  // Sin caducidad, la de serie del campus; sin moneda, la del campus.
  leadId?: number; conversionId?: number; productId: number; importe: number; moneda?: string; caducidad_dias?: number;
}) {
  return client.post<LinkDePago>('/links-pago', cuerpo);
}

export function anularLink(id: number, motivo: string) {
  return client.post<LinkDePago>(`/links-pago/${id}/anular`, { motivo });
}

export function verConfig(projectId: number) {
  return client.get<ConfigLinks>(`/links-pago/config?projectId=${projectId}`);
}

export function guardarConfig(projectId: number, cambios: Partial<Omit<ConfigLinks, 'project_id'>>) {
  return client.put<ConfigLinks>('/links-pago/config', { projectId, ...cambios });
}

export function verWebhook(projectId: number) {
  return client.get<WebhookDeLaCuenta>(`/links-pago/webhook?projectId=${projectId}`);
}

export function cambiarWebhook(projectId: number, accion: 'anadir_eventos' | 'activar' | 'desactivar') {
  return client.put<WebhookDeLaCuenta>('/links-pago/webhook', { projectId, accion });
}

/** «Generar plan de pago» (19/11): la venta y sus cuotas pendientes, cada una con su link vivo si lo tiene. */
export interface CuotaDelPlan {
  id: number;
  numero: number;
  importe: number;
  vence: string | null;
  concepto: string | null;
  link_id: number | null;
  link_estado: EstadoLink | null;
  link_url: string | null;
  link_caduca_el: string | null;
}
export interface PlanDePago {
  venta: {
    id: number; project_id: number; lead_id: number | null; lead_nombre: string | null; lead_email: string | null;
    producto_contratado_id: number | null; producto_nombre: string | null;
    importe_total: number; cobrado: number; pendiente: number;
  };
  cuotas: CuotaDelPlan[];
  creados?: number;
  ya_tenian?: number;
}

export function verPlan(conversionId: number) {
  return client.get<PlanDePago>('/links-pago/plan', { params: { conversionId } });
}

/** Un link por cuota pendiente (las elegidas, o todas las que aún no tienen link). */
export function generarPlan(conversionId: number, cuotaIds?: number[]) {
  return client.post<PlanDePago>('/links-pago/plan', { conversionId, ...(cuotaIds?.length ? { cuotaIds } : {}) });
}
