import client from '@/shared/api/client';
import type { ApiResponse } from '@/shared/types';

export interface Tutor {
  id: number;
  nombre: string;
  email: string;
  active: boolean;
  last_login_at: string | null;
  pendiente_de_entrar: boolean;
  dni_nif: string | null;
  iban: string | null;
  telefono: string | null;
  notas: string | null;
  formaciones: number;
}

export interface Colaboracion {
  id: number;
  tutor_id: number;
  product_id: number;
  pct: string;
  vigente_desde: string;
  vigente_hasta: string | null;
  activa: boolean;
  notas: string | null;
  tutor: string;
  formacion: string;
  precio: string;
  /** Marcada activa Y con las fechas de hoy dentro. Son dos cosas distintas. */
  rige_hoy: boolean;
}

export interface LineaSimulacion {
  tutor_id: number;
  tutor: string;
  product_id: number;
  formacion: string;
  pct: string;
  pagos: number;
  base: string;
  comision: string;
}

export interface AjustesTutores {
  aplica_desde: string;
  pct_por_defecto: string;
  updated_at: string;
}

export const tutoresApi = {
  listar: (projectId?: number | null) =>
    client.get(`/tutores${projectId ? `?projectId=${projectId}` : ''}`) as Promise<ApiResponse<Tutor[]>>,

  alta: (datos: {
    nombre: string; email: string; projectIds: number[];
    dniNif?: string; iban?: string; telefono?: string; notas?: string;
  }) => client.post('/tutores', datos) as Promise<ApiResponse<Tutor>>,

  guardarPerfil: (id: number, datos: Record<string, string | null>) =>
    client.patch(`/tutores/${id}/perfil`, datos) as Promise<ApiResponse<unknown>>,

  colaboraciones: (tutorId?: number | null) =>
    client.get(`/tutores/colaboraciones${tutorId ? `?tutorId=${tutorId}` : ''}`) as Promise<ApiResponse<Colaboracion[]>>,

  crearColaboracion: (datos: {
    tutorId: number; productId: number; pct: number; desde: string; hasta?: string | null; notas?: string;
  }) => client.post('/tutores/colaboraciones', datos) as Promise<ApiResponse<Colaboracion>>,

  editarColaboracion: (id: number, datos: Record<string, unknown>) =>
    client.patch(`/tutores/colaboraciones/${id}`, datos) as Promise<ApiResponse<Colaboracion>>,

  borrarColaboracion: (id: number) =>
    client.delete(`/tutores/colaboraciones/${id}`) as Promise<ApiResponse<{ borrada: boolean; desactivada: boolean; comisiones: number }>>,

  ajustes: () => client.get('/tutores/ajustes') as Promise<ApiResponse<AjustesTutores>>,
  guardarAjustes: (datos: { aplicaDesde?: string; pctPorDefecto?: number }) =>
    client.patch('/tutores/ajustes', datos) as Promise<ApiResponse<AjustesTutores>>,

  /** Lo que se pagaria si el calculo estuviera encendido. No crea nada. */
  simulacion: (desde: string, hasta: string, tutorId?: number | null) =>
    client.get(`/tutores/simulacion?desde=${desde}&hasta=${hasta}${tutorId ? `&tutorId=${tutorId}` : ''}`) as Promise<ApiResponse<LineaSimulacion[]>>,
};
