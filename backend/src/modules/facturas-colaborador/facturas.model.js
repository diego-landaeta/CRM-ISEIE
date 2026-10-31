import pool, { query } from '../../shared/config/db.js';

/*
  Facturas de colaboradores (#202) · las facturas del mes, en la base.

  Una fila por colaborador, empresa y mes. Nace al preparar el mes, con la
  huella de su enlace, y se completa cuando el colaborador sube la factura.
*/

/** El estado que se enseña, calculado siempre igual en la lista y en el enlace. */
export const ESTADO = `
  CASE
    WHEN f.anulada_at IS NOT NULL THEN 'anulada'
    WHEN f.subida_at IS NOT NULL THEN 'recibida'
    -- «Este mes no facturo a esta empresa» (migración 233/246, 31/10).
    WHEN f.sin_factura_at IS NOT NULL THEN 'sin_factura'
    WHEN f.caduca_at IS NOT NULL AND f.caduca_at < NOW() THEN 'caducado'
    WHEN f.abierto_at IS NOT NULL THEN 'abierto'
    WHEN f.enviado_at IS NOT NULL THEN 'enviado'
    -- Solo si lo último que pasó con el envío fue el fallo: un enlace nuevo
    -- después (reenviado) vuelve a «sin enviar» hasta que salga.
    WHEN (SELECT r.evento FROM facturas_colaborador_registro r
           WHERE r.factura_id = f.id AND r.evento IN ('enviado', 'recordatorio', 'no_enviado', 'reenviado')
           ORDER BY r.id DESC LIMIT 1) = 'no_enviado' THEN 'no_enviado'
    ELSE 'sin_enviar'
  END`;

/**
 * Quién tiene que facturar ese mes: activos, dados de alta como muy tarde ese
 * mes y sin baja que empiece ese mes o antes. Uno por empresa. Los que ya tienen
 * su fila viva de ese mes no salen: preparar dos veces no duplica nada.
 */
export async function pendientesDePreparar(periodo, db = pool) {
  const { rows } = await db.query(
    `SELECT c.id AS colaborador_id, ce.issuer_id, ce.importe_acordado
       FROM colaboradores c
       JOIN colaborador_empresas ce ON ce.colaborador_id = c.id
       JOIN invoice_issuers ii ON ii.id = ce.issuer_id AND ii.activo = true
      -- Ese mes: dado de alta como muy tarde ese mes y sin baja que empiece
      -- ese mes o antes. (La baja se mira por su mes, no por si hoy está activo.)
      WHERE (c.alta_desde IS NULL OR c.alta_desde <= $1::date)
        AND (c.baja_desde IS NULL OR c.baja_desde > $1::date)
        AND NOT EXISTS (
              SELECT 1 FROM facturas_colaborador f
               WHERE f.colaborador_id = c.id AND f.issuer_id = ce.issuer_id
                 AND f.periodo = $1::date AND f.anulada_at IS NULL)
      ORDER BY c.id, ce.issuer_id`,
    [periodo],
  );
  return rows;
}

