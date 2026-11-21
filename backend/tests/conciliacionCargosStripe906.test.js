import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * CRM#906 · Finanzas › Conciliación › Cargos de Stripe.
 *
 * Diego, 18/11: en el 360 había 334 cargos de Stripe cobrados sin ningún cobro
 * del CRM; se enlazaron 88 a mano y quedan unos 246 (unos 62.000 €), algunos de
 * alumnos sin venta. Esto lo tiene que poder hacer administración desde el CRM:
 * ver cada cargo con su cobro candidato, enlazarlo (la ruta de #892), apuntarlo
 * en la venta del alumno o crear la venta desde el cargo.
 *
 * Stripe no se toca: los cargos se insertan en la base como los deja el sondeo.
 *
 *   DATABASE_URL=... node scripts/db-preparar.mjs --datos
 *   npx vitest run tests/conciliacionCargosStripe906.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { default: modulo } = await import('../src/modules/stripe-payments/index.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `C906${Date.now().toString(36)}`;
const marca = MARCA.toLowerCase();
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [], leads: [], products: [] };
let MIO; let AJENO; let SUPER; let ADMIN; let GESTORA; let VENDEDORA; let PROGRAMA;
const c = {}; // los cargos, por nombre
const cp = {}; // los cobros, por nombre
const v = {}; // las ventas, por nombre

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const cargo = (id) => one('SELECT * FROM stripe_payments WHERE id = $1', [id]);
const lista = (u, qs = `projectId=${MIO}&mes=2026-10`) => request.get(`/api/stripe-payments/conciliacion?${qs}`).set(como(u));
const fila = (body, id) => body.data.cargos.find((x) => x.id === id);

async function alumno(p, nombre, email) {
  const l = await one(`INSERT INTO leads (project_id, nombre, email, status) VALUES ($1, $2, $3, 'convertido') RETURNING id`, [p, nombre, email]);
  ids.leads.push(l.id);
  return l.id;
}
async function venta(p, leadId, total, producto = null) {
  return one(`INSERT INTO conversions (lead_id, project_id, producto_contratado, producto_contratado_id, importe_total, importe_pagado, fecha_conversion)
              VALUES ($1, $2, $3, $4, $5, 0, '2026-09-01') RETURNING id`, [leadId, p, `${MARCA} Máster`, producto, total]);
}
const cobro = (conversionId, importe, fecha, extra = {}) => one(
  `INSERT INTO conversion_payments (conversion_id, importe, fecha, metodo, origen, origen_ref)
   VALUES ($1, $2, $3, 'tarjeta', $4, $5) RETURNING id`,
  [conversionId, importe, fecha, extra.origen ?? null, extra.origen ? `${MARCA}-${Math.random()}` : null]);
const nuevoCargo = (p, nombre, importe, fecha, { email = null, cliente = null, conversionId = null, cobroId = null, status = 'succeeded' } = {}) => one(
  `INSERT INTO stripe_payments (project_id, stripe_id, type, status, amount, currency, customer_email, customer_name, stripe_created_at, conversion_id, conversion_payment_id)
   VALUES ($1, $2, 'charge', $3, $4, 'EUR', $5, $6, ($7::date + interval '12 hours'), $8, $9) RETURNING id`,
  [p, `ch_${MARCA}_${nombre}`, status, importe, email, cliente, fecha, conversionId, cobroId]).then((r) => r.id);

beforeAll(async () => {
  const campus = async (n) => {
    const p = await one(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
      [`${MARCA} ${n}`, `${marca}-${n}`, `${MARCA}-k-${n}`]);
    ids.projects.push(p.id);
    return p.id;
  };
  MIO = await campus('mio'); AJENO = await campus('ajeno');
  const persona = async (n, role, suyos) => {
    const u = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
      [`${MARCA} ${n}`, `${n}@${marca}.test`, role]);
    ids.users.push(u.id);
    for (const p of suyos) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, p]);
    return u;
  };
  SUPER = await persona('super', 'superadmin', []);
  ADMIN = await persona('admin', 'admin', [MIO]);
  GESTORA = await persona('gestora', 'gestor', [MIO]);
  VENDEDORA = await persona('vendedora', 'gestor', [MIO]);
  PROGRAMA = (await one(`INSERT INTO products (project_id, nombre, precio) VALUES ($1, $2, 900) RETURNING id`, [MIO, `${MARCA} Máster en Psicología`])).id;
  ids.products.push(PROGRAMA);

  // A: el caso de libro. Mismo correo, mismo importe, dos días de diferencia: SEGURO.
  const ana = await alumno(MIO, 'Ana Martín', `ana@${marca}.test`);
  v.ana = await venta(MIO, ana, 1200);
  cp.ana = await cobro(v.ana.id, 100, '2026-10-03');
  c.ana = await nuevoCargo(MIO, 'ana', 100, '2026-10-05', { email: `ANA@${marca}.test `, cliente: 'Ana M.' });

  // B: sin correo en el cargo; casa por el nombre («Luis Pérez» empieza el de Stripe) y 40 céntimos.
  const luis = await alumno(MIO, 'Luis Pérez', `luis.otro@${marca}.test`);
  v.luis = await venta(MIO, luis, 600);
  cp.luis = await cobro(v.luis.id, 200, '2026-10-10');
  c.luis = await nuevoCargo(MIO, 'luis', 200.4, '2026-10-11', { cliente: 'LUIS PEREZ GARCIA' });

  // C y D: dos cargos de 50 € de la misma alumna la misma semana y un solo cobro. Ninguno es seguro.
  const eva = await alumno(MIO, 'Eva Ruiz', `eva@${marca}.test`);
  v.eva = await venta(MIO, eva, 500);
  cp.eva = await cobro(v.eva.id, 50, '2026-10-20');
  c.eva1 = await nuevoCargo(MIO, 'eva1', 50, '2026-10-19', { email: `eva@${marca}.test` });
  c.eva2 = await nuevoCargo(MIO, 'eva2', 50, '2026-10-22', { email: `eva@${marca}.test` });

  // E: el alumno tiene venta, pero su cobro no está apuntado: «Apuntar el cobro en esa venta».
  const raul = await alumno(MIO, 'Raúl Gómez', `raul@${marca}.test`);
  v.raul = await venta(MIO, raul, 900);
  // Un cobro que entró por PayPal, del mismo importe y día: no es de Stripe y no se ofrece.
  cp.raulPaypal = await cobro(v.raul.id, 300, '2026-10-15', { origen: 'paypal' });
  c.raul = await nuevoCargo(MIO, 'raul', 300, '2026-10-15', { email: `raul@${marca}.test` });

  // F: nadie en el CRM. «Crear la venta».
  c.nadie = await nuevoCargo(MIO, 'nadie', 150, '2026-10-25', { email: `nueva@${marca}.test`, cliente: 'Marta Nueva' });

  // G: alumna con venta de ESE programa: crear otra da el aviso de venta repetida (CRM#898).
  const sara = await alumno(MIO, 'Sara León', `sara@${marca}.test`);
  v.sara = await venta(MIO, sara, 900, PROGRAMA);
  c.sara = await nuevoCargo(MIO, 'sara', 75, '2026-10-28', { email: `sara@${marca}.test` });

  // Lo que NO sale: un cobro ya enlazado con otro cargo, un cargo fallido, uno de otro mes y uno de otro campus.
  const tom = await alumno(MIO, 'Tomás Gil', `tom@${marca}.test`);
  v.tom = await venta(MIO, tom, 400);
  cp.tom = await cobro(v.tom.id, 80, '2026-10-08');
  c.tomEnlazado = await nuevoCargo(MIO, 'tomok', 80, '2026-10-08', { email: `tom@${marca}.test`, conversionId: v.tom.id, cobroId: cp.tom.id });
  c.tomSuelto = await nuevoCargo(MIO, 'tomsuelto', 80, '2026-10-09', { email: `tom@${marca}.test` });
  c.fallido = await nuevoCargo(MIO, 'fallido', 100, '2026-10-05', { email: `ana@${marca}.test`, status: 'failed' });
  c.otroMes = await nuevoCargo(MIO, 'otromes', 100, '2026-11-05', { email: `ana@${marca}.test` });
  const ajena = await alumno(AJENO, 'Ana Martín', `ana@${marca}.test`);
  v.ajena = await venta(AJENO, ajena, 100);
  cp.ajena = await cobro(v.ajena.id, 100, '2026-10-05');
  c.ajeno = await nuevoCargo(AJENO, 'ajeno', 100, '2026-10-05', { email: `ana@${marca}.test` });
}, 60000);

