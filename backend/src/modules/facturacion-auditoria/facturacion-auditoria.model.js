import { query } from '../../shared/config/db.js';

/*
  Las consultas de la auditoría de facturación (#765). Solo LEEN facturas y
  cobros; lo único que escriben es su propio registro (vueltas, pausas y la
  cola de la pausa).
*/

// El día de Madrid de un instante. El «desde» y el «hasta» de la auditoría son
// días de Madrid (`hoyEnMadrid`), así que `created_at` se pasa a Madrid antes de
// compararlo: con `created_at::date` (o `CURRENT_DATE`) manda la zona de la sesión
// de Postgres y, si es UTC, de 00:00 a 01:00/02:00 de Madrid una factura recién
// hecha cuenta como de ayer y se queda fuera de la auditoría (#765).
const DIA_MADRID = (col) => `(${col} AT TIME ZONE 'Europe/Madrid')::date`;

// ── Desde cuándo se audita ──────────────────────────────────────────────────

/** El día guardado de la primera vuelta; si no hay, se guarda hoy. */
export async function auditarDesdeGuardado() {
  const { rows } = await query(
    `INSERT INTO facturacion_auditoria_estado (id, auditar_desde)
     VALUES (1, ${DIA_MADRID('NOW()')})
     ON CONFLICT (id) DO UPDATE SET auditar_desde = facturacion_auditoria_estado.auditar_desde
     RETURNING auditar_desde::text AS desde`);
  return rows[0].desde;
}

/**
 * El día guardado, SIN guardarlo: para enseñarlo y para la pasada en seco.
 * Null si la auditoría no ha dado ninguna vuelta (la primera guardará ese día).
 */
export async function auditarDesdeLeido() {
  try {
    const { rows } = await query('SELECT auditar_desde::text AS desde FROM facturacion_auditoria_estado WHERE id = 1');
    return rows[0]?.desde || null;
  } catch {
    return null;
  }
}

// ── 1 · Números repetidos en una serie ──────────────────────────────────────
//
// La numeración es por SERIE y año, no por campus: en el 360 la serie de CEDIA
// la comparten varios campus (ver `nextNumero`). Se cuentan también las
// anuladas: un número anulado sigue gastado y el CRM nunca lo vuelve a dar, así
// que si aparece dos veces es que algo lo ha repetido.
//
// La base ya impide el mismo (año, serie, número) exacto (índice de la
// migración 136). Lo que el índice NO ve es la misma serie escrita distinta
// —«CEDIA» y «cedia » son dos series para él y una para Hacienda—, así que se
// agrupa por la serie en mayúsculas y sin espacios. Y si un día falta el
// índice (una base restaurada), esto sigue cogiendo los exactos.
export async function numerosRepetidos({ desde }) {
  const { rows } = await query(
    `SELECT i.ano, upper(btrim(i.serie)) AS serie, i.numero,
            COUNT(*)::int AS veces,
            array_agg(i.id ORDER BY i.id) AS ids,
            array_agg(DISTINCT i.project_id) AS project_ids,
            json_agg(json_build_object(
              'id', i.id, 'codigo', i.codigo, 'cliente', i.cliente_nombre,
              'total', i.total, 'fecha', i.fecha_emision::text, 'estado', i.estado,
              'tipo', i.tipo, 'campus', p.nombre, 'serie', i.serie) ORDER BY i.id) AS facturas
       FROM invoices i
       JOIN projects p ON p.id = i.project_id
      WHERE i.numero IS NOT NULL
        AND i.estado <> 'borrador'
        AND NOT COALESCE(p.es_prueba, false)
      GROUP BY i.ano, upper(btrim(i.serie)), i.numero
     HAVING COUNT(*) > 1
        AND MAX(GREATEST(i.fecha_emision, ${DIA_MADRID('i.created_at')})) >= $1::date
      ORDER BY 2, 1, 3`,
    [desde]);
  return rows;
}

