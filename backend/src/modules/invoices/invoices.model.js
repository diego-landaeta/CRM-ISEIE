import { query, getClient } from '../../shared/config/db.js';

// Numeración correlativa atómica: UPSERT con +1 garantiza serie consecutiva.
export async function nextNumero(client, projectId, ano, serie) {
  const { rows } = await client.query(
    `INSERT INTO invoice_sequences (project_id, ano, serie, ultimo_numero)
     VALUES ($1, $2, $3, 1)
     ON CONFLICT (project_id, ano, serie) DO UPDATE
       SET ultimo_numero = invoice_sequences.ultimo_numero + 1
     RETURNING ultimo_numero`,
    [projectId, ano, serie]
  );
  return rows[0].ultimo_numero;
}

export async function create(data, userId) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const ano = data.ano || new Date().getFullYear();
    const serie = data.serie || 'A';
    const numero = await nextNumero(client, data.projectId, ano, serie);
    const codigo = `${ano}/${String(numero).padStart(4, '0')}`;

    const { rows } = await client.query(
      `INSERT INTO invoices (
         project_id, conversion_id, lead_id, serie, ano, numero, codigo,
         fecha_emision,
         cliente_nombre, cliente_nif, cliente_direccion, cliente_ciudad, cliente_cp, cliente_pais,
         cliente_email, cliente_telefono,
         items, base_imponible, iva_pct, iva_importe, iva_incluido, total,
         estado, notas, leyenda_iva, metodo_pago, pie_pago, created_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28
       ) RETURNING *`,
      [
        data.projectId, data.conversionId || null, data.leadId || null,
        serie, ano, numero, codigo, data.fechaEmision || new Date(),
        data.clienteNombre, data.clienteNif, data.clienteDireccion,
        data.clienteCiudad, data.clienteCp, data.clientePais,
        data.clienteEmail || null, data.clienteTelefono || null,
        JSON.stringify(data.items),
        data.baseImponible, data.ivaPct, data.ivaImporte, !!data.ivaIncluido, data.total,
        data.estado || 'emitida', data.notas || null, data.leyendaIva || null,
        data.metodoPago, data.piePago || null, userId,
      ]
    );

    if (data.leadId) {
      await client.query(
        `UPDATE leads SET
           identificacion_fiscal  = COALESCE($1, identificacion_fiscal),
           direccion_fiscal       = COALESCE($2, direccion_fiscal),
           ciudad_fiscal          = COALESCE($3, ciudad_fiscal),
           codigo_postal_fiscal   = COALESCE($4, codigo_postal_fiscal),
           pais_fiscal            = COALESCE($5, pais_fiscal),
           updated_at = NOW()
         WHERE id = $6`,
        [data.clienteNif, data.clienteDireccion, data.clienteCiudad, data.clienteCp, data.clientePais, data.leadId]
      );
    }

    await client.query('COMMIT');
    return rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function findById(id) {
  const { rows } = await query(
    `SELECT i.*, p.nombre AS proyecto_nombre, l.nombre AS lead_nombre_actual
     FROM invoices i
     LEFT JOIN projects p ON p.id = i.project_id
     LEFT JOIN leads l ON l.id = i.lead_id
     WHERE i.id = $1`,
    [id]
  );
  return rows[0] || null;
}

