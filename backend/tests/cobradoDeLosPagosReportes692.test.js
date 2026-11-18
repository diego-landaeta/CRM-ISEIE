import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool from '../src/shared/config/db.js';
import * as conversionModel from '../src/modules/conversions/conversion.model.js';
import * as reportModel from '../src/modules/reports/report.model.js';
import * as accountingModel from '../src/modules/accounting/accounting.model.js';
import * as commissionModel from '../src/modules/commissions/commission.model.js';

/**
 * CRM#692, segunda parte · Reportes, Comisiones y Por cobrar leen lo cobrado de
 * los pagos registrados, como ya hacen Ventas, el detalle y Análisis (PR #811).
 *
 * Dos ventas, las dos de octubre:
 *   · A: 430 € «pagados» en el campo guardado y NINGÚN pago (lo de #551/#552);
 *   · B: 300 €, cobrada dos veces (300 + 300 repetido): 300 € de más.
 * Con el campo guardado, A salía pagada y B restaba 300 de lo que se debe.
 * De verdad: cobrado 600, se deben 430 (todo de A) y hay 300 cobrados de más.
 *
 *   DATABASE_URL=... node scripts/db-preparar.mjs
 *   npx vitest run tests/cobradoDeLosPagosReportes692.test.js
 */

const MARCA = `R692_${Date.now().toString(36)}`;
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const OCT = { from: '2026-10-01', to: '2026-10-31' };
let proyecto;
let gestora;
let leadA;
let leadB;
let A;
let B;

beforeAll(async () => {
  [proyecto] = await q(
    `INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [MARCA, MARCA.toLowerCase(), MARCA]
  );
  [gestora] = await q(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'gestor') RETURNING id`,
    [MARCA, `${MARCA.toLowerCase()}@prueba.test`]
  );
  const lead = (n) => q(
    `INSERT INTO leads (nombre, project_id, responsable_id) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} ${n}`, proyecto.id, gestora.id]
  ).then((r) => r[0]);
  leadA = await lead('A');
  leadB = await lead('B');
  const venta = (l, total, pagado) => conversionModel.create({
    lead_id: l.id, project_id: proyecto.id, producto_contratado: `${MARCA} curso`,
    importe_total: total, importe_pagado: pagado, metodo_pago: 'tarjeta', fecha_conversion: '2026-10-12',
    vendedora_id: gestora.id, iva_incluido: true,
  });

  A = await venta(leadA, 430, 0);
  await q('UPDATE conversions SET importe_pagado = 430 WHERE id = $1', [A.id]); // descuadre guardado

  B = await venta(leadB, 300, 300);
  await conversionModel.addPayment(B.id, { importe: 300, fecha: '2026-10-25', metodo: 'tarjeta' },
    { allowOverpay: true, allowDuplicate: true });
});

afterAll(async () => {
  if (proyecto) {
    const ventas = `SELECT id FROM conversions WHERE project_id = ${Number(proyecto.id)}`;
    await q(`DELETE FROM commissions WHERE conversion_id IN (${ventas})`);
    await q('DELETE FROM commission_rules WHERE project_id = $1', [proyecto.id]);
    await q(`DELETE FROM conversion_installments WHERE conversion_id IN (${ventas})`);
    await q(`DELETE FROM conversion_payments WHERE conversion_id IN (${ventas})`);
    await q(`DELETE FROM conversion_items WHERE conversion_id IN (${ventas})`);
    await q('DELETE FROM conversions WHERE project_id = $1', [proyecto.id]);
    await q('DELETE FROM leads WHERE project_id = $1', [proyecto.id]);
    await q('DELETE FROM projects WHERE id = $1', [proyecto.id]);
  }
  if (gestora) await q('DELETE FROM users WHERE id = $1', [gestora.id]);
  await pool.end();
});