afterAll(async () => {
  const ventas = `SELECT id FROM conversions WHERE project_id = ANY($1::int[])`;
  for (const [sql, val] of [
    ['DELETE FROM stripe_payments WHERE project_id = ANY($1::int[])', ids.projects],
    [`DELETE FROM invoices WHERE conversion_id IN (${ventas})`, ids.projects],
    [`DELETE FROM conversion_installments WHERE conversion_id IN (${ventas})`, ids.projects],
    [`DELETE FROM conversion_payments WHERE conversion_id IN (${ventas})`, ids.projects],
    [`DELETE FROM conversion_items WHERE conversion_id IN (${ventas})`, ids.projects],
    ['DELETE FROM conversions WHERE project_id = ANY($1::int[])', ids.projects],
    ['DELETE FROM lead_status_history WHERE lead_id IN (SELECT id FROM leads WHERE project_id = ANY($1::int[]))', ids.projects],
    ['DELETE FROM lead_interactions WHERE lead_id IN (SELECT id FROM leads WHERE project_id = ANY($1::int[]))', ids.projects],
    ['DELETE FROM notifications WHERE user_id = ANY($1::int[])', ids.users],
    ['DELETE FROM leads WHERE project_id = ANY($1::int[])', ids.projects],
    ['DELETE FROM products WHERE id = ANY($1::int[])', ids.products],
    ['DELETE FROM user_projects WHERE user_id = ANY($1::int[])', ids.users],
    ['DELETE FROM users WHERE id = ANY($1::int[])', ids.users],
    ['DELETE FROM projects WHERE id = ANY($1::int[])', ids.projects],
  ]) {
    try { await q(sql, [val]); } catch { /* sigue limpiando */ }
  }
  await pool.end();
}, 60000);

