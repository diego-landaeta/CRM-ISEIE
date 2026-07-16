import { query, getClient } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { issuerFiscalStatus } from '../../shared/utils/spanishTaxId.js';
import { resolveRegimenClave } from './fiscal-engine.js';

// Sociedad emisora de un proyecto (null si no tiene). Helper para numeración.
async function issuerOfProject(exec, projectId) {
  const { rows } = await exec(
    `SELECT sociedad_emisora_id AS id FROM projects WHERE id = $1`,
    [projectId]
  );
  return rows[0]?.id || null;
}

// Numeración correlativa atómica POR SOCIEDAD (spec REQ-NUM-01): todas las facturas
// de una misma sociedad comparten contador por serie+año, aunque sean de proyectos
// distintos. Si el proyecto no tiene sociedad (issuerId null) cae al contador por
// proyecto (legacy). Atómico dentro de la transacción vía FOR UPDATE / índice único.
export async function nextNumero(client, projectId, issuerId, ano, serie) {
  if (issuerId) {
    const sel = await client.query(
      `SELECT ctid, ultimo_numero FROM invoice_sequences
        WHERE issuer_id = $1 AND ano = $2 AND serie = $3 FOR UPDATE`,
      [issuerId, ano, serie]
    );
    if (sel.rows.length) {
      const n = sel.rows[0].ultimo_numero + 1;
      await client.query(`UPDATE invoice_sequences SET ultimo_numero = $1 WHERE ctid = $2`, [n, sel.rows[0].ctid]);
      return n;
    }
    await client.query(
      `INSERT INTO invoice_sequences (project_id, issuer_id, ano, serie, ultimo_numero)
       VALUES ($1, $2, $3, $4, 1)`,
      [projectId, issuerId, ano, serie]
    );
    return 1;
  }
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

    // Resolver emisor (multi-empresa) ANTES de la serie: cada empresa lleva su
    // propia serie/correlativo. Si no se eligió, usa el default del proyecto.
    let iss = null;
    if (data.issuerId) {
      const r = await client.query(`SELECT * FROM invoice_issuers WHERE id = $1`, [data.issuerId]);
      iss = r.rows[0] || null;
    }
    if (!iss) {
      // Emisor por defecto = la sociedad asignada al proyecto (o una emisora propia del proyecto).
      const r = await client.query(
        `SELECT * FROM invoice_issuers i
          WHERE i.activo = true
            AND ( i.id = (SELECT sociedad_emisora_id FROM projects WHERE id = $1) OR i.project_id = $1 )
          ORDER BY (i.id = (SELECT sociedad_emisora_id FROM projects WHERE id = $1)) DESC, es_default DESC, id ASC
          LIMIT 1`, [data.projectId]);
      iss = r.rows[0] || null;
    }

    // Proforma = presupuesto NO fiscal. No consume el correlativo 'A', usa su
    // propia serie (issuer.serie_proforma, def 'PRO') y NO pasa por el gating fiscal.
    const isProforma = data.tipo === 'proforma';
    // Borrador = factura preliminar (al convertir): se guarda aunque falten datos
    // fiscales, SIN numero/codigo (no consume correlativo) y sin gating. Se
    // numera al validar y emitir (emitirBorrador). Solo aplica a tipo normal.
    const isBorrador = !isProforma && data.borrador === true;

    // GATING FISCAL (España): se PERMITE emitir aunque falte el NIF. Solo se
    // bloquea si el CIF/NIF puesto es INVÁLIDO (typo/formato) — así no se emite
    // con un identificador fiscal erróneo. No rompe el flujo del CRM.
    // Las proformas se saltan el gating (no son documento fiscal).
    const fiscal = issuerFiscalStatus(iss);
    if (!isProforma && !isBorrador && !fiscal.ready) {
      // El try/catch de create() hace ROLLBACK + release; aquí solo lanzamos.
      throw new AppError(
        `No se puede emitir: el CIF/NIF de la sociedad "${iss?.razon_social || 'sin asignar'}" no tiene formato válido para España. Corrígelo en Configuración → Empresas emisoras.`,
        400,
        'ISSUER_NIF_INVALID',
      );
    }

    // Snapshot del NIF: si la sociedad aún no tiene NIF (placeholder), la factura
    // lo guarda EN BLANCO (no el texto "PENDIENTE-..."). Cada factura conserva su
    // copia: poner el NIF más adelante NO cambia las facturas ya emitidas, solo
    // afecta a las nuevas.
    const issuerNifSnap = (iss?.nif && !String(iss.nif).toUpperCase().startsWith('PENDIENTE'))
      ? iss.nif : null;

    // Serie: para proforma, la serie_proforma de la empresa (def 'PRO'); para
    // factura, la de la empresa emisora, si no la del request o 'A'. El contador
    // es por serie, así que las proformas nunca tocan el correlativo fiscal.
    const serie = isProforma
      ? ((iss?.serie_proforma && iss.serie_proforma.trim()) || 'PRO')
      : ((iss?.serie && iss.serie.trim()) || data.serie || 'A');
    // Borrador: NO consume correlativo. numero/codigo quedan NULL hasta emitir.
    const numero = isBorrador ? null : await nextNumero(client, data.projectId, iss?.id || null, ano, serie);
    const codigo = isBorrador ? null : (isProforma
      ? `${serie}-${ano}/${String(numero).padStart(4, '0')}`
      : `${ano}/${String(numero).padStart(4, '0')}`);

    const { rows } = await client.query(
      `INSERT INTO invoices (
         project_id, conversion_id, lead_id, serie, ano, numero, codigo,
         fecha_emision,
         cliente_nombre, cliente_nif, cliente_direccion, cliente_ciudad, cliente_cp, cliente_pais,
         cliente_email, cliente_telefono,
         items, base_imponible, iva_pct, iva_importe, iva_incluido, total,
         estado, notas, leyenda_iva, metodo_pago, pie_pago, created_by, tipo,
         issuer_id, issuer_razon_social, issuer_nif, issuer_direccion, issuer_ciudad,
         issuer_cp, issuer_pais, issuer_email, issuer_telefono, issuer_iban, issuer_logo_url
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,
         $30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40
       ) RETURNING *`,
      [
        data.projectId, data.conversionId || null, data.leadId || null,
        serie, ano, numero, codigo, data.fechaEmision || new Date(),
        // Columnas cliente_* son NOT NULL: en proforma/borrador pueden faltar → fallback '—'.
        data.clienteNombre, data.clienteNif || '—', data.clienteDireccion || '—',
        data.clienteCiudad || '—', data.clienteCp || '—', data.clientePais || '—',
        data.clienteEmail || null, data.clienteTelefono || null,
        JSON.stringify(data.items),
        data.baseImponible, data.ivaPct, data.ivaImporte, !!data.ivaIncluido, data.total,
        isBorrador ? 'borrador' : (data.estado || 'emitida'), data.notas || null, data.leyendaIva || null,
        data.metodoPago, (data.piePago || iss?.pie_default || null), userId,
        isProforma ? 'proforma' : 'normal',
        iss?.id || null, iss?.razon_social || null, issuerNifSnap, iss?.direccion || null, iss?.ciudad || null,
        iss?.cp || null, iss?.pais || null, iss?.email || null, iss?.telefono || null, iss?.iban || null, iss?.logo_url || null,
      ]
    );

    if (data.leadId && !isProforma) {
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
    if (orig.estado === 'borrador') throw new AppError('Un borrador no se rectifica: edítalo o anúlalo.', 400, 'DRAFT_CANNOT_RECTIFY');

    const ano = new Date().getFullYear();
    // Serie de abono propia por empresa: deriva de la serie de la factura original
    // (que ya es la de su empresa emisora). Ej: serie 'A' -> abonos 'RA'.
    const baseSerie = String(orig.serie || '').trim();
    const serie = baseSerie ? `R${baseSerie}` : 'R';
    const numero = await nextNumero(client, orig.project_id, orig.issuer_id || null, ano, serie);
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
    `SELECT * FROM invoices WHERE conversion_id = $1 AND tipo <> 'proforma' ORDER BY id DESC LIMIT 1`,
    [conversionId]
  );
  return rows[0] || null;
}

