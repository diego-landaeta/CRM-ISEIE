import * as orders from './wc.orders.js';
import { getCreds } from './wc.model.js';
import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { proyectosDelAmbito } from '../../shared/utils/ambito.js';

/**
 * Pedidos de WooCommerce (#14): listado, sincronización a mano, interruptor y
 * secreto del aviso. Solo admin y super admin (lo pone la ruta), y cada admin solo
 * de SUS campus: `proyectosDelAmbito` recorta, un campus ajeno es un 403.
 */

/** El campus concreto sobre el que se actúa (obligatorio) y comprobado contra los de la persona. */
async function campusDe(req) {
  const id = parseInt(req.query.projectId ?? req.body?.project_id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('projectId requerido', 400, 'PROJECT_REQUIRED');
  req.query.projectId = String(id);
  await proyectosDelAmbito(req); // 403 si no es uno de sus campus
  return id;
}

export async function listar(req, res, next) {
  try {
    const q = req.query;
    res.json({ success: true, data: await orders.listarPedidos({
      ...(await proyectosDelAmbito(req)),
      status: q.status || null,
      q: q.q ? String(q.q).slice(0, 100) : null,
      leadId: q.leadId ? Number(q.leadId) : null,
      sinEnlazar: q.sinEnlazar === 'true',
      limite: q.limit, pagina: q.page,
    }) });
  } catch (err) { next(err); }
}

/** POST /sync/orders?projectId= — a mano. `completa=true` ignora la última vuelta y pide todo. */
export async function sincronizar(req, res, next) {
  try {
    const id = await campusDe(req);
    const creds = await getCreds(id);
    if (!creds || !creds.active) throw new AppError('Este campus no tiene WooCommerce conectado', 404, 'NOT_FOUND');
    if (!creds.consumer_key) throw new AppError('Faltan las claves de WooCommerce', 409, 'CONFLICT');
    const r = await orders.sincronizarPedidos(creds, { completa: req.query.completa === 'true' });
    res.json({ success: true, data: r });
  } catch (err) {
    // Un fallo de WooCommerce no es un 500 nuestro: se cuenta con su mensaje (sin claves).
    if (!(err instanceof AppError) && /WooCommerce contestó|aborted|fetch failed/i.test(err.message)) {
      return next(new AppError(err.message.startsWith('WooCommerce') ? err.message : 'WooCommerce no responde', 502, 'WC_ERROR'));
    }
    next(err);
  }
}

/** PUT /orders-config?projectId= { sync_orders } — enciende o apaga la sincronización de pedidos. */
export async function configurar(req, res, next) {
  try {
    const id = await campusDe(req);
    if (typeof req.body?.sync_orders !== 'boolean') throw new AppError('sync_orders tiene que ser true o false', 400, 'VALIDATION_ERROR');
    const { rowCount } = await query(`UPDATE wc_credentials SET sync_orders = $2 WHERE project_id = $1`, [id, req.body.sync_orders]);
    if (!rowCount) throw new AppError('Este campus no tiene credenciales de WooCommerce', 404, 'NOT_FOUND');
    res.json({ success: true, data: { project_id: id, sync_orders: req.body.sync_orders } });
  } catch (err) { next(err); }
}

/** POST /webhook-secret?projectId= — crea el secreto del aviso; se enseña UNA vez, con la ruta a poner en WooCommerce. */
export async function secretoDelAviso(req, res, next) {
  try {
    const id = await campusDe(req);
    const secreto = await orders.crearSecretoDelAviso(id);
    res.json({ success: true, data: { project_id: id, secreto, ruta: `/api/woocommerce/webhook/${id}` } });
  } catch (err) { next(err); }
}
