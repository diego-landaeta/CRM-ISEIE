import { query } from '../../shared/config/db.js';
import { exigirCampusSuyo } from '../../shared/utils/ambito.js';
import { AppError } from '../../shared/utils/AppError.js';

/**
 * Un formulario, solo para quien trabaja en su campus (CRM#791).
 *
 * Las rutas `/:id` (ver, estado, eventos recibidos, editar, borrar, escuchar)
 * trabajaban con el id de la URL sin mirar el campus: con `forms.view` se leían
 * los envíos de cualquier campus probando ids, y con `forms.edit` se cambiaba el
 * formulario de otra empresa. Misma regla que en el resto del CRM: superadmin y
 * soporte, todo; los demás, sus campus. Fuera de ellos es un 404, como si no
 * existiera (`exigirCampusSuyo`).
 *
 * El id ha de ser un entero positivo escrito solo con cifras; si no, 400 aquí
 * mismo. Antes se dejaba pasar «para que respondiera el controlador», pero solo
 * lo hacía el de eventos: `GET /forms/events` (lo que queda de `/forms//events`
 * cuando nginx junta las barras) llegaba a `getById` con «events», `parseInt`
 * daba NaN y Postgres un 500. Y con `Number` aquí y `parseInt` allí, `1e2` se
 * miraba como el 100 y se trabajaba sobre el 1: solo cifras, y nada que no
 * quepa en el `integer` de la tabla.
 */
const ID_MAXIMO = 2147483647;
export function idDeFormulario(valor) {
  const crudo = String(valor ?? '');
  if (!/^[1-9]\d{0,9}$/.test(crudo)) return null;
  const id = Number(crudo);
  return id <= ID_MAXIMO ? id : null;
}

export async function formularioDeSuCampus(req, res, next) {
  try {
    const id = idDeFormulario(req.params.id);
    if (!id) throw new AppError('ID inválido', 400, 'INVALID_ID');
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
