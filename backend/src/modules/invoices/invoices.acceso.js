import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { campusDeLaPersona, veTodoElCrm } from '../../shared/utils/ambito.js';

/**
 * Una factura, solo para quien trabaja en su campus.
 *
 * Las rutas `/:id` (ver, PDF, enviar, cobrar, anular, emitir, borrar…)
 * trabajaban con el id de la URL sin mirar el campus: cualquier sesión podía
 * leer, enviar o anular la factura de otro campus (con sus datos fiscales)
 * probando ids. Misma regla que en ventas y matrículas: super admin y soporte,
 * todo; el resto, solo sus campus (`user_projects`).
 *
 * Es una guardia por ruta y no `router.param('id')` porque en este módulo `:id`
 * también es el de las empresas emisoras, las plantillas y los regímenes, que no
 * son de un campus.
 */

const PROHIBIDO = () => new AppError('No tienes acceso a esa factura', 403, 'FORBIDDEN');

async function puedeEnCampus(user, projectId) {
  if (veTodoElCrm(user)) return true;
  return (await campusDeLaPersona(user?.userId)).includes(Number(projectId));
}

/** `/:id…`: la factura ha de ser de uno de sus campus. */
export async function facturaDeSuCampus(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return next();   // el controlador responde
    const { rows: [f] } = await query('SELECT project_id FROM invoices WHERE id = $1', [id]);
    if (!f) throw new AppError('Factura no encontrada', 404, 'NOT_FOUND');
    if (!(await puedeEnCampus(req.user, f.project_id))) throw PROHIBIDO();
    next();
  } catch (err) { next(err); }
}

/** Crear o generar en el campus que dice el cuerpo (`projectId`): ha de ser suyo. */
export async function campusDelCuerpo(req, res, next) {
  try {
    const projectId = Number(req.body?.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) return next();   // la validación responde 400
    if (!(await puedeEnCampus(req.user, projectId))) throw new AppError('No tienes acceso a ese campus', 403, 'FORBIDDEN');
    next();
  } catch (err) { next(err); }
}
