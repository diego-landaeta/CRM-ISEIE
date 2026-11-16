import { query } from '../../shared/config/db.js';
import { exigirCampusSuyo } from '../../shared/utils/ambito.js';

/**
 * Un formulario, solo para quien trabaja en su campus (CRM#791).
 *
 * Las rutas `/:id` (ver, estado, eventos recibidos, editar, borrar, escuchar)
 * trabajaban con el id de la URL sin mirar el campus: con `forms.view` se leían
 * los envíos de cualquier campus probando ids, y con `forms.edit` se cambiaba el
 * formulario de otra empresa. Misma regla que en el resto del CRM: superadmin y
 * soporte, todo; los demás, sus campus. Fuera de ellos es un 404, como si no
 * existiera (`exigirCampusSuyo`).
 */
export async function formularioDeSuCampus(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return next();   // el controlador responde 400
    const { rows: [f] } = await query('SELECT project_id FROM form_templates WHERE id = $1', [id]);
    await exigirCampusSuyo(req, f?.project_id ?? null, 'Form no encontrado');
    next();
  } catch (err) { next(err); }
}

/** Crear un formulario en el campus que dice el cuerpo (`project_id`): ha de ser suyo. */
export async function campusDelCuerpo(req, res, next) {
  try {
    const projectId = Number(req.body?.project_id);
    if (!Number.isInteger(projectId) || projectId <= 0) return next();   // la validación responde 400
    await exigirCampusSuyo(req, projectId, 'No tienes acceso a ese campus');
    next();
  } catch (err) { next(err); }
}