// ── 2 · Facturas emitidas sin los datos fiscales obligatorios ───────────────
//
// Las del cobro automático salen numeradas aunque falten datos (los rellena el
// alumno con el formulario, en 7 días): por eso solo cuentan las que llevan más
// de X días emitidas. Las proformas no son documento fiscal y no entran.
export async function facturasEmitidas({ desde, hasta }) {
  const { rows } = await query(
    `SELECT i.id, i.codigo, i.serie, i.ano, i.numero, i.tipo, i.project_id,
            i.fecha_emision::text AS fecha, i.issuer_nif, i.issuer_id,
            i.cliente_nombre, i.cliente_nif, i.cliente_direccion, i.cliente_ciudad,
            i.cliente_cp, i.cliente_pais, i.items, p.nombre AS campus
       FROM invoices i
       JOIN projects p ON p.id = i.project_id
      WHERE i.numero IS NOT NULL
        AND i.tipo IN ('normal', 'rectificativa')
        AND i.estado NOT IN ('borrador', 'cancelada')
        AND NOT COALESCE(p.es_prueba, false)
        AND GREATEST(i.fecha_emision, ${DIA_MADRID('i.created_at')}) >= $1::date
        AND GREATEST(i.fecha_emision, ${DIA_MADRID('i.created_at')}) <= $2::date
      ORDER BY i.serie, i.ano, i.numero`,
    [desde, hasta]);
  return rows;
}

// ── 3 · Cobros con más de X días sin factura ────────────────────────────────

/** Los campus que facturan: con su sociedad, activos y que no son de pruebas. */
export async function campusQueFacturan() {
  const { rows } = await query(
    `SELECT p.id, p.nombre, p.sociedad_emisora_id AS issuer_id, s.serie,
            (SELECT MIN(f.fecha_emision)::text FROM invoices f
              WHERE f.issuer_id = p.sociedad_emisora_id
                AND f.tipo <> 'proforma' AND f.numero IS NOT NULL) AS arranque
       FROM projects p
       JOIN invoice_issuers s ON s.id = p.sociedad_emisora_id
      WHERE p.active AND NOT COALESCE(p.es_prueba, false)
      ORDER BY p.id`);
  return rows;
}

/** Los cobros que esperan en la cola de la pausa (se emiten al reanudar). */
export async function cobrosEnLaColaDeLaPausa() {
  const { rows } = await query(
    `SELECT payment_id FROM facturacion_cola_pausa WHERE procesado_at IS NULL`);
  return new Set(rows.map((r) => Number(r.payment_id)));
}

// ── El registro ─────────────────────────────────────────────────────────────

export async function guardarAuditoria({ origen, empezo, limpia, incidencias, resumen, userId = null }) {
  const { rows } = await query(
    `INSERT INTO facturacion_auditorias (origen, empezo, termino, limpia, incidencias, resumen, ejecutada_por)
     VALUES ($1, $2, NOW(), $3, $4::jsonb, $5::jsonb, $6)
     RETURNING id, origen, empezo, termino, limpia, incidencias, resumen, ejecutada_por`,
    [origen, empezo, limpia, JSON.stringify(incidencias), JSON.stringify(resumen), userId]);
  return rows[0];
}

export async function ultimaAuditoria() {
  const { rows } = await query(
    `SELECT a.id, a.origen, a.empezo, a.termino, a.limpia, a.incidencias, a.resumen,
            u.nombre AS ejecutada_por_nombre
       FROM facturacion_auditorias a
       LEFT JOIN users u ON u.id = a.ejecutada_por
      ORDER BY a.id DESC LIMIT 1`);
  return rows[0] || null;
}

/** La vuelta de antes de esta (para el modo aviso). */
export async function vueltaAnterior(id) {
  const { rows } = await query(
    'SELECT id, limpia FROM facturacion_auditorias WHERE id < $1 ORDER BY id DESC LIMIT 1', [id]);
  return rows[0] || null;
}

