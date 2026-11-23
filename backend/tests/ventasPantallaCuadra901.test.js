import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool from '../src/shared/config/db.js';
import * as conversionModel from '../src/modules/conversions/conversion.model.js';
import {
  getResumenVentas, getVentasPorAsesora, getVentasPorCliente, getDesglose, getSerieVentas,
} from '../src/modules/sales/sales.service.js';

/**
 * Gemela de CRM#901 (revisión de Diego, 21/11): las tarjetas del resumen ya
 * contaban las ventas sin cobro, pero el resto de la pantalla de Ventas
 * (Análisis por asesora/cliente, «Cursos vendidos» y la comparativa/mes a
 * mes) seguía con la regla vieja — la pantalla no cuadraba consigo misma.
 *
 * Una venta CON cobro y otra SIN ningún cobro, mismo periodo y campus: las
 * cinco consultas de la pantalla tienen que contar las dos.
 */

const MARCA = `C901I${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { leads: [], ventas: [] };
let PROYECTO; let GESTORA;
const DESDE = '2026-03-01'; const HASTA = '2026-03-31';

beforeAll(async () => {
  PROYECTO = (await one(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} campus`, `${MARCA.toLowerCase()}`, `${MARCA}-k`])).id;
  GESTORA = (await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'gestor') RETURNING id`,
    [`${MARCA} gestora`, `gestora@${MARCA.toLowerCase()}.test`])).id;

  const venta = async (nombre, importe, conCobro) => {
    const l = await one(`INSERT INTO leads (nombre, email, project_id, responsable_id, status, fecha_solicitud)
                         VALUES ($1, $2, $3, $4, 'nuevo', $5) RETURNING id`,
      [`${MARCA} ${nombre}`, `${nombre}@${MARCA.toLowerCase()}.test`, PROYECTO, GESTORA, DESDE]);
    ids.leads.push(l.id);
    const c = await conversionModel.create({
      lead_id: l.id, project_id: PROYECTO, producto_contratado: `${MARCA} curso`,
      importe_total: importe, importe_pagado: conCobro ? importe : 0,
      metodo_pago: 'tarjeta', fecha_conversion: '2026-03-10', iva_incluido: true,
    });
    ids.ventas.push(c.id);
  };

  await venta('con-cobro', 500, true);
  await venta('sin-cobro', 300, false);
}, 60000);

afterAll(async () => {
  await q('DELETE FROM conversion_payments WHERE conversion_id = ANY($1::int[])', [ids.ventas]);
  await q('DELETE FROM conversions WHERE id = ANY($1::int[])', [ids.ventas]);
  await q('DELETE FROM leads WHERE id = ANY($1::int[])', [ids.leads]);
  await q('DELETE FROM users WHERE id = $1', [GESTORA]);
  await q('DELETE FROM projects WHERE id = $1', [PROYECTO]);
  await pool.end();
});

describe('Ventas cuadra consigo misma (gemela de CRM#901, revisión de Diego)', () => {
  it('el resumen cuenta las dos, con y sin cobro (referencia)', async () => {
    const r = await getResumenVentas({ projectId: PROYECTO, from: DESDE, to: HASTA });
    expect(r.ventas).toBe(2);
  });

  it('Análisis · por asesora cuenta las dos', async () => {
    const filas = await getVentasPorAsesora({ projectId: PROYECTO, from: DESDE, to: HASTA });
    const total = filas.reduce((s, f) => s + f.ventas, 0);
    expect(total).toBe(2);
  });

  it('Análisis · por cliente (y la pestaña Clientes) cuenta las dos', async () => {
    const r = await getVentasPorCliente({ projectId: PROYECTO, from: DESDE, to: HASTA });
    expect(r.clientes.length).toBe(2);
  });

  it('Cursos vendidos (el desglose) cuenta las dos', async () => {
    const r = await getDesglose({ projectId: PROYECTO, from: DESDE, to: HASTA });
    expect(r.totales.ventas).toBe(2);
  });

  it('la comparativa y el mes a mes cuentan las dos', async () => {
    const r = await getSerieVentas({ projectId: PROYECTO, from: DESDE, to: HASTA });
    expect(r.totales.ventas).toBe(2);
  });
});
