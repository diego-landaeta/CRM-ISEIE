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
  /** Esta plantilla va con una imagen detrás: al elegirla se abre el selector.
      El día 2 del proceso es el caso: el mensaje anuncia la opinión y la
      captura va justo después. */
  pide_adjunto?: boolean;
  /** Aviso para la gestora. NO se envía: es la letra pequeña del documento
      comercial, que hasta ahora solo estaba en el PDF. */
  pista?: string | null;
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
  // Con una EMPRESA puesta no hay UN proyecto: se manda `issuerId` y el
  // servidor lo traduce a sus campus. Una gestora de CEDIA atiende los siete.
  plantillas: (projectId: number | null, issuerId: number | null = null): Promise<ApiResponse<PlantillaWhatsapp[]>> =>
    client.get(`/whatsapp/templates${qs({ projectId, issuerId })}`),

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
  /** De que proyecto es el prospecto, si lo tiene. Para decirlo en la lista. */
  proyecto_nombre?: string | null;
  /**
   * Las etiquetas que la gestora tiene puestas en SU WhatsApp (#128, #138).
   *
   * No confundir con `lead_status`, que es la «etiqueta» del chat en el CRM
   * (#72): esa la decide el CRM y viaja con la persona. Estas viven en el movil
   * y las decide ella. Se enseñan las dos.
   *
   * Lista vacia mientras la migracion 157 no este aplicada.
   */
  etiquetas_wa?: { nombre: string; color: string | null; waId: string }[];
  es_grupo: boolean;
  no_escribir: boolean;
  motivo_no_escribir: string | null;
  ultimo_at: string | null;
  no_leidos: number;
  ultimo_texto: string | null;
  /** De que tipo fue el ultimo mensaje: si fue foto o audio no hay texto. */
  ultimo_tipo?: string | null;
  /** Si el ultimo mensaje lo mandamos nosotros o nos lo mandaron. */
  ultimo_direccion?: 'entrante' | 'saliente' | null;
  /**
   * Quien mando el ultimo mensaje, en un grupo.
   *
   * Null en un chat de una persona —ahi ya se sabe quien— y tambien en lo
   * saliente: de eso se encarga `ultimo_direccion`.
   */
  ultimo_autor?: string | null;
  /**
   * Quienes escriben en el grupo, para la cabecera.
   *
   * Solo llega al abrir la conversacion, no en la lista. Son los nombres que
   * sabemos —los de quien ha escrito—, no la lista de miembros: esa sale de la
   * agenda del movil y no la tenemos.
   */
  participantes?: string[];
  /**
   * Cuantos son de verdad, preguntandoselo a WhatsApp.
   *
   * Hace falta porque `participantes` solo trae a quien ha ESCRITO: en un grupo
   * recien enlazado eso ponia «Angel y tu» debajo de un grupo de doce.
   */
  miembros?: number | null;
}


/** Una fila del banco de mensajes (#101). */
export interface MensajeDelBanco {
  id: number;
  ts: string;
  direccion: 'entrante' | 'saliente';
  tipo: string;
  texto: string | null;
  estado: string | null;
  nombre_archivo: string | null;
  con_adjunto: boolean;
  participante_nombre: string | null;
  conversacion_id: number;
  telefono: string;
  instancia: string;
  es_grupo: boolean;
  quien: string | null;
  enviado_por_nombre: string | null;
}

/** El resumen por numero: un numero, todo lo suyo. */
export interface NumeroDelBanco {
  telefono: string;
  es_grupo: boolean;
  quien: string | null;
  mensajes: number;
  primero: string;
  ultimo: string;
  sesiones: number;
}

