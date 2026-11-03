import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { campusDeLaPersona, veTodoElCrm } from '../../shared/utils/ambito.js';

/**
 * Una matrícula, solo para quien trabaja en su campus.
 *
 * Las rutas `/:id` (ver, editar, borrar, cambiar de estado, subir un documento)
 * trabajaban con el id de la URL sin mirar de qué campus era: cualquier sesión
 * con rol de gestora o admin podía leer o cambiar la matrícula de otro campus,
 * con su DNI y sus datos, probando ids. Lo mismo que se cerró en ventas
 * (`conversion.acceso.js`).
 *
 * Regla, con la sesión: super admin y soporte, todo; el resto, solo sus campus
 * (`user_projects`). Se engancha con `router.param`, así que cubre también las
 * rutas que se añadan. La descarga firmada (`GET /:id/doc/:tipo`) va antes de
 * `verifyToken` y se protege con su firma: aquí, sin sesión, se deja pasar.
 */

const PROHIBIDO = () => new AppError('No tienes acceso a esa matrícula', 403, 'FORBIDDEN');

export async function puedeEnCampus(user, projectId) {
  if (veTodoElCrm(user)) return true;
  const mios = await campusDeLaPersona(user?.userId);
  return mios.includes(Number(projectId));
}

export async function matriculaPorId(req, res, next, valor) {
  try {
    if (!req.user) return next();   // la descarga firmada: la protege su firma
    // Solo dígitos canónicos. Con `Number()` entraban `7.5`, `7e1`, `+7`…: la guarda dejaba pasar lo
    // que no era un entero («ya responderá el controlador») y el controlador, con `parseInt`, servía
    // o borraba la matrícula 7 de otro campus. Lo que no sea un entero limpio es un 400.
    if (!/^[1-9]\d{0,14}$/.test(String(valor ?? ''))) throw new AppError('Identificador no válido', 400, 'INVALID_ID');
    const id = Number(valor);
    const { rows: [m] } = await query('SELECT project_id FROM matriculas WHERE id = $1', [id]);
    if (!m) throw new AppError('Matricula no encontrada', 404, 'NOT_FOUND');
    if (!(await puedeEnCampus(req.user, m.project_id))) throw PROHIBIDO();
    next();
  } catch (err) { next(err); }
}