export async function historial({ limite = 20 } = {}) {
  const { rows: vueltas } = await query(
    `SELECT a.id, a.origen, a.empezo, a.termino, a.limpia, a.resumen,
            jsonb_array_length(a.incidencias) AS incidencias, u.nombre AS ejecutada_por
       FROM facturacion_auditorias a
       LEFT JOIN users u ON u.id = a.ejecutada_por
      ORDER BY a.id DESC LIMIT $1`, [limite]);
  const { rows: pausas } = await query(
    `SELECT f.id, f.pausada_at, f.motivo, f.auditoria_id, f.reanudada_at,
            f.auditoria_reanudo_id, f.emitidas_al_reanudar, u.nombre AS reanudada_por
       FROM facturacion_pausas f
       LEFT JOIN users u ON u.id = f.reanudada_por
      ORDER BY f.id DESC LIMIT $1`, [limite]);
  return { vueltas, pausas };
}

/**
 * Abre la pausa. Si ya hay una abierta (dos vueltas a la vez), no abre otra:
 * el índice único lo impide y aquí se devuelve null.
 */
export async function abrirPausa({ auditoriaId, motivo, incidencias }) {
  const { rows } = await query(
    `INSERT INTO facturacion_pausas (auditoria_id, motivo, incidencias)
     VALUES ($1, $2, $3::jsonb)
     ON CONFLICT DO NOTHING
     RETURNING id, pausada_at, auditoria_id, motivo, incidencias`,
    [auditoriaId, motivo, JSON.stringify(incidencias)]);
  return rows[0] || null;
}

/** Cierra la pausa abierta. Devuelve null si otra persona la cerró antes. */
export async function cerrarPausa({ pausaId, userId, auditoriaId, emitidas }) {
  const { rows } = await query(
    `UPDATE facturacion_pausas
        SET reanudada_at = NOW(), reanudada_por = $2, auditoria_reanudo_id = $3,
            emitidas_al_reanudar = $4::jsonb
      WHERE id = $1 AND reanudada_at IS NULL
      RETURNING id, pausada_at, reanudada_at`,
    [pausaId, userId, auditoriaId, JSON.stringify(emitidas)]);
  return rows[0] || null;
}

// ── La cola de la pausa ─────────────────────────────────────────────────────

export async function encolar({ paymentId, conversionId, pausaId, userId = null }) {
  await query(
    `INSERT INTO facturacion_cola_pausa (payment_id, conversion_id, pausa_id, user_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (payment_id) DO NOTHING`,
    [paymentId, conversionId, pausaId, userId]);
}

/** Lo que espera en la cola, EN ORDEN DE COBRO: fecha del cobro y, a igual fecha, el que entró antes. */
export async function colaPendiente() {
  const { rows } = await query(
    `SELECT q.payment_id, q.conversion_id, q.user_id, cp.importe, cp.fecha::text AS fecha,
            c.project_id, l.nombre AS cliente
       FROM facturacion_cola_pausa q
       JOIN conversion_payments cp ON cp.id = q.payment_id
       JOIN conversions c ON c.id = q.conversion_id
       LEFT JOIN leads l ON l.id = c.lead_id
      WHERE q.procesado_at IS NULL
      ORDER BY cp.fecha ASC, cp.id ASC`);
  return rows;
}

export async function marcarProcesado({ paymentId, resultado, invoiceId = null, error = null }) {
  await query(
    `UPDATE facturacion_cola_pausa
        SET procesado_at = NOW(), resultado = $2, invoice_id = $3, error = $4
      WHERE payment_id = $1`,
    [paymentId, resultado, invoiceId, error]);
}

/** Correos de los administradores activos (superadmin y admin). */
export async function correosDeAdministradores() {
  const { rows } = await query(
    `SELECT DISTINCT lower(email) AS email FROM users
      WHERE active = true AND role IN ('superadmin', 'admin')
        AND email IS NOT NULL AND email <> ''`);
  return rows.map((r) => r.email);
}
