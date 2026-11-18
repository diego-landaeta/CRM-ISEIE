import { query } from '../../shared/config/db.js';

/**
 * Guarda un cobro de PayPal o lo pone al día. Lo que ya se sabía (el correo que
 * trajo el sondeo, por ejemplo) no se pisa con un vacío del webhook.
 */
export async function upsertPago(p) {
  const { rows } = await query(
    `INSERT INTO paypal_payments (
       project_id, paypal_id, tipo, status, amount, currency, fee_amount, net_amount,
       customer_email, customer_name, payer_id, invoice_id, custom_id, description,
       event_code, referencia_paypal_id, paypal_created_at, llegado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (project_id, paypal_id) DO UPDATE SET
       status = EXCLUDED.status,
       amount = EXCLUDED.amount,
       currency = EXCLUDED.currency,
       fee_amount = COALESCE(EXCLUDED.fee_amount, paypal_payments.fee_amount),
       net_amount = COALESCE(EXCLUDED.net_amount, paypal_payments.net_amount),
       customer_email = COALESCE(EXCLUDED.customer_email, paypal_payments.customer_email),
       customer_name = COALESCE(EXCLUDED.customer_name, paypal_payments.customer_name),
       payer_id = COALESCE(EXCLUDED.payer_id, paypal_payments.payer_id),
       invoice_id = COALESCE(EXCLUDED.invoice_id, paypal_payments.invoice_id),
       custom_id = COALESCE(EXCLUDED.custom_id, paypal_payments.custom_id),
       description = COALESCE(EXCLUDED.description, paypal_payments.description),
       event_code = COALESCE(EXCLUDED.event_code, paypal_payments.event_code),
       referencia_paypal_id = COALESCE(EXCLUDED.referencia_paypal_id, paypal_payments.referencia_paypal_id),
       llegado_por = EXCLUDED.llegado_por,
       synced_at = NOW(), updated_at = NOW()
     RETURNING *`,
    [
      p.project_id, p.paypal_id, p.tipo || 'cobro', p.status, p.amount, p.currency || 'EUR',
      p.fee_amount ?? null, p.net_amount ?? null, p.customer_email || null, p.customer_name || null,
      p.payer_id || null, p.invoice_id || null, p.custom_id || null, p.description || null,
      p.event_code || null, p.referencia_paypal_id || null, p.paypal_created_at, p.llegado_por || null,
    ]
  );
  return rows[0];
}

// Marca de «lo está enlazando alguien ahora», como en Stripe (#680).
export const ENLAZANDO = 'auto_enlazando';
const RESERVA_MINUTOS = 2;

/**
 * Reserva el cobro con UNA sola sentencia (la misma idea que la #699 de Stripe):
 * quien recibe la fila lo enlaza y los demás no hacen nada. Nadie se queda
 * esperando con una conexión cogida. Devuelve también lo que había antes.
 */
export async function reservar(id) {
  const { rows: [r] } = await query(
    `UPDATE paypal_payments pp
        SET link_method = $2, linked_at = NOW()
       FROM (SELECT id, link_method, linked_at FROM paypal_payments WHERE id = $1 FOR UPDATE) antes
      WHERE pp.id = antes.id
        AND pp.conversion_payment_id IS NULL
        AND (pp.link_method IS DISTINCT FROM $2 OR pp.linked_at < NOW() - make_interval(mins => $3))
      RETURNING pp.*, antes.link_method AS metodo_antes, antes.linked_at AS enlazado_antes`,
    [id, ENLAZANDO, RESERVA_MINUTOS]
  );
  return r || null;
}

/** Si no se llegó a enlazar, la fila vuelve a como estaba. */
export async function soltar(id, metodo, enlazado) {
  await query(
    `UPDATE paypal_payments SET link_method = $2, linked_at = $3 WHERE id = $1 AND link_method = $4`,
    [id, metodo, enlazado, ENLAZANDO]
  );
}

