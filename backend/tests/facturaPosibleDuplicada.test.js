import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * CRM#819 (gemela CRM-ISEIE#500) · Avisar ANTES de emitir una posible duplicada.
 *
 * 17/11/2026, ISEIE: administracion emitio una factura y luego otra para el
 * mismo cobro y el mismo cliente, con el nombre cambiado solo por un espacio.
 * El CRM no aviso. Ahora, si hay otra factura no anulada del mismo cliente
 * (nombre normalizado o NIF), por el mismo total (±0,01) y a 7 dias o menos:
 *
 *   - la API contesta 409 POSIBLE_DUPLICADA con la otra factura, y se emite
 *     igualmente con `confirmar_duplicada: true`;
 *   - la cola no la emite sola: el cobro se queda con el motivo «posible duplicada».
 *
 * Contra la base local:
 *   npm run db:preparar -- --datos
 *   npx vitest run tests/facturaPosibleDuplicada.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/invoices/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const INV = await import('../src/modules/invoices/invoices.model.js');
const SRV = await import('../src/modules/invoices/invoices.service.js');
const { duplicadasDeLaCola } = await import('../src/modules/invoices/posible-duplicada.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `PD${Date.now().toString(36)}`;
const SERIE = `P${Date.now().toString(36).slice(-7)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [], issuers: [], leads: [], conversions: [] };
let P; let SUPER;
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });

// Un dia relativo a hoy, en AAAA-MM-DD, con la fecha de la base (no la del PC).
const dia = async (desplazamiento) =>
  (await one(`SELECT (CURRENT_DATE + $1::int)::text AS d`, [desplazamiento])).d;

// NIF de pega, distinto en cada pasada para no chocar con otras pruebas.
let nifs = 0;
const nif = () => `T${MARCA.slice(-6).toUpperCase()}${(nifs += 1)}`;

function cuerpo({ nombre, nifCliente, total, fecha, ...extra }) {
  return {
    projectId: P,
    clienteNombre: nombre,
    clienteNif: nifCliente,
    clienteDireccion: 'Calle 1', clienteCiudad: 'Madrid', clienteCp: '28001', clientePais: 'España',
    items: [{ descripcion: 'Curso', cantidad: 1, precio_unitario: total }],
    ivaPct: 0,
    metodoPago: 'transferencia',
    ...(fecha ? { fechaEmision: fecha } : {}),
    ...extra,
  };
}
const emitir = (datos) => request.post('/api/invoices').set(como(SUPER)).send(cuerpo(datos));

beforeAll(async () => {
  const e = await one(`INSERT INTO invoice_issuers (razon_social, nif, serie) VALUES ($1, '', $2) RETURNING id`,
    [`${MARCA} Emisora`, SERIE]);
  ids.issuers.push(e.id);
  P = (await one(`INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`${MARCA} campus`, MARCA.toLowerCase(), `${MARCA}-k`, e.id])).id;
  ids.projects.push(P);
  SUPER = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'superadmin') RETURNING id, role`,
    [`${MARCA} super`, `super@${MARCA.toLowerCase()}.test`]);
  ids.users.push(SUPER.id);
}, 60000);

afterAll(async () => {
  const quita = (sql, p) => q(sql, p).catch(() => {});
  await quita('DELETE FROM invoices WHERE project_id = ANY($1::int[])', [ids.projects]);
  await quita('DELETE FROM invoice_sequences WHERE project_id = ANY($1::int[])', [ids.projects]);
  await quita('DELETE FROM conversion_payments WHERE conversion_id = ANY($1::int[])', [ids.conversions]);
  await quita('DELETE FROM conversions WHERE id = ANY($1::int[])', [ids.conversions]);
  await quita('DELETE FROM leads WHERE id = ANY($1::int[])', [ids.leads]);
  await quita('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await quita('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await quita('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await quita('DELETE FROM invoice_issuers WHERE id = ANY($1::int[])', [ids.issuers]);
  await pool.end();
}, 60000);

describe('al emitir a mano (POST /api/invoices)', () => {
  it('el caso del 17/11: mismo cliente con un espacio de mas → 409 con la otra factura', async () => {
    const hoy = await dia(0);
    const primera = await emitir({ nombre: `${MARCA} Juana Pérez`, nifCliente: nif(), total: 125.5 });
    expect(primera.status, JSON.stringify(primera.body)).toBe(200);

    const segunda = await emitir({ nombre: `  ${MARCA.toLowerCase()}  juana   PEREZ `, nifCliente: nif(), total: 125.5 });
    expect(segunda.status).toBe(409);
    expect(segunda.body.code).toBe('POSIBLE_DUPLICADA');
    expect(segunda.body.data.otra).toMatchObject({
      id: primera.body.data.id, numero: primera.body.data.codigo, fecha: hoy, importe: 125.5,
    });
    // Y no se gasto ningun numero en el intento.
    const n = await one(`SELECT count(*)::int AS n FROM invoices WHERE project_id = $1`, [P]);
    expect(n.n).toBe(1);
  });

  it('«Emitir igualmente» (confirmar_duplicada) la emite', async () => {
    const r = await emitir({ nombre: `${MARCA} juana perez`, nifCliente: nif(), total: 125.5, confirmar_duplicada: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.codigo).toBeTruthy();
  });

  it('el mismo NIF escrito de otra forma, aunque el nombre cambie', async () => {
    const n = nif();
    expect((await emitir({ nombre: `${MARCA} Empresa SL`, nifCliente: n, total: 300 })).status).toBe(200);
    const r = await emitir({ nombre: `${MARCA} Empresa, S.L.`, nifCliente: `${n.slice(0, 4)}-${n.slice(4).toLowerCase()}`, total: 300 });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('POSIBLE_DUPLICADA');
  });

  it('el importe: ±0,01 avisa; 0,02 de diferencia ya no', async () => {
    const nombre = `${MARCA} Importe Justo`;
    expect((await emitir({ nombre, nifCliente: nif(), total: 80 })).status).toBe(200);
    expect((await emitir({ nombre, nifCliente: nif(), total: 80.01 })).status).toBe(409);
    expect((await emitir({ nombre, nifCliente: nif(), total: 80.02 })).status).toBe(200);
  });

  it('la fecha: a 7 dias avisa; a 8 ya no', async () => {
    // En una serie propia y vacía: con fechas de hace días en la serie de las
    // demás pruebas (que ya tiene facturas de hoy), la fecha iría por detrás de
    // la de la anterior, y eso ya no se puede (CRM#764, fecha-en-orden.js).
    const s = `Q${Date.now().toString(36).slice(-7)}`;
    const e = await one(`INSERT INTO invoice_issuers (razon_social, nif, serie) VALUES ($1, '', $2) RETURNING id`,
      [`${MARCA} Emisora fechas`, s]);
    ids.issuers.push(e.id);
    const P2 = (await one(`INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [`${MARCA} campus fechas`, `${MARCA.toLowerCase()}-f`, `${MARCA}-kf`, e.id])).id;
    ids.projects.push(P2);
    const nombre = `${MARCA} Fechas Lejos`;
    const en = (fecha) => emitir({ nombre, nifCliente: nif(), total: 45, fecha, projectId: P2 });
    expect((await en(await dia(-10))).status).toBe(200);
    expect((await en(await dia(-3))).status).toBe(409);
    expect((await en(await dia(-2))).status).toBe(200);
  });

  it('una anulada no cuenta', async () => {
    const nombre = `${MARCA} Anulada Antes`;
    const r = await emitir({ nombre, nifCliente: nif(), total: 50 });
    await q(`UPDATE invoices SET estado = 'cancelada' WHERE id = $1`, [r.body.data.id]);
    expect((await emitir({ nombre, nifCliente: nif(), total: 50 })).status).toBe(200);
  });

  it('una proforma ni cuenta ni se para', async () => {
    const nombre = `${MARCA} Presupuesto`;
    const prof = await emitir({ nombre, nifCliente: nif(), total: 60, tipo: 'proforma' });
    expect(prof.status, JSON.stringify(prof.body)).toBe(200);
    expect((await emitir({ nombre, nifCliente: nif(), total: 60 })).status).toBe(200);
    expect((await emitir({ nombre, nifCliente: nif(), total: 60, tipo: 'proforma' })).status).toBe(200);
  });
});

