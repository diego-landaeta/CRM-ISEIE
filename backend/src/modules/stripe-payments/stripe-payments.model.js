import { query } from '../../shared/config/db.js';

export async function upsertPayment(p) {
  const { rows } = await query(
    `INSERT INTO stripe_payments (
       project_id, stripe_id, type, status, amount, currency,
       customer_email, customer_name, customer_stripe_id,
       description, metadata, payment_method,
       disputed, dispute_status, dispute_reason,
       refunded, refunded_amount, stripe_created_at, synced_at, fee_amount, net_amount
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,to_timestamp($18),NOW(),$19,$20)
     ON CONFLICT (project_id, stripe_id) DO UPDATE SET
       status=EXCLUDED.status, amount=EXCLUDED.amount,
       customer_email=EXCLUDED.customer_email, customer_name=EXCLUDED.customer_name,
       description=EXCLUDED.description, metadata=EXCLUDED.metadata,
       payment_method=EXCLUDED.payment_method,
       disputed=EXCLUDED.disputed, dispute_status=EXCLUDED.dispute_status,
       dispute_reason=EXCLUDED.dispute_reason,
       refunded=EXCLUDED.refunded, refunded_amount=EXCLUDED.refunded_amount,
       fee_amount=COALESCE(EXCLUDED.fee_amount, stripe_payments.fee_amount),
       net_amount=COALESCE(EXCLUDED.net_amount, stripe_payments.net_amount),
       synced_at=NOW(), updated_at=NOW()
     RETURNING id, conversion_id`,
    [
      p.project_id, p.stripe_id, p.type, p.status, p.amount, p.currency,
      p.customer_email, p.customer_name, p.customer_stripe_id,
      p.description, p.metadata ? JSON.stringify(p.metadata) : null, p.payment_method,
      !!p.disputed, p.dispute_status, p.dispute_reason,
      !!p.refunded, p.refunded_amount, p.stripe_created_at,
      p.fee_amount ?? null, p.net_amount ?? null,
    ]
  );
  return rows[0];
}

export async function findLeadByEmail(projectId, email) {
  if (!email) return null;
  const { rows } = await query(
    `SELECT id, status FROM leads WHERE project_id=$1 AND LOWER(email)=LOWER($2) AND deleted_at IS NULL ORDER BY id DESC LIMIT 1`,
    [projectId, email]
  );
  return rows[0] || null;
}

export async function findConversionByLeadId(leadId) {
  const { rows } = await query(`SELECT id, importe_total, importe_pagado FROM conversions WHERE lead_id=$1 ORDER BY id DESC LIMIT 1`, [leadId]);
  return rows[0] || null;
}

export async function linkPayment(stripePaymentId, { leadId, conversionId, conversionPaymentId, userId, method }) {
  await query(
    `UPDATE stripe_payments SET
       lead_id=$1, conversion_id=$2, conversion_payment_id=$3,
       linked_by=$4, link_method=$5, linked_at=NOW(), updated_at=NOW()
     WHERE id=$6`,
    [leadId, conversionId, conversionPaymentId, userId, method, stripePaymentId]
  );
}

// Detecta el duplicado REAL: el mismo cobro ya registrado a mano por la asesora
// (mismo importe y fecha a menos de 4 días) en esa venta. Se ignoran los pagos que
// ya vienen de Stripe para no confundir mensualidades iguales de meses distintos.
export async function findPagoDuplicado(conversionId, importe, fecha) {
  const { rows } = await query(
    `SELECT cp.id
       FROM conversion_payments cp
      WHERE cp.conversion_id = $1
        AND ROUND(cp.importe::numeric, 2) = ROUND($2::numeric, 2)
        AND ABS(cp.fecha - $3::date) <= 3
        AND NOT EXISTS (SELECT 1 FROM stripe_payments sp WHERE sp.conversion_payment_id = cp.id)
      ORDER BY cp.id LIMIT 1`,
    [conversionId, importe, fecha]
  );
  return rows[0] || null;
}

