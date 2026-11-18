import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * ISEIE#478 (gemela de CRM#793) · Una factura EMITIDA no se borra ni se cambia (Diego, 18/11/2026).
 *
 * Hasta ahora se podía borrar una emitida (y su número quedaba libre), cambiarle
 * el importe, el IVA y el cliente con «Corregir», el número, y las fechas. Desde
 * hoy esas rutas responden 409 FACTURA_EMITIDA. Si hay que dejarla sin efecto,
 * se ANULA con su motivo: queda quién y por qué, y sale su rectificativa.
 * Borradores y proformas, como siempre.
 *
 *   npx vitest run tests/facturasEmitidas478.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/invoices/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `FE793${Date.now().toString(36)}`;
// La serie cabe en 10 caracteres, también la de su abono («R» delante).
const SERIE = `E${Date.now().toString(36).slice(-6)}`;
const SERIE_PRO = `P${Date.now().toString(36).slice(-6)}`;
const ANO = new Date().getFullYear();
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [] };
let P; let ADMIN; let GESTORA;
let EMITIDA; let EMITIDA_SIN_NIF; let EMITIDA_4; let BORRADOR; let PROFORMA;

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const factura = (id) => one('SELECT * FROM invoices WHERE id = $1', [id]);
const abonosDe = (id) => q(`SELECT * FROM invoices WHERE rectifica_id = $1 AND tipo = 'rectificativa'`, [id]);

async function nueva({ numero, serie = SERIE, estado = 'emitida', tipo = 'normal', nif = 'X1234567L', total = 121, prefijo = '' }) {
  const r = await one(
    `INSERT INTO invoices (project_id, ano, serie, numero, codigo, tipo, estado, fecha_emision,
                           cliente_nombre, cliente_nif, cliente_direccion, cliente_ciudad, cliente_cp, cliente_pais,
                           items, base_imponible, iva_pct, iva_importe, total)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE, $8, $9, 'Calle 1', 'Madrid', '28001', 'España',
             '[{"descripcion":"Curso","cantidad":1,"precio_unitario":100}]'::jsonb, 100, 21, 21, $10)
     RETURNING id`,
    [P, ANO, serie, numero, numero == null ? null : `${prefijo}${ANO}/${String(numero).padStart(4, '0')}`,
     tipo, estado, `${MARCA} Cliente`, nif, total]);
  return r.id;
}

