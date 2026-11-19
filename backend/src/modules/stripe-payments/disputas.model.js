import { query } from '../../shared/config/db.js';

/**
 * Disputas de Stripe (#396): lo que se guarda y lo que se lee. Solo SQL; la
 * logica (de quien es, cuando se avisa) vive en `disputas.service.js`.
 */

/** Los estados en los que la disputa sigue abierta: hay algo que hacer o que esperar. */
export const ESTADOS_ABIERTOS = ['warning_needs_response', 'warning_under_review', 'needs_response', 'under_review'];
/** Los que piden respuesta en Stripe: los unicos que merecen el segundo aviso. */
export const ESTADOS_SIN_RESPONDER = ['warning_needs_response', 'needs_response'];

/**
 * Guarda una disputa (nueva o al dia). Devuelve la fila y si era nueva.
 *
 * `xmax = 0` solo es cierto en la fila recien insertada: es la forma de saber,
 * con una sola sentencia, si el ON CONFLICT actualizo o inserto.
 *
 * El cliente y el cargo no se pisan con null: el webhook no los trae y el
 * sondeo si; lo que ya se sabia se queda.
 */
export async function upsertDisputa(d) {
  const { rows: [fila] } = await query(
    `INSERT INTO stripe_disputes (
       project_id, dispute_id, charge_id, payment_intent_id, amount, currency, reason, status,
       evidence_due_by, has_evidence, customer_email, customer_name, livemode, stripe_created_at, origen)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9),$10,$11,$12,$13,to_timestamp($14),$15)
     ON CONFLICT (project_id, dispute_id) DO UPDATE SET
       charge_id         = COALESCE(EXCLUDED.charge_id, stripe_disputes.charge_id),
       payment_intent_id = COALESCE(EXCLUDED.payment_intent_id, stripe_disputes.payment_intent_id),
       amount            = EXCLUDED.amount,
       currency          = EXCLUDED.currency,
       reason            = EXCLUDED.reason,
       status            = EXCLUDED.status,
       evidence_due_by   = EXCLUDED.evidence_due_by,
       has_evidence      = EXCLUDED.has_evidence,
       customer_email    = COALESCE(EXCLUDED.customer_email, stripe_disputes.customer_email),
       customer_name     = COALESCE(EXCLUDED.customer_name, stripe_disputes.customer_name),
       livemode          = EXCLUDED.livemode,
       synced_at         = NOW(),
       updated_at        = NOW()
     RETURNING *, (xmax = 0) AS nueva`,
    [
      d.project_id, d.dispute_id, d.charge_id, d.payment_intent_id, d.amount, d.currency, d.reason, d.status,
      d.evidence_due_by, d.has_evidence, d.customer_email, d.customer_name, d.livemode, d.stripe_created_at,
      d.origen,
    ]
  );
  return fila;
}

/**
 * Lo que ya sabe el CRM del cargo de la disputa (cliente, venta), si lo tiene.
 * Sirve para el webhook, que solo trae el id del cargo.
 */
export async function cargoDelCrm(projectId, chargeId) {
  if (!chargeId) return null;
  const { rows } = await query(
    `SELECT id, customer_email, customer_name, metadata
       FROM stripe_payments WHERE project_id = $1 AND stripe_id = $2`,
    [projectId, chargeId]
  );
  return rows[0] || null;
}

/** Las abiertas de un campus que el sondeo no ha visto en su ventana: se piden una a una. */
export async function abiertasAnterioresA(projectId, desde) {
  const { rows } = await query(
    `SELECT dispute_id FROM stripe_disputes
      WHERE project_id = $1 AND status = ANY($2::text[]) AND stripe_created_at < $3`,
    [projectId, ESTADOS_ABIERTOS, desde]
  );
  return rows.map((r) => r.dispute_id);
}

/**
 * Reserva el aviso: devuelve true solo a quien lo marca primero. El webhook y el
 * sondeo pueden ver la misma disputa nueva a la vez; solo uno avisa.
 */
export async function reservarAviso(id, columna) {
  if (!['avisada_at', 'recordada_at'].includes(columna)) throw new Error(`columna de aviso no valida: ${columna}`);
  const { rows } = await query(
    `UPDATE stripe_disputes SET ${columna} = NOW() WHERE id = $1 AND ${columna} IS NULL RETURNING id`,
    [id]
  );
  return rows.length > 0;
}

/** Si el aviso no pudo salir, se suelta para que la siguiente vuelta lo reintente. */
export async function soltarAviso(id, columna) {
  if (!['avisada_at', 'recordada_at'].includes(columna)) return;
  await query(`UPDATE stripe_disputes SET ${columna} = NULL WHERE id = $1`, [id]);
}

/**
 * Las que piden el segundo aviso: siguen sin respuesta en Stripe, vencen dentro
 * de `dias` dias y no se ha recordado ninguna vez.
 */
