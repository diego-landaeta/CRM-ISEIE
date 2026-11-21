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
  /** En cuotas (20/11): en cuántas, y la que cobra el link (la 1). `importe` es el total. */
  num_cuotas?: number | null;
  importe_cuota?: string | number | null;
  /**
   * Inicial más cuotas (CRM#982): lo que cobra el link. Entonces `num_cuotas`
   * cuenta la inicial y las cuotas, y estas son iguales sobre lo que queda.
   */
  importe_inicial?: string | number | null;
  /** El precio antes del descuento y el descuento (CRM#982). `importe` es el total. */
  precio_original?: string | number | null;
  descuento_tipo?: 'monto' | 'pct' | null;
  descuento_valor?: string | number | null;
  descuento_importe?: string | number | null;
  guarda_tarjeta?: boolean;
  estado: EstadoLink;
  url: string | null;
  caduca_el: string | null;
  pagado_el: string | null;
  anulado_por_nombre: string | null;
  anulado_el: string | null;
  motivo_anulacion: string | null;
  /** Seguimiento (gemela de CRM#984): cuándo lo abrió el alumno y qué avisos han salido. */
  abierto_el?: string | null;
  aviso_gestora_el?: string | null;
  recordatorio_24h_el?: string | null;
  recordatorio_72h_el?: string | null;
  /** El caducado al que sustituye este, y el nuevo que sustituye a este caducado. */
  renovado_de?: number | null;
  renovado_por?: number | null;
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
  /**
   * Si por la clave no se pueden crear links en el campus (no la tiene, o es
   * live en pruebas): lo que diría «Crear link». null si se puede. Solo lectura.
   */
  aviso_clave?: { code: string; error: string } | null;
  /** Cobro automático de las cuotas (309): si el campus lo permite y a los cuántos días se reintenta. */
  cobro_auto?: boolean;
  cobro_auto_reintento_dias?: number;
  /** Seguimiento (gemela de CRM#984): a las cuántas horas de abrirlo sin pagar se avisa, y los recordatorios al alumno. */
  aviso_abierto_horas?: number;
  recordatorios?: boolean;
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
  // Sin prospecto ni venta (20/11), el campus: el CRM crea la ficha y la venta al pagarse.
  leadId?: number; conversionId?: number; projectId?: number; productId: number; importe: number; moneda?: string; caducidad_dias?: number;
  // En cuotas: `importe` es el total; el link cobra la primera y Stripe las demás.
  modalidad?: 'unico' | 'cuotas'; num_cuotas?: number;
  // CRM#982: con `inicial`, el link cobra la inicial y `num_cuotas` son las de después.
  inicial?: number;
  // CRM#982: el precio antes del descuento y el descuento; `importe` es el total que resulta.
  precio_original?: number; descuento_tipo?: 'monto' | 'pct'; descuento_valor?: number;
}) {
  return client.post<LinkDePago>('/links-pago', cuerpo);
}

/** Si «Cuotas» se puede en el campus y, si no, por qué (20/11). */
export interface CuotasDisponibles { disponible: boolean; motivo: string | null; cuotas_max: number | null }

export function cuotasDisponibles(projectId: number) {
  return client.get<CuotasDisponibles>('/links-pago/cuotas-disponibles', { params: { projectId } });
}

export function anularLink(id: number, motivo: string) {
  return client.post<LinkDePago>(`/links-pago/${id}/anular`, { motivo });
}

/** Renovar un caducado (gemela de CRM#984): un link nuevo igual, con la caducidad de serie del campus. */
export function renovarLink(id: number) {
  return client.post<LinkDePago>(`/links-pago/${id}/renovar`, {});
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
  link_guarda_tarjeta?: boolean;
}

/** Cómo va el cobro automático de una cuota en Stripe (309). */
export interface CuotaCobroAuto {
  installment_id: number;
  numero: number;
  vence: string;
  importe: number;
  estado: 'programada' | 'cobrada' | 'fallida' | 'quitada' | null;
  fecha_programada: string | null;
  importe_programado: number | null;
  desfasada: boolean;
  intentos: number;
  error_codigo: string | null;
  reintento_el: string | null;
  url_pago: string | null;
  historial: Array<{ el: string; que: string; [k: string]: unknown }>;
  guarda_tarjeta: boolean;
  problema: string | null;
}

/** El cobro automático de las cuotas de una venta: lo cobra Stripe en las fechas del plan (309). */
export interface CobroAutomatico {
  disponible: boolean;
  motivo_no_disponible: string | null;
  reintento_dias: number | null;
  activo: boolean;
  activado_el: string | null;
  tarjeta: { marca: string | null; ultimos4: string | null; caduca: string | null; guardada_el: string | null } | null;
  stripe_schedule_id: string | null;
  sincronizado_el: string | null;
  sync_error: string | null;
  hora_de_cobro: number;
  cuotas: CuotaCobroAuto[];
  link_primera?: { id: number; url: string | null } | null;
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
  cobro_automatico?: CobroAutomatico;
}

export function verPlan(conversionId: number) {
  return client.get<PlanDePago>('/links-pago/plan', { params: { conversionId } });
}

/** Un link por cuota pendiente (las elegidas, o todas las que aún no tienen link). */
export function generarPlan(conversionId: number, cuotaIds?: number[], opciones: { cobroAutomatico?: boolean } = {}) {
  return client.post<PlanDePago>('/links-pago/plan', {
    conversionId, ...(cuotaIds?.length ? { cuotaIds } : {}), ...(opciones.cobroAutomatico ? { cobroAutomatico: true } : {}),
  });
}

/** El cobro automático de una venta: si se puede, si está activo y cuota a cuota (309). */
export function verCobroAutomatico(conversionId: number) {
  return client.get<CobroAutomatico>('/links-pago/cobro-automatico', { params: { conversionId } });
}

export function cambiarCobroAutomatico(conversionId: number, activo: boolean) {
  return client.put<CobroAutomatico>('/links-pago/cobro-automatico', { conversionId, activo });
}