describe('#692 · Reportes', () => {
  it('el resumen cuenta los pagos y el «por cobrar» no se come lo cobrado de más', async () => {
    const r = await reportModel.overview({ projectId: proyecto.id, ...OCT });
    expect(Number(r.conversions.ventas_brutas)).toBe(730);
    expect(Number(r.conversions.cobrado)).toBe(600);        // antes: 430 + 600 = 1030
    expect(Number(r.conversions.por_cobrar)).toBe(430);     // antes: 0 + (−300) = −300
    expect(Number(r.conversions.cobrado_de_mas)).toBe(300);
    expect(Number(r.top_productos[0].cobrado)).toBe(600);
    const campus = r.por_proyecto.find((p) => p.project_id === proyecto.id);
    expect(campus.cobrado).toBe(600);
  });

  it('las descargas de ventas dicen 0 cobrado y «Pendiente» para la venta sin pagos', async () => {
    for (const informe of [reportModel.ventasReport, reportModel.ventasPorAsesoraReport]) {
      const filas = await informe({ projectId: proyecto.id, ...OCT });
      const a = filas.find((f) => f.venta_id === A.id || (f.cliente === `${MARCA} A`));
      expect(Number(a.cobrado)).toBe(0);
      expect(Number(a.pendiente)).toBe(430);
      expect(a.estado_pago).toBe('Pendiente');
      const b = filas.find((f) => f.cliente === `${MARCA} B`);
      expect(Number(b.cobrado)).toBe(600);
      expect(Number(b.pendiente)).toBe(0);                  // antes: −300
      expect(b.estado_pago).toBe('Pagada');
    }
  });

  it('resumen mensual, general y por vendedora cuadran con los pagos', async () => {
    const meses = await reportModel.resumenMensual({ projectId: proyecto.id, ...OCT });
    expect(Number(meses.find((m) => m.mes === '2026-10').cobrado)).toBe(600);

    const general = await reportModel.generalReport({ projectId: proyecto.id, from: '2000-01-01', to: '2999-12-31' });
    const ga = general.find((g) => g.nombre === `${MARCA} A`);
    expect(Number(ga.venta_cobrado)).toBe(0);
    expect(Number(ga.venta_pendiente)).toBe(430);

    const vend = await reportModel.ventasVendedora({ projectId: proyecto.id, ...OCT });
    const suya = vend.find((v) => v.vendedora === MARCA);
    expect(Number(suya.pendiente)).toBe(430);               // antes: 130
  });
});

describe('#692 · Por cobrar (Finanzas)', () => {
  it('el panel cuenta como pendiente la venta sin pagos, no la cobrada de más', async () => {
    const d = await accountingModel.getDashboardStats({ projectId: proyecto.id, ...OCT });
    expect(d.ingresos.total_pendiente).toBe(430);           // antes: 130
    expect(d.cuentas_por_cobrar.map((c) => c.id)).toEqual([A.id]); // antes: ninguna
    expect(d.cuentas_por_cobrar[0].importe_pendiente).toBe(430);
    expect(Number(d.cuentas_por_cobrar[0].importe_pagado)).toBe(0);
    expect(d.cuentas_por_cobrar_resumen.total).toBe(430);
  });

  it('el listado de cuentas por cobrar trae la venta sin pagos', async () => {
    const r = await accountingModel.getReceivable({ projectId: proyecto.id });
    const a = r.items.find((f) => f.conversion_id === A.id);
    expect(a).toBeTruthy();
    expect(a.importe).toBe(430);
    expect(r.items.some((f) => f.conversion_id === B.id)).toBe(false);
    expect(r.resumen.total_pendiente).toBe(430);
  });
});

describe('#692 · Comisiones', () => {
  it('la base «cobrado» y el estado de pago salen de los pagos', async () => {
    await q(
      `INSERT INTO commission_rules (project_id, user_id, product_id, pct, base_calc) VALUES ($1, $2, NULL, 10, 'cobrado')`,
      [proyecto.id, gestora.id]
    );
    const ca = await commissionModel.createCommissionForConversion(A.id);
    expect(Number(ca.importe_base)).toBe(0);                // antes: 430 sin haber cobrado nada
    expect(Number(ca.importe_comision)).toBe(0);

    const lista = await commissionModel.listCommissions({ projectId: proyecto.id });
    const fa = lista.find((c) => c.conversion_id === A.id);
    expect(Number(fa.conv_pagado)).toBe(0);
    expect(fa.estado_pago).toBe('pendiente');               // antes: 'pagado'
  });
});
