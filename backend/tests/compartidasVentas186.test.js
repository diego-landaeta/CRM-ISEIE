import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import pool from '../src/shared/config/db.js';
import {
  getResumenVentas, getTopProducts, getDesglose, getSerieVentas, getVentasPorAsesora,
} from '../src/modules/sales/sales.service.js';
import { paisesMasVendidos } from '../src/modules/reports/report.model.js';
import * as salesController from '../src/modules/sales/sales.controller.js';
import * as conversionController from '../src/modules/conversions/conversion.controller.js';
import { listConversionsSchema } from '../src/modules/conversions/conversion.validation.js';
import { leerCompartidas } from '../src/modules/conversions/compartidas.js';

/**
 * CRM-ISEIE#186 (gemela en el 360) · «Solo compartidas / Solo enteras / Todas»
 * en la pantalla de Ventas: que se combine con los demás filtros (gestora,
 * país, fechas) y con las cifras de arriba.
 *
 * La lista y las tarjetas de Ingresos y de Análisis ya las prueba
 * compartidasFiltro163.test.js. Aquí, las tarjetas de Ventas (resumen, cursos
 * vendidos, desglose, evolución y países) y la validación del parámetro.
 *
 * Contra la base real: el filtro es SQL, y un mock del SQL no prueba el SQL.
 */

