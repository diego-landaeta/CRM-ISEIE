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
    // Decisión de negocio: las PROFORMAS comparten el MISMO correlativo que las
    // facturas normales (misma serie y contador) y se numeran igual.
    const serie = (iss?.serie && iss.serie.trim()) || data.serie || 'A';
    // Borrador: NO consume correlativo. numero/codigo quedan NULL hasta emitir.
    const numero = isBorrador ? null : await nextNumero(client, data.projectId, iss?.id || null, ano, serie);
    const codigo = isBorrador ? null : `${ano}/${String(numero).padStart(4, '0')}`;

    const { rows } = await client.query(
      `INSERT INTO invoices (
         project_id, conversion_id, lead_id, payment_id, serie, ano, numero, codigo,
         fecha_emision,
         cliente_nombre, cliente_nif, cliente_direccion, cliente_ciudad, cliente_cp, cliente_pais,
         cliente_email, cliente_telefono,
         items, base_imponible, iva_pct, iva_importe, iva_incluido, total,
         estado, notas, leyenda_iva, metodo_pago, pie_pago, created_by, tipo,
         issuer_id, issuer_razon_social, issuer_nif, issuer_direccion, issuer_ciudad,
         issuer_cp, issuer_pais, issuer_email, issuer_telefono, issuer_iban, issuer_logo_url,
         moneda
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,
         $30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42
       ) RETURNING *`,
      [
        data.projectId, data.conversionId || null, data.leadId || null, data.paymentId || null,
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
        (data.moneda ? String(data.moneda).toUpperCase() : 'EUR'),
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
    // Devuelve el documento vigente de la conversión: prefiere la factura fiscal
    // (tipo normal) y, si aún no existe, cae en la proforma activa. Así el botón de
    // la conversión "ve" la proforma ya emitida y no deja emitir otra (bug: dejaba
    // duplicar proforma porque este SELECT las excluía).
    `SELECT * FROM invoices
      WHERE conversion_id = $1 AND estado <> 'cancelada'
      ORDER BY (tipo = 'proforma') ASC, id DESC
      LIMIT 1`,
    [conversionId]
  );
  return rows[0] || null;
}