describe('#906 · la lista: cada cargo sin enlazar con su cobro candidato', () => {
  it('saca los cargos cobrados sin cobro del campus y del mes, y nada más', async () => {
    const r = await lista(ADMIN);
    expect(r.status).toBe(200);
    const vistos = r.body.data.cargos.map((x) => x.id);
    expect(vistos).toEqual(expect.arrayContaining([c.ana, c.luis, c.eva1, c.eva2, c.raul, c.nadie, c.sara, c.tomSuelto]));
    expect(vistos).not.toContain(c.tomEnlazado); // ya tiene su cobro
    expect(vistos).not.toContain(c.fallido); // no se cobró
    expect(vistos).not.toContain(c.otroMes);
    expect(vistos).not.toContain(c.ajeno);
    // El mes de al lado sale en el selector, con su recuento.
    expect(r.body.data.meses).toEqual(expect.arrayContaining([
      expect.objectContaining({ mes: '2026-11', cargos: 1, importe: 100 }),
      expect.objectContaining({ mes: '2026-10', cargos: 8 }),
    ]));
  });

  it('mismo correo (sin mirar mayúsculas ni espacios), importe y fecha a dos días: un candidato y «seguro»', async () => {
    const a = fila((await lista(ADMIN)).body, c.ana);
    expect(a.cobros.map((x) => x.id)).toEqual([cp.ana.id]);
    expect(a.cobros[0]).toMatchObject({ conversion_id: v.ana.id, por: 'correo', importe: 100, fecha: '2026-10-03' });
    expect(a).toMatchObject({ seguro: true, sugerencia: 'enlazar', importe: 100, fecha: '2026-10-05' });
  });

  it('sin correo en el cargo casa por el nombre (sin tildes; uno empieza por el otro) con céntimos de diferencia', async () => {
    const l = fila((await lista(ADMIN)).body, c.luis);
    expect(l.cobros).toHaveLength(1);
    expect(l.cobros[0]).toMatchObject({ id: cp.luis.id, por: 'nombre' });
    expect(l.seguro).toBe(true);
  });

  it('dos cargos y un solo cobro: los dos lo ven y ninguno es seguro', async () => {
    const body = (await lista(ADMIN)).body;
    for (const id of [c.eva1, c.eva2]) {
      const e = fila(body, id);
      expect(e.cobros.map((x) => x.id)).toEqual([cp.eva.id]);
      expect(e.cobros[0].otrosCargos).toBe(1);
      expect(e.seguro).toBe(false);
    }
  });

  it('un cobro que entró por PayPal no se ofrece; con venta y sin cobro, «apuntar»', async () => {
    const e = fila((await lista(ADMIN)).body, c.raul);
    expect(e.cobros).toEqual([]);
    expect(e.sugerencia).toBe('apuntar');
    expect(e.ventas[0]).toMatchObject({ id: v.raul.id, por: 'correo', total: 900, pendiente: 600 });
  });

  it('un cobro que ya tiene otro cargo no se ofrece; sin venta ni ficha, «crear»', async () => {
    const body = (await lista(ADMIN)).body;
    expect(fila(body, c.tomSuelto).cobros).toEqual([]);
    const n = fila(body, c.nadie);
    expect(n).toMatchObject({ sugerencia: 'crear', ventas: [], ficha: null, customer_name: 'Marta Nueva' });
  });

  it('el resumen cuenta lo que hay en la lista', async () => {
    const { resumen } = (await lista(ADMIN)).body.data;
    expect(resumen).toMatchObject({ cargos: 8, seguros: 2, importeSeguros: 300.4, conCobro: 4, sinVenta: 1 });
  });
});

