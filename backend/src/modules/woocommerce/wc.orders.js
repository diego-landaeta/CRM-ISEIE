import crypto from 'crypto';
import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { comoLista } from '../../shared/utils/ambito.js';

/**
 * Los pedidos de WooCommerce (#14): traerlos, guardarlos y enlazarlos a su prospecto.
 *
 * Tres formas de llegar, y las tres acaban en `guardarPedido`:
 *   · a mano: `POST /api/woocommerce/sync/orders`;
 *   · a su hora: el mismo scheduler de la tienda, si `sync_orders` está encendido;
 *   · en el momento: el aviso (webhook) que manda WooCommerce, firmado.
 *
 * UN PEDIDO NO CREA UNA VENTA. El dinero del CRM sale de `conversion_payments`, y
 * un pedido de la tienda y un cobro de Stripe pueden ser el mismo dinero: crear
 * ventas desde aquí lo contaría dos veces. Se guarda, y si su correo es el de un
 * prospecto vivo del campus, se enlaza (`lead_id`) para poder verlo en su ficha.
 */

const POR_PAGINA = 100;
const MAX_PAGINAS = 50; // 5.000 pedidos por vuelta como mucho

const aNumero = (v) => (v == null || v === '' ? null : Number(v));
const aFecha = (v) => (v ? new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v}Z`).toISOString() : null);

/** Un pedido de la API de WooCommerce a lo que se guarda. */
export function mapearPedido(o) {
  const b = o.billing || {};
  const nombre = [b.first_name, b.last_name].filter(Boolean).join(' ').trim() || null;
  return {
    wc_order_id: Number(o.id),
    numero: o.number != null ? String(o.number) : null,
    status: o.status || null,
    total: aNumero(o.total),
    currency: o.currency || null,
    customer_email: b.email ? String(b.email).trim().toLowerCase().slice(0, 255) : null,
    customer_name: nombre ? nombre.slice(0, 200) : null,
    line_items: (Array.isArray(o.line_items) ? o.line_items : []).map((l) => ({
      id: l.id, product_id: l.product_id ?? null, name: l.name, sku: l.sku || null,
      quantity: l.quantity, total: aNumero(l.total),
    })),
    wc_created_at: aFecha(o.date_created_gmt || o.date_created),
    wc_modified_at: aFecha(o.date_modified_gmt || o.date_modified),
  };
}

/** Guarda (o actualiza) un pedido y lo enlaza al prospecto con ese correo, si lo hay. */
export async function guardarPedido(projectId, orden) {
  const p = mapearPedido(orden);
  if (!Number.isFinite(p.wc_order_id)) throw new AppError('Pedido sin id', 400, 'VALIDATION_ERROR');
  let leadId = null;
  if (p.customer_email) {
    const { rows } = await query(
      `SELECT id FROM leads WHERE project_id = $1 AND lower(email) = $2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
      [projectId, p.customer_email]
    );
    leadId = rows[0]?.id || null;
  }
  const { rows: [r] } = await query(
    `INSERT INTO woocommerce_orders
       (project_id, wc_order_id, numero, status, total, currency, customer_email, customer_name, line_items, lead_id, wc_created_at, wc_modified_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
     ON CONFLICT (project_id, wc_order_id) DO UPDATE SET
       numero = EXCLUDED.numero, status = EXCLUDED.status, total = EXCLUDED.total, currency = EXCLUDED.currency,
       customer_email = EXCLUDED.customer_email, customer_name = EXCLUDED.customer_name, line_items = EXCLUDED.line_items,
       -- Un enlace ya hecho no se pierde si el correo del pedido cambia o el prospecto ya no está.
       lead_id = COALESCE(EXCLUDED.lead_id, woocommerce_orders.lead_id),
       wc_created_at = EXCLUDED.wc_created_at, wc_modified_at = EXCLUDED.wc_modified_at, synced_at = NOW()
     RETURNING id, (xmax = 0) AS nuevo`,
    [projectId, p.wc_order_id, p.numero, p.status, p.total, p.currency, p.customer_email, p.customer_name,
      JSON.stringify(p.line_items), leadId, p.wc_created_at, p.wc_modified_at]
  );
  return { id: r.id, nuevo: r.nuevo, enlazado: !!leadId };
}

/** Pide a WooCommerce los pedidos modificados desde `desde`, página a página. */
async function pedirPedidos(creds, desde) {
  const base = `${creds.store_url.replace(/\/$/, '')}/wp-json/wc/v3/orders`;
  const auth = `consumer_key=${encodeURIComponent(creds.consumer_key)}&consumer_secret=${encodeURIComponent(creds.consumer_secret)}`;
  const todos = [];
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const filtro = desde ? `&modified_after=${encodeURIComponent(new Date(desde).toISOString())}&dates_are_gmt=true` : '';
    const url = `${base}?per_page=${POR_PAGINA}&page=${pagina}&orderby=modified&order=asc${filtro}&${auth}`;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 30000);
    let res;
    try { res = await fetch(url, { signal: ctl.signal }); } finally { clearTimeout(t); }
    if (!res.ok) {
      // Nunca se devuelve la URL: lleva las claves.
      throw new Error(`WooCommerce contestó ${res.status} al pedir los pedidos (página ${pagina})`);
    }
    const items = await res.json();
    if (!Array.isArray(items) || !items.length) break;
    todos.push(...items);
    if (items.length < POR_PAGINA) break;
  }
  return todos;
}

/**
 * Sincroniza los pedidos de una tienda. Incremental: pide solo lo modificado desde
 * la última vez. Si falla, NO avanza `orders_last_sync_at`: la próxima vuelta
 * vuelve a pedir lo mismo y no se pierde ningún pedido.
 */
