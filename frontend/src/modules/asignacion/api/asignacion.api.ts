import client, { API_BASE_URL } from '@/shared/api/client';

/**
 * Conexión → «Asignación de leads» por actividad (CRM#513, 27/10/2026; migración 230).
 *
 * El formulario entra por Make, que se lo pasa al CRM (la ENTRADA). Si alguna
 * gestora ha trabajado en los últimos 15 minutos, el CRM crea el lead con ella y
 * lo manda al ESCENARIO 2; si no, lo manda al ESCENARIO 1, el de siempre.
 */

export type TipoDestino = 'mailhook' | 'webhook';
export type AmbitoAsignacion = 'todas' | 'empresa' | 'campus';
export type EstadoEnvio = 'pendiente' | 'enviando' | 'enviado' | 'fallido';

export interface ConfigAsignacion {
  id: number;
  nombre: string;
  activo: boolean;
  ambito: AmbitoAsignacion;
  issuer_id: number | null;
  empresa: string | null;
  project_id: number | null;
  proyecto: string | null;
  ventana_min: number;
  escenario1: { tipo: TipoDestino; cola: string | null };
  escenario2: { tipo: TipoDestino; cola: string | null };
  clave_cola: string | null;
  created_at: string;
  updated_at: string;
  ultima_decision_at: string | null;
  fallidos_30_dias: number;
  /** Solo al crear o al pedir otra: la única vez que se ve. */
  clave?: string;
}

export interface DecisionAsignacion {
  id: number;
  project_id: number;
  proyecto: string | null;
  uid: string;
  prueba: boolean;
  escenario: 1 | 2;
  responsable_id: number | null;
  responsable: string | null;
  lead_id: number | null;
  motivo: { texto?: string; activas?: Array<{ id: number; hoy: number; total: number; que?: string; ultima?: string }> } | null;
  cliente: string | null;
  cliente_email: string | null;
  estado: EstadoEnvio;
  destino_tipo: TipoDestino | null;
  intentos: number;
  http_status: number | null;
  error: string | null;
  enviado_at: string | null;
  created_at: string;
}

export interface Destino { tipo: TipoDestino; valor: string }

export interface DatosConfig {
  nombre?: string;
  activo?: boolean;
  ambito?: AmbitoAsignacion;
  issuer_id?: number | null;
  project_id?: number | null;
  ventana_min?: number;
  escenario1?: Destino;
  escenario2?: Destino;
}

/** La dirección que llama la entrada de Make (POST, con la clave). */
export const URL_ENTRADA = `${typeof window !== 'undefined' ? window.location.origin : ''}${API_BASE_URL}/asignacion/entrada`;

export const asignacionApi = {
  listar: () => client.get('/asignacion'),
  crear: (d: DatosConfig) => client.post('/asignacion', d),
  cambiar: (id: number, d: DatosConfig) => client.patch(`/asignacion/${id}`, d),
  borrar: (id: number) => client.delete(`/asignacion/${id}`),
  nuevaClave: (id: number) => client.post(`/asignacion/${id}/clave`, {}),
  probar: (id: number, escenario: 1 | 2) => client.post(`/asignacion/${id}/prueba`, { escenario }),
  decisiones: (f: { destinoId?: number | null; projectId?: number | null; issuerId?: number | null; escenario?: 1 | 2 | null; estado?: EstadoEnvio | '' } = {}) => {
    const q = new URLSearchParams();
    if (f.destinoId) q.set('destino_id', String(f.destinoId));
    // Un campus manda sobre la empresa: con los dos, el campus ya es de esa empresa.
    if (f.projectId) q.set('project_id', String(f.projectId));
    else if (f.issuerId) q.set('issuer_id', String(f.issuerId));
    if (f.escenario) q.set('escenario', String(f.escenario));
    if (f.estado) q.set('estado', f.estado);
    q.set('limit', '100');
    return client.get(`/asignacion/decisiones?${q.toString()}`);
  },
  reenviar: (id: number) => client.post(`/asignacion/decisiones/${id}/reenviar`, {}),
};

/** Un destino: correo de Make (mailhook) o URL https (webhook). Lo mismo que comprueba el servidor. */
export function errorDeDestino(tipo: TipoDestino, valor: string): string | undefined {
  const v = valor.trim();
  if (!v) return undefined;
  if (tipo === 'mailhook') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? undefined : 'Tiene que ser la dirección de correo que da Make';
  return /^https:\/\//i.test(v) ? undefined : 'Tiene que empezar por https://';
}
