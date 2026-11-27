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
  /**
   * Si es un campus de quien mira (revisión de la #689, punto 2): su cuenta de Moodle
   * solo la vincula o desvincula quien gestiona tutores en esa empresa. De un campus de
   * otra empresa llega sin su error.
   */
  gestionable?: boolean;
  /**
   * Enlazada con la cuenta de administración del sitio, como excepción confirmada (24/11):
   * en ese campus responde y corrige desde Moodle.
   */
  admin_sitio_excepcion?: boolean;
  admin_sitio_excepcion_at?: string | null;
  /**
   * Con la excepción: el campus (plugin 1.11.7, CRM#1118) la tiene en «Administradoras que dan
   * clase», así que responde y corrige desde el CRM. Lo de la última comprobación.
   */
  admin_sitio_permitida?: boolean;
}

/** Una cuenta de Moodle encontrada al vincular a mano. */
export interface CuentaMoodle { id: number; nombre: string | null; email: string | null; suspendido: boolean }

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
  /** Buscar su cuenta de Moodle por su correo de Moodle (cuando no es el mismo que el del CRM). */
  buscarCuenta: (tutorId: number, projectId: number, q: string) =>
    client.get(`/tutores/${tutorId}/campus/${projectId}/buscar-cuenta?q=${encodeURIComponent(q)}`) as Promise<ApiResponse<CuentaMoodle | null>>,
  /**
   * Vincularla a mano: desde entonces la comprobación de cada hora mira esa cuenta. Con
   * `excepcionAdminDelSitio`, la cuenta de administración del sitio, confirmada en la ficha.
   */
  vincular: (tutorId: number, projectId: number, moodleUserId: number, excepcionAdminDelSitio = false) =>
    client.post(`/tutores/${tutorId}/campus/${projectId}/vincular`,
      excepcionAdminDelSitio ? { moodleUserId, excepcionAdminDelSitio: true } : { moodleUserId }) as Promise<ApiResponse<PanelCampusTutor>>,
  /** Su cuenta de Moodle cambió de verdad: olvidar la vinculada y buscarla por su correo. */
  vincularDeNuevo: (tutorId: number, projectId: number) =>
    client.post(`/tutores/${tutorId}/campus/${projectId}/desvincular`, {}) as Promise<ApiResponse<PanelCampusTutor>>,
  disponible: (tutorId: number, disponible: boolean, motivo?: string | null) =>
    client.patch(`/tutores/${tutorId}/disponible`, { disponible, motivo: motivo || null }) as Promise<ApiResponse<PanelCampusTutor>>,
};

/*
  Las tutoras redactoras en Moodle (CRM#1026): si su cuenta de cada campus está lista y si es
  profesora de los cursos que redacta. Solo lee; no matricula.
*/

/**
 * profesora («Profesor», `editingteacher`, como las tutoras de hoy) · sin_edicion
 * («Profesor sin permiso de edición», `teacher`: no puede redactar) · otro_rol
 * (matriculada, pero no como profesora) · sin_matricula · sin_comprobar.
 */
export type EstadoCursoRedaccion = 'profesora' | 'sin_edicion' | 'otro_rol' | 'sin_matricula' | 'sin_comprobar';

/** Por qué el producto es suyo. */
export type PorQueEsSuyo = 'colaboracion' | 'curso_pendiente' | 'responsable';

export interface CursoRedaccion {
  product_id: number;
  producto: string;
  producto_activo: boolean;
  por: PorQueEsSuyo[];
  curso_moodle_id: number;
  curso_nombre: string | null;
  estado: EstadoCursoRedaccion;
  roles: string[];
  /** La página de participantes del curso en Moodle (para matricularla a mano). */
  enlace: string | null;
}

export interface CampusRedaccion {
  project_id: number;
  campus: string;
  tiene_campus: boolean;
  campus_conectado: boolean;
  vinculada_en_crm: boolean;
  cuenta: { id: number; nombre: string | null; suspendida: boolean; vinculada: boolean } | null;
  problemas: string[];
  cursos: CursoRedaccion[];
}

export interface RedaccionEnMoodle {
  es_redactora: boolean;
  /** El rol de Moodle que debe tener en sus cursos: `editingteacher`. */
  rol_moodle?: string;
  campus: CampusRedaccion[];
  sin_curso: Array<{ product_id: number; producto: string; producto_activo: boolean; por: PorQueEsSuyo[] }>;
  lista: boolean;
}

export const redaccionMoodleApi = {
  ver: (tutorId: number) =>
    client.get(`/tutores/${tutorId}/redaccion-moodle`) as Promise<ApiResponse<RedaccionEnMoodle>>,
  /** La propia redactora, en «Mi campus»: el servidor usa el id de su sesión. */
  mia: () =>
    client.get('/tutores/mi-campus/redaccion-moodle') as Promise<ApiResponse<RedaccionEnMoodle>>,
  /** Supervisión de tutores (26/11/2026): lo que redacta una tutora de sus campus, sin tocar nada. */
  supervisada: (tutorId: number) =>
    client.get(`/tutores/supervision/${tutorId}/redaccion-moodle`) as Promise<ApiResponse<RedaccionEnMoodle>>,
};
