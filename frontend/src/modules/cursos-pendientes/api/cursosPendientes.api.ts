import client from '@/shared/api/client';

/**
 * Cursos pendientes para las tutoras, por campus (#336). Una formación por crear
 * es UN registro dentro de su campus; las alumnas en espera cuelgan de él.
 */

export type EstadoCurso = 'pendiente_asignar' | 'asignado' | 'en_desarrollo' | 'publicado' | 'cerrado' | 'cancelado';
export type TipoCurso = 'curso' | 'diplomado' | 'master';
export type EstadoAlumna = 'en_espera' | 'habilitada' | 'cancelada';

export interface CursoPendiente {
  id: number;
  project_id: number;
  campus: string;
  product_id: number | null;
  nombre: string;
  url_prevista: string | null;
  tipo: TipoCurso;
  tutor_id: number | null;
  tutora: string | null;
  estado: EstadoCurso;
  fecha_solicitud: string;
  fecha_comprometida: string | null;
  fecha_publicacion: string | null;
  veces_movida_fecha: number;
  avance_foto: boolean;
  avance_video: boolean;
  avance_modulos: number;
  url_publicada: string | null;
  notas: string | null;
  /** «Retrasado» no es un estado: sale solo cuando la fecha ya pasó y no está publicado. */
  retrasado: boolean;
  /** Negativo = retrasado. */
  dias_para_la_fecha: number | null;
  alumnas_esperando: number;
  alumnas_total: number;
}

export interface Alumna {
  id: number;
  lead_id: number;
  nombre: string;
  email: string | null;
  telefono: string | null;
  conversion_id: number | null;
  fecha_compra: string | null;
  importe: string | null;
  estado: EstadoAlumna;
  avisada: boolean;
  avisada_at: string | null;
  habilitada_at: string | null;
  habilitada_por: string | null;
  falta_contacto: boolean;
}

export interface Apunte {
  id: number;
  accion: string;
  detalle: Record<string, unknown>;
  motivo: string | null;
  created_at: string;
  persona: string | null;
}

export interface Detalle extends CursoPendiente { alumnas: Alumna[]; historial: Apunte[] }

export interface ResumenCampus {
  project_id: number;
  campus: string;
  abiertos: number;
  retrasados: number;
  sin_tutora: number;
  alumnas_esperando: number;
}

export interface Resumen {
  campus: ResumenCampus[];
  total: { abiertos: number; retrasados: number; sin_tutora: number; alumnas_esperando: number };
  /** Solo supervisión (admin y super admin). */
  carga_por_tutora: { tutor_id: number; tutora: string; abiertos: number; cursos: number; diplomados: number; masters: number; retrasados: number }[] | null;
  indicadores: { project_id: number; campus: string; dias_medios_venta_a_habilitada: string | null; publicados_sin_habilitar: number }[] | null;
}

interface Respuesta<T> { success: boolean; data: T }
const dato = async <T>(p: Promise<unknown>): Promise<T> => (await p as Respuesta<T>).data;

export const cursosApi = {
  listar: (params: Record<string, string | number | boolean | undefined> = {}) =>
    dato<CursoPendiente[]>(client.get('/cursos-pendientes', { params })),
  resumen: (params: Record<string, string | number | undefined> = {}) =>
    dato<Resumen>(client.get('/cursos-pendientes/resumen', { params })),
  detalle: (id: number) => dato<Detalle>(client.get(`/cursos-pendientes/${id}`)),
  crear: (cuerpo: { project_id: number; nombre: string; tipo: TipoCurso; lead_id?: number | null }) =>
    dato<{ curso: CursoPendiente; nuevo: boolean; alumna_sumada: boolean }>(client.post('/cursos-pendientes', cuerpo)),
  modificar: (id: number, cuerpo: Record<string, unknown>) => dato<CursoPendiente>(client.patch(`/cursos-pendientes/${id}`, cuerpo)),
  publicar: (id: number, cuerpo: { url: string; sin_comprobar?: boolean }) =>
    dato<CursoPendiente>(client.post(`/cursos-pendientes/${id}/publicar`, cuerpo)),
  sumarAlumna: (id: number, leadId: number) => dato<unknown>(client.post(`/cursos-pendientes/${id}/alumnas`, { lead_id: leadId })),
  marcarAlumna: (id: number, alumnaId: number, cuerpo: { estado?: EstadoAlumna; avisada?: boolean }) =>
    dato<{ alumnas: Alumna[]; curso: CursoPendiente; cerrado: boolean }>(client.patch(`/cursos-pendientes/${id}/alumnas/${alumnaId}`, cuerpo)),
};

export const ESTADOS: Record<EstadoCurso, string> = {
  pendiente_asignar: 'Sin tutora', asignado: 'Asignado', en_desarrollo: 'En desarrollo',
  publicado: 'Publicado', cerrado: 'Cerrado', cancelado: 'Cancelado',
};
export const TIPOS: Record<TipoCurso, string> = { curso: 'Curso', diplomado: 'Diplomado', master: 'Máster' };
