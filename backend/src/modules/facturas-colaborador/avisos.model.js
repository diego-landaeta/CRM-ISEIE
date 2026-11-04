import { query } from '../../shared/config/db.js';

/*
  Facturas de colaboradores (#202) · los avisos a la empresa y la confirmación
  del pago, en la base (migración 270, Diego 04/11).
*/

/** La empresa del grupo y su correo de facturación (`invoice_issuers.email`). */
export async function empresa(issuerId) {
  const { rows } = await query(
    'SELECT id, razon_social, email FROM invoice_issuers WHERE id = $1', [issuerId]);
  return rows[0] || null;
}

/**
 * Las empresas con facturas recibidas que aún no se han avisado y ya toca: la
 * última llegó hace `ventanaMin` minutos (no está subiendo más), o la primera
 * lleva `topeMin` esperando (alguien que sube una cada cuatro minutos no deja el
 * aviso parado para siempre). Así varias seguidas salen en un solo correo.
 */
export async function empresasConLlegadas({ ventanaMin, topeMin }) {
  const { rows } = await query(
    `SELECT f.issuer_id
       FROM facturas_colaborador f
      WHERE f.subida_at IS NOT NULL AND f.aviso_empresa_at IS NULL AND f.anulada_at IS NULL
      GROUP BY f.issuer_id
     HAVING MAX(f.subida_at) <= NOW() - make_interval(mins => $1::int)
         OR MIN(f.subida_at) <= NOW() - make_interval(mins => $2::int)
      ORDER BY f.issuer_id`,
    [ventanaMin, topeMin],
  );
  return rows.map((r) => Number(r.issuer_id));
}

/**
 * Se queda con las de una empresa para avisar: las marca y devuelve cuáles.
 * Es un solo UPDATE, así que dos vueltas a la vez no avisan dos veces.
 */
export async function reclamarLlegadas(issuerId) {
  const { rows } = await query(
    `UPDATE facturas_colaborador SET aviso_empresa_at = NOW()
      WHERE issuer_id = $1 AND subida_at IS NOT NULL AND aviso_empresa_at IS NULL AND anulada_at IS NULL
      RETURNING id`,
    [issuerId],
  );
  return rows.map((r) => Number(r.id));
}

/** Lo que lleva el aviso de cada factura: quién, de qué mes, cuánto y su archivo. */
export async function paraElAviso(ids) {
  const { rows } = await query(
    `SELECT f.id, to_char(f.periodo, 'YYYY-MM-DD') AS periodo, f.importe, f.moneda,
            f.numero_factura, f.numero_recepcion, f.subida_at,
            f.archivo_key, f.nombre_original, f.tamano,
            c.nombre AS colaborador_nombre
       FROM facturas_colaborador f
       JOIN colaboradores c ON c.id = f.colaborador_id
      WHERE f.id = ANY($1::int[])
      ORDER BY f.subida_at, f.id`,
    [ids],
  );
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

/**
 * Las recibidas y sin pagar de todas las empresas, de la más antigua a la más
 * nueva, con los días que llevan esperando (contados en Madrid).
 */
export async function porPagar() {
  const { rows } = await query(
    `SELECT f.id, f.issuer_id, to_char(f.periodo, 'YYYY-MM-DD') AS periodo, f.importe, f.moneda,
            f.numero_factura, f.numero_recepcion, f.subida_at,
            GREATEST(0, (NOW() AT TIME ZONE 'Europe/Madrid')::date
                      - (f.subida_at AT TIME ZONE 'Europe/Madrid')::date)::int AS dias,
            c.nombre AS colaborador_nombre
       FROM facturas_colaborador f
       JOIN colaboradores c ON c.id = f.colaborador_id
      WHERE f.subida_at IS NOT NULL AND f.anulada_at IS NULL AND f.pagada_at IS NULL
      ORDER BY f.issuer_id, f.subida_at, f.id`,
  );
  return rows.map((r) => ({ ...r, id: Number(r.id), issuer_id: Number(r.issuer_id) }));
}

/**
 * Se queda con el resumen de hoy de una empresa. Si ya salió (o lo está
 * mandando otra vuelta), devuelve false y no se manda otro.
 */
export async function reclamarResumen(issuerId, dia, facturas) {
  const { rows } = await query(
    `INSERT INTO facturas_colaborador_resumenes (issuer_id, dia, facturas)
     VALUES ($1, $2::date, $3)
     ON CONFLICT (issuer_id, dia) DO NOTHING
     RETURNING issuer_id`,
    [issuerId, dia, facturas],
  );
  return rows.length > 0;
}

export async function apuntarResumen(issuerId, dia, { enviado, detalle }) {
  await query(
    `UPDATE facturas_colaborador_resumenes SET enviado = $3, detalle = $4::jsonb
      WHERE issuer_id = $1 AND dia = $2::date`,
    [issuerId, dia, enviado, JSON.stringify(detalle || {})],
  );
}

/** Confirma el pago, solo la primera vez. Devuelve true si lo ha confirmado ahora. */
export async function confirmarPago(id) {
  const { rowCount } = await query(
    `UPDATE facturas_colaborador SET pago_confirmado_at = NOW()
      WHERE id = $1 AND pagada_at IS NOT NULL AND anulada_at IS NULL AND pago_confirmado_at IS NULL`,
    [id],
  );
  return rowCount > 0;
}

/** Guarda la opinión, una sola vez y después de confirmar. */
export async function guardarOpinion(id, { valoracion, comentario }) {
  const { rowCount } = await query(
    `UPDATE facturas_colaborador
        SET pago_valoracion = $2, pago_comentario = $3, pago_feedback_at = NOW()
      WHERE id = $1 AND pago_confirmado_at IS NOT NULL AND pago_feedback_at IS NULL`,
    [id, valoracion ?? null, comentario ?? null],
  );
  return rowCount > 0;
}
