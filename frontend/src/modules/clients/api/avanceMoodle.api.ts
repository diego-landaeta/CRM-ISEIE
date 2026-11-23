import client from '@/shared/api/client';

// El avance del alumno en Moodle (#532): `GET /leads/:id/campus`. Solo lectura; el token
// de cada campus vive cifrado en el servidor y nunca llega aquí.

export type EstadoEnCurso = 'activo' | 'sin_acceso' | 'terminado';

export interface NotaMoodle {
  nota: number | null;
  /** Como la enseña el campus («8,00», «Apto»…). */
  texto: string | null;
  maxima: number | null;
  porcentaje: string | null;
}

export interface CursoDelAlumno {
  id: number;
  nombre: string | null;
  url: string;
  /** Fecha de la venta de ese curso en el CRM; null si no se sabe. */
  matriculadoEl: string | null;
  ultimoAcceso: string | null;
  /** El curso tiene la finalización activada en Moodle. */
  seguimiento: boolean;
  /** % hecho; null = sin seguimiento (nunca un 0 que lo disimule). */
  progreso: number | null;
  terminado: boolean;
  estado: EstadoEnCurso;
  /** Días desde su último acceso; null si nunca ha entrado o si está terminado. */
  diasSinAcceso: number | null;
  notas: { final: NotaMoodle | null; actividades: (NotaMoodle & { id: number; nombre: string | null; tipo: string })[] } | null;
  errorNotas: string | null;
}

export interface CampusDelAlumno {
  projectId: number;
  campus: string;
  campusUrl: string | null;
  alumno: { moodleId: number; suspendido: boolean; ultimoAcceso: string | null; perfilUrl: string } | null;
  error: string | null;
  avisoNotas: string | null;
  leidoAt?: string;
  cursos: CursoDelAlumno[];
}

export interface AvanceMoodle {
  /** false = el plugin del CRM aún no está aprobado en este servidor: no se enseña nada. */
  disponible: boolean;
  diasSinAccesoMaximos?: number;
  campus: CampusDelAlumno[];
}

export const avanceMoodleApi = {
  delAlumno: (leadId: number | string, { refrescar = false } = {}) =>
    client.get(`/leads/${leadId}/campus`, { params: refrescar ? { refrescar: 1 } : undefined }) as
      Promise<{ success: boolean; data: AvanceMoodle }>,
};
