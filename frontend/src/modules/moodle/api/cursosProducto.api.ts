import client from '@/shared/api/client';

// Qué curso de Moodle es cada producto del catálogo (CRM#957). Lo lee la matrícula
// automática (#767) para saber en qué curso matricular a quien compra.

export interface CursoUnido {
  curso_moodle_id: number;
  curso_nombre: string | null;
}

export interface ProductoConCurso {
  id: number;
  nombre: string;
  activo: boolean;
  /** Ventas del campus con este producto. */
  ventas: number;
  /** Vacío = sin curso: la matrícula automática no puede con sus alumnos. */
  cursos: CursoUnido[];
}

export interface ResumenCursosProducto {
  total: number;
  con_curso: number;
  sin_curso: number;
  vendidos_sin_curso: number;
}

export interface CursoDelMoodle {
  id: number;
  nombre: string | null;
  visible: boolean;
}

export const cursosProductoApi = {
  productos: (campusId: number) =>
    client.get<{ campus: { id: number; nombre: string }; productos: ProductoConCurso[]; resumen: ResumenCursosProducto }>(
      `/moodle/campus/${campusId}/productos-cursos`),
  cursosMoodle: (campusId: number, refrescar = false) =>
    client.get<{ cursos: CursoDelMoodle[]; via: 'plugin' | 'panel' }>(
      `/moodle/campus/${campusId}/cursos-moodle`, { params: refrescar ? { refrescar: 1 } : {} }),
  unir: (campusId: number, productoId: number, cursoId: number) =>
    client.put<{ product_id: number; curso_moodle_id: number; curso_nombre: string | null }>(
      `/moodle/campus/${campusId}/productos/${productoId}/curso`, { curso_moodle_id: cursoId }),
  quitar: (campusId: number, productoId: number) =>
    client.delete<{ product_id: number; quitados: number }>(`/moodle/campus/${campusId}/productos/${productoId}/curso`),
};