/** Crea la fila del mes. Si otra llamada se adelantó, no hace nada y devuelve null. */
export async function crearDelMes(db, { colaboradorId, issuerId, periodo, importeEsperado, tokenHash, semilla, caducaAt }) {
  const { rows } = await db.query(
    `INSERT INTO facturas_colaborador
       (colaborador_id, issuer_id, periodo, importe_esperado, token_hash, caduca_at, token_semilla)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (colaborador_id, issuer_id, periodo) WHERE anulada_at IS NULL DO NOTHING
     RETURNING id`,
    [colaboradorId, issuerId, periodo, importeEsperado, tokenHash, caducaAt, semilla],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

const CAMPOS_ENLACE = `
  f.id, f.colaborador_id, f.issuer_id, to_char(f.periodo, 'YYYY-MM-DD') AS periodo,
  f.importe_esperado, f.importe, f.numero_factura, f.numero_recepcion,
  f.subida_at, f.abierto_at, f.caduca_at, f.anulada_at, f.nombre_original,
  ${ESTADO} AS estado,
  c.nombre AS colaborador_nombre, c.email AS colaborador_email, c.area, c.nif AS colaborador_nif,
  ii.razon_social, ii.nif AS empresa_nif, ii.direccion, ii.cp, ii.ciudad, ii.pais, ii.logo_url,
  ce.modalidad, ce.importe_fijo, ce.tarifa_hora, ce.iva_pct, ce.irpf_pct,
  f.base, f.iva, f.irpf, f.total, f.horas, f.cuadra, f.importe_pdf, f.mime,
  to_char(f.pagada_at, 'YYYY-MM-DD') AS pagada_at, f.pagada_por, f.forma_pago, f.referencia_pago, f.justificante`;

/** La fila de un enlace, por la huella de su token. */
export async function porTokenHash(tokenHash) {
  const { rows } = await query(
    `SELECT ${CAMPOS_ENLACE}
       FROM facturas_colaborador f
       JOIN colaboradores c ON c.id = f.colaborador_id
       JOIN invoice_issuers ii ON ii.id = f.issuer_id
       LEFT JOIN colaborador_empresas ce ON ce.colaborador_id = f.colaborador_id AND ce.issuer_id = f.issuer_id
      WHERE f.token_hash = $1`,
    [tokenHash],
  );
  return rows[0] || null;
}

/**
 * «Mi factura»: las filas de los colaboradores que llevan este usuario. Las
 * anuladas no salen: en su lugar está la nueva del mismo mes.
 */
export async function delUsuario(userId) {
  const { rows } = await query(
    `SELECT ${CAMPOS_ENLACE}, f.token_semilla, f.token_hash
       FROM facturas_colaborador f
       JOIN colaboradores c ON c.id = f.colaborador_id
       JOIN invoice_issuers ii ON ii.id = f.issuer_id
       LEFT JOIN colaborador_empresas ce ON ce.colaborador_id = f.colaborador_id AND ce.issuer_id = f.issuer_id
      WHERE c.user_id = $1 AND f.anulada_at IS NULL
      ORDER BY f.periodo DESC, ii.razon_social`,
    [userId],
  );
  return rows;
}

/** Una fila suya, o nada: la de otro colaborador no existe para él. */
export async function delUsuarioPorId(userId, id) {
  const { rows } = await query(
    `SELECT ${CAMPOS_ENLACE}, f.archivo_key
       FROM facturas_colaborador f
       JOIN colaboradores c ON c.id = f.colaborador_id
       JOIN invoice_issuers ii ON ii.id = f.issuer_id
       LEFT JOIN colaborador_empresas ce ON ce.colaborador_id = f.colaborador_id AND ce.issuer_id = f.issuer_id
      WHERE f.id = $2 AND c.user_id = $1`,
    [userId, id],
  );
  return rows[0] || null;
}

/** La misma fila, bloqueada, para subir la factura sin que se crucen dos envíos. */
export async function bloquear(db, id) {
  const { rows } = await db.query(
    `SELECT f.id, f.colaborador_id, f.issuer_id, to_char(f.periodo, 'YYYY-MM-DD') AS periodo,
            f.subida_at, f.anulada_at, f.caduca_at, f.token_hash, f.pagada_at
       FROM facturas_colaborador f WHERE f.id = $1 FOR UPDATE`,
    [id],
  );
  return rows[0] || null;
}

export async function marcarEnviado(id) {
  await query('UPDATE facturas_colaborador SET enviado_at = NOW() WHERE id = $1', [id]);
}

/** Las del mes que siguen sin subir, para el recordatorio del día 5: ni recibidas, ni anuladas, ni caducadas. */
/**
 * Las del mes que se prepararon pero cuyo enlace nunca salió (p. ej. con los correos
 * apagados). Revisión del 10/10: antes solo se mandaban las recién creadas, y una
 * fila preparada sin enviar se quedaba así para siempre.
 */
export async function sinEnviar(periodo) {
  const { rows } = await query(
    `SELECT f.id, f.token_semilla, f.token_hash FROM facturas_colaborador f
      WHERE f.periodo = $1::date AND f.enviado_at IS NULL AND f.subida_at IS NULL AND f.anulada_at IS NULL
        AND f.sin_factura_at IS NULL
        AND (f.caduca_at IS NULL OR f.caduca_at > NOW())
      ORDER BY f.id`,
    [periodo],
  );
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

export async function sinSubir(periodo) {
  const { rows } = await query(
    `SELECT f.id, f.token_semilla, f.token_hash FROM facturas_colaborador f
      WHERE f.periodo = $1::date AND f.subida_at IS NULL AND f.anulada_at IS NULL
        AND f.sin_factura_at IS NULL
        AND (f.caduca_at IS NULL OR f.caduca_at > NOW())
      ORDER BY f.id`,
    [periodo],
  );
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

/**
 * La marca con la que salen los correos de una empresa: uno de sus campus,
 * mejor el que tiene remitente «no contestar» (#177). Da el logo de la cabecera
 * y, por `projectId`, la cuenta y el remitente de la marca en Brevo.
 */
export async function marcaDeLaEmpresa(issuerId) {
  const { rows } = await query(
    `SELECT id, nombre, slug, logo_url, emoji FROM projects
      WHERE sociedad_emisora_id = $1 AND active = true
      ORDER BY (remitente_no_contestar IS NULL), id LIMIT 1`,
    [issuerId],
  );
  return rows[0] || null;
}

/** A quién avisar en la campana: los admins de los campus de esa empresa y los super admin. */
export async function avisarA(issuerId) {
  const { rows } = await query(
    `SELECT u.id FROM users u
      WHERE u.active = true AND u.role = 'superadmin'
     UNION
     SELECT DISTINCT u.id FROM users u
       JOIN user_projects up ON up.user_id = u.id AND up.active = true
       JOIN projects p ON p.id = up.project_id
      WHERE u.active = true AND u.role = 'admin' AND p.sociedad_emisora_id = $1`,
    [issuerId],
  );
  return rows.map((r) => Number(r.id));
}

/** ¿El recordatorio de esta factura ya se intentó y falló? (no se reintenta solo) */
export async function recordatorioFallido(id) {
  const { rows } = await query(
    `SELECT 1 FROM facturas_colaborador_registro
      WHERE factura_id = $1 AND evento = 'no_enviado' AND detalle->>'recordatorio' = 'true' LIMIT 1`,
    [id],
  );
  return rows.length > 0;
}

/** Cuántas veces pasó esto con esta factura (cuántas veces se ha pagado, para la clave del aviso). */
export async function vecesQue(id, evento) {
  const { rows } = await query(
    'SELECT COUNT(*)::int AS n FROM facturas_colaborador_registro WHERE factura_id = $1 AND evento = $2', [id, evento]);
  return rows[0].n;
}

/** ¿Ya pasó esto con esta factura? (para no repetir el recordatorio) */
export async function tieneEvento(id, evento) {
  const { rows } = await query(
    'SELECT 1 FROM facturas_colaborador_registro WHERE factura_id = $1 AND evento = $2 LIMIT 1', [id, evento]);
  return rows.length > 0;
}

/**
 * «Este mes no facturo a esta empresa» (31/10), o deshacerlo. Solo si no está
 * recibida ni anulada: lo comprueba quien llama, con la fila bloqueada.
 */
export async function marcarSinFactura(db, id, motivo) {
  await db.query(
    `UPDATE facturas_colaborador SET sin_factura_at = NOW(), sin_factura_motivo = $2 WHERE id = $1`,
    [id, motivo || null],
  );
}

export async function quitarSinFactura(db, id) {
  await db.query(
    `UPDATE facturas_colaborador SET sin_factura_at = NULL, sin_factura_motivo = NULL WHERE id = $1`,
    [id],
  );
}

export async function marcarAbierto(id) {
  const { rowCount } = await query(
    'UPDATE facturas_colaborador SET abierto_at = NOW() WHERE id = $1 AND abierto_at IS NULL',
    [id],
  );
  return rowCount > 0;
}

/**
 * El número de recepción del mes: REC-2026-09-0007. Se toma con un candado por
 * mes para que dos subidas a la vez no se lleven el mismo.
 */
export async function siguienteRecepcion(db, periodo) {
  await db.query(`SELECT pg_advisory_xact_lock(hashtext('facturas_colaborador_rec_' || $1))`, [periodo]);
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM facturas_colaborador
      WHERE periodo = $1::date AND numero_recepcion IS NOT NULL`,
    [periodo],
  );
  const n = rows[0].n + 1;
  return `REC-${periodo.slice(0, 7)}-${String(n).padStart(4, '0')}`;
}

export async function guardarSubida(db, id, datos) {
  // Sin desglose (ficha sin modalidad): base, IVA, IRPF, total y horas, vacíos.
  // `importe_pdf` y `cuadra` van siempre: salen del PDF, no del desglose (13/10).
  const d = datos.desglose;
  await db.query(
    `UPDATE facturas_colaborador
        SET subida_at = NOW(), sin_factura_at = NULL, sin_factura_motivo = NULL, numero_recepcion = $2, importe = $3, numero_factura = $4,
            archivo_key = $5, nombre_original = $6, mime = $7, tamano = $8, sha256 = $9,
            base = $10, iva = $11, irpf = $12, total = $13, horas = $14, cuadra = $15, importe_pdf = $16
      WHERE id = $1`,
    [id, datos.numeroRecepcion, datos.importe, datos.numeroFactura,
      datos.archivoKey, datos.nombreOriginal, datos.mime, datos.tamano, datos.sha256,
      d?.base ?? null, d?.iva ?? null, d?.irpf ?? null, d?.total ?? null, d?.horas ?? null,
      datos.cuadra ?? null, datos.importePdf ?? null],
  );
  for (const l of d?.lineas ?? []) {
    await db.query(
      `INSERT INTO facturas_colaborador_lineas (factura_id, orden, concepto, project_id, horas, tarifa, importe)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, l.orden, l.concepto, l.project_id, l.horas, l.tarifa, l.importe],
    );
  }
}

/** Varias facturas bloqueadas (en orden, para no cruzarse con otro pago a la vez). */
export async function bloquearVarias(db, ids) {
  const { rows } = await db.query(
    `SELECT f.id, f.subida_at, f.anulada_at, to_char(f.pagada_at, 'YYYY-MM-DD') AS pagada_at
       FROM facturas_colaborador f WHERE f.id = ANY($1::int[]) ORDER BY f.id FOR UPDATE`,
    [ids],
  );
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

export async function marcarPagada(db, id, { fecha, porUserId, forma, justificante, referencia }) {
  await db.query(
    `UPDATE facturas_colaborador
        SET pagada_at = $2, pagada_por = $3, forma_pago = $4, justificante = $5, referencia_pago = $6
      WHERE id = $1`,
    [id, fecha, porUserId, forma, justificante, referencia],
  );
}

/** Deshacer el pago: vuelve a «por pagar». Lo que había queda en el registro. */
export async function deshacerPago(db, id) {
  await db.query(
    `UPDATE facturas_colaborador
        SET pagada_at = NULL, pagada_por = NULL, forma_pago = NULL, justificante = NULL, referencia_pago = NULL
      WHERE id = $1`,
    [id],
  );
}

/**
 * Los campus de una empresa, para el proyecto de cada línea del desglose. Solo
 * los de la empresa de la factura: Diego, 10/10, «son por EMPRESA, no por
 * campus»; y en #307, con una empresa, «solo los campus de esa empresa».
 */
export async function campusDeLaEmpresa(issuerId) {
  // Sin los de prueba, como el resumen del equipo (correosDelEquipo.js).
  const { rows } = await query(
    `SELECT id, nombre FROM projects
      WHERE active AND NOT COALESCE(es_prueba, false) AND sociedad_emisora_id = $1
      ORDER BY nombre`,
    [issuerId],
  );
  return rows.map((r) => ({ id: Number(r.id), nombre: r.nombre }));
}

/** Las líneas del desglose de una factura, con el nombre de su campus. */
export async function lineasDe(facturaId) {
  const { rows } = await query(
    `SELECT l.orden, l.concepto, l.project_id, p.nombre AS campus, l.horas, l.tarifa, l.importe
       FROM facturas_colaborador_lineas l
       LEFT JOIN projects p ON p.id = l.project_id
      WHERE l.factura_id = $1 ORDER BY l.orden`,
    [facturaId],
  );
  const num = (v) => (v === null ? null : Number(v));
  return rows.map((r) => ({ ...r, horas: num(r.horas), tarifa: num(r.tarifa), importe: num(r.importe) }));
}

/** Para administración: una factura, si es de una empresa que se ve. */
export async function porId(id, issuerIds, db = pool) {
  const { rows } = await db.query(
    `SELECT ${CAMPOS_ENLACE}, f.archivo_key, f.tamano
       FROM facturas_colaborador f
       JOIN colaboradores c ON c.id = f.colaborador_id
       JOIN invoice_issuers ii ON ii.id = f.issuer_id
       LEFT JOIN colaborador_empresas ce ON ce.colaborador_id = f.colaborador_id AND ce.issuer_id = f.issuer_id
      WHERE f.id = $1 AND ($2::int[] IS NULL OR f.issuer_id = ANY($2::int[]))`,
    [id, issuerIds],
  );
  return rows[0] || null;
}

export async function anular(db, id, porUserId, motivo) {
  await db.query(
    `UPDATE facturas_colaborador
        SET anulada_at = NOW(), anulada_por = $2, motivo_anulacion = $3
      WHERE id = $1`,
    [id, porUserId, motivo],
  );
}

export async function cambiarEnlace(db, id, tokenHash, semilla, caducaAt) {
  await db.query(
    `UPDATE facturas_colaborador
        SET token_hash = $2, token_semilla = $3, caduca_at = $4, abierto_at = NULL, enviado_at = NULL
      WHERE id = $1`,
    [id, tokenHash, semilla, caducaAt],
  );
}

/** La lista del mes para administración, con su cabecera. */
/** Una fila de las listas de administración («Del mes» y las pestañas de la segunda parte). */
const FILA_DE_LISTA = `SELECT f.id, f.colaborador_id, f.issuer_id, to_char(f.periodo, 'YYYY-MM') AS periodo,
              c.nombre AS colaborador_nombre, c.email, c.area,
              ii.razon_social AS empresa,
              f.importe_esperado, f.importe,
              -- Lo acordado es la base: con desglose, la diferencia es la de su base
              -- (600 acordados y 636 de total con IVA e IRPF no son 36 € de más).
              CASE WHEN f.importe IS NOT NULL AND f.importe_esperado IS NOT NULL
                   THEN COALESCE(f.base, f.importe) - f.importe_esperado END AS diferencia,
              f.numero_factura, f.numero_recepcion, f.subida_at, f.enviado_at, f.abierto_at,
              f.caduca_at, f.anulada_at, f.motivo_anulacion, f.nombre_original, f.tamano,
              -- El desglose (segunda parte) y el PDF (13/10): cuadra = el total del PDF
              -- es lo escrito; null = no se pudo leer el PDF (no es «No cuadra»).
              f.base, f.total, f.horas, f.cuadra, f.importe_pdf, f.mime,
              -- El pago, que no se mezcla con el estado de la factura.
              to_char(f.pagada_at, 'YYYY-MM-DD') AS pagada_at, f.forma_pago, f.referencia_pago,
              (f.justificante IS NOT NULL) AS con_justificante,
              ${ESTADO} AS estado
         FROM facturas_colaborador f
         JOIN colaboradores c ON c.id = f.colaborador_id
         JOIN invoice_issuers ii ON ii.id = f.issuer_id`;

export async function delMes({ periodo, issuerIds, issuerId = null, estado = null, area = null }) {
  const { rows } = await query(
    `SELECT * FROM (
       ${FILA_DE_LISTA}
        WHERE f.periodo = $1::date
          AND ($2::int[] IS NULL OR f.issuer_id = ANY($2::int[]))
          AND ($3::int IS NULL OR f.issuer_id = $3)
          AND ($5::text IS NULL OR c.area = $5)
     ) t
     WHERE ($4::text IS NULL OR t.estado = $4)
     ORDER BY (t.estado = 'anulada'), t.colaborador_nombre, t.empresa, t.id`,
    [periodo, issuerIds, issuerId, estado, area],
  );
  return rows;
}

/**
 * Las pestañas de la segunda parte («Añadido 01/10 (tarde)»): Enviadas, Por
 * pagar, Pagadas e Historial, filtrables por colaborador, empresa, mes y estado.
 * El estado de la factura y el del pago no se mezclan: «no_cuadra» es de la factura.
 */
const VISTAS = {
  enviadas: 'f.subida_at IS NOT NULL AND f.anulada_at IS NULL',
  por_pagar: 'f.subida_at IS NOT NULL AND f.anulada_at IS NULL AND f.pagada_at IS NULL',
  pagadas: 'f.pagada_at IS NOT NULL AND f.anulada_at IS NULL',
  historial: 'TRUE',
};

export async function deLaVista({ vista, issuerIds, issuerId = null, colaboradorId = null, periodo = null, estado = null }) {
  const { rows } = await query(
    `SELECT * FROM (
       ${FILA_DE_LISTA}
        WHERE ${VISTAS[vista]}
          AND ($1::int[] IS NULL OR f.issuer_id = ANY($1::int[]))
          AND ($2::int IS NULL OR f.issuer_id = $2)
          AND ($3::int IS NULL OR f.colaborador_id = $3)
          AND ($4::date IS NULL OR f.periodo = $4::date)
     ) t
     WHERE ($5::text IS NULL OR t.estado = $5 OR ($5 = 'no_cuadra' AND t.cuadra = false AND t.estado <> 'anulada'))
     ORDER BY t.periodo DESC, t.colaborador_nombre, t.empresa, t.id
     LIMIT 1000`,
    [issuerIds, issuerId, colaboradorId, periodo, estado],
  );
  return rows;
}

/**
 * Coste por campus: con las líneas del desglose, cuántas horas y cuánto dinero
 * (la base, sin IVA ni IRPF) de colaboradores se va a cada campus en el mes.
 * Las líneas sin campus (las de fijo, o sin elegir) van juntas, cada empresa en la suya.
 */
export async function costePorCampus({ periodo, issuerIds, issuerId = null }) {
  const { rows } = await query(
    // Por empresa y campus (Diego, 10/10: «son por EMPRESA»): con «Todos los
    // proyectos», lo que no lleva campus de CEDIA y de Ictess no se suma en una fila.
    `SELECT f.issuer_id, ii.razon_social AS empresa, l.project_id, p.nombre AS campus,
            SUM(l.horas)::float AS horas, SUM(l.importe)::float AS importe, COUNT(DISTINCT f.id)::int AS facturas
       FROM facturas_colaborador_lineas l
       JOIN facturas_colaborador f ON f.id = l.factura_id
       JOIN invoice_issuers ii ON ii.id = f.issuer_id
       LEFT JOIN projects p ON p.id = l.project_id
      WHERE f.periodo = $1::date AND f.subida_at IS NOT NULL AND f.anulada_at IS NULL
        AND ($2::int[] IS NULL OR f.issuer_id = ANY($2::int[]))
        AND ($3::int IS NULL OR f.issuer_id = $3)
      GROUP BY f.issuer_id, ii.razon_social, l.project_id, p.nombre
      ORDER BY ii.razon_social, (l.project_id IS NULL), importe DESC`,
    [periodo, issuerIds, issuerId],
  );
  return rows;
}

/** Las recibidas de una empresa y un mes, para el ZIP: con su archivo y lo que pide el resumen. */
export async function paraElZip(periodo, issuerId) {
  const { rows } = await query(
    `SELECT f.id, c.nombre AS colaborador, c.area, c.nif,
            f.numero_factura, f.importe, f.importe_esperado,
            -- Como en la lista: con desglose, la de su base.
            CASE WHEN f.importe IS NOT NULL AND f.importe_esperado IS NOT NULL
                 THEN COALESCE(f.base, f.importe) - f.importe_esperado END AS diferencia,
            f.subida_at, f.numero_recepcion, f.archivo_key
       FROM facturas_colaborador f
       JOIN colaboradores c ON c.id = f.colaborador_id
      WHERE f.periodo = $1::date AND f.issuer_id = $2
        AND f.subida_at IS NOT NULL AND f.anulada_at IS NULL AND f.archivo_key IS NOT NULL
      ORDER BY c.nombre, f.id`,
    [periodo, issuerId],
  );
  return rows;
}

export async function razonSocial(issuerId) {
  const { rows } = await query('SELECT razon_social FROM invoice_issuers WHERE id = $1', [issuerId]);
  return rows[0]?.razon_social ?? null;
}

export async function registroDeFactura(id) {
  const { rows } = await query(
    `SELECT r.id, r.evento, r.creado_at, r.ip, r.detalle, u.nombre AS usuario_nombre
       FROM facturas_colaborador_registro r
       LEFT JOIN users u ON u.id = r.user_id
      WHERE r.factura_id = $1
      ORDER BY r.creado_at DESC, r.id DESC`,
    [id],
  );
  return rows;
}