export interface FiltrosBanco {
  texto?: string;
  telefono?: string;
  desde?: string;
  hasta?: string;
  direccion?: '' | 'entrante' | 'saliente';
  tipo?: string;
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
  /** Quien escribio, SOLO en grupos (#74). Null en chats de una persona. */
  participante?: string | null;
  participante_nombre?: string | null;
  /**
   * Su foto, si esa persona tiene su propio chat con nosotros.
   *
   * Se saca de ahi en vez de guardarla por mensaje: es el mismo dato y evita
   * una tabla nueva de participantes.
   */
  participante_foto?: string | null;
  citado_texto?: string | null;
  citado_tipo?: string | null;
  citado_direccion?: 'entrante' | 'saliente' | null;
  /** Quien escribio el mensaje citado. Solo en grupos. */
  citado_autor?: string | null;
  /**
   * `enviando` no existe en la base: es solo de la pantalla.
   *
   * Marca el mensaje que ya se ve pero todavia no ha vuelto del servidor. En
   * cuanto vuelve, manda el estado de verdad.
   */
  estado: 'enviando' | 'enviado' | 'entregado' | 'leido' | 'fallido' | null;
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
  /** Lo que de verdad acepta un adjunto. Lo dice el servidor, no se adivina. */
  topeAdjuntoBytes?: number;
  /** Si entran los grupos. Lo decide el servidor (#74); la pantalla solo lo dice. */
  grupos?: boolean;
  /** Si este WhatsApp deja corregir mensajes. Falso en cuanto se sabe que no (#75). */
  puedeCorregir?: boolean;
}

/** La ficha del prospecto que se ve en el popup del chat (tarea #64). */
export interface FichaProspecto {
  id: number;
  nombre: string;
  email: string | null;
  telefono: string | null;
  status: string;
  notas: string | null;
  fecha_solicitud: string | null;
  created_at: string;
  reincidente: boolean | null;
  lead_duplicado_de: number | null;
  proyecto: string | null;
  responsable: string | null;
  producto: string | null;
  /**
   * Los datos de su formación, para rellenar plantillas sin salir del chat
   * (#129).
   *
   * `plazas_libres` se cuenta con el mismo SQL que el catálogo y la cola del
   * día, y viene calculada en el momento: el documento comercial dice que el
   * número de plazas «se comprueba antes de cada envío y nunca se arrastra del
   * mensaje anterior». Puede ser negativa —convocatoria sobrevendida— y quien
   * la pinta de cara al cliente es el que corta en cero.
   *
   * Null cuando esa formación no lleva cuenta de plazas, o cuando el prospecto
   * no tiene producto de interés.
   */
  plazas_libres?: number | null;
  fecha_cierre_convocatoria?: string | null;
  fecha_inicio_texto?: string | null;
}

export interface InteraccionProspecto {
  id: number;
  tipo: string;
  nota: string | null;
  fecha: string | null;
  quien: string | null;
}

/**
 * Lo que devuelve la ficha. `prospecto` en null NO es un error: son las
 * conversaciones de gente que escribe y todavia no esta en el CRM, que son
 * muchas. En ese caso vienen el telefono y el nombre para poder crearla.
 */
export interface RespuestaFicha {
  prospecto: FichaProspecto | null;
  interacciones?: InteraccionProspecto[];
  telefono: string | null;
  nombre?: string | null;
  esGrupo?: boolean;
}

