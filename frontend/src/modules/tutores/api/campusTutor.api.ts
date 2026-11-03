import client from '@/shared/api/client';
import type { ApiResponse } from '@/shared/types';

/*
  Consultas de alumnos, fase 1 (#187): en qué campus atiende el tutor —por campus
  o por empresa entera—, si está matriculado en el campus de cada uno y
  «No disponible».
*/

/** activa · pendiente (su correo no es usuario del campus) · baja · null = sin comprobar. */
export type EstadoMatricula = 'activa' | 'pendiente' | 'baja' | null;

export interface CampusDelTutor {
  project_id: number;
  campus: string;
  /** 'campus' = puesto a mano · 'empresa' = le llega por una empresa entera. */
  via: 'campus' | 'empresa';
  issuer_id: number | null;
  empresa: string | null;
  /** Si el campus tiene su Moodle conectado en Integraciones. */
  campus_conectado: boolean;
  estado: EstadoMatricula;
  comprobado_at: string | null;
  error: string | null;
}

export interface EmpresaDelTutor {
  issuer_id: number;
  empresa: string;
  campus: number;
  created_at: string;
}

export interface PanelCampusTutor {
  campus: CampusDelTutor[];
  empresas: EmpresaDelTutor[];
  disponible: boolean;
  motivo_no_disponible: string | null;
  no_disponible_desde: string | null;
  /** Lo que ha salido al comprobar: campus sin matrícula o que no contestan. */
  avisos: string[];
}

export const campusTutorApi = {
  ver: (tutorId: number) =>
    client.get(`/tutores/${tutorId}/campus`) as Promise<ApiResponse<PanelCampusTutor>>,
  asignarCampus: (tutorId: number, projectId: number) =>
    client.post(`/tutores/${tutorId}/campus`, { projectId }) as Promise<ApiResponse<PanelCampusTutor>>,
  asignarEmpresa: (tutorId: number, issuerId: number) =>
    client.post(`/tutores/${tutorId}/empresas`, { issuerId }) as Promise<ApiResponse<PanelCampusTutor>>,
  quitarEmpresa: (tutorId: number, issuerId: number) =>
    client.delete(`/tutores/${tutorId}/empresas/${issuerId}`) as Promise<ApiResponse<PanelCampusTutor>>,
  comprobar: (tutorId: number) =>
    client.post(`/tutores/${tutorId}/campus/comprobar`, {}) as Promise<ApiResponse<PanelCampusTutor>>,
  disponible: (tutorId: number, disponible: boolean, motivo?: string | null) =>
    client.patch(`/tutores/${tutorId}/disponible`, { disponible, motivo: motivo || null }) as Promise<ApiResponse<PanelCampusTutor>>,
};