export async function porRecordar(dias) {
  const { rows } = await query(
    `SELECT d.*, p.nombre AS proyecto
       FROM stripe_disputes d
       JOIN projects p ON p.id = d.project_id
      WHERE d.status = ANY($1::text[])
        AND d.recordada_at IS NULL
        AND d.evidence_due_by IS NOT NULL
        AND d.evidence_due_by > NOW()
        AND d.evidence_due_by <= NOW() + make_interval(days => $2)`,
    [ESTADOS_SIN_RESPONDER, dias]
  );
  return rows;
}

/**
 * A quien se avisa de una disputa de un campus: los super admin (todas) y los
 * admin con ese campus entre los suyos. El mismo criterio que
 * `cursos-pendientes.model.adminsDelCampus`, con el correo para el aviso.
 */
export async function destinatarios(projectId) {
  const { rows } = await query(
    `SELECT DISTINCT u.id, u.email, u.nombre FROM users u
      WHERE u.active AND (u.role = 'superadmin'
         OR (u.role = 'admin' AND EXISTS (
               SELECT 1 FROM user_projects up
                WHERE up.user_id = u.id AND up.project_id = $1 AND up.active)))
      ORDER BY u.id`,
    [projectId]
  );
  return rows;
}

/** El campus y su empresa, para el texto del aviso. */
export async function campus(projectId) {
  const { rows } = await query(
    `SELECT p.id, p.nombre, p.slug, p.logo_url, p.emoji,
            COALESCE(ii.alias, ii.razon_social) AS empresa
       FROM projects p
       LEFT JOIN invoice_issuers ii ON ii.id = p.sociedad_emisora_id
      WHERE p.id = $1`,
    [projectId]
  );
  return rows[0] || null;
}

/**
 * El listado de la pantalla. `projectIds` es el ambito ya recortado a lo de
 * quien pide (null = todo el CRM, solo super admin y soporte).
 *
 * Cada disputa con su campus, su empresa y, si el CRM tiene el cargo, su venta,
 * su prospecto y la formacion.
 */
export async function listar({ projectId = null, projectIds = null, estado = 'abiertas', limit = 500 }) {
  const params = [];
  const where = [];
  if (projectId) { params.push(projectId); where.push(`d.project_id = $${params.length}`); }
  else if (projectIds) { params.push(projectIds); where.push(`d.project_id = ANY($${params.length}::int[])`); }
  if (estado === 'abiertas') { params.push(ESTADOS_ABIERTOS); where.push(`d.status = ANY($${params.length}::text[])`); }
  else if (estado === 'cerradas') { params.push(ESTADOS_ABIERTOS); where.push(`NOT (d.status = ANY($${params.length}::text[]))`); }
  params.push(Math.min(Math.max(Number(limit) || 500, 1), 1000));
  const { rows } = await query(
    `SELECT d.id, d.project_id, d.dispute_id, d.charge_id, d.amount, d.currency, d.reason, d.status,
            d.evidence_due_by, d.has_evidence, d.livemode, d.stripe_created_at, d.avisada_at, d.recordada_at,
            COALESCE(d.customer_name, sp.customer_name, l.nombre) AS customer_name,
            COALESCE(d.customer_email, sp.customer_email, l.email) AS customer_email,
            p.nombre AS proyecto, p.sociedad_emisora_id AS empresa_id,
            COALESCE(ii.alias, ii.razon_social) AS empresa,
            sp.id AS stripe_payment_id, sp.amount AS pago_importe, sp.stripe_created_at AS pago_fecha,
            sp.dispute_my_decision, sp.dispute_notes,
            COALESCE(sp.lead_id, cv.lead_id) AS lead_id,
            cv.id AS conversion_id, cv.producto_contratado AS formacion
       FROM stripe_disputes d
       JOIN projects p ON p.id = d.project_id
       LEFT JOIN invoice_issuers ii ON ii.id = p.sociedad_emisora_id
       LEFT JOIN stripe_payments sp ON sp.project_id = d.project_id AND sp.stripe_id = d.charge_id
       LEFT JOIN conversions cv ON cv.id = sp.conversion_id
       LEFT JOIN leads l ON l.id = COALESCE(sp.lead_id, cv.lead_id)
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY d.evidence_due_by ASC NULLS LAST, d.stripe_created_at DESC
      LIMIT $${params.length}`,
    params
  );
  return rows;
}

/** Cuando se miraron por ultima vez las disputas de cada campus del ambito. */
export async function estadoDelSondeo(projectIds) {
  const params = [];
  let where = `i.provider = 'stripe' AND i.active AND i.encrypted_value IS NOT NULL`;
  if (projectIds) { params.push(projectIds); where += ` AND i.project_id = ANY($1::int[])`; }
  const { rows } = await query(
    `SELECT i.project_id, p.nombre AS proyecto, s.disputes_synced_at, s.disputes_last_error,
            (COALESCE(i.config_public->>'webhook_secret_encrypted', i.config_public->>'webhook_secret') IS NOT NULL) AS tiene_webhook
       FROM project_integrations i
       JOIN projects p ON p.id = i.project_id
       LEFT JOIN stripe_sync_state s ON s.project_id = i.project_id
      WHERE ${where}
      ORDER BY p.nombre`,
    params
  );
  return rows;
}