export const chatApi = {
  /**
   * Cambia el estado del prospecto de una conversacion, SIN salir del chat.
   *
   * Es lo que pide la #72 de verdad: «que se le pueda anadir en seguimiento al
   * chat que estoy viendo». Las etiquetas de arriba solo FILTRAN; para cambiar
   * una habia que irse a Prospectos, buscar la ficha y volver — y volver
   * recarga el chat entero.
   *
   * Va contra el endpoint que ya existe. No hay estado propio del chat: es el
   * del prospecto, que es lo que viaja con la persona.
   */
  cambiarEstado: (leadId: number, status: string, motivo?: string | null): Promise<ApiResponse<unknown>> =>
    client.patch(`/leads/${leadId}/status`, motivo ? { status, motivo } : { status }),

  /**
   * Apuntar una nota en la ficha, sin salir del chat (#112).
   *
   * «Es lo que la gestora acaba de hacer —hablar con la persona— y el sitio
   * natural para escribirlo es donde esta mirando.» Antes habia que abrir otra
   * pestaña, que es justo lo que el popup venia a evitar.
   */
  apuntarNota: (leadId: number, nota: string): Promise<ApiResponse<unknown>> =>
    client.post(`/leads/${leadId}/interactions`, { tipo: 'nota', nota }),

  /**
   * La ficha del prospecto de una conversacion, para el popup del chat.
   *
   * `usuarioId` NO es opcional de verdad: sin el, con la sesion de otra persona
   * elegida el servidor busca en la del propio administrador y contesta que la
   * conversacion no existe. Es el mismo descuido que ya aparecio en otras cinco
   * llamadas de esta pantalla, y la tarea #64 pide justo lo contrario: que el
   * popup funcione igual cuando un admin mira el WhatsApp de una gestora.
   */
  ficha: (conversacionId: number, usuarioId?: number | null): Promise<ApiResponse<RespuestaFicha>> =>
    client.get(`/whatsapp/chats/${conversacionId}/ficha${qs({ usuarioId })}`),

  /**
   * Corrige un mensaje ya enviado (#75). WhatsApp deja 15 minutos, y solo con
   * los propios y de texto — lo comprueba el servidor antes de intentarlo.
   */
  editarMensaje: (mensajeId: number, conversacionId: number, texto: string, usuarioId?: number | null):
    Promise<ApiResponse<MensajeWhatsapp>> =>
    client.patch(`/whatsapp/mensajes/${mensajeId}${qs({ usuarioId })}`, { conversacionId, texto }),

  /** Pide el adjunto de un mensaje que no se bajo en su momento. */
  descargarAdjunto: (mensajeId: number, usuarioId?: number | null): Promise<ApiResponse<{ enCola?: boolean; yaEstaba?: boolean }>> =>
    client.post(`/whatsapp/mensajes/${mensajeId}/descargar${qs({ usuarioId })}`, {}),

  /**
   * La lista de chats. Con `busca`, filtra Postgres sobre TODAS y no el
   * navegador sobre las 50 cargadas — que era lo que dejaba fuera cualquier
   * seguimiento de hace semanas.
   */
  lista: (
    projectId?: number | null,
    usuarioId?: number | null,
    busca?: string | null,
    /** El estado del prospecto, que es lo que hace de etiqueta (#72). */
    estado?: string | null,
    /** Una etiqueta de WhatsApp, la del móvil de la gestora (#128, #138).
        Se puede combinar con `estado`: son dos filtros distintos. */
    etiquetaWa?: string | null,
  ): Promise<ApiResponse<ChatWhatsapp[]>> =>
    client.get(`/whatsapp/chats${qs({
      projectId, usuarioId,
      busca: busca || undefined,
      estado: estado || undefined,
      etiquetaWa: etiquetaWa || undefined,
    })}`),

  /** Quien esta escribiendo ahora mismo en la conversacion abierta. */
  hilo: (id: number, limite = 100, usuarioId?: number | null): Promise<ApiResponse<{ conversacion: ChatWhatsapp; mensajes: MensajeWhatsapp[]; escribiendo: { quien: string; que: string } | null }>> =>
    client.get(`/whatsapp/chats/${id}${qs({ limite, usuarioId })}`),

  /** `citarId` es el mensaje al que se responde: sale con la cita encima. */
  enviar: (id: number, texto: string, citarId?: number | null, usuarioId?: number | null): Promise<ApiResponse<MensajeWhatsapp>> =>
    client.post(`/whatsapp/chats/${id}/enviar`, { texto, citarId, usuarioId }),

  noEscribir: (id: number, motivo: string, usuarioId?: number | null): Promise<ApiResponse<null>> =>
    client.post(`/whatsapp/chats/${id}/no-escribir${qs({ usuarioId })}`, { motivo }),
  /**
   * Reenvia un mensaje a otro chat (#99, punto 5).
   *
   * `destinoId` es a donde va, y `mensajeId` de donde sale. Los dos chats
   * tienen que ser de la misma sesion; eso lo comprueba el servidor.
   */
  reenviar: (destinoId: number, mensajeId: number): Promise<ApiResponse<MensajeWhatsapp>> =>
    client.post(`/whatsapp/chats/${destinoId}/reenviar`, { mensajeId }),

  /**
   * El banco de mensajes (#101). No es el chat: es el respaldo.
   *
   * Un admin lo ve entero —incluidas las sesiones que ya no existen en
   * Evolution, que es justo para lo que sirve— y una gestora solo lo suyo. Eso
   * lo decide el servidor, aqui no se manda de quien.
   */
  banco: (f: FiltrosBanco = {}, pagina = 1, limite = 50) => {
    const q = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v) q.set(k, String(v)); });
    q.set('pagina', String(pagina));
    q.set('limite', String(limite));
    return client.get(`/whatsapp/banco?${q}`) as Promise<
      ApiResponse<MensajeDelBanco[]> & { pagination?: { total: number; page: number; limit: number; totalPages: number } }
    >;
  },

  bancoNumeros: (f: Pick<FiltrosBanco, 'texto' | 'telefono'> = {}): Promise<ApiResponse<NumeroDelBanco[]>> => {
    const q = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v) q.set(k, String(v)); });
    return client.get(`/whatsapp/banco/numeros?${q}`);
  },

  /**
   * Trae de Evolution lo que falte de ESTE chat (#73).
   *
   * Al enlazar solo entra el historial reciente, asi que un seguimiento de hace
   * dos meses no esta en la base y el buscador no puede encontrarlo. Esto pide
   * ese chat concreto, en vez de traer la cuenta entera.
   */
  traerHistorial: (id: number, limite = 300): Promise<ApiResponse<{ pedidos: number; metidos: number }>> =>
    client.post(`/whatsapp/chats/${id}/historial`, { limite }),

  // Apunta que se ha llamado. La llamada la hace el movil, no el CRM: por esta
  // via WhatsApp no da canal de audio. Aqui solo queda el registro, que es lo
  // que hoy se pierde de todas las llamadas que salen.
  apuntarLlamada: (id: number, usuarioId?: number | null): Promise<ApiResponse<{ telefono: string }>> =>
    client.post(`/whatsapp/chats/${id}/llamada`, { usuarioId }),

  // Abrir un chat nuevo partiendo de un prospecto. Se parte de la base y no de
  // un numero suelto: quien esta ahi dejo su telefono en un formulario nuestro.
  abrir: (leadId: number, usuarioId?: number | null): Promise<ApiResponse<ChatWhatsapp>> =>
    client.post('/whatsapp/chats', { leadId, usuarioId }),

  // Abrir con un contacto de WhatsApp que no es prospecto. Se puede: el freno
  // se apago el 21/08/2026. Queda apuntado en el registro del servidor, nada mas.
  abrirPorTelefono: (telefono: string, usuarioId?: number | null): Promise<ApiResponse<ChatWhatsapp>> =>
    client.post('/whatsapp/chats', { telefono, usuarioId }),

  // Prospectos con telefono, para elegir a quien escribir.
  buscarProspectos: (projectId: number | null, texto: string, projectIds: string | null = null): Promise<ApiResponse<Array<{ id: number; nombre: string; telefono: string | null; status: string }>>> =>
    client.get(`/leads${qs({ projectId, projectIds, search: texto || undefined, limit: 15 })}`),

  // ¿Sigue entrando historial? Al emparejar tarda varios minutos.
  sincronizacion: (usuarioId?: number | null): Promise<ApiResponse<{ conversaciones: number; mensajes: number; entrando: boolean; haceSegundos: number | null; adjuntosPendientes: number; progreso: number | null }>> =>
    client.get(`/whatsapp/sincronizacion${qs({ usuarioId })}`),

  conexion: (usuarioId?: number | null): Promise<ApiResponse<ConexionWhatsapp>> =>
    client.get(`/whatsapp/conexion${qs({ usuarioId })}`),

  // El adjunto va en multipart, no en JSON: el cliente de axios ya pone el
  // Content-Type con su boundary si se le pasa un FormData.
  /**
   * `segundos` solo para las notas de voz: es la duracion MEDIDA al grabar.
   * Lo que graba Chrome es webm y ese contenedor no la lleva en la cabecera,
   * asi que WhatsApp enseñaba una duracion inventada, mas larga que la real.
   *
   * `usuarioId` es de quien es el WhatsApp que se esta mirando. Va en la
   * direccion y no dentro del formulario: asi vale igual aqui que en las
   * llamadas normales, sin depender de como lea el servidor el multipart.
   */
  adjunto: (id: number, archivo: File, pie?: string, segundos?: number, usuarioId?: number | null): Promise<ApiResponse<MensajeWhatsapp>> => {
    const fd = new FormData();
    fd.append('archivo', archivo);
    if (pie) fd.append('pie', pie);
    if (segundos) fd.append('segundos', String(segundos));
    // Va en el formulario y no en la direccion porque esto es multipart. Sin el,
    // con la sesion de otra persona elegida el servidor busca en la del propio
    // administrador: la octava vez que aparece lo mismo, y la encontro sola la
    // prueba de `whatsappUsuarioId.test.js`.
    if (usuarioId) fd.append('usuarioId', String(usuarioId));
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
  /**
   * Si esta persona puede tener WhatsApp del CRM.
   *
   * Antes quien no podia NO SALIA en la lista, y nadie sabia por que — hoy los
   * tutores. No aparecer es la peor forma de negar algo: parece un fallo y se
   * pierde el rato buscandolo. Ahora sale, apagada y con su motivo.
   */
  puede: boolean;
  motivo: string | null;
  /**
   * Si ADEMAS lo usa (#128): la casilla de su ficha.
   *
   * Son dos preguntas: un admin puede tener derecho a WhatsApp y no usarlo. Los
   * apagados no se pintan en la lista —eso pidio Diego— pero el servidor los
   * sigue devolviendo y se cuentan al pie, para que no desaparezca gente sin
   * explicacion, que es lo que la #68 vino a arreglar.
   */
  usa: boolean;
}