describe('#906 · quién', () => {
  it('sin `stripe.edit` (una gestora), 403', async () => {
    expect((await lista(GESTORA)).status).toBe(403);
  });

  it('un admin no ve otro campus ni pidiéndolo; sin pedir nada, solo los suyos', async () => {
    expect((await lista(ADMIN, `projectId=${AJENO}&mes=2026-10`)).status).toBe(403);
    const todos = await lista(ADMIN, 'mes=2026-10');
    expect(todos.body.data.cargos.map((x) => x.id)).not.toContain(c.ajeno);
    const sa = await lista(SUPER, `projectId=${AJENO}&mes=2026-10`);
    expect(sa.body.data.cargos.map((x) => x.id)).toEqual([c.ajeno]);
  });

  it('un mes mal escrito es un 400', async () => {
    expect((await lista(ADMIN, `projectId=${MIO}&mes=octubre`)).status).toBe(400);
  });

  it('crear la venta con un cargo de otro campus: 404, como si no existiera', async () => {
    const r = await request.post(`/api/stripe-payments/${c.ajeno}/crear-venta`).set(como(ADMIN))
      .send({ productoId: PROGRAMA, vendedoraId: VENDEDORA.id });
    expect(r.status).toBe(404);
  });

  it('«Enlazar todos los seguros» en un campus ajeno: 403', async () => {
    const r = await request.post('/api/stripe-payments/conciliacion/enlazar-seguros').set(como(ADMIN))
      .send({ projectId: AJENO, mes: '2026-10' });
    expect(r.status).toBe(403);
  });
});