export async function sincronizarPedidos(creds, { completa = false } = {}) {
  const inicio = new Date();
  const desde = completa ? null : creds.orders_last_sync_at || null;
  const pedidos = await pedirPedidos(creds, desde);
  let nuevos = 0; let actualizados = 0; let enlazados = 0;
  for (const o of pedidos) {
    const r = await guardarPedido(creds.project_id, o);
    if (r.nuevo) nuevos += 1; else actualizados += 1;
    if (r.enlazado) enlazados += 1;
  }
  // Se avanza hasta el INICIO de la vuelta, no hasta ahora: lo que cambie mientras
  // se descarga se pedirá otra vez en la siguiente.
  await query(`UPDATE wc_credentials SET orders_last_sync_at = $2 WHERE project_id = $1`, [creds.project_id, inicio.toISOString()]);
  logger.info({ projectId: creds.project_id, nuevos, actualizados, enlazados }, 'Pedidos de WooCommerce sincronizados');
  return { total: pedidos.length, nuevos, actualizados, enlazados, desde };
}

// ── Lectura ───────────────────────────────────────────────────────────────

export async function listarPedidos({ projectId, projectIds = null, status = null, q = null, leadId = null, sinEnlazar = false, limite = 50, pagina = 1 }) {
  const lista = comoLista(projectId, projectIds);
  const params = [];
  const cond = [];
  if (lista) { params.push(lista); cond.push(`o.project_id = ANY($${params.length}::int[])`); }
  if (status) { params.push(status); cond.push(`o.status = $${params.length}`); }
  if (leadId) { params.push(leadId); cond.push(`o.lead_id = $${params.length}`); }
  if (sinEnlazar) cond.push('o.lead_id IS NULL');
  if (q) { params.push(`%${q}%`); cond.push(`(o.customer_email ILIKE $${params.length} OR o.customer_name ILIKE $${params.length} OR o.numero ILIKE $${params.length})`); }
  const n = Math.min(Math.max(Number(limite) || 50, 1), 200);
  const donde = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const { rows: [{ total }] } = await query(`SELECT count(*)::int AS total FROM woocommerce_orders o ${donde}`, params);
  params.push(n, (Math.max(Number(pagina) || 1, 1) - 1) * n);
  const { rows } = await query(
    `SELECT o.id, o.project_id, p.nombre AS campus, o.wc_order_id, o.numero, o.status, o.total, o.currency,
            o.customer_email, o.customer_name, o.line_items, o.lead_id, l.nombre AS lead_nombre,
            o.wc_created_at, o.synced_at
       FROM woocommerce_orders o
       JOIN projects p ON p.id = o.project_id
       LEFT JOIN leads l ON l.id = o.lead_id
       ${donde}
      ORDER BY o.wc_created_at DESC NULLS LAST, o.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  // wc_order_id es BIGINT y pg lo devuelve como texto: los ids de WooCommerce caben de sobra en un número.
  return { pedidos: rows.map((r) => ({ ...r, wc_order_id: Number(r.wc_order_id), total: r.total != null ? Number(r.total) : null })), total, limite: n };
}

// ── El aviso de WooCommerce (webhook) ─────────────────────────────────────

/** El secreto del aviso de un proyecto: se crea una vez y solo se enseña entonces. */
export async function crearSecretoDelAviso(projectId) {
  const secreto = crypto.randomBytes(24).toString('hex');
  const { rowCount } = await query(`UPDATE wc_credentials SET webhook_secret = $2 WHERE project_id = $1`, [projectId, secreto]);
  if (!rowCount) throw new AppError('Este campus no tiene credenciales de WooCommerce', 404, 'NOT_FOUND');
  return secreto;
}

/** ¿La firma (`X-WC-Webhook-Signature`: HMAC-SHA256 del cuerpo en base64) es la del secreto? */
export function firmaValida(cuerpoEnBruto, firma, secreto) {
  if (!secreto || !firma || !Buffer.isBuffer(cuerpoEnBruto)) return false;
  const esperada = crypto.createHmac('sha256', secreto).update(cuerpoEnBruto).digest();
  let recibida;
  try { recibida = Buffer.from(String(firma), 'base64'); } catch { return false; }
  return recibida.length === esperada.length && crypto.timingSafeEqual(recibida, esperada);
}

/** Atiende un aviso de WooCommerce: comprueba la firma y guarda el pedido. */
export async function recibirAviso(projectId, cuerpoEnBruto, firma) {
  const { rows: [c] } = await query(`SELECT project_id, webhook_secret, active FROM wc_credentials WHERE project_id = $1`, [projectId]);
  // La misma respuesta para «no existe», «sin secreto» y «firma falsa»: no se enseña cuál de las tres es.
  if (!c || !c.active || !firmaValida(cuerpoEnBruto, firma, c.webhook_secret)) {
    throw new AppError('Firma no válida', 401, 'INVALID_SIGNATURE');
  }
  const texto = cuerpoEnBruto.toString('utf8');
  // Al crear el aviso, WooCommerce manda un «ping» (webhook_id=N) que no es JSON.
  if (/^webhook_id=/.test(texto)) return { guardado: false };
  let orden;
  try { orden = JSON.parse(texto); } catch { throw new AppError('Cuerpo no válido', 400, 'VALIDATION_ERROR'); }
  // WooCommerce manda un «ping» al crear el aviso, sin pedido dentro: se acepta y no se guarda nada.
  if (!orden || orden.id == null) return { guardado: false };
  return { guardado: true, ...(await guardarPedido(projectId, orden)) };
}
