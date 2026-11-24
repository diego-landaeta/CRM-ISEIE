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
  /** 23/11: las cuotas de después de la inicial con su importe y su fecha. */
  plan_cuotas?: { importe: number | string; vence: string }[] | null;
  /** El precio antes del descuento y el descuento (CRM#982). `importe` es el total. */
  precio_original?: string | number | null;
  descuento_tipo?: 'monto' | 'pct' | null;
  descuento_valor?: string | number | null;
  descuento_importe?: string | number | null;
  guarda_tarjeta?: boolean;
  /** Códigos promocionales (CRM#986): si el link los admite y, pagado, el que usó el alumno y lo que descontó. */
  codigos_promo?: boolean;
  promo_codigo?: string | null;
  promo_descuento?: string | number | null;
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
  /**
   * CRM#1107: al crear un link desde un prospecto, su venta. `creada`: la ha creado
   * el link (pendiente de cobro); si no, es la que ya tenía la ficha. Sin
   * `conversion_id`, no se pudo crear (`error`) y se creará al pagarse.
   */
  venta_del_link?: { conversion_id: number | null; creada: boolean; error?: string };
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
  /** Si los links del campus admiten códigos promocionales de Stripe (CRM#986). */
  codigos_promo?: boolean;
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
  // 23/11: con inicial, cada cuota de después con su importe y su fecha (AAAA-MM-DD).
  cuotas?: { importe: number; vence: string }[];
  // CRM#982: el precio antes del descuento y el descuento; `importe` es el total que resulta.
  precio_original?: number; descuento_tipo?: 'monto' | 'pct'; descuento_valor?: number;
  // CRM#986: si el link admite códigos promocionales (sin decirlo, lo que diga el campus).
  codigos_promo?: boolean;
  // CRM#1107: el alumno ya tiene una venta de ese programa y se crea otra igualmente.
  forzar?: boolean;
}) {
  return client.post<LinkDePago>('/links-pago', cuerpo);
}


/** Un código promocional de campaña (CRM#986): un cupón y un código de Stripe con su fecha límite. */
export interface CodigoPromocional {
  id: number;
  project_id: number;
  codigo: string;
  campana: string | null;
  tipo: 'pct' | 'monto';
  valor: number;
  moneda: string | null;
  caduca_el: string;
  max_usos: number | null;
  activo: boolean;
  estado: 'vigente' | 'caducado' | 'desactivado';
  creado_por_nombre?: string | null;
  created_at: string;
}

/** Los códigos del campus: quien crea links ve los vigentes; quien configura, todos. */
export function listarCodigos(projectId: number) {
  return client.get<CodigoPromocional[]>('/links-pago/codigos', { params: { projectId } });
}

export function crearCodigo(projectId: number, cuerpo: {
  codigo: string; tipo: 'pct' | 'monto'; valor: number; moneda?: string; caduca_el: string; max_usos?: number; campana?: string;
}) {
  return client.post<CodigoPromocional>('/links-pago/codigos', { projectId, ...cuerpo });
}

export function desactivarCodigo(projectId: number, id: number) {
  return client.post<CodigoPromocional>(`/links-pago/codigos/${id}/desactivar`, { projectId });
}

/** «20 %» o «50,00 €»: lo que descuenta un código. */
export function textoDelCodigo(c: Pick<CodigoPromocional, 'tipo' | 'valor' | 'moneda'>) {
  if (c.tipo === 'pct') return `${String(c.valor).replace('.', ',')} %`;
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: c.moneda || 'EUR' }).format(Number(c.valor));
  } catch {
    return `${c.valor} ${c.moneda || ''}`.trim();
  }
}

/** Si «Cuotas» se puede en el campus y, si no, por qué (20/11). */
/*
  `codigo` (CRM#992): por qué no. `sin_clave` y `clave_sin_permiso` se arreglan en
  Integraciones › Links de pago (aviso «Conectar Stripe para cobros automáticos»);
  `apagado_entorno`, en ningún sitio de la pantalla. El resto, solo el texto.
*/
/*
  23/11 (Diego: «crear cuotas sí o sí»): `disponible` dice si se pueden crear cuotas
  (solo no si el campus no las admite en euros) y `automatico`, si Stripe las cobra
  solas. Sin cobro automático, cada cuota tiene su propio link; `codigo` y `motivo`
  dicen por qué no es automático.
*/
export interface CuotasDisponibles {
  disponible: boolean; automatico?: boolean; codigo?: string | null; motivo: string | null; cuotas_max: number | null;
}

export function cuotasDisponibles(projectId: number) {
  return client.get<CuotasDisponibles>('/links-pago/cuotas-disponibles', { params: { projectId } });
}

export interface CampusPorConectar { project_id: number; nombre: string; codigo: string; motivo: string }
export interface ConectarStripe { activo: boolean; codigo: string | null; motivo: string | null; campus: CampusPorConectar[] }

/** Los campus del ámbito sin clave de Stripe o sin su permiso de suscripciones (CRM#992). */
export function conectarStripe(ambito?: { projectId?: number; issuerId?: number }) {
  return client.get<ConectarStripe>('/links-pago/conectar-stripe', { params: { ...(ambito || {}) } });
}

export function anularLink(id: number, motivo: string) {
  return client.post<LinkDePago>(`/links-pago/${id}/anular`, { motivo });
}

/** Una fila del embudo (CRM#987): por gestora (`user_id`), por campus (`project_id`) o el total. */
export interface FilaEmbudo {
  user_id?: number | null;
  project_id?: number;
  nombre?: string;
  creados: number;
  abiertos: number;
  pagados: number;
  pct_abiertos: number | null;
  pct_pagados: number | null;
  cobrado: number;
  cuotas_cobradas: number;
  cuotas_fallidas: number;
  cuotas_pendientes: number;
}
export interface Embudo { desde: string; hasta: string; total: FilaEmbudo; por_gestora: FilaEmbudo[]; por_campus: FilaEmbudo[] }

/** El embudo de los links (CRM#987), con el ámbito de quien mira. */
export function verEmbudo(params: { desde: string; hasta: string; ambito?: { projectId?: number; issuerId?: number } }) {
  return client.get<Embudo>('/links-pago/embudo', { params: { desde: params.desde, hasta: params.hasta, ...(params.ambito || {}) } });
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
