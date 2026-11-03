import client from '@/shared/api/client';

// Moodle: el panel de cursos, alumnos y recursos de cada campus (#335). Solo lectura.
// El token de cada Moodle vive cifrado en el servidor y nunca llega aquí.

export type EstadoCurso = 'activo' | 'proximo' | 'terminado' | 'oculto';
export type FiltroEstado = 'activos' | 'proximos' | 'terminados' | 'ocultos' | 'todos';
export type OrdenCursos = 'nombre' | 'inicio' | 'fin' | 'categoria';
export type SentidoOrden = 'asc' | 'desc';

export interface CampusMoodle {
  id: number;
  nombre: string;
  /** Hay un token de Moodle guardado para este campus. */
  configurado: boolean;
  cursos?: { total: number; activos: number; proximos: number; terminados: number; ocultos: number };
  /** El Moodle del campus no contestó (token caducado, caído…). */
  error?: string;
}

export interface CursoMoodle {
  campus_id: number;
  curso_id: number;
  nombre: string;
  nombre_corto: string | null;
  categoria: string | null;
  estado: EstadoCurso;
  visible: boolean;
  inicio: string | null;
  fin: string | null;
  finalizacion_activada: boolean;
  /** null = no se pudo leer (con su motivo en `alumnos_error`), nunca un 0 que lo disimule. */
  alumnos: number | null;
  alumnos_error?: string;
}

export interface ListaCursos {
  total: number;
  pagina: number;
  limite: number;
  cursos: CursoMoodle[];
  resumen: { cursos_en_moodle: number; de_cache: boolean; actualizado_hace_s: number };
}

/** Un curso que sale en «Para revisar»: los datos de siempre más lo que lo hace salir. */
export interface CursoParaRevisar extends CursoMoodle {
  alumnos: number;
  /** Solo en «con alumnos que nunca han entrado». */
  nunca_han_entrado?: number;
}

/** Qué cursos activos de un campus conviene mirar. Se calcula por tandas: mientras `pendientes` > 0, se vuelve a pedir. */
export interface RevisionCampus {
  total: number;
  revisados: number;
  /** Cursos que no se pudieron leer: ni salen como «sin alumnos» ni se cuentan como revisados. */
  no_leidos: number;
  pendientes: number;
  /** Moodle dijo que iba justo de carga: hay que esperar `espera_s` segundos antes de volver a pedir. */
  saturado: boolean;
  espera_s: number;
  hallazgos: {
    sin_alumnos: CursoParaRevisar[];
    dormidos: CursoParaRevisar[];
    con_nunca_entraron: CursoParaRevisar[];
  };
}

export interface CategoriaMoodle {
  id: number;
  nombre: string;
  ruta: string;
  padre_id: number | null;
  profundidad: number;
  cursos: number;
  visible: boolean;
}

export interface AlumnosDelCurso {
  matriculados: number;
  matricula_activa: number | null;
  suspendidos: number | null;
  nunca_han_entrado: number | null;
  terminados: number | null;
  criterios_de_finalizacion: boolean | null;
  otros_roles: number;
  avisos?: string[];
  /** `activos_ultimos_30_dias` (el número de días va en el nombre). */
  [campo: string]: unknown;
}

export interface ActividadDelCurso {
  nombre: string;
  tipo: string;
  visible: boolean;
}

export interface EstructuraDelCurso {
  total_secciones: number;
  total_actividades: number;
  por_tipo: Record<string, number>;
  secciones: { numero: number; nombre: string; visible: boolean; total_actividades: number; actividades: ActividadDelCurso[] }[];
}

export interface RecursoExterno {
  nombre: string;
  seccion: string;
  visible: boolean;
  tipo: 'youtube' | 'vimeo' | 'drive' | 'lti' | 'enlace';
  url: string | null;
  /** Solo si se pidió comprobar: ok · roto · restringido · error_servidor · no_responde · bloqueado · sin_comprobar. */
  estado?: string;
  http?: number;
}

export interface RecursosDelCurso {
  total_recursos_externos: number;
  por_tipo: Record<string, number>;
  enlaces_rotos?: number;
  recursos: RecursoExterno[];
}

/** Lo que dice el CRM tras probar y guardar una conexión. */
export interface ResultadoConexion {
  cursos: number;
  /** Funciones que le faltan al servicio del token y qué se pierde con cada una. */
  faltan: { funcion: string; consecuencia: string }[];
}

export interface RespuestaCampus {
  campus: CampusMoodle[];
  /** Las funciones que ha de tener el servicio del token. */
  funciones: string[];
}

const proyecto = (proyectoId: number) => ({ proyecto_id: proyectoId });

export const moodleApi = {
  /** Todos los campus, o solo uno con `proyectoId` (la pantalla de un campus no pregunta a los demás Moodle). */
  campus: (p: { proyectoId?: number; refrescar?: boolean } = {}) =>
    client.get('/moodle/campus', { params: { ...(p.proyectoId ? { proyecto_id: p.proyectoId } : {}), ...(p.refrescar ? { refrescar: 1 } : {}) } }),
  revision: (proyectoId: number, refrescar = false) =>
    client.get(`/moodle/campus/${proyectoId}/revision`, { params: refrescar ? { refrescar: 1 } : {} }),
  cursos: (p: { proyectoId: number; estado: FiltroEstado; texto?: string; categoriaId?: number | null; pagina: number; limite?: number; orden?: OrdenCursos; sentido?: SentidoOrden; refrescar?: boolean }) =>
    client.get('/moodle/cursos', {
      params: {
        proyecto_id: p.proyectoId,
        estado: p.estado,
        pagina: p.pagina,
        limite: p.limite ?? 25,
        orden: p.orden ?? 'nombre',
        sentido: p.sentido ?? 'asc',
        ...(p.texto ? { texto: p.texto } : {}),
        ...(p.categoriaId ? { categoria_id: p.categoriaId } : {}),
        ...(p.refrescar ? { refrescar: 1 } : {}),
      },
    }),
  /** Prueba la conexión y, si vale, la guarda (solo super admin). Sin `url` se reutiliza la guardada. Si no vale, no guarda nada y lanza el motivo. */
  conectar: (proyectoId: number, datos: { url?: string; token: string }) => client.post(`/moodle/campus/${proyectoId}/conexion`, datos),
  desconectar: (proyectoId: number) => client.delete(`/moodle/campus/${proyectoId}/conexion`),
  categorias: (proyectoId: number) => client.get('/moodle/categorias', { params: proyecto(proyectoId) }),
  alumnos: (proyectoId: number, cursoId: number) => client.get(`/moodle/cursos/${cursoId}/alumnos`, { params: proyecto(proyectoId) }),
  estructura: (proyectoId: number, cursoId: number) => client.get(`/moodle/cursos/${cursoId}/estructura`, { params: proyecto(proyectoId) }),
  recursos: (proyectoId: number, cursoId: number, comprobar = false) =>
    client.get(`/moodle/cursos/${cursoId}/recursos`, { params: { ...proyecto(proyectoId), ...(comprobar ? { comprobar: 1 } : {}) } }),
};