export async function list({ projectId, estado, search, from, to, tipo, page = 1, limit = 50 }) {
  const conds = ['project_id = $1'];
  const params = [projectId];
  let i = 2;
  // tipo='proforma' → solo proformas; cualquier otro / ausente → solo facturas
  // (normal + rectificativa), para que las proformas no ensucien el histórico fiscal.
  if (tipo === 'proforma') conds.push(`tipo = 'proforma'`);
  else conds.push(`tipo <> 'proforma'`);
  if (estado) { conds.push(`estado = $${i++}`); params.push(estado); }
  if (search) { conds.push(`(LOWER(cliente_nombre) LIKE $${i} OR LOWER(cliente_nif) LIKE $${i} OR codigo LIKE $${i})`); params.push(`%${search.toLowerCase()}%`); i++; }
  if (from) { conds.push(`fecha_emision >= $${i++}`); params.push(from); }
  if (to)   { conds.push(`fecha_emision <= $${i++}`); params.push(to); }
  const where = conds.join(' AND ');
  const offset = (page - 1) * limit;
  const { rows } = await query(
    `SELECT id, codigo, ano, numero, fecha_emision, fecha_pago,
            cliente_nombre, cliente_nif, cliente_direccion, cliente_ciudad, cliente_cp, cliente_pais,
            cliente_email, total, iva_pct, estado, sent_at, tipo
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
       COUNT(*) FILTER (WHERE estado <> 'borrador')::int AS total,
       COUNT(*) FILTER (WHERE estado = 'borrador')::int AS borradores,
       COUNT(*) FILTER (WHERE estado = 'emitida')::int AS emitidas,
       COUNT(*) FILTER (WHERE estado = 'enviada')::int AS enviadas,
       COUNT(*) FILTER (WHERE estado = 'pagada')::int  AS pagadas,
       COUNT(*) FILTER (WHERE estado = 'cancelada')::int AS canceladas,
       COALESCE(SUM(total) FILTER (WHERE estado <> 'borrador'),0) AS total_facturado,
       COALESCE(SUM(total) FILTER (WHERE estado = 'pagada'),0) AS total_cobrado,
       COALESCE(SUM(iva_importe) FILTER (WHERE estado <> 'borrador'),0) AS total_iva
     FROM invoices WHERE project_id = $1 AND tipo <> 'proforma'`,
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

// ===== BORRADORES =====

// Qué le falta a una factura (borrador) para poder emitirse. Los campos
// cliente_* NOT NULL usan '—' como placeholder → cuenta como "falta".
const vacio = (v) => !v || String(v).trim() === '' || String(v).trim() === '—';
export function invoiceFaltantes(inv) {
  const faltan = [];
  if (vacio(inv.cliente_nombre)) faltan.push('nombre del cliente');
  if (vacio(inv.cliente_nif)) faltan.push('NIF/DNI del cliente');
  if (vacio(inv.cliente_direccion)) faltan.push('dirección fiscal');
  if (vacio(inv.cliente_ciudad)) faltan.push('ciudad');
  if (vacio(inv.cliente_cp)) faltan.push('código postal');
  if (vacio(inv.cliente_pais)) faltan.push('país');
  if (!Array.isArray(inv.items) || inv.items.length === 0) faltan.push('conceptos');
  return faltan;
}

// Numeración de un borrador SIN exigir completitud (uso interno del auto-emit
// por pago: el número se asigna igual; los datos que falten solo bloquean
// enviar/descargar la factura).
async function numerarBorrador(invoiceId) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows: sel } = await client.query(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [invoiceId]);
    const inv = sel[0];
    if (!inv || inv.estado !== 'borrador') { await client.query('COMMIT'); return inv || null; }
    const ano = new Date().getFullYear();
    const serie = (inv.serie && inv.serie.trim()) || 'A';
    const numero = await nextNumero(client, inv.project_id, inv.issuer_id || null, ano, serie);
    const codigo = `${ano}/${String(numero).padStart(4, '0')}`;
    const { rows } = await client.query(
      `UPDATE invoices SET ano = $2, numero = $3, codigo = $4,
         fecha_emision = CURRENT_DATE, estado = 'emitida', updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [invoiceId, ano, numero, codigo]
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

// AUTO-EMISIÓN AL REGISTRAR UN PAGO (spec owner 2026-07-15): en cuanto entra un
// pago, la conversión debe tener factura EMITIDA con su correlativo, guardada.
// Si había borrador → se numera tal cual. Si no había factura → se crea emitida
// con los datos de la conversión + lo que el lead tenga (faltantes = '—').
// Los datos incompletos NO bloquean la numeración, solo enviar/descargar.
export async function autoEmitirPorPago(conversionId, userId = null) {
  if (!conversionId) return null;
  const existing = await findByConversion(conversionId);
  if (existing && existing.estado !== 'cancelada') {
    if (existing.estado === 'borrador') return await numerarBorrador(existing.id);
    return existing; // ya numerada
  }
  const { rows: convRows } = await query(
    `SELECT c.*, l.nombre AS lead_nombre, l.email AS lead_email, l.telefono AS lead_telefono,
            l.identificacion_fiscal, l.direccion_fiscal, l.ciudad_fiscal, l.codigo_postal_fiscal, l.pais_fiscal
       FROM conversions c LEFT JOIN leads l ON l.id = c.lead_id
      WHERE c.id = $1`, [conversionId]);
  const conv = convRows[0];
  if (!conv) return null;

  const { rows: itemRows } = await query(
    `SELECT descripcion, cantidad, precio_unitario FROM conversion_items WHERE conversion_id = $1 ORDER BY orden`,
    [conversionId]);
  const items = itemRows.length
    ? itemRows.map((it) => ({ descripcion: it.descripcion, cantidad: Number(it.cantidad) || 1, precio_unitario: Number(it.precio_unitario) || 0 }))
    : [{ descripcion: conv.producto_contratado || 'Servicio', cantidad: 1, precio_unitario: Number(conv.importe_total) || 0 }];

  const ivaPct = conv.iva_exento ? 0 : Number(conv.iva_pct ?? 21);
  const metodosValidos = ['transferencia', 'tarjeta', 'tarjeta_stripe', 'efectivo', 'bizum', 'fraccionado', 'otro'];

  return await create({
    projectId: conv.project_id,
    conversionId,
    leadId: conv.lead_id,
    clienteNombre: conv.lead_nombre || 'Cliente',
    clienteNif: conv.identificacion_fiscal || undefined,
    clienteDireccion: conv.direccion_fiscal || undefined,
    clienteCiudad: conv.ciudad_fiscal || undefined,
    clienteCp: conv.codigo_postal_fiscal || undefined,
    clientePais: conv.pais_fiscal || 'España',
    clienteEmail: conv.lead_email || null,
    clienteTelefono: conv.lead_telefono || null,
    items,
    baseImponible: Number(conv.base_imponible ?? conv.importe_total) || 0,
    ivaPct,
    ivaImporte: Number(conv.iva_importe ?? 0) || 0,
    ivaIncluido: !!conv.iva_incluido,
    total: Number(conv.importe_total) || 0,
    leyendaIva: ivaPct === 0 ? 'Operación exenta de IVA conforme a la normativa aplicable.' : null,
    metodoPago: metodosValidos.includes(conv.metodo_pago) ? conv.metodo_pago : 'otro',
  }, userId);
}

// Completar datos fiscales del cliente en una factura YA emitida (que salió
// numerada con datos incompletos por el auto-emit). No toca la numeración.
export async function completarDatosCliente(id, patch = {}) {
  const inv = await findById(id);
  if (!inv) throw new AppError('Factura no encontrada', 404, 'INVOICE_NOT_FOUND');
  if (inv.estado === 'cancelada') throw new AppError('La factura está cancelada', 400, 'INVOICE_CANCELLED');
  const merged = {
    cliente_nombre: patch.clienteNombre ?? inv.cliente_nombre,
    cliente_nif: patch.clienteNif ?? inv.cliente_nif,
    cliente_direccion: patch.clienteDireccion ?? inv.cliente_direccion,
    cliente_ciudad: patch.clienteCiudad ?? inv.cliente_ciudad,
    cliente_cp: patch.clienteCp ?? inv.cliente_cp,
    cliente_pais: patch.clientePais ?? inv.cliente_pais,
    cliente_email: patch.clienteEmail ?? inv.cliente_email,
    cliente_telefono: patch.clienteTelefono ?? inv.cliente_telefono,
  };
  const { rows } = await query(
    `UPDATE invoices SET cliente_nombre=$2, cliente_nif=$3, cliente_direccion=$4, cliente_ciudad=$5,
        cliente_cp=$6, cliente_pais=$7, cliente_email=$8, cliente_telefono=$9,
        pdf_path = NULL, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, merged.cliente_nombre, merged.cliente_nif, merged.cliente_direccion, merged.cliente_ciudad,
     merged.cliente_cp, merged.cliente_pais, merged.cliente_email, merged.cliente_telefono]
  );
  if (inv.lead_id) {
    await query(
      `UPDATE leads SET
         identificacion_fiscal = COALESCE(NULLIF($1,'—'), identificacion_fiscal),
         direccion_fiscal      = COALESCE(NULLIF($2,'—'), direccion_fiscal),
         ciudad_fiscal         = COALESCE(NULLIF($3,'—'), ciudad_fiscal),
         codigo_postal_fiscal  = COALESCE(NULLIF($4,'—'), codigo_postal_fiscal),
         pais_fiscal           = COALESCE(NULLIF($5,'—'), pais_fiscal),
         updated_at = NOW()
       WHERE id = $6`,
      [merged.cliente_nif, merged.cliente_direccion, merged.cliente_ciudad, merged.cliente_cp, merged.cliente_pais, inv.lead_id]
    );
  }
  return rows[0];
}

