import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool from '../src/shared/config/db.js';
import * as service from '../src/modules/conciliacion/conciliacion.service.js';
import * as ctrl from '../src/modules/conciliacion/conciliacion.controller.js';

/**
 * CRM#905 · Conciliación: facturas emitidas sin cobro y cobros sin factura, y
 * enlazarlos desde el CRM.
 *
 * Con base (la de `db:preparar`): un campus de prueba con sus ventas, cobros y
 * facturas emitidas inventadas. Lo que se defiende:
 *   · una factura y un cobro que casan (importe, fecha y cliente) salen como
 *     «seguro», en las dos listas, y se enlazan;
 *   · enlazar une la factura con el cobro y su venta SIN tocar número, importe,
 *     emisora ni datos del cliente, y queda quién lo hizo;
 *   · una ya enlazada da 409 (la factura con cobro y el cobro con factura);
 *   · dos facturas que casan con el mismo cobro no son seguras;
 *   · otro importe, otro campus o fuera de los campus de quien enlaza: no;
 *   · «Enlazar todas las seguras» pide cuántas y por cuánto, y si ha cambiado, 409;
 *   · una gestora (alcance comercial) no concilia.
 *
 *   DATABASE_URL=... node scripts/db-preparar.mjs --datos
 *   npx vitest run tests/conciliacionFacturasCobros905.test.js
 */

const MARCA = `C905_${Date.now().toString(36)}`;
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
let campus;
let otroCampus;
let usuario;
const usuarios = {};
let numero = 0;
// La numeración es única por año y serie en toda la base: una serie propia de
// esta vuelta, para no chocar con otras pruebas ni con restos de una anterior.
const SERIE = `T${Date.now().toString(36).slice(-6).toUpperCase()}`;

async function alumno(nombre, email, projectId = campus.id) {
  const [l] = await q('INSERT INTO leads (nombre, email, project_id) VALUES ($1, $2, $3) RETURNING id',
    [nombre, email, projectId]);
  return l;
}

async function venta(lead, importe, projectId = campus.id) {
  const [v] = await q(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, fecha_conversion)
     VALUES ($1, $2, $3, $4, '2026-10-01') RETURNING id, lead_id`,
    [lead.id, projectId, `${MARCA} máster`, importe]);
  return v;
}

async function cobro(v, importe, fecha) {
  const [c] = await q(
    'INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, $2, $3) RETURNING id',
    [v.id, importe, fecha]);
  return c;
}

/** Una factura emitida como las de las cargas de Excel: con número, sin cobro ni venta. */
async function factura({ cliente, email = null, total, fecha, projectId = campus.id, extra = {} }) {
  numero += 1;
  const [f] = await q(
    `INSERT INTO invoices (project_id, serie, ano, numero, codigo, fecha_emision, cliente_nombre, cliente_nif,
                           cliente_direccion, cliente_ciudad, cliente_cp, cliente_pais, cliente_email,
                           items, base_imponible, total, estado, tipo, conversion_id, lead_id)
     VALUES ($1, $11, 2026, $2, $3, $4, $5, '—', 'Calle 1', 'Madrid', '28001', 'España', $6,
             '[{"concepto":"Máster","importe":1}]'::jsonb, $7, $7, $8, 'normal', $9, $10)
     RETURNING id, codigo, numero, total::float8 AS total, cliente_nombre, cliente_email`,
    [projectId, numero, `${MARCA}-${numero}`, fecha, cliente, email, total, extra.estado || 'emitida',
     extra.conversionId || null, extra.leadId || null, SERIE]);
  return f;
}

const fila = async (id) => (await q(
  `SELECT id, codigo, numero, total::float8 AS total, cliente_nombre, cliente_email, issuer_id,
          payment_id, conversion_id, lead_id, estado
     FROM invoices WHERE id = $1`, [id]))[0];

const listar = (mes = '2026-10') => service.listar({ campus: [campus.id], mes });

beforeAll(async () => {
  [campus] = await q('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
    [MARCA, MARCA.toLowerCase(), MARCA]);
  [otroCampus] = await q('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
    [`${MARCA}b`, `${MARCA.toLowerCase()}b`, `${MARCA}b`]);
  // En ISEIE la base de la CI no trae usuarios: los de la prueba se crean aquí
  // (en MultiCRM se cogía el primer superadmin de la base).
  const crear = async (role) => (await q(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id`,
    [`${MARCA} ${role}`, `${role}.${MARCA.toLowerCase()}@prueba.test`, role]))[0];
  usuario = await crear('superadmin');
  usuarios.gestor = await crear('gestor');
  usuarios.admin = await crear('admin');
});

