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
  /** «Se desbloquea a los … días» en Moodle (CRM#1124); null = desde el principio. */
  dias_desbloqueo?: number | null;
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
  /** `url`: el enlace al curso en el Moodle del campus (si está conectado). */
  cursos_moodle: Array<{
    curso_moodle_id: number; curso_nombre: string | null; url?: string | null;
    /** Los días que el CRM dejó en cada sección la última vez que lo llevó a Moodle, por posición (CRM#1124). */
    dias_secciones?: Array<number | null>;
  }>;
  /** Fase 2: `disponible` = interruptor + plugin + permiso `moodle.crear_cursos`; `conectado` = el campus tiene su Moodle. */
  moodle?: { disponible: boolean; conectado: boolean };
}

export interface CursoGuardado {
  cursoId: number;
  nombre: string;
  nombreCorto: string;
  creado: boolean;
  visible: boolean;
  secciones: Array<{ numero: number; id: number }>;
  /** Secciones del curso de más, que no se han tocado. */
  sobran: number;
  /** El enlace al curso en el campus. */
  url?: string | null;
  /** Lo que Moodle no ha podido hacer, sin fallar, dicho para quien lo lee (p. ej. sin el plugin «Fecha relativa», CRM#1124). */
  avisos?: string[];
}

/** Una categoría del Moodle del campus. `ruta` solo si el token puede leer el árbol entero. */
export interface CategoriaMoodle {
  id: number;
  nombre: string;
  ruta: string | null;
  cursos: number;
}

/** De dónde sale la categoría: guardada en Integraciones, propuesta por su nombre o la de por defecto (0). */
export type OrigenCategoria = 'campus' | 'propuesta' | 'por_defecto';

export interface CategoriaElegida { id: number; nombre: string | null; origen: OrigenCategoria }

/** Un módulo con otros días en Moodle (CRM#1198). null = sin restricción. */
export interface DesbloqueoDistinto {
  /** El módulo, desde 0 (su sección en Moodle es la siguiente). */
  posicion: number;
  modulo: string;
  en_moodle: number | null;
  /** Desde cuándo cuentan en Moodle: 1 = inicio del curso, 3 = matrícula del alumno. */
  desde_moodle: number | null;
  aqui: number | null;
}

/** Fase 2: lo que se va a hacer en Moodle, antes de pulsar. */
export interface VistaPreviaMoodle {
  accion: 'crear' | 'actualizar' | 'varios';
  nombre: string;
  tipo: TipoFormacion;
  inicio: string | null;
  fin: string | null;
  /** Una sección por módulo, en orden. */
  secciones: string[];
  /** A los cuántos días se desbloquea cada sección, en el mismo orden (null = desde el principio), CRM#1124. */
  desbloqueo?: Array<number | null>;
  /** Las secciones a las que se les quita la restricción que tienen en Moodle: sus días, o null (se manda `dias = -1`). */
  quitar_desbloqueo?: Array<number | null>;
  /**
   * Solo al actualizar el único curso unido (CRM#1198): los módulos cuyo «se desbloquea» en Moodle
   * no es el de aquí (alguien lo cambió o lo quitó a mano allí). Vacío si coinciden o si no se
   * puede saber (plugin anterior a la 1.16.0, campus sin «Fecha relativa»…).
   */
  desbloqueo_distinto?: DesbloqueoDistinto[];
  cursos_unidos: Array<{ id: number; nombre: string | null; url: string | null }>;
  /** Solo al crear (al actualizar, Moodle deja la categoría, el nombre corto y la visibilidad como estén). */
  categoria?: CategoriaElegida | null;
  categorias?: CategoriaMoodle[];
  /** 'moodle' = el árbol entero; 'cursos' = solo las categorías con algún curso. */
  fuente_categorias?: 'moodle' | 'cursos' | null;
  nombre_corto?: { valor: string; propuesto: string; origen: 'sku' | 'regla'; ajustado: boolean } | null;
  visible?: boolean | null;
  aviso?: string | null;
}

/** Integraciones › Moodle: la categoría de cada tipo en el Moodle del campus. */
export interface CategoriasDelCampus {
  fuente: 'moodle' | 'cursos';
  categorias: CategoriaMoodle[];
  propuesta: Record<TipoFormacion, { id: number; nombre: string } | null>;
  guardadas: Partial<Record<TipoFormacion, number>>;
  efectivas: Record<TipoFormacion, CategoriaElegida>;
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
  /** `dias_desbloqueo` solo va con la fase 2 de Moodle encendida; sin la clave, el servidor deja lo guardado. */
  modulos: Array<{ id?: number; titulo: string; descripcion: string | null; horas: number | null; dias_desbloqueo?: number | null }>;
}

export const formacionesApi = {
  ver: (id: number, projectId: number) =>
    client.get(`/products/${id}/formacion?projectId=${projectId}`) as Promise<ApiResponse<Formacion>>,
  crear: (projectId: number, datos: DatosFormacion) =>
    client.post('/products/formacion', { ...datos, projectId }) as Promise<ApiResponse<Formacion>>,
  guardar: (id: number, projectId: number, datos: DatosFormacion) =>
    client.put(`/products/${id}/formacion`, { ...datos, projectId }) as Promise<ApiResponse<Formacion>>,
  /** Fase 2: qué se va a crear o actualizar en Moodle (solo lee). */
  vistaMoodle: (id: number, projectId: number) =>
    client.get(`/products/${id}/formacion/moodle?projectId=${projectId}`) as Promise<ApiResponse<VistaPreviaMoodle>>,
  /** Fase 2: crea o actualiza su curso de Moodle, con una sección por módulo. Al crear, la categoría y el nombre corto elegidos. */
  llevarAMoodle: (id: number, projectId: number, elegido: { categoria?: number | null; nombre_corto?: string | null } = {}) =>
    client.post(`/products/${id}/formacion/moodle`, { projectId, ...elegido }) as Promise<ApiResponse<{ curso: CursoGuardado; formacion: Formacion }>>,
  /** Integraciones › Moodle: las categorías del campus y la de cada tipo. */
  categoriasDelCampus: (projectId: number, refrescar = false) =>
    client.get(`/integrations/moodle/categorias?projectId=${projectId}${refrescar ? '&refrescar=1' : ''}`) as Promise<ApiResponse<CategoriasDelCampus>>,
  /** Un id (0 = la de por defecto del Moodle) o null (= la propuesta por el nombre). */
  guardarCategorias: (projectId: number, categorias: Record<TipoFormacion, number | null>) =>
    client.put('/integrations/moodle/categorias', { projectId, categorias }) as Promise<ApiResponse<{ guardadas: Partial<Record<TipoFormacion, number>> }>>,
};
