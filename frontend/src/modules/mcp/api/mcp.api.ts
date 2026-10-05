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
  /** Código de desbloqueo (#192): si hace falta y cuánto dura cada cosa. */
  codigo?: { obligatorio: boolean; minutosCodigo: number; inactividadMin: number; maximoMin: number };
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
export const urlDelMcp = () => `${window.location.origin}${API_BASE_URL}/mcp`;

export const mcpApi = {
  estado: () => client.get('/mcp/panel'),
  crearToken: (nombre: string) => client.post('/mcp/panel/tokens', { nombre }),
  /** Código para darle a Claude (#192): un solo uso, caduca en minutos. */
  crearCodigo: () => client.post('/mcp/panel/codigo', {}),
  revocarToken: (id: number) => client.delete(`/mcp/panel/tokens/${id}`),
  personas: () => client.get('/mcp/panel/personas'),
  cambiarAcceso: (id: number, usa_mcp: boolean) => client.patch(`/mcp/panel/personas/${id}`, { usa_mcp }),
};