describe('#906 · enlazar, apuntar y crear', () => {
  it('«Enlazar» un cargo con su cobro (la ruta de #892): queda en ese cobro y sale de la lista', async () => {
    const r = await request.post(`/api/stripe-payments/${c.eva1}/link`).set(como(ADMIN)).send({ conversionPaymentId: cp.eva.id });
    expect(r.status).toBe(200);
    expect(await cargo(c.eva1)).toMatchObject({ conversion_payment_id: cp.eva.id, conversion_id: v.eva.id, link_method: 'manual_cobro' });
    const body = (await lista(ADMIN)).body;
    expect(fila(body, c.eva1)).toBeUndefined();
    // El otro cargo de Eva ya no tiene cobro al que ir.
    expect(fila(body, c.eva2).cobros).toEqual([]);
  });

  it('«Enlazar todos los seguros» enlaza los dos seguros, dice cuántos y por cuánto, y no toca el resto', async () => {
    const r = await request.post('/api/stripe-payments/conciliacion/enlazar-seguros').set(como(ADMIN))
      .send({ projectId: MIO, mes: '2026-10' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ seguros: 2, enlazados: 2, importe: 300.4, fallos: [] });
    expect((await cargo(c.ana)).conversion_payment_id).toBe(cp.ana.id);
    expect((await cargo(c.luis)).conversion_payment_id).toBe(cp.luis.id);
    expect((await cargo(c.eva2)).conversion_payment_id).toBeNull();
    // Sin crear cobros: los dos cobros siguen siendo los que había.
    expect((await q('SELECT COUNT(*)::int AS n FROM conversion_payments WHERE conversion_id = ANY($1::int[])', [[v.ana.id, v.luis.id]]))[0].n).toBe(2);
  });

  it('«Apuntar el cobro en esa venta»: crea el cobro con el importe y la fecha del cargo y lo enlaza', async () => {
    const r = await request.post(`/api/stripe-payments/${c.raul}/link`).set(como(ADMIN))
      .send({ conversionId: v.raul.id, leadId: (await one('SELECT lead_id FROM conversions WHERE id = $1', [v.raul.id])).lead_id });
    expect(r.status).toBe(200);
    const k = await cargo(c.raul);
    expect(k.conversion_id).toBe(v.raul.id);
    const nuevo = await one('SELECT importe::float8 AS importe, fecha::text AS fecha, notas FROM conversion_payments WHERE id = $1', [k.conversion_payment_id]);
    expect(nuevo).toMatchObject({ importe: 300, fecha: '2026-10-15' });
    expect(nuevo.notas).toContain(`ch_${MARCA}_raul`);
  });

  it('opciones para crear la venta: los programas y las vendedoras del campus', async () => {
    const r = await request.get(`/api/stripe-payments/conciliacion/opciones?projectId=${MIO}`).set(como(ADMIN));
    expect(r.status).toBe(200);
    expect(r.body.data.productos.map((p) => p.id)).toContain(PROGRAMA);
    expect(r.body.data.vendedoras.map((u) => u.id)).toEqual(expect.arrayContaining([VENDEDORA.id, GESTORA.id, ADMIN.id]));
  });

  it('«Crear la venta» sin programa ni vendedora: 400, y el cargo sigue igual', async () => {
    const r = await request.post(`/api/stripe-payments/${c.nadie}/crear-venta`).set(como(ADMIN)).send({});
    expect(r.status).toBe(400);
    expect((await cargo(c.nadie)).conversion_id).toBeNull();
  });

  it('«Crear la venta» de un cargo sin venta: ficha nueva de la vendedora, venta con el importe y su cobro enlazado', async () => {
    const r = await request.post(`/api/stripe-payments/${c.nadie}/crear-venta`).set(como(ADMIN))
      .send({ productoId: PROGRAMA, vendedoraId: VENDEDORA.id });
    expect(r.status).toBe(201);
    const k = await cargo(c.nadie);
    expect(k.conversion_id).toBe(r.body.data.conversionId);
    expect(k.conversion_payment_id).toBe(r.body.data.conversionPaymentId);
    expect(k.link_method).toBe('manual');
    const venta = await one(
      `SELECT c.importe_total::float8 AS total, c.fecha_conversion::text AS fecha, c.vendedora_id, c.producto_contratado_id,
              l.nombre, l.email, l.responsable_id, l.project_id,
              (SELECT COALESCE(SUM(importe), 0)::float8 FROM conversion_payments WHERE conversion_id = c.id) AS cobrado
         FROM conversions c JOIN leads l ON l.id = c.lead_id WHERE c.id = $1`, [k.conversion_id]);
    expect(venta).toMatchObject({
      total: 150, cobrado: 150, fecha: '2026-10-25', vendedora_id: VENDEDORA.id, producto_contratado_id: PROGRAMA,
      nombre: 'Marta Nueva', email: `nueva@${marca}.test`, responsable_id: VENDEDORA.id, project_id: MIO,
    });
    // Otra vez el mismo cargo: ya está enlazado.
    const otra = await request.post(`/api/stripe-payments/${c.nadie}/crear-venta`).set(como(ADMIN))
      .send({ productoId: PROGRAMA, vendedoraId: VENDEDORA.id });
    expect(otra.status).toBe(409);
    expect(otra.body.code).toBe('CARGO_YA_ENLAZADO');
  });

  it('venta repetida (#898): 409 con la que existe y el cargo suelto; con «forzar» se crea', async () => {
    const r = await request.post(`/api/stripe-payments/${c.sara}/crear-venta`).set(como(ADMIN))
      .send({ productoId: PROGRAMA, vendedoraId: VENDEDORA.id });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('VENTA_YA_EXISTE');
    const suelto = await cargo(c.sara);
    expect(suelto).toMatchObject({ conversion_id: null, conversion_payment_id: null });
    // La reserva se suelta: el sondeo (o el siguiente clic) lo puede enlazar ya.
    expect(suelto.link_method).toBeNull();
    const ventasAntes = (await one('SELECT COUNT(*)::int AS n FROM conversions WHERE project_id = $1', [MIO])).n;
    const f = await request.post(`/api/stripe-payments/${c.sara}/crear-venta`).set(como(ADMIN))
      .send({ productoId: PROGRAMA, vendedoraId: VENDEDORA.id, importeTotal: 900, forzar: true });
    expect(f.status).toBe(201);
    expect((await one('SELECT COUNT(*)::int AS n FROM conversions WHERE project_id = $1', [MIO])).n).toBe(ventasAntes + 1);
    const nueva = await one('SELECT importe_total::float8 AS total, repetida_de, lead_id FROM conversions WHERE id = $1', [f.body.data.conversionId]);
    expect(nueva).toMatchObject({ total: 900, repetida_de: v.sara.id });
    // En la ficha que ya tenía, no en otra.
    expect(nueva.lead_id).toBe((await one('SELECT lead_id FROM conversions WHERE id = $1', [v.sara.id])).lead_id);
  });

  it('un total menor que lo cobrado en Stripe es un 400', async () => {
    const r = await request.post(`/api/stripe-payments/${c.eva2}/crear-venta`).set(como(ADMIN))
      .send({ productoId: PROGRAMA, vendedoraId: VENDEDORA.id, importeTotal: 10 });
    expect(r.status).toBe(400);
  });

  it('sin `stripe.edit` (una gestora, que sí registra ventas), crear la venta desde el cargo da 403', async () => {
    const r = await request.post(`/api/stripe-payments/${c.eva2}/crear-venta`).set(como(GESTORA))
      .send({ productoId: PROGRAMA, vendedoraId: VENDEDORA.id });
    expect(r.status).toBe(403);
  });
});
