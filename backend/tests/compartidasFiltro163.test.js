import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool from '../src/shared/config/db.js';
import { findAll, filasDelPeriodo, cuotasDelPeriodo } from '../src/modules/conversions/conversion.model.js';
import { getResumenVentas, getVentasPorCliente, getVentasPorAsesora } from '../src/modules/sales/sales.service.js';
import { opcionDeCompartidas, condicionDeCompartidas } from '../src/modules/conversions/compartidas.js';

/**
 * #163 · Filtrar las ventas compartidas: «Todas · Solo compartidas · Solo
 * enteras», en Ingresos (la lista y la del periodo) y en Análisis de ventas.
 *
 * Lo que la issue pide cuidar: con una gestora elegida, la compartida le sigue
 * contando la MITAD (`conversion_reparto`, peso 0,5), no entera.
 *
 * Contra la base real: el filtro es SQL, y un mock del SQL no prueba el SQL.
 */

const MARCA = `C163${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], leads: [], ventas: [], facturas: [] };
let PROYECTO; let FABIOLA; let RAQUEL; let COMPARTIDA; let DE_FABIOLA; let DE_RAQUEL;
const DESDE = '2026-02-01'; const HASTA = '2026-02-28';

async function venta(nombre, responsable, importe) {
  const l = await one(`INSERT INTO leads (project_id, nombre, email, responsable_id, status, fecha_solicitud)
                       VALUES ($1, $2, $3, $4, 'convertido', '2026-02-01') RETURNING id`,
    [PROYECTO, `${MARCA} ${nombre}`, `${nombre}@${MARCA.toLowerCase()}.test`, responsable]);
  ids.leads.push(l.id);
  const c = await one(`INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion, vendedora_id)
                       VALUES ($1, $2, 'Curso', $3, $3, '2026-02-10', $4) RETURNING id`, [l.id, PROYECTO, importe, responsable]);
  ids.ventas.push(c.id);
  // Con cobro: en Análisis, una venta sin cobro es una proforma y no cuenta.
  await q(`INSERT INTO conversion_payments (conversion_id, importe, fecha, metodo) VALUES ($1, $2, '2026-02-10', 'tarjeta')`, [c.id, importe]);
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
  // La de Viviana, a medias entre las dos (como la 634 de ISEIE); las otras, enteras.
  COMPARTIDA = await venta('viviana', FABIOLA, 400);
  await q(`INSERT INTO conversion_vendedoras (conversion_id, user_id, porcentaje) VALUES ($1, $2, 50), ($1, $3, 50)`, [COMPARTIDA, FABIOLA, RAQUEL]);
  DE_FABIOLA = await venta('sara', FABIOLA, 100);
  DE_RAQUEL = await venta('marta', RAQUEL, 200);

  // Revisión de Diego (05/11): una CUOTA de la compartida y otra de una entera
  // (un segundo cobro, con su factura), y una factura suelta, sin venta.
  let numero = 990000 + Math.floor(Math.random() * 9000);
  const factura = async (conversionId, paymentId, total) => {
    const f = await one(
      `INSERT INTO invoices (project_id, ano, numero, codigo, cliente_nombre, cliente_nif, cliente_direccion, cliente_ciudad, cliente_cp, cliente_pais,
                             items, base_imponible, total, conversion_id, payment_id, fecha_emision)
       VALUES ($1, 2026, $2, $3, 'Cliente', 'X1234567L', 'Calle 1', 'Madrid', '28001', 'España', '[]'::jsonb, $4, $4, $5, $6, '2026-02-20') RETURNING id`,
      [PROYECTO, numero, `${MARCA}-${numero}`, total, conversionId, paymentId]);
    numero += 1;
    ids.facturas.push(f.id);
  };
  const segundoCobro = async (conversionId, importe) => (await one(
    `INSERT INTO conversion_payments (conversion_id, importe, fecha, metodo) VALUES ($1, $2, '2026-02-20', 'tarjeta') RETURNING id`,
    [conversionId, importe])).id;
  await factura(COMPARTIDA, await segundoCobro(COMPARTIDA, 40), 40);
  await factura(DE_FABIOLA, await segundoCobro(DE_FABIOLA, 10), 10);
  await factura(null, null, 7);
}, 60000);

afterAll(async () => {
  await q('DELETE FROM conversion_vendedoras WHERE conversion_id = ANY($1::int[])', [ids.ventas]);
  await q('DELETE FROM conversion_payments WHERE conversion_id = ANY($1::int[])', [ids.ventas]);
  await q('DELETE FROM invoices WHERE id = ANY($1::int[]) OR conversion_id = ANY($2::int[])', [ids.facturas, ids.ventas]);
  await q('DELETE FROM matriculas WHERE conversion_id = ANY($1::int[])', [ids.ventas]).catch(() => {});
  await q('DELETE FROM conversions WHERE id = ANY($1::int[])', [ids.ventas]);
  await q('DELETE FROM lead_status_history WHERE lead_id = ANY($1::int[])', [ids.leads]);
  await q('DELETE FROM leads WHERE id = ANY($1::int[])', [ids.leads]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM projects WHERE id = $1', [PROYECTO]);
  await pool.end();
});

const idsDe = (filas, campo = 'id') => filas.map((f) => f[campo]).sort((a, b) => a - b);
const ordenados = (...xs) => [...xs].sort((a, b) => a - b);

describe('la regla', () => {
  it('«solo» y «enteras» filtran; «todas» o cualquier otra cosa, no', () => {
    expect(opcionDeCompartidas('solo')).toBe('solo');
    expect(opcionDeCompartidas('ENTERAS')).toBe('enteras');
    expect(opcionDeCompartidas('todas')).toBeNull();
    expect(opcionDeCompartidas("x'; DROP TABLE conversions; --")).toBeNull();
    expect(condicionDeCompartidas('solo', 'cv')).toContain('cvx.conversion_id = cv.id');
    expect(condicionDeCompartidas('enteras', 'c')).toMatch(/^NOT EXISTS/);
  });
});

describe('Ingresos · la lista', () => {
  const lista = (extra) => findAll({ projectId: PROYECTO, from: DESDE, to: HASTA, page: 1, limit: 50, ...extra });

  it('sin filtro, las tres', async () => {
    expect(idsDe((await lista({})).conversions)).toEqual(ordenados(COMPARTIDA, DE_FABIOLA, DE_RAQUEL));
  });
  it('solo compartidas', async () => {
    expect(idsDe((await lista({ compartidas: 'solo' })).conversions)).toEqual([COMPARTIDA]);
  });
  it('solo enteras', async () => {
    expect(idsDe((await lista({ compartidas: 'enteras' })).conversions)).toEqual(ordenados(DE_FABIOLA, DE_RAQUEL));
  });
  it('con una gestora: Raquel ve su compartida, y con «enteras» solo la suya', async () => {
    expect(idsDe((await lista({ responsableId: RAQUEL, compartidas: 'solo' })).conversions)).toEqual([COMPARTIDA]);
    expect(idsDe((await lista({ responsableId: RAQUEL, compartidas: 'enteras' })).conversions)).toEqual([DE_RAQUEL]);
  });
  it('los totales de arriba siguen al filtro', async () => {
    expect(Number((await lista({ compartidas: 'solo' })).totales.importe)).toBe(400);
    expect(Number((await lista({ compartidas: 'enteras' })).totales.importe)).toBe(300);
  });
});

describe('Ingresos · la lista del periodo', () => {
  it('filtra igual', async () => {
    const solo = await filasDelPeriodo({ projectId: PROYECTO, from: DESDE, to: HASTA, compartidas: 'solo' });
    expect(solo.filas.filter((f) => f.tipo === 'venta').map((f) => f.venta_id)).toEqual([COMPARTIDA]);
    const enteras = await filasDelPeriodo({ projectId: PROYECTO, from: DESDE, to: HASTA, compartidas: 'enteras' });
    expect(enteras.filas.filter((f) => f.tipo === 'venta').map((f) => f.venta_id).sort((a, b) => a - b)).toEqual(ordenados(DE_FABIOLA, DE_RAQUEL));
  });
});

describe('Análisis de ventas', () => {
  const base = { projectId: PROYECTO, from: DESDE, to: HASTA };

  it('por cliente: solo compartidas o solo enteras', async () => {
    const solo = await getVentasPorCliente({ ...base, compartidas: 'solo' });
    expect(solo.clientes.map((c) => c.cliente)).toEqual([`${MARCA} viviana`]);
    const enteras = await getVentasPorCliente({ ...base, compartidas: 'enteras' });
    expect(enteras.clientes.map((c) => c.cliente).sort()).toEqual([`${MARCA} marta`, `${MARCA} sara`]);
  });

  it('con una gestora, la compartida le cuenta la MITAD, con filtro o sin él', async () => {
    const solo = await getVentasPorCliente({ ...base, responsableId: FABIOLA, compartidas: 'solo' });
    expect(Number(solo.clientes[0].importe)).toBe(200);
    const todas = await getVentasPorCliente({ ...base, responsableId: FABIOLA });
    expect(todas.clientes.reduce((t, c) => t + Number(c.importe), 0)).toBe(300); // 200 de la mitad + 100 suya
  });

  it('el resumen y la tabla por asesora siguen al filtro', async () => {
    const resumen = await getResumenVentas({ ...base, compartidas: 'enteras' });
    expect(JSON.stringify(resumen)).not.toContain(`${MARCA} viviana`);
    const porAsesora = await getVentasPorAsesora({ ...base, compartidas: 'solo' });
    expect(porAsesora.reduce((t, a) => t + a.ventas, 0)).toBe(1);
  });
});

describe('Ingresos · las tarjetas de facturas, «Por proyecto» y «Ver cuotas» (revisión de Diego, 05/11)', () => {
  const lista = (extra) => findAll({ projectId: PROYECTO, from: DESDE, to: HASTA, page: 1, limit: 50, ...extra });
  const cuotasDeLaLista = async (compartidas) => (await filasDelPeriodo({ projectId: PROYECTO, from: DESDE, to: HASTA, compartidas }))
    .filas.filter((f) => f.tipo === 'cuota').map((f) => f.venta_id);

  it('con «Solo compartidas», la tarjeta de Cuotas dice las mismas que la lista', async () => {
    const t = (await lista({ compartidas: 'solo' })).totales;
    expect(await cuotasDeLaLista('solo')).toEqual([COMPARTIDA]);
    expect(t.facturasPorClase.cuota.n).toBe(1);
    expect(Number(t.facturasPorClase.cuota.importe)).toBe(40);
    // La factura suelta no es de ninguna venta: no es compartida.
    expect(t.facturasPorClase.suelta.n).toBe(0);
  });

  it('con «Solo enteras», la cuota de la entera, y la suelta sí entra', async () => {
    const t = (await lista({ compartidas: 'enteras' })).totales;
    expect(await cuotasDeLaLista('enteras')).toEqual([DE_FABIOLA]);
    expect(t.facturasPorClase.cuota.n).toBe(1);
    expect(t.facturasPorClase.suelta.n).toBe(1);
  });

  it('sin filtro, las dos cuotas y la suelta', async () => {
    const t = (await lista({})).totales;
    expect(t.facturasPorClase.cuota.n).toBe(2);
    expect(t.facturasPorClase.suelta.n).toBe(1);
  });

  it('«Por proyecto» suma lo mismo que las tarjetas con el filtro puesto', async () => {
    const delCampus = async (compartidas) => (await lista({ compartidas })).totales.porProyecto.find((p) => p.project_id === PROYECTO);
    expect((await delCampus('solo'))).toMatchObject({ ventas: { n: 1, importe: 400 }, cuotas: { n: 1, importe: 40 } });
    expect((await delCampus('enteras'))).toMatchObject({ ventas: { n: 2, importe: 300 }, cuotas: { n: 1, importe: 10 } });
  });

  it('«Ver cuotas» sigue al filtro', async () => {
    const de = async (compartidas) => (await cuotasDelPeriodo({ projectId: PROYECTO, from: DESDE, to: HASTA, compartidas })).map((c) => c.venta_id);
    expect(await de('solo')).toEqual([COMPARTIDA]);
    expect(await de('enteras')).toEqual([DE_FABIOLA]);
    expect((await de(null)).sort((a, b) => a - b)).toEqual(ordenados(COMPARTIDA, DE_FABIOLA));
  });
});
