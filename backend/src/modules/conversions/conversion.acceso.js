import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { campusDeLaPersona, veTodoElCrm } from '../../shared/utils/ambito.js';
import { soloLoSuyo } from '../../shared/utils/roles.js';

/**
 * Quién puede tocar UNA venta (y sus cuotas, pagos, devoluciones y reparto).
 *
 * El hueco que cierra: las rutas `/:id`, `/installments/:instId`,
 * `/payments/:paymentId`, `/refunds/:refundId` y `/by-lead/:leadId` trabajaban
 * con el id que llegaba en la URL y nada más. Cualquier persona con sesión,
 * de cualquier campus, podía leer o cambiar la venta de otro con solo probar
 * ids (IDOR). El listado sí estaba acotado; el detalle, no.
 *
 * La regla, con la sesión y nunca con parámetros de la URL:
 *   · super admin y soporte: todo;
 *   · el resto, solo ventas de SUS campus (`user_projects`);
 *   · además, la gestora, solo las suyas: es la responsable del prospecto, la
 *     vendedora de la venta o está en su reparto (el mismo criterio con el que
 *     se le filtra el listado).
 *
 * Se engancha con `router.param`, así que cubre todas las rutas con esos
 * parámetros, también las que se añadan mañana, sin acordarse de nada en cada
 * controlador. Un id que no es número se deja pasar: el controlador responde 400.
 */

async function puede(user, { project_id, responsable_id = null, vendedora_id = null, en_reparto = false }) {
  if (veTodoElCrm(user)) return true;
  const mios = await campusDeLaPersona(user?.userId);
  if (!mios.includes(Number(project_id))) return false;
  if (!soloLoSuyo(user)) return true;
  return [responsable_id, vendedora_id].some((x) => x != null && Number(x) === Number(user.userId)) || en_reparto;
}

const PROHIBIDO = () => new AppError('No tienes acceso a esa venta', 403, 'FORBIDDEN');

async function exigirVenta(req, conversionId) {
  const { rows: [v] } = await query(
    `SELECT c.id, c.project_id, c.vendedora_id, l.responsable_id,
            EXISTS (SELECT 1 FROM conversion_reparto r WHERE r.conversion_id = c.id AND r.vendedora_id = $2) AS en_reparto
       FROM conversions c JOIN leads l ON l.id = c.lead_id
      WHERE c.id = $1`,
    [conversionId, req.user?.userId ?? 0]
  );
  if (!v) throw new AppError('Venta no encontrada', 404, 'CONVERSION_NOT_FOUND');
  if (!(await puede(req.user, v))) throw PROHIBIDO();
}

/**
 * Un id solo vale si son DÍGITOS canónicos. `Number()` aceptaba `7.5`, `7e1`, `+7`, `007`…: la
 * guarda miraba una cosa y el controlador (`parseInt`) otra. `/conversions/7.5` pasaba por la
 * guarda como «no es entero» y el controlador servía la venta 7; `7e1` era la venta 70 para la
 * guarda y la 7 para el controlador. Lo que no sea un entero limpio es un 400, no un `next()`.
 */
const numero = (valor) => (/^[1-9]\d{0,14}$/.test(String(valor ?? '')) ? Number(valor) : null);

const IDENTIFICADOR_NO_VALIDO = () => new AppError('Identificador no válido', 400, 'INVALID_ID');

/** Para `router.param(nombre, guardia(...))`. */
const guardia = (buscar, noEncontrada, codigo = 'NOT_FOUND') => async (req, res, next, valor) => {
  try {
    const id = numero(valor);
    if (id === null) throw IDENTIFICADOR_NO_VALIDO();
    const conversionId = await buscar(id);
    if (conversionId === null) throw new AppError(noEncontrada, 404, codigo);
    await exigirVenta(req, conversionId);
    next();
  } catch (err) { next(err); }
};

const primera = async (sql, id, columna = 'conversion_id') => {
  const { rows: [f] } = await query(sql, [id]);
  return f ? f[columna] : null;
};

export const ventaPorId = guardia(async (id) => id, 'Venta no encontrada', 'CONVERSION_NOT_FOUND');
export const cuotaPorId = guardia((id) => primera('SELECT conversion_id FROM conversion_installments WHERE id = $1', id), 'Cuota no encontrada');
export const pagoPorId = guardia((id) => primera('SELECT conversion_id FROM conversion_payments WHERE id = $1', id), 'Pago no encontrado');
export const comisionPorId = guardia((id) => primera('SELECT conversion_id FROM commissions WHERE id = $1', id), 'Comisión no encontrada');
export const devolucionPorId = guardia((id) => primera('SELECT conversion_id FROM conversion_refunds WHERE id = $1', id), 'Devolución no encontrada');

/** `/by-lead/:leadId`: el prospecto ha de ser de sus campus y, si es gestora, suyo. */
export async function prospectoPorId(req, res, next, valor) {
  try {
    const id = numero(valor);
    if (id === null) throw IDENTIFICADOR_NO_VALIDO();
    const { rows: [l] } = await query('SELECT project_id, responsable_id FROM leads WHERE id = $1', [id]);
    // Un prospecto que no existe devuelve lista vacía, como antes: no se delata nada.
    if (l && !(await puede(req.user, { project_id: l.project_id, responsable_id: l.responsable_id }))) throw PROHIBIDO();
    next();
  } catch (err) { next(err); }
}

/** `POST /`: no se puede crear una venta en un campus ajeno ni sobre un prospecto ajeno. */
export async function puedeCrearEn(req, res, next) {
  try {
    const crudoLead = req.body?.lead_id;
    const crudoProyecto = req.body?.project_id;
    // Si falta alguno, el esquema responde 400. Pero si VIENE y no es un entero limpio no se puede
    // dejar pasar: el esquema podría interpretarlo (p. ej. «1e0») y la guarda no habría mirado nada.
    if (crudoLead == null || crudoProyecto == null) return next();
    const leadId = numero(crudoLead);
    const projectId = numero(crudoProyecto);
    if (leadId === null || projectId === null) throw IDENTIFICADOR_NO_VALIDO();
    const { rows: [l] } = await query('SELECT project_id, responsable_id FROM leads WHERE id = $1', [leadId]);
    if (!l) return next();                                       // el servicio responde 404
    // Manda el campus del PROSPECTO. Si la venta dice otro, el servicio responde 400
    // («el prospecto no pertenece al proyecto»); aquí solo se corta lo ajeno.
    if (!(await puede(req.user, { project_id: l.project_id, responsable_id: l.responsable_id }))) throw PROHIBIDO();
    next();
  } catch (err) { next(err); }
}
