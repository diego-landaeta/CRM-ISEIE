import client, { API_BASE_URL } from '@/shared/api/client';

// Conexión → MCP: el panel desde el que cada persona conecta su Claude al CRM.
//
// El token se ve UNA vez, en la respuesta de `crearToken`. El servidor solo
// guarda su huella, así que no hay forma de volver a pedirlo: si se pierde, se
// revoca y se crea otro.

export interface McpToken {
  id: number;
  nombre: string;
  /** Los primeros caracteres, para reconocerlo. Nunca el token. */
  prefijo: string;
  created_at: string;
  /** null = no caduca. */
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  /** Desde dónde se usó por última vez (#194). */
  last_used_ip?: string | null;
  last_used_cliente?: string | null;
  /** 'manual' | 'sin_uso' | 'usuario_desactivado' | 'conector' */
  revocado_motivo?: string | null;
  vivo: boolean;
  /** Cuándo volverá a pedir el código (#192). null con el código apagado o la URL muerta. */
  codigo?: McpEstadoCodigo | null;
}

/**
 * Cuándo volverá a pedir el código una URL (#192, Diego 05/10). Lo calcula el
 * servidor, con la hora de Madrid: aquí solo se enseña `texto`.
 */
export interface McpEstadoCodigo {
  estado: 'sin_desbloquear' | 'desbloqueada' | 'bloqueada' | 'pendiente';
  /** Hasta cuándo está bloqueada por códigos falsos. Ya no hay horas de caducidad (#326). */
  hasta: string | null;
  texto: string;
  /** Cada Claude conectado con esta URL, para autorizarlo o rechazarlo (#326). */
  conexiones?: McpConexionClaude[];
}

/** Un Claude conectado a una URL (#326): queda pendiente hasta que su dueño lo autoriza. */
export interface McpConexionClaude {
  id: number;
  token_id: number;
  cliente: 'claude' | 'claude_code';
  estado: 'pendiente' | 'autorizada' | 'rechazada';
  desbloqueada: boolean;
  created_at: string;
  last_used_at: string | null;
  decidida_at: string | null;
  /** Solo en la lista del super admin. */
  persona?: string;
  url?: string;
}

export interface McpProyecto {
  id: number;
  nombre: string;
  sociedad_id: number | null;
  sociedad_nombre: string | null;
}

export interface McpHerramienta {
  nombre: string;
  titulo: string;
  descripcion: string;
  /** El apartado de «Consultas disponibles» en que se enseña. */
  grupo: string;
}


export interface McpEstado {
  tieneAcceso: boolean;
  puedeAdministrar: boolean;
  soloLoSuyo: boolean;
  /** null = los tokens no caducan. */
  diasDeVida: number | null;
  /** Días sin usarse tras los que una URL se revoca sola; null = nunca (#194). */
  diasSinUso?: number | null;
  proyectos: McpProyecto[];
  herramientas: McpHerramienta[];
  tokens: McpToken[];
  /** Interruptor de emergencia (#196). */
  interruptor?: McpInterruptor;
  puedeApagar?: boolean;
  /** Código de desbloqueo (#192): si hace falta y cuánto dura cada cosa. */
  codigo?: {
    obligatorio: boolean; minutosCodigo: number;
    /**
     * TODAS sus URLs vivas, estén en el ámbito que se mira o no (#260): para
     * avisar de las que la lista de conexiones no enseña. `ambito`: dónde está
     * su conexión («ICTESS», «Todo el sistema»…); null en una URL suelta.
     */
    urls?: { id: number; nombre: string; ambito: string | null }[];
  };
  /** Super admin: los Claude conectados de otras personas, para poder rechazarlos (#326). */
  conexionesDelEquipo?: McpConexionClaude[] | null;
}

export interface McpInterruptor {
  apagado: boolean;
  /** Apagado con MCP_DISABLED=1 en el .env: el botón no lo enciende. */
  porEnv: boolean;
  porBoton: boolean;
  cambiadoPor: string | null;
  cambiadoAt: string | null;
  motivo: string | null;
}

export interface McpCodigo {
  /** Se enseña una vez. El servidor solo guarda su huella. */
  codigo: string;
  caducaAt: string;
  minutos: number;
}

export interface McpPersona {
  id: number;
  nombre: string;
  email: string;
  role: string;
  usa_mcp: boolean;
  porRol: boolean;
  tieneAcceso: boolean;
  tokens_vivos: number;
  ultimo_uso: string | null;
}

/** La dirección que se pega en Claude. La misma API del CRM, en /mcp. */
/** Una consulta de Claude, de Conexión → MCP → Actividad (#195). */
export interface McpActividadFila {
  id: number;
  created_at: string;
  user_id: number | null;
  persona: string | null;
  email: string | null;
  token_id: number | null;
  url_nombre: string | null;
  prefijo: string | null;
  connector_id: number | null;
  conexion: string | null;
  herramienta: string;
  parametros: Record<string, unknown> | null;
  ok: boolean;
  error: string | null;
  duracion_ms: number | null;
  ip: string | null;
  cliente: string | null;
}

export interface McpActividad {
  total: number;
  pagina: number;
  limite: number;
  filas: McpActividadFila[];
  opciones: {
    personas: { id: number; nombre: string }[];
    conexiones: { id: number; label: string }[];
    herramientas: string[];
  };
}

export interface McpFiltrosActividad {
  persona?: string; conexion?: string; desde?: string; hasta?: string;
  herramienta?: string; resultado?: string; pagina?: number;
}

export const urlDelMcp = () => `${window.location.origin}${API_BASE_URL}/mcp`;

export const mcpApi = {
  estado: () => client.get('/mcp/panel'),
  crearToken: (nombre: string) => client.post('/mcp/panel/tokens', { nombre }),
  /** Código para darle a Claude (#192): de UNA URL (#260), un solo uso, caduca en minutos. */
  crearCodigo: (tokenId: number) => client.post(`/mcp/panel/tokens/${tokenId}/codigo`, {}),
  revocarToken: (id: number) => client.delete(`/mcp/panel/tokens/${id}`),
  /** «Desbloquear desde aquí» (#192): sin pasar por Claude. Solo una URL tuya. */
  desbloquearUrl: (id: number) => client.post(`/mcp/panel/tokens/${id}/desbloquear`, {}),
  /** Autorizar o rechazar un Claude conectado a una URL (#326). */
  decidirConexion: (id: number, decision: 'autorizar' | 'rechazar') =>
    client.patch(`/mcp/panel/conexiones/${id}`, { decision }),
  personas: () => client.get('/mcp/panel/personas'),
  /** Interruptor de emergencia (#196): solo super admin. */
  cambiarInterruptor: (apagado: boolean, motivo?: string) => client.post('/mcp/panel/interruptor', { apagado, motivo }),
  /** Actividad (#195): solo super admin y admin. */
  actividad: (f: McpFiltrosActividad) => {
    const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]));
    return client.get(`/mcp/panel/actividad?${q.toString()}`);
  },
  cambiarAcceso: (id: number, usa_mcp: boolean) => client.patch(`/mcp/panel/personas/${id}`, { usa_mcp }),
};