beforeAll(async () => {
  P = (await one(
    `INSERT INTO projects (nombre, slug, webhook_api_key, factura_serie_default) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`${MARCA} campus`, `${MARCA.toLowerCase()}-a`, `${MARCA}-k`, SERIE])).id;
  ids.projects.push(P);
  const persona = async (n, role) => {
    const u = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
      [`${MARCA} ${n}`, `${n}@${MARCA.toLowerCase()}.test`, role]);
    ids.users.push(u.id);
    await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, P]);
    return u;
  };
  ADMIN = await persona('admin', 'admin');
  GESTORA = await persona('gestora', 'gestor');

  // La serie: 1, 2 y 4. Falta la 3.
  EMITIDA = await nueva({ numero: 1, estado: 'pagada' });
  EMITIDA_SIN_NIF = await nueva({ numero: 2, nif: '—' });
  EMITIDA_4 = await nueva({ numero: 4 });
  BORRADOR = await nueva({ numero: null, estado: 'borrador' });
  // El código es único por campus: la proforma numera «PRO-2026/0001», como en la serie PRO.
  PROFORMA = await nueva({ numero: 1, serie: SERIE_PRO, tipo: 'proforma', prefijo: 'PRO-' });
}, 60000);

afterAll(async () => {
  for (const [sql, v] of [
    ['UPDATE invoices SET anulada_abono_id = NULL WHERE project_id = ANY($1::int[])', ids.projects],
    ['DELETE FROM invoices WHERE project_id = ANY($1::int[]) AND rectifica_id IS NOT NULL', ids.projects],
    ['DELETE FROM invoices WHERE project_id = ANY($1::int[])', ids.projects],
    ['DELETE FROM invoice_sequences WHERE project_id = ANY($1::int[])', ids.projects],
    ['DELETE FROM user_projects WHERE user_id = ANY($1::int[])', ids.users],
    ['DELETE FROM users WHERE id = ANY($1::int[])', ids.users],
    ['DELETE FROM projects WHERE id = ANY($1::int[])', ids.projects],
  ]) {
    try { await q(sql, [v]); } catch { /* sigue limpiando */ }
  }
  await pool.end();
}, 60000);

describe('#793 · una emitida no se borra ni se cambia', () => {
  it('borrarla: 409 FACTURA_EMITIDA y sigue ahí, con su número', async () => {
    const r = await request.delete(`/api/invoices/${EMITIDA_4}`).set(como(ADMIN));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('FACTURA_EMITIDA');
    expect((await factura(EMITIDA_4))?.numero).toBe(4);
  });

  it('corregirla (importe, IVA, cliente): 409 y nada cambia', async () => {
    const r = await request.patch(`/api/invoices/${EMITIDA}/corregir`).set(como(ADMIN)).send({
      clienteNombre: 'Otro cliente', items: [{ descripcion: 'Curso', cantidad: 1, precio_unitario: 1 }], ivaPct: 0,
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('FACTURA_EMITIDA');
    const f = await factura(EMITIDA);
    expect(Number(f.total)).toBe(121);
    expect(f.cliente_nombre).toBe(`${MARCA} Cliente`);
  });

  it('cambiarle el número: 409', async () => {
    const r = await request.patch(`/api/invoices/${EMITIDA_4}`).set(como(ADMIN)).send({ numero: 3 });
    expect(r.status).toBe(409);
    expect((await factura(EMITIDA_4)).numero).toBe(4);
  });

  it('cambiarle las fechas: 409', async () => {
    const antes = (await factura(EMITIDA)).fecha_emision;
    const r = await request.patch(`/api/invoices/${EMITIDA}/fechas`).set(como(ADMIN)).send({ fechaEmision: '2020-01-01' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('FACTURA_EMITIDA');
    expect((await factura(EMITIDA)).fecha_emision).toEqual(antes);
  });

  it('completar datos: lo que falta, sí; cambiar lo que tiene, no', async () => {
    let r = await request.post(`/api/invoices/${EMITIDA_SIN_NIF}/completar-datos`).set(como(ADMIN))
      .send({ clienteNombre: 'Otro cliente' });
    expect(r.status).toBe(409);
    expect((await factura(EMITIDA_SIN_NIF)).cliente_nombre).toBe(`${MARCA} Cliente`);
    r = await request.post(`/api/invoices/${EMITIDA_SIN_NIF}/completar-datos`).set(como(ADMIN))
      .send({ clienteNif: '12345678Z', clienteNombre: `${MARCA} Cliente` });
    expect(r.status).toBe(200);
    expect((await factura(EMITIDA_SIN_NIF)).cliente_nif).toBe('12345678Z');
  });

  it('cancelarla por la vía de los borradores: 409, se anula con su motivo', async () => {
    const r = await request.post(`/api/invoices/${EMITIDA_4}/cancel`).set(como(ADMIN)).send({ motivo: 'Error de carga' });
    expect(r.status).toBe(409);
    expect((await factura(EMITIDA_4)).estado).toBe('emitida');
  });
});

describe('#793 · borradores y proformas, como siempre', () => {
  it('un borrador se borra', async () => {
    const r = await request.delete(`/api/invoices/${BORRADOR}`).set(como(ADMIN));
    expect(r.status).toBe(200);
    expect(await factura(BORRADOR)).toBeUndefined();
  });

  it('una proforma se borra', async () => {
    const r = await request.delete(`/api/invoices/${PROFORMA}`).set(como(ADMIN));
    expect(r.status).toBe(200);
    expect(await factura(PROFORMA)).toBeUndefined();
  });
});

describe('#793 · anular una emitida', () => {
  it('sin motivo: 400 y nada cambia', async () => {
    for (const body of [{}, { motivo: '' }, { motivo: '   ' }]) {
      const r = await request.post(`/api/invoices/${EMITIDA}/anular`).set(como(ADMIN)).send(body);
      expect(r.status).toBe(400);
    }
    expect((await factura(EMITIDA)).anulada_at).toBeNull();
    expect(await abonosDe(EMITIDA)).toHaveLength(0);
  });

  it('una gestora sin el permiso: 403', async () => {
    const r = await request.post(`/api/invoices/${EMITIDA}/anular`).set(como(GESTORA)).send({ motivo: 'Cliente equivocado' });
    expect(r.status).toBe(403);
    expect((await factura(EMITIDA)).anulada_at).toBeNull();
  });

  it('con motivo: queda quién y por qué, y sale su rectificativa por el total', async () => {
    const r = await request.post(`/api/invoices/${EMITIDA}/anular`).set(como(ADMIN)).send({ motivo: 'Cliente equivocado' });
    expect(r.status).toBe(200);
    const f = await factura(EMITIDA);
    expect(f.anulada_at).not.toBeNull();
    expect(f.anulada_por).toBe(ADMIN.id);
    expect(f.motivo_anulacion).toBe('Cliente equivocado');
    // Sigue contando: su abono la deja a cero.
    expect(f.estado).toBe('pagada');
    const [abono] = await abonosDe(EMITIDA);
    expect(abono).toBeDefined();
    expect(Number(abono.total)).toBe(-121);
    expect(abono.motivo_rectificacion).toContain('Cliente equivocado');
    expect(f.anulada_abono_id).toBe(abono.id);
    expect(r.body.data.abono.id).toBe(abono.id);
  });

  it('otra vez: 409 y no sale otro abono; tampoco abonarla a mano', async () => {
    let r = await request.post(`/api/invoices/${EMITIDA}/anular`).set(como(ADMIN)).send({ motivo: 'Otra vez' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('YA_ANULADA');
    r = await request.post(`/api/invoices/${EMITIDA}/rectificar`).set(como(ADMIN)).send({ motivo: 'Otra vez' });
    expect(r.status).toBe(409);
    expect(await abonosDe(EMITIDA)).toHaveLength(1);
    expect((await factura(EMITIDA)).motivo_anulacion).toBe('Cliente equivocado');
  });

  it('el abono no se anula ni se borra', async () => {
    const [abono] = await abonosDe(EMITIDA);
    let r = await request.post(`/api/invoices/${abono.id}/anular`).set(como(ADMIN)).send({ motivo: 'Sobra' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('ABONO_NO_SE_ANULA');
    r = await request.delete(`/api/invoices/${abono.id}`).set(como(ADMIN));
    expect(r.status).toBe(409);
  });

  it('en la lista, la anulada sale con su motivo, quién y su abono', async () => {
    const r = await request.get(`/api/invoices?projectId=${P}&tipo=normal`).set(como(ADMIN));
    expect(r.status).toBe(200);
    const fila = r.body.data.find((f) => f.id === EMITIDA);
    expect(fila.motivo_anulacion).toBe('Cliente equivocado');
    expect(fila.anulada_por_nombre).toBe(`${MARCA} admin`);
    expect(fila.anulada_abono_codigo).toBeTruthy();
  });
});

describe('#793 · el aviso de la numeración', () => {
  it('dice el número que falta y la anulada con su motivo', async () => {
    const r = await request.get(`/api/invoices/siguiente-numero?projectId=${P}`).set(como(ADMIN));
    expect(r.status).toBe(200);
    expect(r.body.data.serie).toBe(SERIE);
    expect(r.body.data.huecos).toEqual([3]);
    expect(r.body.data.anuladas).toEqual([
      expect.objectContaining({ numero: 1, codigo: `${ANO}/0001`, motivo: 'Cliente equivocado' }),
    ]);
  });
});
