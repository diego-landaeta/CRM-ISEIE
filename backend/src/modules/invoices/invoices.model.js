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

    // Resolver emisor (multi-empresa). Si no se eligió, usa el default del proyecto.
    let iss = null;
    if (data.issuerId) {
      const r = await client.query(`SELECT * FROM invoice_issuers WHERE id = $1`, [data.issuerId]);
      iss = r.rows[0] || null;
    }
    if (!iss) {
      const r = await client.query(
        `SELECT * FROM invoice_issuers WHERE activo = true AND (project_id IS NULL OR project_id = $1)
         ORDER BY es_default DESC, id ASC LIMIT 1`, [data.projectId]);
      iss = r.rows[0] || null;
    }

    const { rows } = await client.query(
      `INSERT INTO invoices (
         project_id, conversion_id, lead_id, serie, ano, numero, codigo,
         fecha_emision,
         cliente_nombre, cliente_nif, cliente_direccion, cliente_ciudad, cliente_cp, cliente_pais,
         cliente_email, cliente_telefono,
         items, base_imponible, iva_pct, iva_importe, iva_incluido, total,
         estado, notas, leyenda_iva, metodo_pago, pie_pago, created_by,
         issuer_id, issuer_razon_social, issuer_nif, issuer_direccion, issuer_ciudad,
         issuer_cp, issuer_pais, issuer_email, issuer_telefono, issuer_iban, issuer_logo_url
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,
         $29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39
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
        data.metodoPago, (data.piePago || iss?.pie_default || null), userId,
        iss?.id || null, iss?.razon_social || null, iss?.nif || null, iss?.direccion || null, iss?.ciudad || null,
        iss?.cp || null, iss?.pais || null, iss?.email || null, iss?.telefono || null, iss?.iban || null, iss?.logo_url || null,
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
export async function createRectificativa(originalId, { motivo, userId, parcial = null, overrideIssuerId = null }) {
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

    // Permite cambiar el emisor de la rectificativa; si no, hereda el de la original
    let issObj = null;
    if (overrideIssuerId) {
      const r = await client.query(`SELECT * FROM invoice_issuers WHERE id = $1`, [overrideIssuerId]);
      issObj = r.rows[0] || null;
    }
    const iss = {
      id: issObj?.id || orig.issuer_id,
      razon_social: issObj?.razon_social ?? orig.issuer_razon_social,
      nif: issObj?.nif ?? orig.issuer_nif,
      direccion: issObj?.direccion ?? orig.issuer_direccion,
      ciudad: issObj?.ciudad ?? orig.issuer_ciudad,
      cp: issObj?.cp ?? orig.issuer_cp,
      pais: issObj?.pais ?? orig.issuer_pais,
      email: issObj?.email ?? orig.issuer_email,
      telefono: issObj?.telefono ?? orig.issuer_telefono,
      iban: issObj?.iban ?? orig.issuer_iban,
      logo_url: issObj?.logo_url ?? orig.issuer_logo_url,
    };

    const { rows } = await client.query(
      `INSERT INTO invoices (
         project_id, conversion_id, lead_id, serie, ano, numero, codigo, fecha_emision,
         cliente_nombre, cliente_nif, cliente_direccion, cliente_ciudad, cliente_cp, cliente_pais,
         cliente_email, cliente_telefono,
         items, base_imponible, iva_pct, iva_importe, iva_incluido, total,
         estado, notas, leyenda_iva, metodo_pago, pie_pago, created_by,
         tipo, rectifica_id, rectifica_codigo, motivo_rectificacion,
         issuer_id, issuer_razon_social, issuer_nif, issuer_direccion, issuer_ciudad,
         issuer_cp, issuer_pais, issuer_email, issuer_telefono, issuer_iban, issuer_logo_url
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_DATE,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
         'emitida',$22,$23,$24,$25,$26,'rectificativa',$27,$28,$29,
         $30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40) RETURNING *`,
      [
        orig.project_id, orig.conversion_id, orig.lead_id, serie, ano, numero, codigo,
        orig.cliente_nombre, orig.cliente_nif, orig.cliente_direccion, orig.cliente_ciudad, orig.cliente_cp, orig.cliente_pais,
        orig.cliente_email, orig.cliente_telefono,
        JSON.stringify(items), base, orig.iva_pct, ivaImp, orig.iva_incluido, total,
        `Factura rectificativa de ${orig.codigo}. ${motivo || ''}`.trim(),
        orig.leyenda_iva, orig.metodo_pago, orig.pie_pago, userId,
        originalId, orig.codigo, motivo || 'Anulación',
        iss.id || null, iss.razon_social, iss.nif, iss.direccion, iss.ciudad,
        iss.cp, iss.pais, iss.email, iss.telefono, iss.iban, iss.logo_url,
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

// ─── Emisores (multi-empresa) ────────────────────────────────────────────────
export async function listIssuers(projectId) {
  const { rows } = await query(
    `SELECT * FROM invoice_issuers
     WHERE activo = true AND (project_id IS NULL OR project_id = $1)
     ORDER BY es_default DESC, razon_social ASC`,
    [projectId]
  );
  return rows;
}

export async function getIssuer(id) {
  const { rows } = await query(`SELECT * FROM invoice_issuers WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function getDefaultIssuer(projectId) {
  const { rows } = await query(
    `SELECT * FROM invoice_issuers
     WHERE activo = true AND (project_id IS NULL OR project_id = $1)
     ORDER BY es_default DESC, id ASC LIMIT 1`,
    [projectId]
  );
  return rows[0] || null;
}

export async function createIssuer(d, userId) {
  const { rows } = await query(
    `INSERT INTO invoice_issuers
       (project_id, razon_social, nif, direccion, ciudad, cp, pais, email, telefono, iban, logo_url, pie_default, es_default, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [d.projectId || null, d.razonSocial, d.nif, d.direccion || null, d.ciudad || null, d.cp || null,
     d.pais || 'España', d.email || null, d.telefono || null, d.iban || null, d.logoUrl || null,
     d.pieDefault || null, !!d.esDefault, userId]
  );
  return rows[0];
}

export async function updateIssuer(id, d) {
  // Update parcial: solo toca los campos presentes en `d` (no pisa el resto con null).
  const COLS = {
    razonSocial: 'razon_social', nif: 'nif', direccion: 'direccion', ciudad: 'ciudad',
    cp: 'cp', pais: 'pais', email: 'email', telefono: 'telefono', iban: 'iban',
    logoUrl: 'logo_url', logoKey: 'logo_key', pieDefault: 'pie_default',
    esDefault: 'es_default', activo: 'activo',
  };
  const sets = [];
  const params = [id];
  for (const [key, col] of Object.entries(COLS)) {
    if (Object.prototype.hasOwnProperty.call(d, key)) {
      params.push(d[key]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (!sets.length) return getIssuer(id);
  sets.push('updated_at = NOW()');
  const { rows } = await query(
    `UPDATE invoice_issuers SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  return rows[0];
}

export async function deleteIssuer(id) {
  await query(`UPDATE invoice_issuers SET activo = false, updated_at = NOW() WHERE id = $1`, [id]);
}

// ── Plantillas visuales (editor Canva) ──────────────────────────────────────
export async function listTemplates(projectId) {
  const { rows } = await query(
    `SELECT t.*, i.razon_social AS issuer_nombre
       FROM invoice_templates t
       LEFT JOIN invoice_issuers i ON i.id = t.issuer_id
      WHERE t.activo = true AND (t.project_id IS NULL OR t.project_id = $1)
      ORDER BY t.es_default DESC, t.id ASC`, [projectId]);
  return rows;
}
export async function getTemplate(id) {
  const { rows } = await query(`SELECT * FROM invoice_templates WHERE id = $1`, [id]);
  return rows[0] || null;
}
// Devuelve la plantilla del emisor; si no tiene, la default del proyecto (o null).
export async function getTemplateForIssuer(issuerId, projectId) {
  if (issuerId) {
    const r = await query(`SELECT * FROM invoice_templates WHERE activo=true AND issuer_id=$1 ORDER BY es_default DESC, id ASC LIMIT 1`, [issuerId]);
    if (r.rows[0]) return r.rows[0];
  }
  const d = await query(
    `SELECT * FROM invoice_templates WHERE activo=true AND (project_id IS NULL OR project_id=$1)
     ORDER BY es_default DESC, id ASC LIMIT 1`, [projectId]);
  return d.rows[0] || null;
}
export async function createTemplate(d, userId) {
  const { rows } = await query(
    `INSERT INTO invoice_templates (project_id, issuer_id, nombre, page_size, layout, es_default, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [d.projectId || null, d.issuerId || null, d.nombre || 'Plantilla', d.pageSize || 'A4',
     JSON.stringify(d.layout || []), !!d.esDefault, userId]);
  return rows[0];
}
export async function updateTemplate(id, d) {
  const COLS = { nombre: 'nombre', pageSize: 'page_size', issuerId: 'issuer_id', esDefault: 'es_default', activo: 'activo' };
  const sets = []; const params = [id];
  for (const [k, col] of Object.entries(COLS)) {
    if (Object.prototype.hasOwnProperty.call(d, k)) { params.push(d[k]); sets.push(`${col} = $${params.length}`); }
  }
  if (Object.prototype.hasOwnProperty.call(d, 'layout')) { params.push(JSON.stringify(d.layout)); sets.push(`layout = $${params.length}`); }
  if (!sets.length) return getTemplate(id);
  sets.push('updated_at = NOW()');
  const { rows } = await query(`UPDATE invoice_templates SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
  return rows[0];
}
export async function deleteTemplate(id) {
  await query(`UPDATE invoice_templates SET activo=false, updated_at=NOW() WHERE id=$1`, [id]);
}

// Ventas (conversiones) con importe > 0 que aún NO tienen factura emitida (no cancelada).
export async function listVentasSinFactura(projectId) {
  const { rows } = await query(
    `SELECT c.id AS conversion_id, c.lead_id, l.nombre AS cliente_nombre,
            c.producto_contratado, c.importe_total, c.fecha_conversion, c.metodo_pago
       FROM conversions c
       JOIN leads l ON l.id = c.lead_id
       LEFT JOIN invoices i ON i.conversion_id = c.id AND i.estado <> 'cancelada'
      WHERE c.project_id = $1
        AND COALESCE(c.importe_total, 0) > 0
        AND i.id IS NULL
      ORDER BY c.fecha_conversion DESC NULLS LAST`,
    [projectId]
  );
  return rows;
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