const MARCA = `C186${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], leads: [], ventas: [] };
let PROYECTO; let FABIOLA; let RAQUEL; let COMPARTIDA;
const DESDE = '2026-03-01'; const HASTA = '2026-03-31';

async function venta(nombre, responsable, importe) {
  const l = await one(`INSERT INTO leads (project_id, nombre, email, responsable_id, status, fecha_solicitud)
                       VALUES ($1, $2, $3, $4, 'convertido', '2026-03-01') RETURNING id`,
    [PROYECTO, `${MARCA} ${nombre}`, `${nombre}@${MARCA.toLowerCase()}.test`, responsable]);
  ids.leads.push(l.id);
  const c = await one(`INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion, vendedora_id)
                       VALUES ($1, $2, 'Curso', $3, $3, '2026-03-10', $4) RETURNING id`, [l.id, PROYECTO, importe, responsable]);
  ids.ventas.push(c.id);
  // Con cobro: una venta sin ningún cobro es una proforma en varias tarjetas.
  await q(`INSERT INTO conversion_payments (conversion_id, importe, fecha, metodo) VALUES ($1, $2, '2026-03-10', 'tarjeta')`, [c.id, importe]);
  return c.id;
}

beforeAll(async () => {
  PROYECTO = (await one(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} campus`, `${MARCA.toLowerCase()}`, `${MARCA}-k`])).id;
  const gestora = async (n) => {
    const u = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'gestor') RETURNING id`,
      [`${MARCA} ${n}`, `${n}@${MARCA.toLowerCase()}.test`]);
    ids.users.push(u.id);
    return u.id;
  };
  FABIOLA = await gestora('fabiola'); RAQUEL = await gestora('raquel');
  // Una venta a medias entre las dos (400) y dos enteras (100 de Fabiola, 200 de Raquel).
  COMPARTIDA = await venta('viviana', FABIOLA, 400);
  await q(`INSERT INTO conversion_vendedoras (conversion_id, user_id, porcentaje) VALUES ($1, $2, 50), ($1, $3, 50)`, [COMPARTIDA, FABIOLA, RAQUEL]);
  await venta('sara', FABIOLA, 100);
  await venta('marta', RAQUEL, 200);
}, 60000);

afterAll(async () => {
  await q('DELETE FROM conversion_vendedoras WHERE conversion_id = ANY($1::int[])', [ids.ventas]);
  await q('DELETE FROM conversion_payments WHERE conversion_id = ANY($1::int[])', [ids.ventas]);
  await q('DELETE FROM invoices WHERE conversion_id = ANY($1::int[])', [ids.ventas]);
  await q('DELETE FROM matriculas WHERE conversion_id = ANY($1::int[])', [ids.ventas]).catch(() => {});
  await q('DELETE FROM conversions WHERE id = ANY($1::int[])', [ids.ventas]);
  await q('DELETE FROM lead_status_history WHERE lead_id = ANY($1::int[])', [ids.leads]);
  await q('DELETE FROM leads WHERE id = ANY($1::int[])', [ids.leads]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM projects WHERE id = $1', [PROYECTO]);
  await pool.end();
});

const base = () => ({ projectId: PROYECTO, from: DESDE, to: HASTA });

describe('el parámetro, validado con Zod', () => {
  it('sin valor o «todas», no filtra; «solo» y «enteras», sí', () => {
    expect(leerCompartidas(undefined)).toBeNull();
    expect(leerCompartidas('')).toBeNull();
    expect(leerCompartidas('todas')).toBeNull();
    expect(leerCompartidas('solo')).toBe('solo');
    expect(leerCompartidas('enteras')).toBe('enteras');
  });
  it('cualquier otra cosa es un 400, no un filtro a medias', () => {
    expect(() => leerCompartidas("x'; DROP TABLE conversions; --")).toThrow(expect.objectContaining({ statusCode: 400, code: 'VALIDATION_ERROR' }));
    expect(() => leerCompartidas(['solo', 'enteras'])).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(listConversionsSchema.safeParse({ compartidas: 'medias' }).success).toBe(false);
    expect(listConversionsSchema.safeParse({ compartidas: 'solo' }).data.compartidas).toBe('solo');
  });
  it('las rutas lo devuelven como 400', async () => {
    const req = { query: { compartidas: 'medias', from: DESDE, to: HASTA }, user: { id: 1, role: 'superadmin' } };
    const res = { json: vi.fn() };
    for (const accion of [salesController.resumenVentas, salesController.topProducts, salesController.desglose,
      salesController.serieVentas, salesController.paises, conversionController.filas, conversionController.cuotas]) {
      const next = vi.fn();
      await accion(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    }
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe('Ventas · las cifras de arriba (resumen)', () => {
  it('todas, solo compartidas y solo enteras', async () => {
    expect(await getResumenVentas(base())).toMatchObject({ ventas: 3, importe: 700 });
    expect(await getResumenVentas({ ...base(), compartidas: 'solo' })).toMatchObject({ ventas: 1, importe: 400 });
    expect(await getResumenVentas({ ...base(), compartidas: 'enteras' })).toMatchObject({ ventas: 2, importe: 300 });
  });
  it('con la gestora: la compartida le cuenta la mitad, con el filtro o sin él', async () => {
    expect((await getResumenVentas({ ...base(), responsableId: FABIOLA, compartidas: 'solo' })).importe).toBe(200);
    expect((await getResumenVentas({ ...base(), responsableId: FABIOLA, compartidas: 'enteras' })).importe).toBe(100);
    expect((await getResumenVentas({ ...base(), responsableId: FABIOLA })).importe).toBe(300);
  });
  it('la tabla por asesora suma lo mismo', async () => {
    const porAsesora = await getVentasPorAsesora({ ...base(), compartidas: 'enteras' });
    expect(porAsesora.reduce((t, a) => t + a.ventas, 0)).toBe(2);
  });
});

describe('Ventas · el resto de tarjetas sigue al filtro', () => {
  it('cursos vendidos', async () => {
    expect((await getTopProducts({ ...base(), compartidas: 'solo' })).totales).toMatchObject({ ventas: 1 });
    expect((await getTopProducts({ ...base(), compartidas: 'enteras' })).totales).toMatchObject({ ventas: 2 });
    expect((await getTopProducts(base())).totales).toMatchObject({ ventas: 3 });
  });
  it('de qué se compone lo vendido: ventas y cobros', async () => {
    expect((await getDesglose({ ...base(), compartidas: 'solo' })).totales).toMatchObject({ ventas: 1, vendido: 400, cobrado: 400 });
    expect((await getDesglose({ ...base(), compartidas: 'enteras' })).totales).toMatchObject({ ventas: 2, vendido: 300, cobrado: 300 });
  });
  it('la evolución: ventas y cobros; los leads no son ventas y siguen todos', async () => {
    const solo = await getSerieVentas({ ...base(), compartidas: 'solo' });
    const enteras = await getSerieVentas({ ...base(), compartidas: 'enteras' });
    const todas = await getSerieVentas(base());
    expect(solo.totales).toMatchObject({ ventas: 1, vendido: 400, cobrado: 400 });
    expect(enteras.totales).toMatchObject({ ventas: 2, vendido: 300, cobrado: 300 });
    expect(solo.totales.leads).toBe(todas.totales.leads);
    expect(enteras.totales.leads).toBe(todas.totales.leads);
  });
  it('ventas por país', async () => {
    const ventas = async (compartidas) => (await paisesMasVendidos({ ...base(), compartidas }))
      .reduce((t, p) => t + Number(p.ventas || 0), 0);
    expect(await ventas('solo')).toBe(1);
    expect(await ventas('enteras')).toBe(2);
    expect(await ventas(null)).toBe(3);
  });
});
