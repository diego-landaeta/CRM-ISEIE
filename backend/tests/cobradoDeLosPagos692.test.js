import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool from '../src/shared/config/db.js';
import * as conversionModel from '../src/modules/conversions/conversion.model.js';
import * as installmentsModel from '../src/modules/conversions/installments.model.js';
import { updateConversionPaid } from '../src/modules/stripe-payments/stripe-payments.model.js';
import { getResumenVentas, getVentasPorAsesora } from '../src/modules/sales/sales.service.js';

/**
 * CRM#692 (gemela CRM-ISEIE#411) · Lo cobrado de una venta es la suma de sus
 * pagos registrados.
 *
 * Dos síntomas en /testeo: «Pendiente de cobro» NEGATIVO en Análisis (las
 * ventas cobradas de más restaban de lo que deben las demás) y ventas
 * «pagadas, 430 €» con «Pagos registrados (0)» (la lista y el detalle leían el
 * acumulado `importe_pagado`, que cada sitio sumaba a su manera).
 *
 *   DATABASE_URL=... node scripts/db-preparar.mjs
 *   npx vitest run tests/cobradoDeLosPagos692.test.js
 */

const MARCA = `C692_${Date.now().toString(36)}`;
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const guardado = async (id) => Number((await q('SELECT importe_pagado FROM conversions WHERE id = $1', [id]))[0].importe_pagado);
let proyecto;
let lead;
// En ISEIE `conversions.factura_no_requerida` no tiene migración (está en las
// bases de los servidores, no en una nueva): sin ella `findAll` da error. Lo de
// la lista solo se comprueba si la columna existe (ver equipoComercial.test.js).
let hayLista = false;

async function venta(importe_total, importe_pagado = 0, extra = {}) {
  return conversionModel.create({
    lead_id: lead.id, project_id: proyecto.id, producto_contratado: `${MARCA} curso`,
    importe_total, importe_pagado, metodo_pago: 'tarjeta', fecha_conversion: '2026-10-12',
    iva_incluido: true, ...extra, // el importe ya lleva el IVA: no se toca
  });
}

