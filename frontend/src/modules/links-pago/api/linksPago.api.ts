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
  conversion_id: number | null;
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

export function crearLink(cuerpo: {
  leadId?: number; conversionId?: number; productId: number; importe: number; moneda: string; caducidad_dias: number;
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
