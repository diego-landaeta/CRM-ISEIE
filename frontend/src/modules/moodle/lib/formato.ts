import type { EstadoCurso } from '../api/moodle.api';
import type { TonoEstado } from '@/shared/components/ui/StatusDot';

/** `2026-05-12` → `12/05/2026`. Sin fecha, un guion. */
export const fecha = (iso: string | null | undefined) => (iso ? iso.split('-').reverse().join('/') : '—');

export const ESTADO_DEL_CURSO: Record<EstadoCurso, { tono: TonoEstado; etiqueta: string; ayuda: string }> = {
  activo: { tono: 'success', etiqueta: 'Activo', ayuda: 'Visible y sin fecha de fin pasada' },
  proximo: { tono: 'info', etiqueta: 'Próximo', ayuda: 'Todavía no ha empezado' },
  terminado: { tono: 'neutral', etiqueta: 'Terminado', ayuda: 'Su fecha de fin ya pasó' },
  oculto: { tono: 'warning', etiqueta: 'Oculto', ayuda: 'No lo ve el alumnado' },
};

export const TIPO_DE_RECURSO: Record<string, string> = {
  youtube: 'YouTube', vimeo: 'Vimeo', drive: 'Google Drive', lti: 'Herramienta externa', enlace: 'Enlace',
};

/** El estado de un enlace comprobado, en palabras y con su tono. */
export const ESTADO_DEL_ENLACE: Record<string, { tono: TonoEstado; etiqueta: string }> = {
  ok: { tono: 'success', etiqueta: 'Responde' },
  roto: { tono: 'danger', etiqueta: 'Roto' },
  restringido: { tono: 'warning', etiqueta: 'Pide acceso' },
  error_servidor: { tono: 'warning', etiqueta: 'Error del servidor' },
  no_responde: { tono: 'warning', etiqueta: 'No responde' },
  bloqueado: { tono: 'neutral', etiqueta: 'No se comprueba' },
  sin_comprobar: { tono: 'neutral', etiqueta: 'Sin comprobar' },
};

export const TIPO_DE_ACTIVIDAD: Record<string, string> = {
  assign: 'Tarea', resource: 'Archivo', folder: 'Carpeta', page: 'Página', label: 'Etiqueta', forum: 'Foro',
  quiz: 'Cuestionario', url: 'Enlace', chat: 'Chat', book: 'Libro', lesson: 'Lección', scorm: 'SCORM',
  workshop: 'Taller', choice: 'Consulta', feedback: 'Encuesta', glossary: 'Glosario', data: 'Base de datos',
  wiki: 'Wiki', h5pactivity: 'H5P', lti: 'Herramienta externa', bigbluebuttonbn: 'Videoconferencia', zoom: 'Zoom',
};