export async function enlazar(id, { leadId, conversionId, paymentId, userId = null, method }) {
  await query(
    `UPDATE paypal_payments SET
       lead_id = $2, conversion_id = $3, conversion_payment_id = $4,
       linked_by = $5, link_method = $6, linked_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [id, leadId, conversionId, paymentId, userId, method]
  );
}

export async function getById(id) {
  const { rows } = await query('SELECT * FROM paypal_payments WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function porPaypalId(projectId, paypalId) {
  const { rows } = await query(
    'SELECT * FROM paypal_payments WHERE project_id = $1 AND paypal_id = $2', [projectId, paypalId]);
  return rows[0] || null;
}

/** Los campus con la integración de PayPal guardada y activa. */
export async function proyectosConPaypal() {
  const { rows } = await query(
    `SELECT DISTINCT project_id FROM project_integrations
      WHERE provider = 'paypal' AND active = true AND encrypted_value IS NOT NULL
      ORDER BY project_id`
  );
  return rows.map((r) => Number(r.project_id));
}

export async function estadoSync(projectId) {
  const { rows } = await query('SELECT * FROM paypal_sync_state WHERE project_id = $1', [projectId]);
  return rows[0] || null;
}

export async function guardarEstadoSync(projectId, campos) {
  const cols = Object.keys(campos);
  const vals = Object.values(campos);
  await query(
    `INSERT INTO paypal_sync_state (project_id, ${cols.join(', ')})
     VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})
     ON CONFLICT (project_id) DO UPDATE SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}`,
    [projectId, ...vals]
  );
}

/** Cobros completados y sin enlazar de los últimos `dias`: los que reintenta «Sincronizar». */
export async function pendientesDeEnlazar(projectId, dias = 120) {
  const { rows } = await query(
    `SELECT * FROM paypal_payments
      WHERE project_id = $1 AND tipo = 'cobro' AND status = 'completed'
        AND conversion_payment_id IS NULL
        AND paypal_created_at > NOW() - make_interval(days => $2)
      ORDER BY paypal_created_at DESC LIMIT 1000`,
    [projectId, dias]
  );
  return rows;
}

export async function listar({ projectIds, enlazado, buscar, page = 1, limit = 50 }) {
  const conds = ['pp.project_id = ANY($1::int[])'];
  const params = [projectIds];
  let i = 2;
  if (enlazado === 'si') conds.push('pp.conversion_payment_id IS NOT NULL');
  if (enlazado === 'no') conds.push(`pp.conversion_payment_id IS NULL AND pp.tipo = 'cobro' AND pp.status = 'completed'`);
  const t = typeof buscar === 'string' ? buscar.trim().toLowerCase() : '';
  if (t) {
    conds.push(`(LOWER(pp.customer_email) LIKE $${i} OR LOWER(pp.customer_name) LIKE $${i} OR LOWER(pp.paypal_id) LIKE $${i})`);
    params.push(`%${t}%`); i++;
  }
  const where = conds.join(' AND ');
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = (Math.max(Number(page) || 1, 1) - 1) * lim;
  const { rows } = await query(
    `SELECT pp.id, pp.project_id, pp.paypal_id, pp.tipo, pp.status, pp.amount, pp.currency,
            pp.fee_amount, pp.customer_email, pp.customer_name, pp.invoice_id, pp.custom_id,
            pp.paypal_created_at, pp.conversion_id, pp.conversion_payment_id, pp.link_method,
            pp.llegado_por, l.nombre AS lead_nombre, cv.producto_contratado
       FROM paypal_payments pp
       LEFT JOIN leads l ON l.id = pp.lead_id
       LEFT JOIN conversions cv ON cv.id = pp.conversion_id
      WHERE ${where}
      ORDER BY pp.paypal_created_at DESC
      LIMIT ${lim} OFFSET ${off}`,
    params
  );
  const { rows: [c] } = await query(`SELECT COUNT(*)::int AS total FROM paypal_payments pp WHERE ${where}`, params);
  return { rows, total: c.total, page: off / lim + 1, limit: lim };
}

/**
 * Desde cuándo cuenta un campus: lo de antes ya se llevó fuera del CRM (#44).
 * Los mismos tres escalones que Stripe (`fechaDeCorte`): el corte puesto a mano,
 * la primera factura de la sociedad y el alta del campus. Aquí y no importado
 * de Stripe para que el módulo sea el mismo en los dos CRM.
 */
export async function sueloDelCampus(projectId) {
  const { rows } = await query(
    `SELECT COALESCE(
       (SELECT st.al_dia_hasta FROM invoicing_status st WHERE st.project_id = $1),
       (SELECT MIN(f.fecha_emision) FROM invoices f
         WHERE f.issuer_id = (SELECT pr.sociedad_emisora_id FROM projects pr WHERE pr.id = $1)
           AND f.tipo <> 'proforma' AND f.numero IS NOT NULL),
       (SELECT pr3.created_at::date FROM projects pr3 WHERE pr3.id = $1)
     ) AS corte`,
    [projectId]
  );
  return rows[0]?.corte || null;
}
