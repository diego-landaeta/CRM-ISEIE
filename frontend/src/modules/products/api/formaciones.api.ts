import client from '@/shared/api/client';
import type { ApiResponse } from '@/shared/types';

/**
 * Productos › Formaciones (CRM#1113): una formación del catálogo con sus
 * módulos, de una vez. Una formación ES un producto: el id es el del producto.
 */

export type TipoFormacion = 'curso' | 'diplomado' | 'master';

export const TIPOS_FORMACION: Array<{ value: TipoFormacion; label: string }> = [
  { value: 'curso', label: 'Curso' },
  { value: 'diplomado', label: 'Diplomado' },
  { value: 'master', label: 'Máster' },
];

/** La regla de Diego (19/10) para una formación sin horas: lo mismo que guarda el servidor. */
export const HORAS_POR_TIPO: Record<TipoFormacion, number> = { curso: 100, diplomado: 750, master: 1500 };

export interface ModuloFormacion {
  id?: number;
  orden?: number;
  titulo: string;
  descripcion: string | null;
  horas: number | null;
}

export interface TutoraFormacion {
  colaboracion_id: number;
  tutor_id: number;
  nombre: string;
  /** Solo para quien gestiona colaboraciones (`tutores.gestionar`): es su comisión. */
  pct?: number;
  vigente_desde: string | null;
  vigente_hasta: string | null;
}

export interface Formacion {
  id: number;
  project_id: number;
  nombre: string;
  tipo_formacion: TipoFormacion | null;
  /** Sin tipo guardado, el que se adivina por el nombre (para proponerlo). */
  tipo_por_nombre: TipoFormacion | null;
  horas_totales: number | null;
  /** Lo que hay guardado tal cual («1.500 horas», «De 120 a 150 horas»). */
  horas_texto: string | null;
  precio: number | null;
  moneda: string | null;
  modalidad: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  fecha_inicio_texto: string | null;
  activa: boolean;
  /** Viene de la web: la importación vuelve a escribir nombre, precio y lo que la web diga. */
  de_la_web: boolean;
  url_info: string | null;
  modulos: ModuloFormacion[];
  horas_de_los_modulos: number;
  tutoras: TutoraFormacion[];
  cursos_moodle: Array<{ curso_moodle_id: number; curso_nombre: string | null }>;
}

export interface DatosFormacion {
  nombre: string;
  tipo_formacion: TipoFormacion | null;
  horas_totales: number | null;
  precio: number | null;
  moneda: string | null;
  modalidad: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  modulos: Array<{ id?: number; titulo: string; descripcion: string | null; horas: number | null }>;
}

export const formacionesApi = {
  ver: (id: number, projectId: number) =>
    client.get(`/products/${id}/formacion?projectId=${projectId}`) as Promise<ApiResponse<Formacion>>,
  crear: (projectId: number, datos: DatosFormacion) =>
    client.post('/products/formacion', { ...datos, projectId }) as Promise<ApiResponse<Formacion>>,
  guardar: (id: number, projectId: number, datos: DatosFormacion) =>
    client.put(`/products/${id}/formacion`, { ...datos, projectId }) as Promise<ApiResponse<Formacion>>,
};