export async function createConversionPayment(conversionId, amount, fecha, notas) {
  const { rows } = await query(
    `INSERT INTO conversion_payments (conversion_id, importe, fecha, notas) VALUES ($1,$2,$3,$4) RETURNING id`,
    [conversionId, amount, fecha, notas]
  );
  return rows[0].id;
}

export async function updateConversionPaid(conversionId, addAmount) {
  await query(
    `UPDATE conversions SET importe_pagado = LEAST(importe_total, importe_pagado + $1), updated_at=NOW() WHERE id=$2`,
    [addAmount, conversionId]
  );
}

export async function listPayments({ projectId, status, linked, search, from, to, facturables, page = 1, limit = 50 }) {
  const conds = ['sp.project_id = $1'];
  const params = [projectId];
  let i = 2;
  if (status) { conds.push(`sp.status = $${i++}`); params.push(status); }
  if (linked === 'yes') conds.push('sp.conversion_id IS NOT NULL');
  if (linked === 'no')  conds.push('sp.conversion_id IS NULL');
  // facturables=1 → solo cobros que REALMENTE tocaría facturar: los posteriores a
  // la primera factura emitida por la sociedad del proyecto. Si esa sociedad aún
  // no factura (o empezó después), no se marca nada. Se deriva del dato, así que
  // no hay que configurar fechas de arranque a mano.
  if (facturables) {
    // Un cobro fallido/no cobrado nunca es facturable: solo los realmente cobrados.
    conds.push(`sp.status = 'succeeded'`);
    // El corte es el de la cola de facturacion: lo anterior ya se facturo fuera
    // del CRM y no hay que asociarlo. Antes se usaba la fecha de la PRIMERA
    // factura de la sociedad, que en ISEIE es de enero: colaba casi trescientos
    // cobros ya resueltos y la pantalla enseñaba los primeros cincuenta.
    // Si el proyecto no tiene corte puesto, se cae a la primera factura, que era
    // el comportamiento de antes.
    conds.push(`sp.stripe_created_at::date > COALESCE(
      (SELECT st.al_dia_hasta FROM invoicing_status st WHERE st.project_id = sp.project_id),
      (SELECT MIN(f.fecha_emision) FROM invoices f
        WHERE f.issuer_id = (SELECT pr.sociedad_emisora_id FROM projects pr WHERE pr.id = sp.project_id)
          AND f.tipo <> 'proforma' AND f.numero IS NOT NULL),
      DATE '1900-01-01')`);
    // Y el cliente NO tiene ya una factura en la sociedad (por email o nombre):
    // evita que aparezcan cobros de ventas ya facturadas manualmente.
    conds.push(`NOT EXISTS (
      SELECT 1 FROM invoices f
       WHERE f.issuer_id = (SELECT pr2.sociedad_emisora_id FROM projects pr2 WHERE pr2.id = sp.project_id)
         AND f.tipo <> 'proforma' AND f.estado <> 'cancelada'
         AND ( (sp.customer_email IS NOT NULL AND LOWER(f.cliente_email) = LOWER(sp.customer_email))
            OR (sp.customer_name  IS NOT NULL AND LOWER(f.cliente_nombre) = LOWER(sp.customer_name)) ))`);
  }
  if (search) { conds.push(`(LOWER(sp.customer_email) LIKE $${i} OR LOWER(sp.customer_name) LIKE $${i} OR sp.stripe_id LIKE $${i})`); params.push(`%${search.toLowerCase()}%`); i++; }
  if (from) { conds.push(`sp.stripe_created_at >= $${i++}`); params.push(from); }
  if (to)   { conds.push(`sp.stripe_created_at <= $${i++}`); params.push(to); }
  const where = conds.join(' AND ');
  const offset = (page - 1) * limit;
  const { rows } = await query(
    // Se añade a QUÉ pertenece el cobro: el curso/concepto de la conversión y la
    // factura emitida por ese pago concreto (si ya existe).
    `SELECT sp.*, l.nombre AS lead_nombre,
            cv.producto_contratado,
            f.codigo AS factura_codigo
     FROM stripe_payments sp
     LEFT JOIN leads l ON l.id = sp.lead_id
     LEFT JOIN conversions cv ON cv.id = sp.conversion_id
     LEFT JOIN invoices f ON f.payment_id = sp.conversion_payment_id AND f.tipo <> 'proforma'
     WHERE ${where}
     ORDER BY sp.stripe_created_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const { rows: c } = await query(`SELECT COUNT(*)::int AS total FROM stripe_payments sp WHERE ${where}`, params);
  return { rows, total: c[0].total };
}

export async function getById(id) {
  const { rows } = await query(
    `SELECT sp.*, l.nombre AS lead_nombre, l.email AS lead_email
     FROM stripe_payments sp
     LEFT JOIN leads l ON l.id = sp.lead_id
     WHERE sp.id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function listProjectsWithStripe() {
  const { rows } = await query(
    `SELECT DISTINCT project_id FROM project_integrations
     WHERE provider = 'stripe' AND active = true AND encrypted_value IS NOT NULL`
  );
  return rows.map(r => r.project_id);
}

export async function getStats(projectId) {
  const { rows } = await query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status='succeeded')::int AS succeeded,
       COUNT(*) FILTER (WHERE status='failed')::int AS failed,
       COUNT(*) FILTER (WHERE disputed=true)::int AS disputed,
       COUNT(*) FILTER (WHERE refunded=true)::int AS refunded,
       COUNT(*) FILTER (WHERE conversion_id IS NULL AND status='succeeded')::int AS unlinked,
       COALESCE(SUM(amount) FILTER (WHERE status='succeeded'), 0) AS total_cobrado,
       COALESCE(SUM(refunded_amount), 0) AS total_refunded
     FROM stripe_payments WHERE project_id=$1`,
    [projectId]
  );
  return rows[0];
}

export async function getSyncState(projectId) {
  const { rows } = await query(`SELECT * FROM stripe_sync_state WHERE project_id=$1`, [projectId]);
  return rows[0] || null;
}

export async function upsertSyncState(projectId, fields) {
  const cols = ['project_id', ...Object.keys(fields)];
  const vals = [projectId, ...Object.values(fields)];
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
  const updates = Object.keys(fields).map((k, i) => `${k}=$${i + 2}`).join(', ');
  await query(
    `INSERT INTO stripe_sync_state (${cols.join(',')}) VALUES (${placeholders})
     ON CONFLICT (project_id) DO UPDATE SET ${updates}`,
    vals
  );
}

// Cargos ya importados que siguen sin asociar a una venta. La sincronizacion los
// reintenta en cada pasada: si mientras tanto el lead se convirtio, o alguien
// deshizo una asociacion, en el siguiente Sincronizar se vuelven a enganchar.
export async function listPendientesDeAsociar(projectId, limit = 500) {
  const { rows } = await query(
    `SELECT id, project_id, stripe_id, status, amount, currency, customer_email, customer_name,
            EXTRACT(EPOCH FROM stripe_created_at)::bigint AS stripe_created_at,
            conversion_id, conversion_payment_id, lead_id
       FROM stripe_payments
      WHERE project_id = $1
        AND status = 'succeeded'
        AND COALESCE(refunded, false) = false
        AND conversion_payment_id IS NULL
        AND conversion_id IS NULL
        -- los de otra moneda hay que reconvertir antes: si no, entran
        -- pesos o colones como si fueran euros
        AND UPPER(COALESCE(currency, 'EUR')) = 'EUR'
        -- Los anteriores a la fecha de revision ya se miraron uno a uno:
        -- lo que quedo sin cliente se dejo asi a proposito.
        AND (
          (SELECT s.stripe_ok_hasta FROM invoicing_status s WHERE s.project_id = $1) IS NULL
          OR stripe_created_at::date > (SELECT s.stripe_ok_hasta FROM invoicing_status s WHERE s.project_id = $1)
        )
      ORDER BY stripe_created_at DESC
      LIMIT $2`,
    [projectId, limit]
  );
  return rows;
}