// Validar y emitir un borrador: completa datos del cliente (si vienen), exige
// que no falte nada, y RECIÉN AHÍ asigna numero/codigo (correlativo fiscal).
export async function emitirBorrador(id, patch = {}) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows: sel } = await client.query(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [id]);
    const inv = sel[0];
    if (!inv) throw new AppError('Factura no encontrada', 404, 'INVOICE_NOT_FOUND');
    if (inv.estado !== 'borrador') throw new AppError('Solo un borrador se puede emitir', 400, 'NOT_DRAFT');

    // Completar datos del cliente que vengan en el patch (camelCase del frontend).
    const merged = {
      cliente_nombre: patch.clienteNombre ?? inv.cliente_nombre,
      cliente_nif: patch.clienteNif ?? inv.cliente_nif,
      cliente_direccion: patch.clienteDireccion ?? inv.cliente_direccion,
      cliente_ciudad: patch.clienteCiudad ?? inv.cliente_ciudad,
      cliente_cp: patch.clienteCp ?? inv.cliente_cp,
      cliente_pais: patch.clientePais ?? inv.cliente_pais,
      cliente_email: patch.clienteEmail ?? inv.cliente_email,
      cliente_telefono: patch.clienteTelefono ?? inv.cliente_telefono,
    };
    const faltan = invoiceFaltantes({ ...inv, ...merged });
    if (faltan.length > 0) {
      throw new AppError(`No se puede emitir. Falta: ${faltan.join(', ')}.`, 400, 'DRAFT_INCOMPLETE');
    }

    // Gating fiscal del emisor (igual que en create): NIF inválido bloquea.
    if (inv.issuer_id) {
      const r = await client.query(`SELECT * FROM invoice_issuers WHERE id = $1`, [inv.issuer_id]);
      const fiscal = issuerFiscalStatus(r.rows[0]);
      if (!fiscal.ready) {
        throw new AppError(
          `No se puede emitir: el CIF/NIF de la sociedad emisora no tiene formato válido. Corrígelo en Configuración → Empresas emisoras.`,
          400, 'ISSUER_NIF_INVALID');
      }
    }

    // Numeración fiscal AHORA (el borrador nunca consumió número).
    const ano = new Date().getFullYear();
    const serie = (inv.serie && inv.serie.trim()) || 'A';
    const numero = await nextNumero(client, inv.project_id, inv.issuer_id || null, ano, serie);
    const codigo = `${ano}/${String(numero).padStart(4, '0')}`;

    const { rows } = await client.query(
      `UPDATE invoices SET
         cliente_nombre = $2, cliente_nif = $3, cliente_direccion = $4,
         cliente_ciudad = $5, cliente_cp = $6, cliente_pais = $7,
         cliente_email = $8, cliente_telefono = $9,
         ano = $10, numero = $11, codigo = $12,
         fecha_emision = CURRENT_DATE, estado = 'emitida', updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, merged.cliente_nombre, merged.cliente_nif, merged.cliente_direccion,
       merged.cliente_ciudad, merged.cliente_cp, merged.cliente_pais,
       merged.cliente_email, merged.cliente_telefono,
       ano, numero, codigo]
    );

    // Persistir datos fiscales en el lead para próximas facturas.
    if (inv.lead_id) {
      await client.query(
        `UPDATE leads SET
           identificacion_fiscal = COALESCE(NULLIF($1,'—'), identificacion_fiscal),
           direccion_fiscal      = COALESCE(NULLIF($2,'—'), direccion_fiscal),
           ciudad_fiscal         = COALESCE(NULLIF($3,'—'), ciudad_fiscal),
           codigo_postal_fiscal  = COALESCE(NULLIF($4,'—'), codigo_postal_fiscal),
           pais_fiscal           = COALESCE(NULLIF($5,'—'), pais_fiscal),
           updated_at = NOW()
         WHERE id = $6`,
        [merged.cliente_nif, merged.cliente_direccion, merged.cliente_ciudad,
         merged.cliente_cp, merged.cliente_pais, inv.lead_id]
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

// Conversiones (cursos contratados) de un lead → para pre-rellenar conceptos de
// la factura/presupuesto. Trae el curso, el importe y el precio de catálogo.
export async function getLeadConversions(leadId) {
  const { rows } = await query(
    `SELECT c.id, c.producto_contratado, c.producto_contratado_id,
            c.importe_total, c.importe_pagado, c.metodo_pago, c.fecha_conversion,
            p.nombre AS producto_nombre, p.precio AS producto_precio
       FROM conversions c
       LEFT JOIN products p ON p.id = c.producto_contratado_id
      WHERE c.lead_id = $1
      ORDER BY c.fecha_conversion DESC NULLS LAST, c.id DESC`,
    [leadId]
  );
  return rows;
}

export async function getLeadFiscalData(leadId) {
  const { rows } = await query(
    `SELECT id, nombre, email, telefono,
            identificacion_fiscal, direccion_fiscal,
            ciudad_fiscal, codigo_postal_fiscal, pais_fiscal,
            cliente_tipo, nif_iva_vies, vies_validado
     FROM leads WHERE id = $1 AND deleted_at IS NULL`,
    [leadId]
  );
  return rows[0] || null;
}

// ─── Emisores (multi-empresa) ────────────────────────────────────────────────
export async function listIssuers(projectId) {
  const { rows } = await query(
    `SELECT * FROM invoice_issuers i
      WHERE i.activo = true
        AND ( i.project_id = $1
              OR i.id = (SELECT sociedad_emisora_id FROM projects WHERE id = $1) )
      ORDER BY es_default DESC, razon_social ASC`,
    [projectId]
  );
  // Enriquecemos con el estado fiscal (gating España): ready + qué falta.
  return rows.map((r) => ({ ...r, fiscal_status: issuerFiscalStatus(r) }));
}

export async function getIssuer(id) {
  const { rows } = await query(`SELECT * FROM invoice_issuers WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function getDefaultIssuer(projectId) {
  // La sociedad del proyecto es su emisor por defecto (spec: cada proyecto factura por su sociedad).
  const { rows } = await query(
    `SELECT * FROM invoice_issuers i
      WHERE i.activo = true
        AND ( i.id = (SELECT sociedad_emisora_id FROM projects WHERE id = $1) OR i.project_id = $1 )
      ORDER BY (i.id = (SELECT sociedad_emisora_id FROM projects WHERE id = $1)) DESC, es_default DESC, id ASC
      LIMIT 1`,
    [projectId]
  );
  return rows[0] || null;
}

export async function createIssuer(d, userId) {
  const { rows } = await query(
    `INSERT INTO invoice_issuers
       (project_id, razon_social, nif, direccion, ciudad, cp, pais, email, telefono, iban, logo_url, pie_default, es_default, serie, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [d.projectId || null, d.razonSocial, d.nif, d.direccion || null, d.ciudad || null, d.cp || null,
     d.pais || 'España', d.email || null, d.telefono || null, d.iban || null, d.logoUrl || null,
     d.pieDefault || null, !!d.esDefault, (d.serie && d.serie.trim()) || null, userId]
  );
  return rows[0];
}

export async function updateIssuer(id, d) {
  // Update parcial: solo toca los campos presentes en `d` (no pisa el resto con null).
  const COLS = {
    razonSocial: 'razon_social', nif: 'nif', direccion: 'direccion', ciudad: 'ciudad',
    cp: 'cp', pais: 'pais', email: 'email', telefono: 'telefono', iban: 'iban',
    logoUrl: 'logo_url', logoKey: 'logo_key', pieDefault: 'pie_default',
    esDefault: 'es_default', activo: 'activo', serie: 'serie',
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

// ── Regímenes fiscales + coletillas parametrizadas (editables desde panel) ───
export async function listRegimenes(projectId) {
  const { rows } = await query(
    `SELECT * FROM fiscal_regimenes WHERE activo = true AND (project_id IS NULL OR project_id = $1)
     ORDER BY orden ASC, id ASC`, [projectId]);
  return rows;
}

// Motor fiscal (REQ-FIS-02): resuelve el régimen aplicable según producto + cliente.
// Devuelve { clave, regimen } — `regimen` trae iva_pct + coletilla parametrizados.
export async function resolveRegimen(projectId, { productId, pais, cp, provincia, tipo, viesValido } = {}) {
  // ¿El producto tiene un régimen exento (formación exenta en España)?
  let productoExento = false;
  if (productId) {
    const { rows } = await query(
      `SELECT fr.aplica_iva FROM products p
        LEFT JOIN fiscal_regimenes fr ON fr.id = p.regimen_fiscal_id
        WHERE p.id = $1`, [productId]);
    if (rows[0] && rows[0].aplica_iva === false) productoExento = true;
  }
  const clave = resolveRegimenClave({ productoExento, pais, cp, provincia, tipo, viesValido: !!viesValido });
  // Régimen del proyecto si existe, si no el global.
  const { rows } = await query(
    `SELECT * FROM fiscal_regimenes
      WHERE clave = $1 AND activo = true AND (project_id = $2 OR project_id IS NULL)
      ORDER BY (project_id = $2) DESC NULLS LAST LIMIT 1`, [clave, projectId]);
  return { clave, regimen: rows[0] || null };
}
export async function updateRegimen(id, d) {
  const COLS = { nombre: 'nombre', aplicaIva: 'aplica_iva', ivaPct: 'iva_pct', coletilla: 'coletilla', orden: 'orden', activo: 'activo' };
  const sets = []; const params = [id];
  for (const [k, col] of Object.entries(COLS)) {
    if (Object.prototype.hasOwnProperty.call(d, k)) { params.push(d[k]); sets.push(`${col} = $${params.length}`); }
  }
  if (!sets.length) { const r = await query(`SELECT * FROM fiscal_regimenes WHERE id=$1`, [id]); return r.rows[0]; }
  sets.push('updated_at = NOW()');
  const { rows } = await query(`UPDATE fiscal_regimenes SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
  return rows[0];
}
export async function createRegimen(d) {
  const { rows } = await query(
    `INSERT INTO fiscal_regimenes (project_id, clave, nombre, aplica_iva, iva_pct, coletilla, orden)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [d.projectId || null, d.clave || null, d.nombre || 'Régimen', !!d.aplicaIva, Number(d.ivaPct) || 0, d.coletilla || null, Number(d.orden) || 99]);
  return rows[0];
}
export async function deleteRegimen(id) {
  await query(`UPDATE fiscal_regimenes SET activo=false, updated_at=NOW() WHERE id=$1`, [id]);
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
// Elige la plantilla según la condición por país del cliente. Prioridad:
// 1) plantilla del emisor que matchee el país (espana/extranjero)
// 2) plantilla del emisor sin condición (todos)
// 3) plantilla default del proyecto
export async function getTemplateForInvoice(issuerId, projectId, clientePais) {
  const isSpain = /españa|espana|spain|^es$/i.test(String(clientePais || '').trim());
  const wanted = isSpain ? 'espana' : 'extranjero';
  const { rows } = await query(
    `SELECT * FROM invoice_templates
      WHERE activo = true
        AND (issuer_id = $1 OR issuer_id IS NULL)
        AND (project_id IS NULL OR project_id = $2)
      ORDER BY (issuer_id = $1) DESC NULLS LAST, es_default DESC, id ASC`,
    [issuerId || null, projectId]);
  if (!rows.length) return null;
  return rows.find((t) => t.condicion_pais === wanted)
      || rows.find((t) => !t.condicion_pais || t.condicion_pais === 'todos')
      || rows[0];
}
export async function createTemplate(d, userId) {
  const { rows } = await query(
    `INSERT INTO invoice_templates (project_id, issuer_id, nombre, page_size, layout, es_default, condicion_pais, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [d.projectId || null, d.issuerId || null, d.nombre || 'Plantilla', d.pageSize || 'A4',
     JSON.stringify(d.layout || []), !!d.esDefault, d.condicionPais || null, userId]);
  return rows[0];
}
export async function updateTemplate(id, d) {
  const COLS = { nombre: 'nombre', pageSize: 'page_size', issuerId: 'issuer_id', esDefault: 'es_default', activo: 'activo', condicionPais: 'condicion_pais' };
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
       LEFT JOIN invoices i ON i.conversion_id = c.id AND i.estado <> 'cancelada' AND i.tipo <> 'proforma'
      WHERE c.project_id = $1
        AND COALESCE(c.importe_total, 0) > 0
        AND i.id IS NULL
      ORDER BY c.fecha_conversion DESC NULLS LAST`,
    [projectId]
  );
  return rows;
}

export async function getProjectInvoicerData(projectId) {
  // Nota: el emisor real viene del snapshot multi-empresa (issuer_*); esta función
  // solo aporta nombre/defaults del proyecto. No se referencia datos_fiscales
  // porque esa columna no existe en todas las instancias.
  const { rows } = await query(
    `SELECT id, nombre, slug, logo_url,
            factura_pie_default, factura_serie_default, factura_metodo_default
     FROM projects WHERE id = $1`,
    [projectId]
  );
  return rows[0] || null;
}

export async function setSequence(projectId, ano, serie, ultimoNumero) {
  const issuerId = await issuerOfProject(query, projectId);
  if (issuerId) {
    const upd = await query(
      `UPDATE invoice_sequences SET ultimo_numero = $1 WHERE issuer_id = $2 AND ano = $3 AND serie = $4`,
      [ultimoNumero, issuerId, ano, serie]
    );
    if (upd.rowCount === 0) {
      await query(
        `INSERT INTO invoice_sequences (project_id, issuer_id, ano, serie, ultimo_numero) VALUES ($1, $2, $3, $4, $5)`,
        [projectId, issuerId, ano, serie, ultimoNumero]
      );
    }
    return;
  }
  await query(
    `INSERT INTO invoice_sequences (project_id, ano, serie, ultimo_numero)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_id, ano, serie) DO UPDATE SET ultimo_numero = EXCLUDED.ultimo_numero`,
    [projectId, ano, serie, ultimoNumero]
  );
}

export async function getSequence(projectId, ano, serie) {
  const issuerId = await issuerOfProject(query, projectId);
  const { rows } = issuerId
    ? await query(`SELECT ultimo_numero FROM invoice_sequences WHERE issuer_id=$1 AND ano=$2 AND serie=$3`, [issuerId, ano, serie])
    : await query(`SELECT ultimo_numero FROM invoice_sequences WHERE project_id=$1 AND ano=$2 AND serie=$3`, [projectId, ano, serie]);
  return rows[0]?.ultimo_numero || 0;
}

export async function listSequences(projectId) {
  const issuerId = await issuerOfProject(query, projectId);
  const { rows } = issuerId
    ? await query(`SELECT ano, serie, ultimo_numero FROM invoice_sequences WHERE issuer_id=$1 ORDER BY ano DESC, serie`, [issuerId])
    : await query(`SELECT ano, serie, ultimo_numero FROM invoice_sequences WHERE project_id=$1 ORDER BY ano DESC, serie`, [projectId]);
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
