import client from '@/shared/api/client';
import type { ApiResponse } from '@/shared/api/client';

// Monitask en el CRM (#236): la conexión, la actividad de cada persona y el cotejo
// con las facturas de colaboradores. Todo contesta 404 si el servidor tiene
// MONITASK_ACTIVO apagado: la pantalla lo trata como «apagado».

export interface EstadoMonitask {
  activo: boolean;
  client_id: string | null;
  tiene_secreto: boolean;
  secreto_cola: string | null;
  conectada: boolean;
  conectada_at: string | null;
  conectada_por: string | null;
  renueva_sola: boolean;
  access_caduca_at: string | null;
  margen_pct: number;
  redirect_uri: string | null;
  ultima_sync_at: string | null;
  ultima_sync: {
    desde?: string; hasta?: string; personas?: number; dias?: number; emparejadas?: number; avisos?: number;
    sin_actividad?: boolean; errores?: Array<{ que: string; error: string }>; fallo?: string;
  } | null;
  ultimo_error: string | null;
  ultimo_error_at: string | null;
  sincronizando: boolean;
}

export interface ProyectoHoras { nombre: string; horas: number }

export interface ActividadPersona {
  monitask_id: number;
  nombre: string;
  correo: string | null;
  colaborador_id: number | null;
  colaborador_nombre: string | null;
  user_id: number | null;
  usuario_nombre: string | null;
  horas: number;
  horas_activas: number | null;
  actividad_pct: number | null;
  dias: number;
  proyectos: ProyectoHoras[];
}

export interface DiaPersona {
  dia: string;
  horas: number;
  horas_activas: number | null;
  actividad_pct: number | null;
  entradas: number;
  proyectos: ProyectoHoras[];
  tareas: Array<{ nombre: string; proyecto: string; horas: number }>;
}

export interface FilaCotejo {
  colaborador_id: number;
  nombre: string;
  email: string;
  con_monitask: boolean;
  horas_facturadas: number | null;
  horas_otras_empresas: number;
  horas_monitask: number;
  horas_activas: number | null;
  actividad_pct: number | null;
  dias: number;
  sin_cotejo: boolean;
  diferencia_horas: number | null;
  diferencia_pct: number | null;
  fuera_de_margen: boolean;
  sin_factura: boolean;
  facturas: Array<{
    id: number; empresa: string; horas: number | null; modalidad: string | null;
    numero_factura: string | null; numero_recepcion: string | null; pagada: boolean;
  }>;
}

export interface Cotejo {
  periodo: string;
  margen_pct: number;
  filas: FilaCotejo[];
  resumen: { colaboradores: number; con_cotejo: number; factura_de_mas: number[]; factura_de_menos: number[] };
}

export interface PersonaMonitask {
  monitask_id: number;
  nombre: string;
  correo: string | null;
  emparejado: 'correo' | 'manual' | 'ninguno' | null;
  colaborador_id: number | null;
  colaborador_nombre: string | null;
  user_id: number | null;
  usuario_nombre: string | null;
  emparejado_por_nombre: string | null;
  ultimo_dia: string | null;
}

export interface Personas {
  personas: PersonaMonitask[];
  colaboradores: Array<{ id: number; nombre: string; email: string; activo: boolean; user_id: number | null }>;
  usuarios: Array<{ id: number; nombre: string; email: string; role: string }>;
}

export const monitaskApi = {
  estado: () => client.get('/monitask/estado') as Promise<ApiResponse<EstadoMonitask>>,
  guardar: (body: { client_id: string; client_secret?: string; margen_pct?: number }) =>
    client.put('/monitask/conexion', body) as Promise<ApiResponse<EstadoMonitask>>,
  desconectar: (todo = false) =>
    client.delete(`/monitask/conexion${todo ? '?todo=1' : ''}`) as Promise<ApiResponse<EstadoMonitask>>,
  autorizar: () => client.post('/monitask/conexion/autorizar') as Promise<ApiResponse<{ url: string }>>,
  sincronizar: (rango?: { desde: string; hasta: string }) =>
    client.post('/monitask/sincronizar', rango || {}) as Promise<ApiResponse<{ en_marcha: boolean; desde: string; hasta: string }>>,
  actividad: (qs: URLSearchParams) =>
    client.get(`/monitask/actividad?${qs}`) as Promise<ApiResponse<ActividadPersona[]>>,
  dias: (id: number, qs: URLSearchParams) =>
    client.get(`/monitask/actividad/${id}/dias?${qs}`) as Promise<ApiResponse<{ persona: { monitask_id: number; nombre: string }; dias: DiaPersona[] }>>,
  cotejo: (mes: string) => client.get(`/monitask/cotejo?mes=${mes}`) as Promise<ApiResponse<Cotejo>>,
  personas: () => client.get('/monitask/personas') as Promise<ApiResponse<Personas>>,
  emparejar: (id: number, body: { colaborador_id?: number | null; user_id?: number | null; ninguno?: boolean }) =>
    client.patch(`/monitask/personas/${id}`, body) as Promise<ApiResponse<Personas>>,
};

export function errorDe(e: unknown): string {
  const err = e as { data?: { error?: string }; message?: string };
  return err?.data?.error || err?.message || 'Error desconocido';
}

/** 7,5 h → «7,5 h». */
export function horasEscritas(h: number | null | undefined): string {
  if (h === null || h === undefined) return '—';
  return `${h.toLocaleString('es-ES', { maximumFractionDigits: 2 })} h`;
}