afterAll(async () => {
  for (const p of [campus, otroCampus].filter(Boolean)) {
    const ventas = `SELECT id FROM conversions WHERE project_id = ${Number(p.id)}`;
    await q('DELETE FROM invoices WHERE project_id = $1', [p.id]);
    await q(`DELETE FROM conversion_payments WHERE conversion_id IN (${ventas})`);
    await q('DELETE FROM conversions WHERE project_id = $1', [p.id]);
    await q('DELETE FROM lead_status_history WHERE lead_id IN (SELECT id FROM leads WHERE project_id = $1)', [p.id]);
    await q('DELETE FROM leads WHERE project_id = $1', [p.id]);
    await q('DELETE FROM projects WHERE id = $1', [p.id]);
  }
  await q(`DELETE FROM user_activity_log WHERE action = 'conciliacion.enlazar_factura' AND details->>'codigo' LIKE $1`, [`${MARCA}%`]);
  const mios = [usuario, usuarios.gestor, usuarios.admin].filter(Boolean).map((u) => u.id);
  await q('DELETE FROM user_activity_log WHERE user_id = ANY($1::int[])', [mios]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [mios]).catch(() => {});
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [mios]);
  await pool.end();
});

describe('#905 · facturas emitidas sin cobro y cobros sin factura', () => {
  let ana;
  let ventaAna;
  let cobroAna;
  let facturaAna;

  it('una factura y un cobro que casan salen como «seguro» en las dos listas', async () => {
    ana = await alumno('Ana Pérez', `ana.${MARCA}@prueba.test`);
    ventaAna = await venta(ana, 1200);
    cobroAna = await cobro(ventaAna, 600, '2026-10-03');
    // La factura de la carga de Excel: el nombre con tildes y mayúsculas distintas.
    facturaAna = await factura({ cliente: '  ANA  perez ', total: 600, fecha: '2026-10-05' });

    const r = await listar();
    const f = r.facturas.find((x) => x.id === facturaAna.id);
    expect(f.candidatos).toHaveLength(1);
    expect(f.candidatos[0]).toMatchObject({ payment_id: cobroAna.id, segura: true, por: 'nombre', dias: 2 });
    const c = r.cobros.find((x) => x.id === cobroAna.id);
    expect(c.candidatas).toEqual([expect.objectContaining({ invoice_id: facturaAna.id, segura: true })]);
    expect(r.seguras).toEqual([{ invoice_id: facturaAna.id, payment_id: cobroAna.id, importe: 600 }]);
    expect(r.resumen).toMatchObject({ seguras: 1, importe_seguras: 600 });
  });

  it('enlazar une la factura con su cobro y su venta, sin tocar número, importe ni cliente', async () => {
    const antes = await fila(facturaAna.id);
    const hecha = await service.enlazar({
      invoiceId: facturaAna.id, paymentId: cobroAna.id, campus: [campus.id], userId: usuario.id, ip: '127.0.0.1',
    });
    expect(hecha).toMatchObject({ id: facturaAna.id, payment_id: cobroAna.id, conversion_id: ventaAna.id });
    const despues = await fila(facturaAna.id);
    expect(despues).toMatchObject({
      payment_id: cobroAna.id, conversion_id: ventaAna.id, lead_id: ana.id,
      codigo: antes.codigo, numero: antes.numero, total: antes.total, cliente_nombre: antes.cliente_nombre,
      cliente_email: antes.cliente_email, issuer_id: antes.issuer_id, estado: antes.estado,
    });
    const [log] = await q(
      `SELECT user_id, details FROM user_activity_log
        WHERE action = 'conciliacion.enlazar_factura' AND (details->>'invoice_id')::int = $1`, [facturaAna.id]);
    expect(log.user_id).toBe(usuario.id);
    expect(log.details).toMatchObject({ payment_id: cobroAna.id, antes: { conversion_id: null, lead_id: null } });

    // Ya no sale en ninguna de las dos listas.
    const r = await listar();
    expect(r.facturas.some((x) => x.id === facturaAna.id)).toBe(false);
    expect(r.cobros.some((x) => x.id === cobroAna.id)).toBe(false);
  });

  it('una ya enlazada da 409: la factura ya tiene cobro, y el cobro ya tiene factura', async () => {
    const otroCobro = await cobro(ventaAna, 600, '2026-10-20');
    await expect(service.enlazar({ invoiceId: facturaAna.id, paymentId: otroCobro.id, campus: null }))
      .rejects.toMatchObject({ statusCode: 409, code: 'FACTURA_YA_TIENE_COBRO' });

    const otraFactura = await factura({ cliente: 'Ana Pérez', total: 600, fecha: '2026-10-04' });
    await expect(service.enlazar({ invoiceId: otraFactura.id, paymentId: cobroAna.id, campus: null }))
      .rejects.toMatchObject({ statusCode: 409, code: 'COBRO_YA_FACTURADO' });
    expect((await fila(otraFactura.id)).payment_id).toBeNull();
  });

  it('dos facturas que casan con el mismo cobro: candidatas, pero ninguna segura', async () => {
    const luis = await alumno('Luis Gómez', `luis.${MARCA}@prueba.test`);
    const v = await venta(luis, 900);
    const c = await cobro(v, 300, '2026-10-10');
    const f1 = await factura({ cliente: 'Otro nombre', email: `LUIS.${MARCA}@prueba.test`, total: 300, fecha: '2026-10-11' });
    const f2 = await factura({ cliente: 'Luis Gomez', total: 300, fecha: '2026-10-14' });

    const r = await listar();
    expect(r.facturas.find((x) => x.id === f1.id).candidatos).toEqual([expect.objectContaining({ payment_id: c.id, por: 'correo', segura: false })]);
    expect(r.facturas.find((x) => x.id === f2.id).candidatos).toEqual([expect.objectContaining({ payment_id: c.id, segura: false })]);
    expect(r.cobros.find((x) => x.id === c.id).candidatas.map((x) => x.invoice_id).sort()).toEqual([f1.id, f2.id].sort());
    expect(r.seguras.some((s) => s.payment_id === c.id)).toBe(false);
  });

  it('no casan: otro importe, a más de 7 días, otro cliente u otro campus', async () => {
    const eva = await alumno('Eva Ruiz', `eva.${MARCA}@prueba.test`);
    const v = await venta(eva, 500);
    const c = await cobro(v, 250, '2026-10-15');
    const otroImporte = await factura({ cliente: 'Eva Ruiz', total: 251, fecha: '2026-10-15' });
    const lejos = await factura({ cliente: 'Eva Ruiz', total: 250, fecha: '2026-10-25' });
    const otroCliente = await factura({ cliente: 'Pedro Sanz', total: 250, fecha: '2026-10-15' });
    const fuera = await factura({ cliente: 'Eva Ruiz', total: 250, fecha: '2026-10-15', projectId: otroCampus.id });

    const r = await listar();
    for (const f of [otroImporte, lejos, otroCliente]) {
      expect(r.facturas.find((x) => x.id === f.id).candidatos).toEqual([]);
    }
    expect(r.facturas.some((x) => x.id === fuera.id)).toBe(false);
    expect(r.cobros.find((x) => x.id === c.id)).toMatchObject({ candidatas: [], en_cola: true });

    await expect(service.enlazar({ invoiceId: otroImporte.id, paymentId: c.id, campus: null }))
      .rejects.toMatchObject({ statusCode: 409, code: 'IMPORTE_DISTINTO' });
    await expect(service.enlazar({ invoiceId: fuera.id, paymentId: c.id, campus: null }))
      .rejects.toMatchObject({ statusCode: 409, code: 'OTRO_CAMPUS' });
    // Fuera de los campus de quien enlaza: como si no existiera.
    await expect(service.enlazar({ invoiceId: fuera.id, paymentId: c.id, campus: [campus.id] }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('una factura sin número, cancelada o anulada no se enlaza', async () => {
    const pepa = await alumno('Pepa Luna', `pepa.${MARCA}@prueba.test`);
    const c = await cobro(await venta(pepa, 100), 100, '2026-10-02');
    const cancelada = await factura({ cliente: 'Pepa Luna', total: 100, fecha: '2026-10-02', extra: { estado: 'cancelada' } });
    expect((await listar()).facturas.some((x) => x.id === cancelada.id)).toBe(false);
    await expect(service.enlazar({ invoiceId: cancelada.id, paymentId: c.id, campus: null }))
      .rejects.toMatchObject({ statusCode: 409, code: 'FACTURA_NO_ENLAZABLE' });
  });

  it('«Enlazar todas las seguras»: con lo que se vio enlaza; si ha cambiado, 409 y nada', async () => {
    const rosa = await alumno('Rosa Mar', `rosa.${MARCA}@prueba.test`);
    const v = await venta(rosa, 400);
    const c = await cobro(v, 200, '2026-10-21');
    const f = await factura({ cliente: 'Rosa Mar', total: 200, fecha: '2026-10-22', extra: { conversionId: v.id } });

    const r = await listar();
    expect(r.seguras).toEqual([{ invoice_id: f.id, payment_id: c.id, importe: 200 }]);
    expect(r.facturas.find((x) => x.id === f.id).candidatos[0].por).toBe('venta');

    await expect(service.enlazarSeguras({ campus: [campus.id], mes: '2026-10', cuantas: 2, importe: 400 }))
      .rejects.toMatchObject({ statusCode: 409, code: 'SEGURAS_CAMBIADAS', data: { seguras: 1, importe: 200 } });
    expect((await fila(f.id)).payment_id).toBeNull();

    const hecho = await service.enlazarSeguras({ campus: [campus.id], mes: '2026-10', cuantas: 1, importe: 200, userId: usuario.id });
    expect(hecho).toMatchObject({ enlazadas: 1, importe: 200, fallidas: [] });
    expect((await fila(f.id)).payment_id).toBe(c.id);
    expect((await listar()).resumen.seguras).toBe(0);
  });

  it('el mes filtra: las de otro mes no salen', async () => {
    const r = await listar('2026-09');
    expect(r.facturas.filter((x) => x.project_id === campus.id)).toEqual([]);
    expect(r.cobros.filter((x) => x.project_id === campus.id)).toEqual([]);
  });

  it('una gestora (alcance comercial) no concilia, aunque tenga el permiso', async () => {
    const gestora = usuarios.gestor;
    const req = { user: { userId: gestora.id, role: 'gestor' }, query: { mes: '2026-10' }, body: {} };
    let error;
    await ctrl.listar(req, { json: () => {} }, (e) => { error = e; });
    expect(error).toMatchObject({ statusCode: 403 });
  });

  it('un admin solo ve sus campus, aunque pida otro por la URL', async () => {
    const admin = usuarios.admin;
    const req = { user: { userId: admin.id, role: 'admin' }, query: { projectId: String(campus.id), mes: '2026-10' }, body: {} };
    let error;
    await ctrl.listar(req, { json: () => {} }, (e) => { error = e; });
    expect(error).toMatchObject({ statusCode: 403 });
  });
});