describe('al emitir un borrador (POST /:id/emitir)', () => {
  it('el borrador se guarda, pero al emitirlo avisa; con confirmar_duplicada sale', async () => {
    const nombre = `${MARCA} Borrador Igual`;
    const ya = await emitir({ nombre, nifCliente: nif(), total: 99 });
    expect(ya.status).toBe(200);
    const b = await emitir({ nombre: ` ${nombre} `, nifCliente: nif(), total: 99, borrador: true });
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    expect(b.body.data.estado).toBe('borrador');

    const sin = await request.post(`/api/invoices/${b.body.data.id}/emitir`).set(como(SUPER)).send({});
    expect(sin.status).toBe(409);
    expect(sin.body.code).toBe('POSIBLE_DUPLICADA');
    expect(sin.body.data.otra.numero).toBe(ya.body.data.codigo);

    const con = await request.post(`/api/invoices/${b.body.data.id}/emitir`).set(como(SUPER)).send({ confirmar_duplicada: true });
    expect(con.status, JSON.stringify(con.body)).toBe(200);
    expect(con.body.data.estado).toBe('emitida');
  });
});

describe('la cola y la emision automatica', () => {
  let VENTA; let COBRO; let OTRA;

  beforeAll(async () => {
    const nombre = `${MARCA} Rosa Núñez`;
    const l = await one(`INSERT INTO leads (project_id, nombre) VALUES ($1, $2) RETURNING id`, [P, nombre]);
    ids.leads.push(l.id);
    VENTA = (await one(`INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion)
                         VALUES ($1, $2, 'Curso', 1000, 70, CURRENT_DATE) RETURNING id`, [l.id, P])).id;
    ids.conversions.push(VENTA);
    COBRO = (await one(`INSERT INTO conversion_payments (conversion_id, importe, fecha, metodo)
                         VALUES ($1, 70, CURRENT_DATE, 'transferencia') RETURNING id`, [VENTA])).id;
    // La factura que ya se hizo a mano para este cliente, sin enganchar a la venta.
    const r = await emitir({ nombre: `${MARCA.toUpperCase()} ROSA  NUNEZ`, nifCliente: nif(), total: 70 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    OTRA = r.body.data;
  }, 60000);

  it('la cola dice por que sigue ahi: «posible duplicada», con la otra factura', async () => {
    const m = await duplicadasDeLaCola([COBRO]);
    expect(m.get(COBRO)).toMatchObject({ numero: OTRA.codigo, importe: 70 });

    const estado = await SRV.getFacturacionAlDia(P);
    const fila = estado.cola.find((c) => c.payment_id === COBRO);
    expect(fila).toBeTruthy();
    expect(fila.motivo).toBe('posible duplicada');
    expect(fila.posible_duplicada.numero).toBe(OTRA.codigo);
  });

  it('«Emitir hasta» (la emision sin nadie delante) no la emite: queda en la cola', async () => {
    const r = await SRV.emitirColaHasta(P, await dia(0));
    expect(r.detalle.map((d) => d.payment_id)).not.toContain(COBRO);
    expect(r.fallidas.find((f) => f.payment_id === COBRO)?.error).toMatch(/Posible duplicada de la factura/);
    const cola = await INV.listPagosSinFactura(P);
    expect(cola.map((c) => c.payment_id)).toContain(COBRO);
  });

  it('el camino automatico (emitirFacturaDePago sin confirmar) tampoco', async () => {
    await expect(INV.emitirFacturaDePago(VENTA, { paymentId: COBRO, importe: 70 }))
      .rejects.toMatchObject({ code: 'POSIBLE_DUPLICADA' });
  });

  it('desde la cola, quien factura lo confirma y sale', async () => {
    const sin = await request.post('/api/invoices/cola/generar').set(como(SUPER))
      .send({ projectId: P, paymentId: COBRO, forzar: true });
    expect(sin.status).toBe(409);
    expect(sin.body.code).toBe('POSIBLE_DUPLICADA');

    const con = await request.post('/api/invoices/cola/generar').set(como(SUPER))
      .send({ projectId: P, paymentId: COBRO, forzar: true, confirmar_duplicada: true });
    expect(con.status, JSON.stringify(con.body)).toBe(200);
    expect(con.body.data.payment_id).toBe(COBRO);
    const cola = await INV.listPagosSinFactura(P);
    expect(cola.map((c) => c.payment_id)).not.toContain(COBRO);
  });
});
