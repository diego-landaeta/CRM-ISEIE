import client from '@/shared/api/client';
import type { ApiResponse } from '@/shared/types';

export interface PlantillaWhatsapp {
  id: number;
  project_id: number;
  label: string;
  body: string;
  ambito: 'compartida' | 'personal';
  owner_id: number | null;
  orden: number;
  creada_por?: string | null;
}

export interface ProspectoCola {
  id: number;
  nombre: string;
  email: string | null;
  telefono: string | null;
  status: string;
  entrada: string;
  producto: string;
  gestora: string | null;
  ultimo_contacto: string | null;
  contactos: number;
  /** Cuantos cumplen el filtro en total, no cuantos se han traido. Igual en
   *  todas las filas: el servidor lo calcula antes de aplicar el tope. */
  total?: number;
}

type Params = Record<string, string | number | null | undefined> | undefined;

const qs = (params: Params): string => {
  const limpio = Object.fromEntries(
    Object.entries(params || {}).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  ) as Record<string, string>;
  const s = new URLSearchParams(limpio).toString();
  return s ? `?${s}` : '';
};

export const whatsappApi = {
  plantillas: (projectId: number): Promise<ApiResponse<PlantillaWhatsapp[]>> =>
    client.get(`/whatsapp/templates${qs({ projectId })}`),

  crearPlantilla: (data: {
    projectId: number; label: string; body: string; ambito: 'compartida' | 'personal';
  }): Promise<ApiResponse<PlantillaWhatsapp>> => client.post('/whatsapp/templates', data),

  editarPlantilla: (id: number, data: { label?: string; body?: string }):
    Promise<ApiResponse<PlantillaWhatsapp>> => client.patch(`/whatsapp/templates/${id}`, data),

  borrarPlantilla: (id: number): Promise<ApiResponse<null>> =>
    client.delete(`/whatsapp/templates/${id}`),

  cola: (params: {
    projectId: number; responsableId?: number | null; estado?: string | null;
    sinContactar?: boolean;
  }): Promise<ApiResponse<ProspectoCola[]>> =>
    client.get(`/whatsapp/cola${qs({
      projectId: params.projectId,
      responsableId: params.responsableId,
      estado: params.estado,
      sinContactar: params.sinContactar ? '1' : undefined,
    })}`),

  // Registrar que se ha contactado. Va contra el endpoint de leads que ya
  // existe: no hace falta uno nuevo y así la interacción sale en la ficha.
  registrarContacto: (leadId: number, nota: string): Promise<ApiResponse<unknown>> =>
    client.post(`/leads/${leadId}/interactions`, {
      tipo: 'whatsapp', nota, fecha: new Date().toISOString(),
    }),
};

// ── El chat ──────────────────────────────────────────────────────────────────
// Las conversaciones viven ahora en el CRM. Antes se veian en un navegador
// remoto y no se guardaban en ninguna parte.

export interface ChatWhatsapp {
  id: number;
  instancia: string;
  jid: string;
  telefono: string;
  nombre_push: string | null;
  avatar_url: string | null;
  lead_id: number | null;
  lead_nombre: string | null;
  lead_status: string | null;
  project_id: number | null;
  es_grupo: boolean;
  no_escribir: boolean;
  motivo_no_escribir: string | null;
  ultimo_at: string | null;
  no_leidos: number;
  ultimo_texto: string | null;
  /** De que tipo fue el ultimo mensaje: si fue foto o audio no hay texto. */
  ultimo_tipo?: string | null;
}

export interface MensajeWhatsapp {
  id: number;
  wa_id: string | null;
  direccion: 'entrante' | 'saliente';
  tipo: string;
  texto: string | null;
  media_url: string | null;
  media_mime: string | null;
  nombre_archivo: string | null;
  /** El permiso para pedir el adjunto: «?c=...&f=...». Un <img> no puede
   *  mandar cabeceras, asi que lo que autoriza es esta firma temporal. Se pega
   *  detras de urlMedia(id) — la direccion la arma el frontend, que es quien
   *  sabe si el CRM cuelga de /crm/ o de /testeo/. */
  media_firma: string | null;
  /** A que mensaje responde este, y un adelanto del citado para pintarlo. */
  responde_a?: string | null;
  citado_texto?: string | null;
  citado_tipo?: string | null;
  citado_direccion?: 'entrante' | 'saliente' | null;
  estado: 'enviado' | 'entregado' | 'leido' | 'fallido' | null;
  enviado_por: number | null;
  ts: string;
}