// Listado de facturas. Ámbito:
//  - por PROYECTO (projectId): el flujo normal.
//  - por SOCIEDAD (issuerId, sin projectId): vista global de todas las facturas
//    de esa empresa emisora entre todos los proyectos (correlativos en orden).
//    Solo admin/superadmin (lo restringe el controller).
export async function list({ projectId, issuerId, estado, search, from, to, tipo, responsableId, page = 1, limit = 50 }) {
  const conds = [];
  const params = [];
  let idx = 1;
  if (issuerId)  { conds.push(`i.issuer_id = $${idx++}`); params.push(issuerId); }
  if (projectId) { conds.push(`i.project_id = $${idx++}`); params.push(projectId); }
  // Gestor: solo ve las facturas de SUS leads (responsable). Admin/superadmin ven todas.
  if (responsableId) { conds.push(`l.responsable_id = $${idx++}`); params.push(responsableId); }
  // tipo='proforma' → solo proformas; cualquier otro / ausente → solo facturas
  // (normal + rectificativa), para que las proformas no ensucien el histórico fiscal.
  if (tipo === 'proforma') conds.push(`i.tipo = 'proforma'`);
  else if (tipo === 'rectificativa') conds.push(`i.tipo = 'rectificativa'`);   // pestaña Abonos
  else if (tipo === 'normal') conds.push(`i.tipo = 'normal'`);                 // pestaña Facturas
  else conds.push(`i.tipo <> 'proforma'`);                                     // compat
  if (estado) { conds.push(`i.estado = $${idx++}`); params.push(estado); }
  if (search) { conds.push(`(LOWER(i.cliente_nombre) LIKE $${idx} OR LOWER(i.cliente_nif) LIKE $${idx} OR i.codigo LIKE $${idx})`); params.push(`%${search.toLowerCase()}%`); idx++; }
  if (from) { conds.push(`i.fecha_emision >= $${idx++}`); params.push(from); }
  if (to)   { conds.push(`i.fecha_emision <= $${idx++}`); params.push(to); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const offset = (page - 1) * limit;
  const { rows } = await query(
    `SELECT i.id, i.codigo, i.ano, i.numero, i.fecha_emision, i.fecha_pago,
            i.cliente_nombre, i.cliente_nif, i.cliente_direccion, i.cliente_ciudad, i.cliente_cp, i.cliente_pais,
            i.cliente_email, i.total, i.iva_pct, i.estado, i.sent_at, i.tipo,
            i.lead_id, i.conversion_id,
            i.project_id, p.nombre AS proyecto_nombre,
            i.issuer_id, i.issuer_razon_social,
            i.metodo_pago, i.moneda,
            u.nombre AS gestora_nombre
     FROM invoices i
     LEFT JOIN projects p ON p.id = i.project_id
     LEFT JOIN leads l ON l.id = i.lead_id
     LEFT JOIN users u ON u.id = l.responsable_id
     ${where}
     ORDER BY i.ano DESC, i.numero DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const { rows: c } = await query(
    `SELECT COUNT(*)::int AS total FROM invoices i LEFT JOIN leads l ON l.id = i.lead_id ${where}`,
    params
  );
  return { rows, total: c[0].total };
}

// Stats de la MISMA vista que la lista: por proyecto o por sociedad (issuerId),
// pudiendo acotar a un proyecto de esa sociedad. Así los KPIs cuadran con la tabla.
export async function getStats({ projectId, issuerId } = {}) {
  const conds = [`tipo <> 'proforma'`];
  const params = [];
  let idx = 1;
  if (issuerId)  { conds.push(`issuer_id = $${idx++}`);  params.push(issuerId); }
  if (projectId) { conds.push(`project_id = $${idx++}`); params.push(projectId); }
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
     FROM invoices WHERE ${conds.join(' AND ')}`,
    params
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

// Elimina una factura por completo y LIBERA su número: recalcula el contador de la
// serie al mayor número restante, de modo que si se borran los últimos (errores) el
// siguiente vuelve a reutilizarlos sin dejar huecos. Solo admin/superadmin.
// No toca la conversión ni sus pagos (la venta sigue; se podrá re-facturar).
export async function deleteInvoice(id) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows: sel } = await client.query(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [id]);
    const inv = sel[0];
    if (!inv) { await client.query('ROLLBACK'); return null; }
    await client.query(`DELETE FROM invoices WHERE id = $1`, [id]);
    if (inv.issuer_id != null && inv.serie != null && inv.numero != null) {
      const { rows: mx } = await client.query(
        `SELECT COALESCE(MAX(numero), 0) AS m FROM invoices WHERE issuer_id = $1 AND ano = $2 AND serie = $3`,
        [inv.issuer_id, inv.ano, inv.serie]
      );
      await client.query(
        `UPDATE invoice_sequences SET ultimo_numero = $1
          WHERE issuer_id = $2 AND ano = $3 AND serie = $4 AND ultimo_numero > $1`,
        [mx[0].m, inv.issuer_id, inv.ano, inv.serie]
      );
    }
    await client.query('COMMIT');
    return inv;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ¿La conversión no tiene ningún pago? → no puede emitir factura fiscal (solo proforma).
export async function conversionSinPago(conversionId) {
  const { rows } = await query(
    `SELECT COALESCE(c.importe_pagado, 0) AS pagado,
            EXISTS (
              SELECT 1 FROM conversion_payments cp WHERE cp.conversion_id = c.id
            ) AS tiene_pagos
       FROM conversions c
      WHERE c.id = $1`,
    [conversionId]
  );
  return rows[0] ? Number(rows[0].pagado) <= 0 && !rows[0].tiene_pagos : false;
}

// ¿El usuario tiene el permiso factura_manager? (gestora con poderes de factura).
export async function esFacturaManager(userId) {
  const { rows } = await query(`SELECT factura_manager FROM users WHERE id = $1`, [userId]);
  return !!rows[0]?.factura_manager;
}

// ¿Puede este usuario gestionar (editar/corregir/eliminar/abonar) esta factura?
// Admin/superadmin → cualquiera. Gestor → solo si es factura_manager Y la factura
// es de un lead del que es responsable (sus propias facturas).
export async function puedeGestionarFactura(userId, role, invoiceId) {
  if (role === 'admin' || role === 'superadmin') return true;
  if (role !== 'gestor') return false;
  if (!(await esFacturaManager(userId))) return false;
  const { rows } = await query(
    `SELECT l.responsable_id FROM invoices i LEFT JOIN leads l ON l.id = i.lead_id WHERE i.id = $1`,
    [invoiceId]
  );
  return !!rows[0] && rows[0].responsable_id === userId;
}

// Permiso acotado: usuario que SOLO puede cambiar las fechas (emisión y pago) de
// las facturas, sin tocar importes/conceptos. Admin/superadmin siempre pueden.
export async function esEditorFechas(userId) {
  const { rows } = await query(`SELECT editar_fechas_factura FROM users WHERE id = $1`, [userId]);
  return !!rows[0]?.editar_fechas_factura;
}

export async function puedeEditarFechas(userId, role) {
  if (role === 'admin' || role === 'superadmin') return true;
  return esEditorFechas(userId);
}

// Actualiza SOLO fecha_emision y/o fecha_pago. Regenera el PDF (pdf_path=NULL).
export async function updateFechas(id, { fechaEmision, fechaPago }) {
  const { rows } = await query(
    `UPDATE invoices
        SET fecha_emision = COALESCE($2::date, fecha_emision),
            fecha_pago    = COALESCE($3::date, fecha_pago),
            pdf_path = NULL, updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, fechaEmision || null, fechaPago || null]
  );
  return rows[0];
}

// Opción B: asocia una factura YA existente a una venta (conversión) del mismo
// proyecto. Reapunta también el lead de la factura al de la venta. Devuelve null
// si la conversión no existe o es de otro proyecto.
export async function asociarVenta(id, conversionId) {
  const { rows } = await query(
    `UPDATE invoices i
        SET conversion_id = c.id,
            lead_id = c.lead_id,
            updated_at = NOW()
       FROM conversions c
      WHERE i.id = $1 AND c.id = $2 AND c.project_id = i.project_id
      RETURNING i.*`,
    [id, conversionId]
  );
  return rows[0] || null;
}

// Proforma activa (no cancelada) ya emitida para una conversión. Evita duplicar
// proformas (y quemar correlativo fiscal) si se pulsa "Emitir proforma" dos veces.
export async function proformaActivaDeConversion(conversionId) {
  const { rows } = await query(
    `SELECT id, codigo FROM invoices
      WHERE conversion_id = $1 AND tipo = 'proforma' AND estado <> 'cancelada'
      ORDER BY id ASC LIMIT 1`,
    [conversionId]
  );
  return rows[0] || null;
}

// ===== BORRADORES =====

// Qué le falta a una factura (borrador) para poder emitirse. Los campos
// cliente_* NOT NULL usan '—' como placeholder → cuenta como "falta".
const vacio = (v) => !v || String(v).trim() === '' || String(v).trim() === '—';
export function invoiceFaltantes(inv) {
  const faltan = [];
  const esEspana = /españa|espana|spain|^es$/i.test(String(inv.cliente_pais || '').trim());
  if (vacio(inv.cliente_nombre)) faltan.push('nombre del cliente');
  if (vacio(inv.cliente_nif)) faltan.push('NIF/DNI del cliente');
  if (vacio(inv.cliente_direccion)) faltan.push('dirección fiscal');
  if (vacio(inv.cliente_ciudad)) faltan.push('ciudad');
  // El código postal solo se exige a clientes de España (los extranjeros no usan
  // el CP español; muchas facturas internacionales no lo llevan).
  if (esEspana && vacio(inv.cliente_cp)) faltan.push('código postal');
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
const METODOS_PAGO_VALIDOS = ['transferencia', 'tarjeta', 'tarjeta_stripe', 'efectivo', 'bizum', 'fraccionado', 'otro'];

// Datos fiscales del cliente + snapshot de la conversión, para armar la factura.
async function _convDataParaFactura(conversionId) {
  const { rows } = await query(
    `SELECT c.*, l.nombre AS lead_nombre, l.email AS lead_email, l.telefono AS lead_telefono,
             l.identificacion_fiscal, l.direccion_fiscal, l.ciudad_fiscal, l.codigo_postal_fiscal, l.pais_fiscal,
             l.cliente_tipo, l.custom_fields,
             pr.nombre AS producto_catalogo
       FROM conversions c
       LEFT JOIN leads l ON l.id = c.lead_id
       LEFT JOIN products pr ON pr.id = c.producto_contratado_id
      WHERE c.id = $1`, [conversionId]);
  return rows[0] || null;
}

// Nombre del PROGRAMA para el concepto: prioriza el producto del catálogo
// (producto_contratado_id) sobre el texto libre (que a veces trae mal cargado el
// nombre del cliente).
function nombrePrograma(conv) {
  const cat = conv.producto_catalogo && String(conv.producto_catalogo).trim();
  if (cat) return cat;
  const txt = conv.producto_contratado && String(conv.producto_contratado).trim();
  return txt || 'programa';
}

function nombreClienteFactura(conv) {
  const razonSocial = conv.cliente_tipo === 'empresa'
    ? String(conv.custom_fields?.razon_social || '').trim()
    : '';
  return razonSocial || conv.lead_nombre || 'Cliente';
}

function telefonoClienteFactura(conv) {
  const telefonoFiscal = conv.cliente_tipo === 'empresa'
    ? String(conv.custom_fields?.telefono_facturacion || '').trim()
    : '';
  return telefonoFiscal || conv.lead_telefono || null;
}

// PROFORMA → FACTURA: convierte una proforma (número fiscal ya reservado) en
// factura definitiva con ESE MISMO número, por el TOTAL de la conversión. Así el
// correlativo fiscal queda continuo (el número reservado acaba siendo factura).
async function _convertirProformaEnFactura(prof, conv, paymentId, fechaPago) {
  const total = Number(conv.importe_total) || 0;
  const pagado = Number(conv.importe_pagado) || 0;
  const ivaPct = conv.iva_exento ? 0 : Number(conv.iva_pct ?? 21);
  const base = ivaPct > 0 ? Number((total / (1 + ivaPct / 100)).toFixed(2)) : total;
  const ivaImp = Number((total - base).toFixed(2));
  // Concepto con el formato fijo y el programa del catálogo (no el texto libre).
  const concepto = `Producto/servicio: servicio académico, ${nombrePrograma(conv)}`;
  const saldada = pagado >= total - 0.01;
  // El ítem lleva el precio BRUTO (con IVA incluido); el PDF ya lo pasa a neto para
  // que la línea cuadre con la base imponible (antes se guardaba el neto y el PDF lo
  // volvía a dividir → subtotal ≠ base imponible).
  const items = JSON.stringify([{ descripcion: concepto, cantidad: 1, precio_unitario: total }]);
  const { rows } = await query(
    `UPDATE invoices SET
       tipo = 'normal', estado = $2::text,
       fecha_emision = COALESCE($3::date, fecha_emision),
       fecha_pago = CASE WHEN $2::text = 'pagada' THEN $3::date ELSE NULL END,
       payment_id = COALESCE(payment_id, $4::int),
       items = $5::jsonb, base_imponible = $6::numeric, iva_pct = $7::numeric, iva_importe = $8::numeric,
       iva_incluido = true, total = $9::numeric, leyenda_iva = $10, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [prof.id, saldada ? 'pagada' : 'emitida', fechaPago, paymentId, items, base, ivaPct, ivaImp, total,
     ivaPct === 0 ? 'Operación exenta de IVA conforme a la normativa aplicable.' : null]);
  return rows[0];
}

// FACTURA POR PAGO (spec owner 2026-07-16): cada abono genera su propia factura
// por el MONTO PAGADO (no por el total del programa). El importe del pago se
// trata como BRUTO (IVA incluido); se desglosa base + IVA. Dedup por payment_id
// (índice único parcial) → reintentos/reejecuciones no duplican.
// EXCEPCIÓN: si la conversión tiene una PROFORMA (número reservado), el pago la
// convierte en factura con ese número, en vez de crear una factura nueva.
export async function emitirFacturaDePago(conversionId, { paymentId, importe }, userId = null) {
  if (!conversionId || !paymentId) return null;
  const monto = Number(importe) || 0;
  if (monto <= 0) return null;

  const { rows: dup } = await query(
    `SELECT * FROM invoices WHERE payment_id = $1 AND estado <> 'cancelada' LIMIT 1`, [paymentId]);
  if (dup[0]) return dup[0];

  const conv = await _convDataParaFactura(conversionId);
  if (!conv) return null;

  // Fecha real del cobro → la factura sale PAGADA con esa fecha (el dinero ya entró).
  const { rows: payRows } = await query(
    `SELECT cp.fecha, cp.metodo, cp.notas,
            sp.metadata AS stripe_metadata
       FROM conversion_payments cp
       LEFT JOIN stripe_payments sp ON sp.conversion_payment_id = cp.id
      WHERE cp.id = $1
      ORDER BY sp.id DESC NULLS LAST
      LIMIT 1`,
    [paymentId]
  );
  const fechaPago = payRows[0]?.fecha || null;
  const metodoPago = payRows[0]?.metodo || null;
  const notasPago = payRows[0]?.notas || null;
  const stripeMeta = payRows[0]?.stripe_metadata || {};
  const originalAmount = Number(stripeMeta.original_amount);
  const originalCurrency = String(stripeMeta.original_currency || '').toUpperCase();
  const foreignStripePayment = Number.isFinite(originalAmount)
    && originalAmount > 0
    && originalCurrency
    && originalCurrency !== 'EUR';

  // No auto-facturar pagos ANTERIORES al inicio de facturación de la sociedad (su
  // primera factura emitida). Evita facturas retroactivas de cobros previos al
  // arranque. Si la sociedad aún no factura, no bloquea (permite el primer arranque).
  if (fechaPago) {
    const { rows: chk } = await query(
      `SELECT 1 FROM projects pr
         JOIN invoices f ON f.issuer_id = pr.sociedad_emisora_id
           AND f.tipo <> 'proforma' AND f.numero IS NOT NULL
        WHERE pr.id = $1
        GROUP BY pr.id
       HAVING $2::date < MIN(f.fecha_emision)`, [conv.project_id, fechaPago]);
    if (chk.length) return null;
  }

  // ¿La conversión tiene una PROFORMA? → convertirla en factura (por el total, con
  // su número reservado). El correlativo fiscal queda continuo.
  const { rows: prof } = await query(
    `SELECT * FROM invoices WHERE conversion_id = $1 AND tipo = 'proforma' AND estado <> 'cancelada' ORDER BY id DESC LIMIT 1`,
    [conversionId]);
  if (prof[0]) return await _convertirProformaEnFactura(prof[0], conv, paymentId, fechaPago);

  // ¿Ya hay una factura por el TOTAL de la conversión (ex-proforma o completa)?
  // No se crea otra por pago: solo se marca pagada cuando la venta queda saldada.
  const { rows: facTot } = await query(
    `SELECT id, estado FROM invoices WHERE conversion_id = $1 AND tipo = 'normal' AND estado <> 'cancelada'
       AND total >= (SELECT importe_total FROM conversions WHERE id = $1) - 0.01 ORDER BY id DESC LIMIT 1`,
    [conversionId]);
  if (facTot[0]) {
    const saldada = Number(conv.importe_pagado) >= Number(conv.importe_total) - 0.01;
    if (saldada && facTot[0].estado !== 'pagada') { try { await markPaid(facTot[0].id, fechaPago); } catch { /* noop */ } }
    return facTot[0];
  }

  // Servicios académicos: exentos de IVA. La factura sale sin IVA (base = monto).
  const ivaPct = 0;
  const base = monto;
  const ivaImporte = 0;
  // Concepto FIJO: "Producto/servicio: servicio académico, <programa>". Si el pago
  // es una cuota (notas "Cuota N") → "...mensualidad N de <programa>".
  const prog = nombrePrograma(conv);
  const mCuota = /cuota\s*(\d+)/i.exec(String(notasPago || ''));
  const conceptoBase = mCuota
    ? `Producto/servicio: servicio académico, mensualidad ${mCuota[1]} de ${prog}`
    : `Producto/servicio: servicio académico, ${prog}`;
  const concepto = foreignStripePayment
    ? `${conceptoBase} (${originalAmount.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${originalCurrency}; liquidación neta Stripe: ${monto.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR)`
    : conceptoBase;

  const inv = await create({
    projectId: conv.project_id,
    conversionId,
    paymentId,
    leadId: conv.lead_id,
    clienteNombre: nombreClienteFactura(conv),
    clienteNif: conv.identificacion_fiscal || undefined,
    clienteDireccion: conv.direccion_fiscal || undefined,
    clienteCiudad: conv.ciudad_fiscal || undefined,
    clienteCp: conv.codigo_postal_fiscal || undefined,
    clientePais: conv.pais_fiscal || 'España',
    clienteEmail: conv.lead_email || null,
    clienteTelefono: telefonoClienteFactura(conv),
    items: [{ descripcion: concepto, cantidad: 1, precio_unitario: base }],
    baseImponible: base,
    ivaPct,
    ivaImporte,
    ivaIncluido: false,
    total: monto,
    notas: foreignStripePayment
      ? `Cobro internacional: ${originalAmount.toFixed(2)} ${originalCurrency}. Importe neto liquidado por Stripe: ${monto.toFixed(2)} EUR.`
      : null,
    leyendaIva: 'Operación exenta de IVA conforme a la normativa aplicable.',
    // Método REAL del pago (el que eligió el usuario al cobrar). 'fraccionado' es
    // el PLAN de la venta, no un método: si el pago no trae método, cae a Tarjeta.
    metodoPago: (metodoPago && METODOS_PAGO_VALIDOS.includes(metodoPago)) ? metodoPago
      : conv.metodo_pago === 'fraccionado' ? 'tarjeta'
      : (METODOS_PAGO_VALIDOS.includes(conv.metodo_pago) ? conv.metodo_pago : 'otro'),
  }, userId);
  // Un pago recibido → factura PAGADA (no 'emitida'), con la fecha del cobro.
  if (inv?.id) {
    try { await markPaid(inv.id, fechaPago); inv.estado = 'pagada'; inv.fecha_pago = fechaPago; } catch { /* no bloqueante */ }
  }
  return inv;
}

// LEGACY (compat): auto-emisión "1 factura por conversión al total". Se conserva
// para llamadas sin info de pago. El flujo nuevo usa emitirFacturaDePago.
export async function autoEmitirPorPago(conversionId, userId = null) {
  if (!conversionId) return null;
  const existing = await findByConversion(conversionId);
  if (existing && existing.estado !== 'cancelada') {
    if (existing.estado === 'borrador') return await numerarBorrador(existing.id);
    return existing; // ya numerada
  }
  const conv = await _convDataParaFactura(conversionId);
  if (!conv) return null;

  const { rows: itemRows } = await query(
    `SELECT descripcion, cantidad, precio_unitario FROM conversion_items WHERE conversion_id = $1 ORDER BY orden`,
    [conversionId]);
  const items = itemRows.length
    ? itemRows.map((it) => ({ descripcion: it.descripcion, cantidad: Number(it.cantidad) || 1, precio_unitario: Number(it.precio_unitario) || 0 }))
    : [{ descripcion: conv.producto_contratado || 'Servicio', cantidad: 1, precio_unitario: Number(conv.importe_total) || 0 }];

  const ivaPct = conv.iva_exento ? 0 : Number(conv.iva_pct ?? 21);
  return await create({
    projectId: conv.project_id,
    conversionId,
    leadId: conv.lead_id,
    clienteNombre: nombreClienteFactura(conv),
    clienteNif: conv.identificacion_fiscal || undefined,
    clienteDireccion: conv.direccion_fiscal || undefined,
    clienteCiudad: conv.ciudad_fiscal || undefined,
    clienteCp: conv.codigo_postal_fiscal || undefined,
    clientePais: conv.pais_fiscal || 'España',
    clienteEmail: conv.lead_email || null,
    clienteTelefono: telefonoClienteFactura(conv),
    items,
    baseImponible: Number(conv.base_imponible ?? conv.importe_total) || 0,
    ivaPct,
    ivaImporte: Number(conv.iva_importe ?? 0) || 0,
    ivaIncluido: !!conv.iva_incluido,
    total: Number(conv.importe_total) || 0,
    leyendaIva: ivaPct === 0 ? 'Operación exenta de IVA conforme a la normativa aplicable.' : null,
    // 'fraccionado' es el PLAN de la venta, no el método de un pago concreto: la
    // factura del pago usa el método real (por defecto Tarjeta en pagos online).
    metodoPago: conv.metodo_pago === 'fraccionado' ? 'tarjeta'
      : (METODOS_PAGO_VALIDOS.includes(conv.metodo_pago) ? conv.metodo_pago : 'otro'),
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
    // Respeta un número YA reservado (borrador con hueco reservado, p.ej. 0612);
    // si no tenía, asigna el siguiente de la secuencia.
    const ano = inv.numero != null ? inv.ano : new Date().getFullYear();
    const serie = (inv.serie && inv.serie.trim()) || 'A';
    const numero = inv.numero != null ? inv.numero : await nextNumero(client, inv.project_id, inv.issuer_id || null, ano, serie);
    const codigo = inv.codigo || `${ano}/${String(numero).padStart(4, '0')}`;
    // Si ya tenía fecha propia (borrador reservado), la conserva; si no, hoy.
    const fecha = inv.fecha_emision || new Date();

    const { rows } = await client.query(
      `UPDATE invoices SET
         cliente_nombre = $2, cliente_nif = $3, cliente_direccion = $4,
         cliente_ciudad = $5, cliente_cp = $6, cliente_pais = $7,
         cliente_email = $8, cliente_telefono = $9,
         ano = $10, numero = $11, codigo = $12,
         fecha_emision = $13, estado = 'emitida', updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, merged.cliente_nombre, merged.cliente_nif, merged.cliente_direccion,
       merged.cliente_ciudad, merged.cliente_cp, merged.cliente_pais,
       merged.cliente_email, merged.cliente_telefono,
       ano, numero, codigo, fecha]
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

// Edición COMPLETA de una factura en BORRADOR (solo admin/superadmin vía ruta).
// Permite cambiar cliente, conceptos, importes, fecha, emisor, moneda… Nunca toca
// una factura ya emitida (fiscalmente inmutable). Los importes llegan ya
// recalculados server-side desde el controller.
export async function updateBorrador(id, data, { soloBorrador = true } = {}) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { rows: sel } = await client.query(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [id]);
    const inv = sel[0];
    if (!inv) throw new AppError('Factura no encontrada', 404, 'INVOICE_NOT_FOUND');
    // soloBorrador=false → corrección admin de una factura ya emitida/pagada
    // (mantiene su número fiscal; se usa para enmendar datos/IVA/concepto).
    if (soloBorrador && inv.estado !== 'borrador') throw new AppError('Solo se pueden editar facturas en borrador (una factura emitida es inmutable).', 400, 'NOT_DRAFT');

    // Snapshot del emisor si cambia; si no, conserva el actual.
    let iss = { id: inv.issuer_id, razon_social: inv.issuer_razon_social, nif: inv.issuer_nif, direccion: inv.issuer_direccion, ciudad: inv.issuer_ciudad, cp: inv.issuer_cp, pais: inv.issuer_pais };
    if (data.issuerId && data.issuerId !== inv.issuer_id) {
      const r = await client.query(`SELECT * FROM invoice_issuers WHERE id = $1`, [data.issuerId]);
      if (r.rows[0]) { const e = r.rows[0]; iss = { id: e.id, razon_social: e.razon_social, nif: e.nif, direccion: e.direccion, ciudad: e.ciudad, cp: e.cp, pais: e.pais }; }
    }
    const g = (k, d) => (data[k] !== undefined ? data[k] : d);
    const { rows } = await client.query(
      `UPDATE invoices SET
         cliente_nombre=$2, cliente_nif=$3, cliente_direccion=$4, cliente_ciudad=$5, cliente_cp=$6, cliente_pais=$7,
         cliente_email=$8, cliente_telefono=$9,
         items=$10, base_imponible=$11, iva_pct=$12, iva_importe=$13, iva_incluido=$14, total=$15,
         fecha_emision=$16, notas=$17, metodo_pago=$18, pie_pago=$19, leyenda_iva=$20, moneda=$21,
         issuer_id=$22, issuer_razon_social=$23, issuer_nif=$24, issuer_direccion=$25, issuer_ciudad=$26, issuer_cp=$27, issuer_pais=$28,
         project_id=$29, updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [id,
       g('clienteNombre', inv.cliente_nombre), g('clienteNif', inv.cliente_nif), g('clienteDireccion', inv.cliente_direccion),
       g('clienteCiudad', inv.cliente_ciudad), g('clienteCp', inv.cliente_cp), g('clientePais', inv.cliente_pais),
       g('clienteEmail', inv.cliente_email), g('clienteTelefono', inv.cliente_telefono),
       JSON.stringify(g('items', inv.items)), g('baseImponible', inv.base_imponible), g('ivaPct', inv.iva_pct),
       g('ivaImporte', inv.iva_importe), g('ivaIncluido', inv.iva_incluido), g('total', inv.total),
       g('fechaEmision', inv.fecha_emision), g('notas', inv.notas), g('metodoPago', inv.metodo_pago),
       g('piePago', inv.pie_pago), g('leyendaIva', inv.leyenda_iva), g('moneda', inv.moneda),
       iss.id, iss.razon_social, iss.nif, iss.direccion, iss.ciudad, iss.cp, iss.pais,
       g('projectId', inv.project_id)]);
    // Corrección de una emitida: invalida el PDF cacheado para que se regenere
    // con los datos nuevos la próxima vez que se descargue.
    if (!soloBorrador) {
      await client.query(`UPDATE invoices SET pdf_path = NULL WHERE id = $1`, [id]);
      rows[0].pdf_path = null;
      // Si la factura corresponde a un pago concreto y cambió el importe, se sincroniza
      // el pago, la cuota y el total pagado de la conversión → así en la ficha del
      // cliente aparece el monto corregido (ej.: era 300 y se puso 250, se corrige).
      const nuevoTotal = Number(rows[0].total);
      const viejoTotal = Number(inv.total);
      if (inv.payment_id && Number.isFinite(nuevoTotal) && Math.abs(nuevoTotal - viejoTotal) > 0.001) {
        await client.query(`UPDATE conversion_payments SET importe = $1 WHERE id = $2`, [nuevoTotal, inv.payment_id]);
        await client.query(`UPDATE conversion_installments SET importe_cobrado = $1 WHERE payment_id = $2 AND fecha_cobro IS NOT NULL`, [nuevoTotal, inv.payment_id]);
        if (inv.conversion_id) {
          await client.query(
            `UPDATE conversions SET importe_pagado = GREATEST(0, importe_pagado + $1), updated_at = NOW() WHERE id = $2`,
            [nuevoTotal - viejoTotal, inv.conversion_id]
          );
        }
      }
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
  // Sin proyecto → TODAS las sociedades activas (para el filtro por sociedad, admin).
  const { rows } = projectId
    ? await query(
        `SELECT * FROM invoice_issuers i
          WHERE i.activo = true
            AND ( i.project_id = $1
                  OR i.id = (SELECT sociedad_emisora_id FROM projects WHERE id = $1) )
          ORDER BY es_default DESC, razon_social ASC`,
        [projectId])
    : await query(
        `SELECT * FROM invoice_issuers WHERE activo = true ORDER BY razon_social ASC`);
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
        AND c.factura_no_requerida IS NOT TRUE
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