/**
 * De quien puedo ver el WhatsApp.
 *
 * La pantalla no decide nada: pregunta y pinta. Si el servidor devuelve una
 * sola persona —el caso de una gestora— el selector ni se enseña.
 */
export const usuariosWhatsapp = (
  ambito: { projectId?: number | null; issuerId?: number | null } = {},
): Promise<ApiResponse<UsuarioWhatsapp[]>> =>
  client.get(`/whatsapp/usuarios${qs(ambito)}`);

/** Una etiqueta del WhatsApp de la gestora (#128, #138). */
export interface EtiquetaWhatsapp {
  id: number;
  wa_id: string;
  nombre: string;
  color: string | null;
  conversaciones: number;
}

/**
 * Las etiquetas de esta sesion.
 *
 * Vacio NO es un error: las etiquetas son de WhatsApp Business, asi que una
 * cuenta personal no tiene ninguna. La pantalla lo trata como «aqui no hay
 * nada que enseñar» y no pinta el boton.
 */
export const etiquetasWhatsapp = (usuarioId?: number | null):
  Promise<ApiResponse<EtiquetaWhatsapp[]>> =>
  client.get(`/whatsapp/etiquetas${qs({ usuarioId })}`);

/** Pone o quita una etiqueta en un chat. */
export const etiquetarChat = (
  conversacionId: number, waId: string, poner: boolean, usuarioId?: number | null,
): Promise<ApiResponse<{ waId: string; puesta: boolean }>> =>
  client.post(`/whatsapp/chats/${conversacionId}/etiqueta${qs({ usuarioId })}`, { waId, poner });