export interface ConexionWhatsapp {
  configurado: boolean;
  motivo?: string;
  instancia?: string;
  numero?: string | null;
  nombre?: string | null;
  conectado?: boolean;
  estado?: string | null;
}

export const chatApi = {
  /** Pide el adjunto de un mensaje que no se bajo en su momento. */
  descargarAdjunto: (mensajeId: number): Promise<ApiResponse<{ enCola?: boolean; yaEstaba?: boolean }>> =>
    client.post(`/whatsapp/mensajes/${mensajeId}/descargar`, {}),

  lista: (projectId?: number | null, usuarioId?: number | null): Promise<ApiResponse<ChatWhatsapp[]>> =>
    client.get(`/whatsapp/chats${qs({ projectId, usuarioId })}`),

  /** Quien esta escribiendo ahora mismo en la conversacion abierta. */
  hilo: (id: number, limite = 100, usuarioId?: number | null): Promise<ApiResponse<{ conversacion: ChatWhatsapp; mensajes: MensajeWhatsapp[]; escribiendo: { quien: string; que: string } | null }>> =>
    client.get(`/whatsapp/chats/${id}${qs({ limite, usuarioId })}`),

  /** `citarId` es el mensaje al que se responde: sale con la cita encima. */
  enviar: (id: number, texto: string, citarId?: number | null, usuarioId?: number | null): Promise<ApiResponse<MensajeWhatsapp>> =>
    client.post(`/whatsapp/chats/${id}/enviar`, { texto, citarId, usuarioId }),

  noEscribir: (id: number, motivo: string): Promise<ApiResponse<null>> =>
    client.post(`/whatsapp/chats/${id}/no-escribir`, { motivo }),

  // Abrir un chat nuevo partiendo de un prospecto. Se parte de la base y no de
  // un numero suelto: quien esta ahi dejo su telefono en un formulario nuestro.
  abrir: (leadId: number): Promise<ApiResponse<ChatWhatsapp>> =>
    client.post('/whatsapp/chats', { leadId }),

  // Abrir con un contacto de WhatsApp que no es prospecto. El freno de
  // consentimiento sigue vigente: si nunca ha escrito, no se le puede escribir.
  abrirPorTelefono: (telefono: string): Promise<ApiResponse<ChatWhatsapp>> =>
    client.post('/whatsapp/chats', { telefono }),

  // Prospectos con telefono, para elegir a quien escribir.
  buscarProspectos: (projectId: number | null, texto: string): Promise<ApiResponse<Array<{ id: number; nombre: string; telefono: string | null; status: string }>>> =>
    client.get(`/leads${qs({ projectId, search: texto || undefined, limit: 15 })}`),

  // ¿Sigue entrando historial? Al emparejar tarda varios minutos.
  sincronizacion: (usuarioId?: number | null): Promise<ApiResponse<{ conversaciones: number; mensajes: number; entrando: boolean; haceSegundos: number | null; adjuntosPendientes: number }>> =>
    client.get(`/whatsapp/sincronizacion${qs({ usuarioId })}`),

  conexion: (usuarioId?: number | null): Promise<ApiResponse<ConexionWhatsapp>> =>
    client.get(`/whatsapp/conexion${qs({ usuarioId })}`),

  // El adjunto va en multipart, no en JSON: el cliente de axios ya pone el
  // Content-Type con su boundary si se le pasa un FormData.
  adjunto: (id: number, archivo: File, pie?: string): Promise<ApiResponse<MensajeWhatsapp>> => {
    const fd = new FormData();
    fd.append('archivo', archivo);
    if (pie) fd.append('pie', pie);
    return client.post(`/whatsapp/chats/${id}/adjunto`, fd);
  },
};

/** La direccion desde la que se ve un adjunto ya descargado. */
export const urlMedia = (mensajeId: number) =>
  `${(import.meta.env.BASE_URL || '/crm/').replace(/\/$/, '')}/api/whatsapp/media/${mensajeId}`;

/** Alguien de quien se puede abrir el WhatsApp. Para una gestora, solo ella. */
export interface UsuarioWhatsapp {
  id: number;
  nombre: string;
  email: string;
  role: string;
  soyYo: boolean;
  conectado: boolean;
  numero: string | null;
}

/**
 * De quien puedo ver el WhatsApp.
 *
 * La pantalla no decide nada: pregunta y pinta. Si el servidor devuelve una
 * sola persona —el caso de una gestora— el selector ni se enseña.
 */
export const usuariosWhatsapp = (): Promise<ApiResponse<UsuarioWhatsapp[]>> =>
  client.get('/whatsapp/usuarios');