// Crea una factura rectificativa (de abono) a partir de una factura original.
// Importes negativos, serie 'R', referencia a la original.
export async function createRectificativa(originalId, { motivo, userId, parcial = null }) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows: origRows } = await client.query(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [originalId]);
    const orig = origRows[0];
    if (!orig) throw new Error('Factura original no encontrada');
    if (orig.tipo === 'rectificativa') throw new Error('No se puede rectificar una rectificativa');

    const ano = new Date().getFullYear();
    const serie = 'R';
    const numero = await nextNumero(client, orig.project_id, ano, serie);
    const codigo = `R-${ano}/${String(numero).padStart(4, '0')}`;

    // Importes negativos. Si parcial (monto), rectifica solo ese importe; si no, todo.
    const factor = parcial != null ? -Math.abs(Number(parcial)) / Number(orig.total || 1) : -1;
    const items = (Array.isArray(orig.items) ? orig.items : JSON.parse(orig.items || '[]')).map((it) => ({
      ...it,
      precio_unitario: -Math.abs(Number(it.precio_unitario)) * (parcial != null ? Math.abs(factor) : 1),
      subtotal: -Math.abs(Number(it.subtotal || 0)) * (parcial != null ? Math.abs(factor) : 1),
    }));
    const base = -Math.abs(Number(orig.base_imponible || 0)) * (parcial != null ? Math.abs(factor) : 1);
    const ivaImp = -Math.abs(Number(orig.iva_importe || 0)) * (parcial != null ? Math.abs(factor) : 1);
    const total = parcial != null ? -Math.abs(Number(parcial)) : -Math.abs(Number(orig.total || 0));

    const { rows } = await client.query(
      `INSERT INTO invoices (
         project_id, conversion_id, lead_id, serie, ano, numero, codigo, fecha_emision,
         cliente_nombre, cliente_nif, cliente_direccion, cliente_ciudad, cliente_cp, cliente_pais,
         cliente_email, cliente_telefono,
         items, base_imponible, iva_pct, iva_importe, iva_incluido, total,
         estado, notas, leyenda_iva, metodo_pago, pie_pago, created_by,
         tipo, rectifica_id, rectifica_codigo, motivo_rectificacion
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_DATE,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
         'emitida',$22,$23,$24,$25,$26,'rectificativa',$27,$28,$29) RETURNING *`,
      [
        orig.project_id, orig.conversion_id, orig.lead_id, serie, ano, numero, codigo,
        orig.cliente_nombre, orig.cliente_nif, orig.cliente_direccion, orig.cliente_ciudad, orig.cliente_cp, orig.cliente_pais,
        orig.cliente_email, orig.cliente_telefono,
        JSON.stringify(items), base, orig.iva_pct, ivaImp, orig.iva_incluido, total,
        `Factura rectificativa de ${orig.codigo}. ${motivo || ''}`.trim(),
        orig.leyenda_iva, orig.metodo_pago, orig.pie_pago, userId,
        originalId, orig.codigo, motivo || 'Anulación',
      ]
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function findByConversion(conversionId) {
  const { rows } = await query(
    `SELECT * FROM invoices WHERE conversion_id = $1 ORDER BY id DESC LIMIT 1`,
    [conversionId]
  );
  return rows[0] || null;
}

export async function list({ projectId, estado, search, from, to, page = 1, limit = 50 }) {
  const conds = ['project_id = $1'];
  const params = [projectId];
  let i = 2;
  if (estado) { conds.push(`estado = $${i++}`); params.push(estado); }
  if (search) { conds.push(`(LOWER(cliente_nombre) LIKE $${i} OR LOWER(cliente_nif) LIKE $${i} OR codigo LIKE $${i})`); params.push(`%${search.toLowerCase()}%`); i++; }
  if (from) { conds.push(`fecha_emision >= $${i++}`); params.push(from); }
  if (to)   { conds.push(`fecha_emision <= $${i++}`); params.push(to); }
  const where = conds.join(' AND ');
  const offset = (page - 1) * limit;
  const { rows } = await query(
    `SELECT id, codigo, ano, numero, fecha_emision, fecha_pago,
            cliente_nombre, cliente_nif, total, iva_pct, estado, sent_at
     FROM invoices WHERE ${where}
     ORDER BY ano DESC, numero DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const { rows: c } = await query(`SELECT COUNT(*)::int AS total FROM invoices WHERE ${where}`, params);
  return { rows, total: c[0].total };
}

export async function getStats(projectId) {
  const { rows } = await query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE estado = 'emitida')::int AS emitidas,
       COUNT(*) FILTER (WHERE estado = 'enviada')::int AS enviadas,
       COUNT(*) FILTER (WHERE estado = 'pagada')::int  AS pagadas,
       COUNT(*) FILTER (WHERE estado = 'cancelada')::int AS canceladas,
       COALESCE(SUM(total),0)                       AS total_facturado,
       COALESCE(SUM(total) FILTER (WHERE estado = 'pagada'),0) AS total_cobrado,
       COALESCE(SUM(iva_importe),0)                 AS total_iva
     FROM invoices WHERE project_id = $1`,
    [projectId]
  );
  return rows[0];
}

export async function markPaid(id, fechaPago) {
  await query(
    `UPDATE invoices SET estado = 'pagada', fecha_pago = $2, updated_at = NOW() WHERE id = $1`,
    [id, fechaPago || new Date().toISOString().slice(0, 10)]
  );
}

export async function markSent(id, email) {
  await query(
    `UPDATE invoices SET estado = CASE WHEN estado = 'emitida' THEN 'enviada' ELSE estado END,
       sent_at = NOW(), sent_to_email = $2, updated_at = NOW()
     WHERE id = $1`,
    [id, email]
  );
}

export async function setPdfPath(id, path) {
  await query(`UPDATE invoices SET pdf_path = $2, updated_at = NOW() WHERE id = $1`, [id, path]);
}

export async function cancel(id) {
  await query(`UPDATE invoices SET estado = 'cancelada', updated_at = NOW() WHERE id = $1`, [id]);
}

export async function getLeadFiscalData(leadId) {
  const { rows } = await query(
    `SELECT id, nombre, email, telefono,
            identificacion_fiscal, direccion_fiscal,
            ciudad_fiscal, codigo_postal_fiscal, pais_fiscal
     FROM leads WHERE id = $1 AND deleted_at IS NULL`,
    [leadId]
  );
  return rows[0] || null;
}

export async function getProjectInvoicerData(projectId) {
  const { rows } = await query(
    `SELECT id, nombre, slug, logo_url, datos_fiscales,
            factura_pie_default, factura_serie_default, factura_metodo_default
     FROM projects WHERE id = $1`,
    [projectId]
  );
  return rows[0] || null;
}

export async function setSequence(projectId, ano, serie, ultimoNumero) {
  await query(
    `INSERT INTO invoice_sequences (project_id, ano, serie, ultimo_numero)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_id, ano, serie) DO UPDATE SET ultimo_numero = EXCLUDED.ultimo_numero`,
    [projectId, ano, serie, ultimoNumero]
  );
}

export async function getSequence(projectId, ano, serie) {
  const { rows } = await query(
    `SELECT ultimo_numero FROM invoice_sequences WHERE project_id=$1 AND ano=$2 AND serie=$3`,
    [projectId, ano, serie]
  );
  return rows[0]?.ultimo_numero || 0;
}

export async function listSequences(projectId) {
  const { rows } = await query(
    `SELECT ano, serie, ultimo_numero FROM invoice_sequences WHERE project_id=$1 ORDER BY ano DESC, serie`,
    [projectId]
  );
  return rows;
}

export async function updateProjectFacturacionConfig(projectId, { piePagoDefault, serieDefault, metodoDefault }) {
  const sets = [];
  const params = [];
  let i = 1;
  if (piePagoDefault !== undefined) { sets.push(`factura_pie_default = $${i++}`); params.push(piePagoDefault); }
  if (serieDefault !== undefined) { sets.push(`factura_serie_default = $${i++}`); params.push(serieDefault); }
  if (metodoDefault !== undefined) { sets.push(`factura_metodo_default = $${i++}`); params.push(metodoDefault); }
  if (!sets.length) return;
  params.push(projectId);
  await query(`UPDATE projects SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${i}`, params);
}
