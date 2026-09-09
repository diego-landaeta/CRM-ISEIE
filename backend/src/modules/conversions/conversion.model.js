import { query, getClient } from '../../shared/config/db.js';
import { CLASE_FACTURA, FACTURA_REAL } from '../invoices/clase.sql.js';

const LEAD_EXISTS_SQL = `SELECT id, project_id FROM leads WHERE id = $1`;

export async function leadBelongsToProject(leadId, projectId) {
  const { rows } = await query(LEAD_EXISTS_SQL, [leadId]);
  if (!rows[0]) return false;
  return rows[0].project_id === projectId;
}

export async function create(data) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const {
      lead_id,
      project_id,
      producto_contratado,
      producto_contratado_id,
      importe_total,
      importe_pagado,
      metodo_pago,
      metodo_pago_inicial,   // método REAL del pago inicial (tarjeta, transferencia…)
      fecha_compromiso_pago,
      fecha_conversion,
      notas_pago,
      items,             // array opcional [{descripcion, cantidad, precio_unitario, product_id?}]
      iva_pct,           // default 21
      iva_incluido,      // default false (sumar IVA al subtotal)
      iva_exento,        // default false
      descuento_tipo,    // 'none' | 'pct' | 'monto'
      descuento_valor,   // % o monto fijo
      subtotal_bruto,    // precio base antes de descuento/IVA (modo simple)
    } = data;

    const ivaPctVal = Number(iva_pct ?? 21);
    const isExento = !!iva_exento;
    const isIncluido = !!iva_incluido;
    const descTipo = ['pct', 'monto'].includes(descuento_tipo) ? descuento_tipo : 'none';
    const descVal = Number(descuento_valor || 0);

    // 1) Subtotal bruto: suma de items, o el importe_total ingresado (modo simple)
    const hasItems = Array.isArray(items) && items.length > 0;
    const subtotalBruto = hasItems
      ? items.reduce((s, it) => s + Number(it.cantidad || 1) * Number(it.precio_unitario || 0), 0)
      : Number(subtotal_bruto ?? importe_total ?? 0);

    // 2) Descuento
    let descImporte = 0;
    if (descTipo === 'pct') descImporte = subtotalBruto * descVal / 100;
    else if (descTipo === 'monto') descImporte = Math.min(descVal, subtotalBruto);
    descImporte = Number(descImporte.toFixed(2));

    // 3) Neto tras descuento
    const neto = Number((subtotalBruto - descImporte).toFixed(2));

    // 4) Base + IVA + total
    let base, ivaImp, total;
    if (isExento) {
      base = neto; ivaImp = 0; total = neto;
    } else if (isIncluido) {
      total = neto;
      base = neto / (1 + ivaPctVal / 100);
      ivaImp = total - base;
    } else {
      base = neto;
      ivaImp = base * ivaPctVal / 100;
      total = base + ivaImp;
    }
    base = Number(base.toFixed(2)); ivaImp = Number(ivaImp.toFixed(2)); total = Number(total.toFixed(2));
    const finalImporte = total;

    // INSERT conversion (IVA + descuento)
    const { rows: convRows } = await client.query(
      `INSERT INTO conversions
        (lead_id, project_id, producto_contratado, producto_contratado_id, importe_total, importe_pagado,
         metodo_pago, fecha_compromiso_pago, fecha_conversion, notas_pago,
         iva_pct, iva_incluido, iva_exento, base_imponible, iva_importe,
         subtotal_bruto, descuento_tipo, descuento_valor, descuento_importe)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, CURRENT_DATE), $10,
               $11, $12, $13, $14, $15, $16, $17, $18, $19)
       RETURNING *`,
      [lead_id, project_id, producto_contratado, producto_contratado_id || null,
       finalImporte, importe_pagado, metodo_pago, fecha_compromiso_pago, fecha_conversion, notas_pago,
       isExento ? 0 : ivaPctVal, isIncluido, isExento, base, ivaImp,
       Number(subtotalBruto.toFixed(2)), descTipo, descVal, descImporte]
    );
    const conversion = convRows[0];

    // INSERT items (si vienen)
    if (Array.isArray(items) && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const cant = Number(it.cantidad || 1);
        const precio = Number(it.precio_unitario || 0);
        const subt = Number((cant * precio).toFixed(2));
        await client.query(
          `INSERT INTO conversion_items
            (conversion_id, product_id, descripcion, cantidad, precio_unitario, subtotal, orden)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [conversion.id, it.product_id || null, it.descripcion || 'Item sin descripcion',
           cant, precio, subt, i]
        );
      }
    }

    // Si hay importe_pagado > 0, crear primer payment. Guardamos su id en la
    // conversión devuelta para que el servicio pueda facturar ESE abono inicial.
    if (Number(importe_pagado) > 0) {
      const { rows: firstPay } = await client.query(
        `INSERT INTO conversion_payments (conversion_id, importe, fecha, notas, metodo)
         VALUES ($1, $2, COALESCE($3, CURRENT_DATE), $4, $5) RETURNING id, importe`,
        [conversion.id, importe_pagado, fecha_conversion, 'Pago inicial',
         (metodo_pago_inicial || (metodo_pago && metodo_pago !== 'fraccionado' ? metodo_pago : 'tarjeta'))]
      );
      conversion._initial_payment_id = firstPay[0].id;
      conversion._initial_payment_importe = Number(firstPay[0].importe);
    }

    // Cambiar status del lead a convertido
    await client.query(
      `UPDATE leads SET status = 'convertido', updated_at = NOW() WHERE id = $1`,
      [lead_id]
    );

    // Historial
    await client.query(
      `INSERT INTO lead_status_history (lead_id, status_anterior, status_nuevo, changed_by)
       SELECT $1, status, 'convertido', $2 FROM leads WHERE id = $1`,
      [lead_id, data.changed_by || null]
    );

    await client.query('COMMIT');
    return conversion;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function findById(id) {
  const { rows } = await query(
    `SELECT c.*,
            l.nombre as lead_nombre, l.email as lead_email,
            p.nombre as proyecto_nombre, p.slug as proyecto_slug,
            (c.importe_total - c.importe_pagado) AS importe_pendiente
     FROM conversions c
     LEFT JOIN leads l ON l.id = c.lead_id
     LEFT JOIN projects p ON p.id = c.project_id
     WHERE c.id = $1`,
    [id]
  );
  if (!rows[0]) return null;
  const conversion = rows[0];

  // Items de la conversion (multi-product)
  const { rows: items } = await query(
    `SELECT id, product_id, descripcion, cantidad, precio_unitario, subtotal, orden
     FROM conversion_items
     WHERE conversion_id = $1
     ORDER BY orden ASC`,
    [id]
  );
  conversion.items = items;

  // Cada pago trae SU factura (una factura por pago). Enlazamos por payment_id
  // e incluimos los datos de cliente para que el front sepa si faltan datos.
  const { rows: payments } = await query(
    `SELECT cp.id, cp.importe, cp.fecha, cp.notas, cp.metodo, cp.created_at,
            ci.numero AS cuota_numero,
            (cp.metodo = 'tarjeta_stripe' OR EXISTS (
              SELECT 1 FROM stripe_payments sp
               WHERE sp.conversion_payment_id = cp.id AND sp.status = 'succeeded'
            )) AS pagado_por_stripe,
            i.id  AS factura_id, i.codigo AS factura_codigo, i.estado AS factura_estado,
            i.tipo AS factura_tipo, i.cliente_nif, i.cliente_direccion, i.cliente_ciudad,
            i.cliente_cp, i.cliente_pais, i.items AS factura_items
       FROM conversion_payments cp
       LEFT JOIN conversion_installments ci ON ci.payment_id = cp.id
       LEFT JOIN invoices i ON i.payment_id = cp.id AND i.estado <> 'cancelada'
      WHERE cp.conversion_id = $1
      ORDER BY cp.fecha DESC, cp.id DESC`,
    [id]
  );
  conversion.payments = payments;

  // Cuotas (plan de pago fraccionado) con la factura de la cuota ya cobrada.
  const { rows: installments } = await query(
    `SELECT ci.id, ci.numero, ci.importe_previsto, ci.fecha_vencimiento,
            ci.fecha_cobro, ci.importe_cobrado, ci.metodo, ci.payment_id,
            (ci.metodo = 'tarjeta_stripe' OR EXISTS (
              SELECT 1 FROM stripe_payments sp
               WHERE sp.conversion_payment_id = ci.payment_id AND sp.status = 'succeeded'
            )) AS pagado_por_stripe,
            i.id AS factura_id, i.codigo AS factura_codigo, i.estado AS factura_estado,
            i.tipo AS factura_tipo, i.cliente_nif, i.cliente_direccion, i.cliente_ciudad,
            i.cliente_cp, i.cliente_pais
       FROM conversion_installments ci
       LEFT JOIN invoices i ON i.payment_id = ci.payment_id AND i.estado <> 'cancelada'
      WHERE ci.conversion_id = $1
      ORDER BY ci.numero ASC`,
    [id]
  );
  conversion.installments = installments;
  return conversion;
}

export async function findByLead(leadId) {
  // Devuelve payments y refunds embebidos (json_agg) para evitar N+1 desde el front.
  const { rows } = await query(
    `SELECT c.*,
            (c.importe_total - c.importe_pagado) AS importe_pendiente,
            COALESCE((SELECT json_agg(ci_row ORDER BY ci_row.orden)
                      FROM (
                        SELECT id, product_id, descripcion, cantidad, precio_unitario, subtotal, orden
                          FROM conversion_items WHERE conversion_id = c.id
                      ) ci_row), '[]'::json) AS items,
            COALESCE((SELECT json_agg(cp_row ORDER BY cp_row.fecha DESC, cp_row.id DESC)
                      FROM (
                        SELECT id, importe, fecha, notas, created_at
                          FROM conversion_payments WHERE conversion_id = c.id
                      ) cp_row), '[]'::json) AS payments,
            (SELECT COUNT(*) FROM conversion_payments WHERE conversion_id = c.id) AS payments_count,
            COALESCE((SELECT json_agg(cr_row ORDER BY cr_row.fecha DESC, cr_row.id DESC)
                      FROM (
                        SELECT cr.id, cr.importe, cr.fecha, cr.motivo, cr.created_at,
                               u.nombre AS created_by_nombre
                          FROM conversion_refunds cr
                          LEFT JOIN users u ON u.id = cr.created_by
                         WHERE cr.conversion_id = c.id
                      ) cr_row), '[]'::json) AS refunds,
            COALESCE((SELECT SUM(importe) FROM conversion_refunds WHERE conversion_id = c.id), 0) AS refunds_total
     FROM conversions c
     WHERE c.lead_id = $1
     ORDER BY c.fecha_conversion DESC, c.id DESC`,
    [leadId]
  );
  return rows;
}

export async function findAll({ projectId, leadId, responsableId, pendiente, vencido, pendingBilling, producto, from, to, page, limit }) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (projectId) { conditions.push(`c.project_id = $${idx++}`); params.push(projectId); }
  if (leadId) { conditions.push(`c.lead_id = $${idx++}`); params.push(leadId); }
  if (responsableId) { conditions.push(`COALESCE(c.vendedora_id, l.responsable_id) = $${idx++}`); params.push(responsableId); }
  if (pendiente === 'true') { conditions.push(`c.importe_pagado < c.importe_total`); }
  if (pendiente === 'false') { conditions.push(`c.importe_pagado >= c.importe_total`); }
  if (vencido === 'true') {
    conditions.push(`c.fecha_compromiso_pago IS NOT NULL AND c.fecha_compromiso_pago < CURRENT_DATE AND c.importe_pagado < c.importe_total`);
  }
  // pendingBilling: conversion sin importe (backfill u otras a completar)
  if (pendingBilling === 'true') {
    conditions.push(`(c.importe_total = 0 OR c.notas_pago LIKE 'Backfill 2026-06-16%')`);
  }
  if (producto) { conditions.push(`TRIM(c.producto_contratado) = $${idx++}`); params.push(String(producto).trim()); }
  if (from) { conditions.push(`c.fecha_conversion >= $${idx++}`); params.push(from); }
  if (to) { conditions.push(`c.fecha_conversion <= $${idx++}`); params.push(to); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const offset = (page - 1) * limit;

  // JOIN a leads necesario si filtramos por l.responsable_id
  const countJoin = 'LEFT JOIN leads l ON l.id = c.lead_id';
  // Totales sobre TODO el filtro, no sobre la pagina: las tarjetas de arriba
  // sumaban solo las filas visibles y por eso no cuadraban nunca.
  const { rows: countRows } = await query(
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(c.importe_total), 0) AS total_importe,
            COALESCE(SUM(c.importe_pagado), 0) AS total_pagado,
            COALESCE(SUM(c.importe_total - c.importe_pagado), 0) AS total_pendiente,
            COALESCE(SUM(COALESCE(c.iva_importe, c.importe_total * 0.21 / 1.21)), 0) AS total_iva,
            -- Cuantas de estas ventas tienen factura de verdad. Una proforma no
            -- cuenta: es un presupuesto, no obliga a nadie. Una anulada tampoco.
            COUNT(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM invoices i
               WHERE i.conversion_id = c.id
                 AND i.tipo <> 'proforma' AND i.estado <> 'cancelada'
            )) AS facturadas,
            /*
              «Sin factura» no significa lo mismo en todos los casos: la mayoria
              estan marcadas NO REQUIERE FACTURA --una decision tomada, no un
              descuido-- y otras no tienen importe. Meterlas en el mismo saco
              convierte la unica cifra que hay que vigilar en ruido.
            */
            COUNT(*) FILTER (WHERE c.factura_no_requerida IS TRUE) AS no_requiere_factura,
            COUNT(*) FILTER (WHERE
              NOT EXISTS (SELECT 1 FROM invoices i
                           WHERE i.conversion_id = c.id
                             AND i.tipo <> 'proforma' AND i.estado <> 'cancelada')
              AND c.factura_no_requerida IS NOT TRUE
              AND COALESCE(c.importe_total, 0) > 0
            ) AS pendientes_de_facturar
       FROM conversions c ${countJoin} ${where}`,
    params
  );
  const total = parseInt(countRows[0].count);
  const totales = {
    importe: Number(countRows[0].total_importe),
    pagado: Number(countRows[0].total_pagado),
    pendiente: Number(countRows[0].total_pendiente),
    iva: Number(countRows[0].total_iva),
    facturadas: Number(countRows[0].facturadas),
    sinFactura: total - Number(countRows[0].facturadas),
    // De las que no tienen factura: cuantas es porque no la necesitan y cuantas
    // estan de verdad pendientes.
    noRequiereFactura: Number(countRows[0].no_requiere_factura),
    pendientesDeFacturar: Number(countRows[0].pendientes_de_facturar),
  };

  /*
    Por que Facturacion enseña mas filas que Ventas en el mismo dia.

    Diego, el 09/09: «pongo ventas del 8 al 8 y sale 1». Y salia bien: ese dia
    hubo UNA venta nueva y DOS facturas, porque la otra era una cuota de una
    venta de julio. Una venta a plazos emite una factura por cada cobro, y esas
    facturas caen en el mes en que se cobran, no en el que se vendio.

    Ventas cuenta VENTAS y Facturacion cuenta FACTURAS: las dos cifras son
    correctas y distintas. Lo que faltaba era que la pantalla lo dijera. Asi que
    se cuentan aparte las facturas del periodo que pertenecen a ventas
    anteriores, que son exactamente las que sobran al comparar.
  */
  let facturasDeAntes = { n: 0, importe: 0 };
  let facturadoEnPeriodo = { n: 0, importe: 0 };
  /*
    LAS FACTURAS DEL PERIODO, REPARTIDAS COMO LAS VE FACTURACION.

    Diego: «dice que hay 1 venta y 2 cuotas en ISEIH y yo solo veo 1 y 1.
    Necesito que eso use los datos de facturacion». Tenia razon: aqui se
    contaban cuotas por fecha de COBRO y alli por fecha de FACTURA, y 52 de los
    142 cobros facturados de 2026 llevan fechas distintas. Dos pantallas que
    cuentan cosas distintas no coinciden nunca, y explicarlo no arregla nada.

    Ahora se cuentan FACTURAS por fecha de emision, con la MISMA regla que el
    listado de Facturacion --`CLASE_FACTURA`, en un fichero compartido--. Lo
    que dice esta tarjeta es exactamente lo que se ve alli con las mismas
    fechas: si no coincide, es un fallo, no una explicacion pendiente.
  */
  const vacio = () => ({ n: 0, importe: 0 });
  let facturasPorClase = { venta: vacio(), cuota: vacio(), parte: vacio(), suelta: vacio() };
  if (from && to) {
    const args = [from, to];
    // El mismo recorte de proyecto que el resto de la consulta, pero sobre la
    // factura: si se esta mirando una sociedad, sus facturas y no las demas.
    let alcance = 'TRUE';
    if (projectId) { args.push(projectId); alcance = `i.project_id = $3`; }
    const { rows: [fa] } = await query(
      `WITH f AS (
         SELECT i.total, cv.id AS venta_id, cv.fecha_conversion, ${CLASE_FACTURA} AS clase
           FROM invoices i
           LEFT JOIN conversions cv ON cv.id = i.conversion_id
          WHERE ${FACTURA_REAL}
            AND i.fecha_emision >= $1 AND i.fecha_emision <= $2
            AND ${alcance}
       )
       SELECT COUNT(*)::int AS n_todas,
              COALESCE(SUM(total), 0) AS importe_todas,
              -- Las que no son de una venta de este periodo: cuotas de ventas
              -- anteriores, o facturas sueltas sin venta detras.
              COUNT(*) FILTER (WHERE venta_id IS NULL OR fecha_conversion < $1)::int AS n_de_antes,
              COALESCE(SUM(total) FILTER (WHERE venta_id IS NULL OR fecha_conversion < $1), 0) AS importe_de_antes,
              COUNT(*) FILTER (WHERE clase = 'venta')::int  AS n_venta,
              COALESCE(SUM(total) FILTER (WHERE clase = 'venta'), 0)  AS i_venta,
              COUNT(*) FILTER (WHERE clase = 'cuota')::int  AS n_cuota,
              COALESCE(SUM(total) FILTER (WHERE clase = 'cuota'), 0)  AS i_cuota,
              COUNT(*) FILTER (WHERE clase = 'parte')::int  AS n_parte,
              COALESCE(SUM(total) FILTER (WHERE clase = 'parte'), 0)  AS i_parte,
              COUNT(*) FILTER (WHERE clase = 'suelta')::int AS n_suelta,
              COALESCE(SUM(total) FILTER (WHERE clase = 'suelta'), 0) AS i_suelta
         FROM f`,
      args);
    facturasDeAntes = { n: Number(fa.n_de_antes), importe: Number(fa.importe_de_antes) };
    facturadoEnPeriodo = { n: Number(fa.n_todas), importe: Number(fa.importe_todas) };
    facturasPorClase = {
      venta:  { n: Number(fa.n_venta),  importe: Number(fa.i_venta) },
      cuota:  { n: Number(fa.n_cuota),  importe: Number(fa.i_cuota) },
      parte:  { n: Number(fa.n_parte),  importe: Number(fa.i_parte) },
      suelta: { n: Number(fa.n_suelta), importe: Number(fa.i_suelta) },
    };
  }
  totales.facturasDeAntes = facturasDeAntes;
  totales.facturadoEnPeriodo = facturadoEnPeriodo;
  totales.facturasPorClase = facturasPorClase;
  /*
    POR PROYECTO, cuando se mira una empresa entera.

    Diego: «si veo una empresa, ver cuales de esos proyectos se recibio ventas
    y las cuotas». Con CEDIA elegida la tarjeta suma siete campus y no dice de
    cual es cada euro. Se reparte con las MISMAS reglas que las tarjetas: las
    ventas por fecha de venta, las cuotas por factura y clase compartida. Suma
    de la columna = tarjeta, o es un fallo.
  */
  let porProyecto = [];
  if (from && to) {
    const args = [from, to];
    let alcanceC = 'TRUE', alcanceI = 'TRUE';
    if (projectId) { args.push(projectId); alcanceC = `c.project_id = $${args.length}`; alcanceI = `i.project_id = $${args.length}`; }
    // Los MISMOS recortes que las tarjetas --gestora y curso--, o la columna no
    // sumaria la tarjeta en cuanto se filtre. Salio en la revision.
    let porGestora = '', porProducto = '';
    if (responsableId) { args.push(responsableId); porGestora = `AND COALESCE(c.vendedora_id, l.responsable_id) = $${args.length}`; }
    if (producto) { args.push(String(producto).trim()); porProducto = `AND TRIM(c.producto_contratado) = $${args.length}`; }
    const { rows } = await query(
      `WITH v AS (
         SELECT c.project_id, COUNT(*)::int AS ventas, COALESCE(SUM(c.importe_total), 0) AS importe_ventas
           FROM conversions c
           LEFT JOIN leads l ON l.id = c.lead_id
          WHERE c.fecha_conversion >= $1 AND c.fecha_conversion <= $2 AND ${alcanceC} ${porGestora} ${porProducto}
          GROUP BY c.project_id),
       q AS (
         SELECT i.project_id, COUNT(*)::int AS cuotas, COALESCE(SUM(i.total), 0) AS importe_cuotas
           FROM invoices i
           JOIN conversions c ON c.id = i.conversion_id
           LEFT JOIN leads l ON l.id = c.lead_id
          WHERE ${FACTURA_REAL} AND i.fecha_emision >= $1 AND i.fecha_emision <= $2 AND ${alcanceI} ${porGestora} ${porProducto}
            AND ${CLASE_FACTURA} = 'cuota'
          GROUP BY i.project_id)
       SELECT pr.id AS project_id, pr.nombre,
              COALESCE(v.ventas, 0) AS ventas, COALESCE(v.importe_ventas, 0) AS importe_ventas,
              COALESCE(q.cuotas, 0) AS cuotas, COALESCE(q.importe_cuotas, 0) AS importe_cuotas
         FROM projects pr
         LEFT JOIN v ON v.project_id = pr.id
         LEFT JOIN q ON q.project_id = pr.id
        WHERE (v.ventas IS NOT NULL OR q.cuotas IS NOT NULL)
        ORDER BY COALESCE(v.importe_ventas, 0) + COALESCE(q.importe_cuotas, 0) DESC, pr.nombre`,
      args);
    porProyecto = rows.map((r) => ({
      project_id: r.project_id, nombre: r.nombre,
      ventas: { n: Number(r.ventas), importe: Number(r.importe_ventas) },
      cuotas: { n: Number(r.cuotas), importe: Number(r.importe_cuotas) },
    }));
  }
  totales.porProyecto = porProyecto;


  /*
    El dinero que ENTRO en estas fechas, partido en dos.

    Diego: «tienes que poner ventas, mensualidades cobradas o cuotas cobradas».
    No se puede hacer por `es_mensualidad`: esa columna esta a false en todas las
    ventas, nadie la marca nunca. Lo que si esta en los datos es cual fue el
    PRIMER cobro de cada venta.

      · matricula — el primer cobro de una venta. Dinero de una venta nueva.
      · cuota     — cualquier cobro posterior. Una mensualidad de algo que ya
                    estaba vendido, aunque entre este mes.

    Es la misma regla que `ES_MATRICULA` de los informes, a proposito: otra
    definicion aqui haria que las dos pantallas dieran cifras distintas para la
    misma pregunta.
  */
  let cobrosDelPeriodo = {
    matricula: { n: 0, importe: 0 },
    cuotas: { n: 0, importe: 0 },
  };
  if (from && to) {
    const args = [from, to];
    let alcance = 'TRUE';
    if (projectId) { args.push(projectId); alcance = 'c.project_id = $3'; }
    const { rows: [cb] } = await query(
      `WITH cobros AS (
         SELECT cp.importe,
                (NOT c.es_mensualidad AND NOT EXISTS (
                   SELECT 1 FROM conversion_payments p0
                    WHERE p0.conversion_id = cp.conversion_id
                      AND (p0.fecha < cp.fecha
                           OR (p0.fecha = cp.fecha AND p0.id < cp.id))
                 )) AS es_matricula
           FROM conversion_payments cp
           JOIN conversions c ON c.id = cp.conversion_id
          WHERE cp.fecha >= $1 AND cp.fecha <= $2 AND ${alcance}
       )
       SELECT COUNT(*) FILTER (WHERE es_matricula)::int AS n_matricula,
              COALESCE(SUM(importe) FILTER (WHERE es_matricula), 0) AS importe_matricula,
              COUNT(*) FILTER (WHERE NOT es_matricula)::int AS n_cuotas,
              COALESCE(SUM(importe) FILTER (WHERE NOT es_matricula), 0) AS importe_cuotas
         FROM cobros`,
      args);
    cobrosDelPeriodo = {
      matricula: { n: Number(cb.n_matricula), importe: Number(cb.importe_matricula) },
      cuotas: { n: Number(cb.n_cuotas), importe: Number(cb.importe_cuotas) },
    };
  }
  totales.cobrosDelPeriodo = cobrosDelPeriodo;

  const { rows } = await query(
    `SELECT c.id, c.lead_id, c.project_id, c.producto_contratado,
            c.importe_total, c.importe_pagado,
            (c.importe_total - c.importe_pagado) AS importe_pendiente,
            c.fecha_compromiso_pago, c.metodo_pago,
            c.fecha_conversion, c.created_at,
            l.nombre as lead_nombre, l.email as lead_email,
            COALESCE(c.vendedora_id, l.responsable_id) AS responsable_id,
            COALESCE(uv.nombre, u.nombre) AS responsable_nombre,
            p.nombre as proyecto_nombre
     FROM conversions c
     LEFT JOIN leads l ON l.id = c.lead_id
     LEFT JOIN users u ON u.id = l.responsable_id
     LEFT JOIN users uv ON uv.id = c.vendedora_id
     LEFT JOIN projects p ON p.id = c.project_id
     ${where}
     ORDER BY c.fecha_conversion DESC, c.id DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset]
  );

  return { conversions: rows, total, totales, page, limit, totalPages: Math.ceil(total / limit) };
}

/**
 * Las cuotas FACTURADAS en un periodo, una por una.
 *
 * Diego: «tiene que decir cuales son las cuotas y su numero de factura».
 *
 * Son facturas, no cobros: la misma lista, con la misma regla y las mismas
 * fechas, que se ve en Facturacion con la etiqueta CUOTA. Antes listaba cobros
 * por fecha de cobro y salian dos donde Facturacion enseñaba una --la de Laura
 * Estrada: cobrada el 8, facturada el 9--. Ahora suma exactamente lo que dice la
 * tarjeta, porque es la misma consulta.
 *
 * Se devuelve tambien el dia del cobro, por si no es el de la factura: es el
 * dato que explica el desfase cuando alguien lo mira desde el otro lado.
 */
export async function cuotasDelPeriodo({
  projectId = null, projectIds = null, from, to, responsableId = null, limit = 300,
} = {}) {
  if (!from || !to) return [];
  const args = [from, to];
  
  let alcance = 'TRUE';
  if (projectId) { args.push(projectId); alcance = `i.project_id = $${args.length}`; }
  let porGestora = '';
  if (responsableId) {
    args.push(responsableId);
    porGestora = `AND COALESCE(c.vendedora_id, l.responsable_id) = $${args.length}`;
  }
  args.push(limit);

  const { rows } = await query(
    `SELECT i.id AS factura_id, i.codigo AS factura, i.fecha_emision AS fecha, i.total AS importe,
            c.id AS venta_id, c.fecha_conversion AS fecha_de_la_venta,
            COALESCE(NULLIF(TRIM(i.cliente_nombre), ''), l.nombre) AS cliente,
            COALESCE(p.nombre, NULLIF(TRIM(c.producto_contratado), '')) AS producto,
            -- El dia del cobro, que casi nunca es el de la factura.
            cp.fecha AS cobro_fecha
       FROM invoices i
       JOIN conversions c ON c.id = i.conversion_id
       LEFT JOIN leads l ON l.id = c.lead_id
       LEFT JOIN products p ON p.id = c.producto_contratado_id
       LEFT JOIN conversion_payments cp ON cp.id = i.payment_id
      WHERE ${FACTURA_REAL}
        AND i.fecha_emision >= $1 AND i.fecha_emision <= $2
        AND ${alcance} ${porGestora}
        AND ${CLASE_FACTURA} = 'cuota'
      ORDER BY i.fecha_emision DESC, i.numero DESC
      LIMIT $${args.length}`,
    args);
  return rows;
}

/**
 * La lista de Ventas con fechas puestas: ventas del periodo + cuotas facturadas
 * del periodo, cada fila con su etiqueta.
 *
 * Diego: «ahi abajo debe de decirme cual es cuota y cual es venta». La lista
 * eran solo ventas por fecha de venta, y el 8/9 salia UNA fila cuando
 * Facturacion enseñaba dos: la venta de Maria Jose y la cuota de Mary Flor.
 *
 * Las cuotas salen de las FACTURAS --por fecha de emision y con la regla
 * compartida de clase.sql.js--, no de los cobros: es lo que hace que esta lista
 * y Facturacion tengan exactamente las mismas filas para las mismas fechas.
 *
 * Las facturas de clase «venta» NO se añaden: esa venta ya esta en la lista
 * como venta. Las «suelta» tampoco: no cuelgan de ninguna venta y esta es la
 * pantalla de ventas. Las «parte» si, marcadas: son papel de mas de una venta
 * que ya se ve, y esconderlas volveria a descuadrar el recuento de facturas.
 */
export async function filasDelPeriodo({
  projectId = null, from, to, responsableId = null, producto = null, page = 1, limit = 50,
} = {}) {
  if (!from || !to) return { filas: [], total: 0 };
  const args = [from, to];
  
  let alcanceC = 'TRUE';
  let alcanceI = 'TRUE';
  if (projectId) { args.push(projectId); alcanceC = `c.project_id = $${args.length}`; alcanceI = `i.project_id = $${args.length}`; }
  let porGestora = '';
  if (responsableId) {
    args.push(responsableId);
    porGestora = `AND COALESCE(c.vendedora_id, l.responsable_id) = $${args.length}`;
  }
  let porProducto = '';
  if (producto) {
    args.push(String(producto).trim());
    porProducto = `AND TRIM(c.producto_contratado) = $${args.length}`;
  }
  args.push(limit, (Math.max(1, page) - 1) * limit);

  const { rows } = await query(
    `WITH ventas AS (
       SELECT 'venta'::text AS tipo, c.id AS venta_id, c.id AS clave_id, NULL::int AS factura_id,
              c.fecha_conversion AS fecha, c.fecha_conversion AS fecha_de_la_venta,
              c.lead_id, l.nombre::text AS cliente, c.producto_contratado::text AS producto,
              c.importe_total AS total, c.importe_pagado AS pagado,
              -- Todas sus facturas, para verlas en la fila de la venta.
              (SELECT string_agg(x.codigo, ', ' ORDER BY x.numero) FROM invoices x
                WHERE x.conversion_id = c.id AND x.tipo <> 'proforma' AND x.estado <> 'cancelada') AS factura,
              COALESCE(c.factura_no_requerida, false) AS factura_no_requerida
         FROM conversions c
         LEFT JOIN leads l ON l.id = c.lead_id
        WHERE c.fecha_conversion >= $1 AND c.fecha_conversion <= $2
          AND ${alcanceC} ${porGestora} ${porProducto}
     ),
     facturas AS (
       SELECT (${CLASE_FACTURA})::text AS tipo, c.id AS venta_id, i.id AS clave_id, i.id AS factura_id,
              i.fecha_emision AS fecha, c.fecha_conversion AS fecha_de_la_venta,
              c.lead_id, COALESCE(NULLIF(TRIM(i.cliente_nombre), ''), l.nombre)::text AS cliente,
              COALESCE(p.nombre, NULLIF(TRIM(c.producto_contratado), ''))::text AS producto,
              i.total AS total,
              CASE WHEN i.estado = 'pagada' THEN i.total ELSE 0 END AS pagado,
              i.codigo::text AS factura,
              false AS factura_no_requerida
         FROM invoices i
         JOIN conversions c ON c.id = i.conversion_id
         LEFT JOIN leads l ON l.id = c.lead_id
         LEFT JOIN products p ON p.id = c.producto_contratado_id
        WHERE ${FACTURA_REAL}
          AND i.fecha_emision >= $1 AND i.fecha_emision <= $2
          AND ${alcanceI} ${porGestora} ${porProducto}
     ),
     filas AS (
       SELECT * FROM ventas
       UNION ALL
       SELECT * FROM facturas WHERE tipo IN ('cuota', 'parte')
     )
     SELECT *, COUNT(*) OVER () AS total_filas
       FROM filas
      ORDER BY fecha DESC, (tipo = 'venta') DESC, clave_id DESC
      LIMIT $${args.length - 1} OFFSET $${args.length}`,
    args);
  return { filas: rows, total: rows.length ? Number(rows[0].total_filas) : 0 };
}

export async function update(id, fields) {
  const allowed = ['producto_contratado', 'producto_contratado_id', 'importe_total', 'metodo_pago', 'fecha_compromiso_pago', 'fecha_conversion', 'notas_pago'];
  const sets = [];
  const params = [];
  let idx = 1;

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = $${idx++}`);
      params.push(fields[key]);
    }
  }
  if (!sets.length) return null;
  sets.push(`updated_at = NOW()`);
  params.push(id);

  const { rows } = await query(
    `UPDATE conversions SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    params
  );
  return rows[0];
}

// opts.allowOverpay: permite registrar un cobro que supere el importe_total de la venta.
// Lo usa el cobro automático de Stripe: el dinero entró de verdad, y cuando excede el total
// lo que suele estar mal es el total previsto, no el cobro. El flujo manual sigue bloqueado.
export async function addPayment(conversionId, { importe, fecha, notas, metodo }, opts = {}) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Verificar que la conversion existe y lock
    const { rows: convRows } = await client.query(
      `SELECT id, importe_total, importe_pagado FROM conversions WHERE id = $1 FOR UPDATE`,
      [conversionId]
    );
    if (!convRows[0]) {
      await client.query('ROLLBACK');
      return { error: 'NOT_FOUND' };
    }

    const nuevoTotal = Number(convRows[0].importe_pagado) + Number(importe);
    if (!opts.allowOverpay && nuevoTotal > Number(convRows[0].importe_total)) {
      await client.query('ROLLBACK');
      return { error: 'OVERPAY' };
    }

    // Anti-duplicado: el mismo importe en la misma venta con menos de 3 dias
    // de diferencia es casi siempre el mismo cobro metido dos veces (a mano y
    // por la sincronizacion de Stripe). Se puede forzar con allowDuplicate.
    if (!opts.allowDuplicate) {
      const { rows: dup } = await client.query(
        `SELECT id, importe, fecha, notas, metodo FROM conversion_payments
          WHERE conversion_id = $1
            AND ABS(importe - $2::numeric) < 0.01
            AND ABS(fecha - COALESCE($3::date, CURRENT_DATE)) <= 3
          ORDER BY id LIMIT 1`,
        [conversionId, importe, fecha]
      );
      if (dup[0]) {
        await client.query('ROLLBACK');
        return { error: 'DUPLICATE', existing: dup[0] };
      }
    }

    // INSERT payment
    const { rows: payRows } = await client.query(
      `INSERT INTO conversion_payments (conversion_id, importe, fecha, notas, metodo)
       VALUES ($1, $2, COALESCE($3, CURRENT_DATE), $4, $5)
       RETURNING *`,
      [conversionId, importe, fecha, notas, metodo || null]
    );

    // UPDATE conversion.importe_pagado
    await client.query(
      `UPDATE conversions SET importe_pagado = $1, updated_at = NOW() WHERE id = $2`,
      [nuevoTotal, conversionId]
    );

    // Si la venta es fraccionada, el abono SALDA las cuotas pendientes más
    // antiguas (FIFO) — igual que "Registrar pago". Así "Abonar" y "Registrar
    // pago" son el MISMO proceso: el importe resta cuotas y deja de estar vencida.
    // El sobrante que no complete una cuota queda como abono a cuenta.
    const { rows: cuotas } = await client.query(
      `SELECT id, importe_previsto FROM conversion_installments
        WHERE conversion_id = $1 AND fecha_cobro IS NULL
        ORDER BY numero ASC FOR UPDATE`, [conversionId]);
    let restante = Number(importe);
    const fechaAbono = payRows[0].fecha;
    for (const q of cuotas) {
      const prev = Number(q.importe_previsto);
      if (restante + 0.001 < prev) break; // no alcanza para saldar esta cuota entera
      await client.query(
        `UPDATE conversion_installments
            SET fecha_cobro = $1, importe_cobrado = $2, payment_id = $3, updated_at = NOW()
          WHERE id = $4`,
        [fechaAbono, prev, payRows[0].id, q.id]);
      restante = Number((restante - prev).toFixed(2));
    }

    await client.query('COMMIT');
    return { payment: payRows[0], nuevoImportePagado: nuevoTotal };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Devuelve { conversion_id, lead_id, responsable_id } del pago para RBAC.
export async function getPaymentOwnership(paymentId) {
  const { query } = await import('../../shared/config/db.js');
  const { rows } = await query(
    `SELECT cp.id AS payment_id, cp.conversion_id, c.lead_id, l.responsable_id, l.project_id
     FROM conversion_payments cp
     JOIN conversions c ON c.id = cp.conversion_id
     JOIN leads l ON l.id = c.lead_id
     WHERE cp.id = $1`,
    [paymentId]
  );
  return rows[0] || null;
}

export async function deletePayment(paymentId) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, conversion_id, importe FROM conversion_payments WHERE id = $1`,
      [paymentId]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query(`DELETE FROM conversion_payments WHERE id = $1`, [paymentId]);
    await client.query(
      `UPDATE conversions SET importe_pagado = importe_pagado - $1, updated_at = NOW() WHERE id = $2`,
      [rows[0].importe, rows[0].conversion_id]
    );

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteConversion(id) {
  await query(`DELETE FROM conversions WHERE id = $1`, [id]);
}

// Valores distintos de producto para el desplegable de filtros. Va aparte de
// findAll porque el listado esta paginado y no ve el catalogo completo.
export async function listProductos({ projectId, responsableId }) {
  const cond = ["TRIM(COALESCE(c.producto_contratado, '')) <> ''"];
  const params = [];
  let idx = 1;
  if (projectId) { cond.push(`c.project_id = $${idx++}`); params.push(projectId); }
  if (responsableId) { cond.push(`COALESCE(c.vendedora_id, l.responsable_id) = $${idx++}`); params.push(responsableId); }
  const { rows } = await query(
    `SELECT DISTINCT TRIM(c.producto_contratado) AS producto
       FROM conversions c
       LEFT JOIN leads l ON l.id = c.lead_id
      WHERE ${cond.join(' AND ')}
      ORDER BY 1`,
    params
  );
  return rows.map(r => r.producto);
}