beforeAll(async () => {
  [proyecto] = await q(
    `INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [MARCA, MARCA.toLowerCase(), MARCA]
  );
  [lead] = await q(`INSERT INTO leads (nombre, project_id) VALUES ($1, $2) RETURNING id`, [MARCA, proyecto.id]);
  const [col] = await q(`SELECT 1 AS si FROM information_schema.columns
                          WHERE table_name = 'conversions' AND column_name = 'factura_no_requerida'`);
  hayLista = Boolean(col);
});

afterAll(async () => {
  if (proyecto) {
    const ventas = `SELECT id FROM conversions WHERE project_id = ${Number(proyecto.id)}`;
    await q(`DELETE FROM conversion_installments WHERE conversion_id IN (${ventas})`);
    await q(`DELETE FROM conversion_payments WHERE conversion_id IN (${ventas})`);
    await q(`DELETE FROM conversion_items WHERE conversion_id IN (${ventas})`);
    await q(`DELETE FROM conversions WHERE project_id = $1`, [proyecto.id]);
    await q('DELETE FROM leads WHERE project_id = $1', [proyecto.id]);
    await q('DELETE FROM projects WHERE id = $1', [proyecto.id]);
  }
  await pool.end();
});

describe('#692 · la lista y el detalle cuentan los pagos, no el campo guardado', () => {
  it('una venta «pagada» sin ningún pago sale sin cobrar, y avisa de que no cuadra', async () => {
    const v = await venta(430);
    // Lo que tenían #551 y #552: 430 € apuntados en la venta y ningún pago.
    await q('UPDATE conversions SET importe_pagado = 430 WHERE id = $1', [v.id]);

    const detalle = await conversionModel.findById(v.id);
    expect(detalle.payments).toHaveLength(0);
    expect(Number(detalle.importe_pagado)).toBe(0);
    expect(Number(detalle.importe_pendiente)).toBe(430);
    expect(Number(detalle.importe_pagado_guardado)).toBe(430); // para el aviso

    if (hayLista) {
      const lista = await conversionModel.findAll({ projectId: proyecto.id, page: 1, limit: 50 });
      const fila = lista.conversions.find((c) => c.id === v.id);
      expect(Number(fila.importe_pagado)).toBe(0);
      expect(Number(fila.importe_pendiente)).toBe(430);

      // El filtro «pendientes» también la ve pendiente.
      const pendientes = await conversionModel.findAll({ projectId: proyecto.id, pendiente: 'true', page: 1, limit: 50 });
      expect(pendientes.conversions.map((c) => c.id)).toContain(v.id);

      // La lista con fechas puestas (ventas + cuotas facturadas).
      const filas = await conversionModel.filasDelPeriodo({ projectId: proyecto.id, from: '2026-10-01', to: '2026-10-31' });
      const f = filas.filas.find((x) => x.tipo === 'venta' && x.venta_id === v.id);
      expect(Number(f.pagado)).toBe(0);
    }
  });

  it('un abono sobre una venta descuadrada deja el campo igual a la suma de pagos', async () => {
    const v = await venta(1000, 100);
    await q('UPDATE conversions SET importe_pagado = 700 WHERE id = $1', [v.id]); // desfase de antes
    const r = await conversionModel.addPayment(v.id, { importe: 200, fecha: '2026-10-20', metodo: 'transferencia' });
    expect(r.error).toBeUndefined();
    // Antes: 700 + 200 = 900. Ahora: 100 + 200.
    expect(await guardado(v.id)).toBe(300);
    expect(r.nuevoImportePagado).toBe(300);

    await conversionModel.deletePayment(r.payment.id);
    expect(await guardado(v.id)).toBe(100);
  });

  it('el tope de «no cobrar de más» mira los pagos, no el campo', async () => {
    const v = await venta(500, 100);
    await q('UPDATE conversions SET importe_pagado = 450 WHERE id = $1', [v.id]);
    // Con el campo (450 + 100 > 500) lo rechazaba; con los pagos (100 + 100) no.
    const r = await conversionModel.addPayment(v.id, { importe: 100, fecha: '2026-10-21', metodo: 'transferencia' });
    expect(r.error).toBeUndefined();
    expect(await guardado(v.id)).toBe(200);
  });

  it('cobrar, corregir y deshacer una cuota recalcula desde los pagos', async () => {
    const v = await venta(600, 0);
    await q('UPDATE conversions SET importe_pagado = 50 WHERE id = $1', [v.id]); // desfase de antes
    const [cuota] = await q(
      `INSERT INTO conversion_installments (conversion_id, numero, importe_previsto, fecha_vencimiento)
       VALUES ($1, 1, 200, '2026-11-01') RETURNING id`, [v.id]);

    await installmentsModel.markPaid(cuota.id, { fecha_cobro: '2026-11-01', importe_cobrado: 200, metodo: 'transferencia' });
    expect(await guardado(v.id)).toBe(200); // antes: 250

    await installmentsModel.editPaid(cuota.id, { importe_cobrado: 180 });
    expect(await guardado(v.id)).toBe(180);

    await installmentsModel.unpay(cuota.id);
    expect(await guardado(v.id)).toBe(0); // antes: GREATEST(0, 230 - 180) = 50
  });

  it('Stripe ya no topa lo cobrado en el total: el campo dice lo que suman los pagos', async () => {
    const v = await venta(100, 100);
    await q(`INSERT INTO conversion_payments (conversion_id, importe, fecha, notas) VALUES ($1, 30, '2026-10-22', 'cargo')`, [v.id]);
    await updateConversionPaid(v.id, 30);
    expect(await guardado(v.id)).toBe(130); // antes: LEAST(100, 130) = 100
  });
});

describe('#692 · «Pendiente de cobro» nunca negativo; lo de más, aparte', () => {
  it('una venta cobrada de más no resta de lo que deben las otras', async () => {
    // Proyecto aparte para que las cifras sean solo estas dos ventas.
    const [p2] = await q(
      `INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
      [`${MARCA}b`, `${MARCA.toLowerCase()}b`, `${MARCA}b`]
    );
    const [l2] = await q(`INSERT INTO leads (nombre, project_id) VALUES ($1, $2) RETURNING id`, [`${MARCA}b`, p2.id]);
    const crear = (total, pagado) => conversionModel.create({
      lead_id: l2.id, project_id: p2.id, producto_contratado: `${MARCA} x`,
      importe_total: total, importe_pagado: pagado, metodo_pago: 'tarjeta', fecha_conversion: '2026-10-12',
      iva_incluido: true,
    });
    try {
      const debe = await crear(1000, 200);     // debe 800
      const deMas = await crear(300, 300);     // y le entra un cobro repetido de 300
      await conversionModel.addPayment(deMas.id, { importe: 300, fecha: '2026-10-25', metodo: 'tarjeta' },
        { allowOverpay: true, allowDuplicate: true });

      const r = await getResumenVentas({ projectId: p2.id, from: '2026-10-01', to: '2026-10-31' });
      expect(r.importe).toBe(1300);
      expect(r.cobrado).toBe(800);
      // Antes: (1000 − 200) + (300 − 600) = 500. Lo que se debe de verdad es 800.
      expect(r.pendiente).toBe(800);
      expect(r.cobrado_de_mas).toEqual({ ventas: 1, importe: 300 });

      const asesoras = await getVentasPorAsesora({ projectId: p2.id, from: '2026-10-01', to: '2026-10-31' });
      const suma = asesoras.reduce((t, a) => t + a.pendiente, 0);
      expect(suma).toBe(800);

      if (hayLista) {
        const lista = await conversionModel.findAll({ projectId: p2.id, page: 1, limit: 50 });
        expect(lista.totales.pagado).toBe(800);
        expect(lista.totales.pendiente).toBe(800);
        expect(lista.totales.cobradoDeMas).toEqual({ n: 1, importe: 300 });
      }

      const detalle = await conversionModel.findById(deMas.id);
      expect(Number(detalle.importe_pendiente)).toBe(0);
      expect(Number(detalle.cobrado_de_mas)).toBe(300);
      expect(debe.id).toBeTruthy();
    } finally {
      const ventas = `SELECT id FROM conversions WHERE project_id = ${Number(p2.id)}`;
      await q(`DELETE FROM conversion_installments WHERE conversion_id IN (${ventas})`);
      await q(`DELETE FROM conversion_payments WHERE conversion_id IN (${ventas})`);
      await q('DELETE FROM conversions WHERE project_id = $1', [p2.id]);
      await q('DELETE FROM leads WHERE project_id = $1', [p2.id]);
      await q('DELETE FROM projects WHERE id = $1', [p2.id]);
    }
  });
});
