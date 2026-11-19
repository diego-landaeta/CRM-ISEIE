import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Cambiar la fecha de una factura EMITIDA (Diego, 19/11/2026: «habilita la
 * edición para que puedan editar las fechas»).
 *
 * La #793 cerró las emitidas a todo cambio, también la fecha. Se abren SOLO las
 * fechas, con el permiso «Cambiar fechas» (admin y superadmin de serie), y la de
 * emisión solo en su sitio de la serie: entre la del número anterior y la del
 * siguiente. Lo demás (importe, número, cliente) sigue cerrado. Cada cambio
 * queda apuntado: quién, cuándo, de qué fecha a cuál.
 *
 *   npx vitest run tests/facturasCambiarFecha.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/invoices/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { motivoFechaFueraDeOrden } = await import('../src/modules/invoices/invoices.orden.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `CF${Date.now().toString(36)}`;
const SERIE = `F${Date.now().toString(36).slice(-6)}`;
const ANO = new Date().getFullYear();
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [] };
let P; let ADMIN; let GESTORA; let GESTORA_FECHAS;
let F10; let F11; let F12;

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const factura = (id) => one('SELECT *, fecha_emision::text AS fe FROM invoices WHERE id = $1', [id]);
const dia = (d) => `${ANO}-03-${String(d).padStart(2, '0')}`;

async function nueva(numero, fecha) {
  const r = await one(
    `INSERT INTO invoices (project_id, ano, serie, numero, codigo, tipo, estado, fecha_emision,
                           cliente_nombre, cliente_nif, cliente_direccion, cliente_ciudad, cliente_cp, cliente_pais,
                           items, base_imponible, iva_pct, iva_importe, total)
     VALUES ($1, $2, $3, $4, $5, 'normal', 'emitida', $6::date, $7, 'X1234567L', 'Calle 1', 'Madrid', '28001', 'España',
             '[{"descripcion":"Curso","cantidad":1,"precio_unitario":100}]'::jsonb, 100, 0, 0, 100)
     RETURNING id`,
    [P, ANO, SERIE, numero, `${ANO}/${String(numero).padStart(4, '0')}`, fecha, `${MARCA} Cliente`]);
  return r.id;
}

beforeAll(async () => {
  P = (await one(
    `INSERT INTO projects (nombre, slug, webhook_api_key, factura_serie_default) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`${MARCA} campus`, `${MARCA.toLowerCase()}-a`, `${MARCA}-k`, SERIE])).id;
  ids.projects.push(P);
  const persona = async (n, role, extra = '') => {
    const u = await one(`INSERT INTO users (nombre, email, password_hash, role${extra ? ', editar_fechas_factura' : ''})
                         VALUES ($1, $2, 'x', $3${extra ? ', true' : ''}) RETURNING id, role`,
      [`${MARCA} ${n}`, `${n}@${MARCA.toLowerCase()}.test`, role]);
    ids.users.push(u.id);
    await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, P]);
    return u;
  };
  ADMIN = await persona('admin', 'admin');
  GESTORA = await persona('gestora', 'gestor');
  GESTORA_FECHAS = await persona('gestorafechas', 'gestor', 'si');
  // La casilla de antes vive como excepción del catálogo (#423, migración 222).
  await q(`INSERT INTO user_permission_overrides (user_id, resource, action, allowed)
           VALUES ($1, 'facturas', 'editar_fechas', true)`, [GESTORA_FECHAS.id]);

  // La serie: la 10 del 05/03, la 11 del 09/03 (mal puesta) y la 12 del 07/03.
  F10 = await nueva(10, dia(5));
  F11 = await nueva(11, dia(9));
  F12 = await nueva(12, dia(7));
  // Una gestora solo toca las suyas: la 11 la hizo la de la casilla, la 12 la otra.
  await q('UPDATE invoices SET created_by = $2 WHERE id = $1', [F11, GESTORA_FECHAS.id]);
  await q('UPDATE invoices SET created_by = $2 WHERE id = $1', [F12, GESTORA.id]);
}, 60000);

afterAll(async () => {
  for (const [sql, v] of [
    ['DELETE FROM user_permission_overrides WHERE user_id = ANY($1::int[])', ids.users],
    ['DELETE FROM invoices WHERE project_id = ANY($1::int[])', ids.projects],
    ['DELETE FROM user_projects WHERE user_id = ANY($1::int[])', ids.users],
    ['DELETE FROM users WHERE id = ANY($1::int[])', ids.users],
    ['DELETE FROM projects WHERE id = ANY($1::int[])', ids.projects],
  ]) {
    try { await q(sql, [v]); } catch { /* sigue limpiando */ }
  }
  await pool.end();
}, 60000);

describe('la regla del orden, sola', () => {
  const limites = { ano: 2026, anterior: { codigo: '2026/0294', fecha: '2026-11-16' }, siguiente: { codigo: '2026/0296', fecha: '2026-11-16' } };
  it('dentro del rango (incluidos los extremos), vale', () => {
    expect(motivoFechaFueraDeOrden('2026-11-16', limites)).toBeNull();
  });
  it('fuera, dice entre qué fechas puede ir', () => {
    const m = motivoFechaFueraDeOrden('2026-11-19', limites);
    expect(m).toContain('entre el 16/11/2026 (2026/0294) y el 16/11/2026 (2026/0296)');
  });
  it('otro año, no', () => {
    expect(motivoFechaFueraDeOrden('2025-12-31', { ano: 2026 })).toMatch(/2026/);
  });
});

describe('cambiar la fecha de una emitida', () => {
  it('con el permiso, dentro de su sitio: cambia, y queda quién y de qué a qué', async () => {
    const r = await request.patch(`/api/invoices/${F11}/fechas`).set(como(ADMIN)).send({ fechaEmision: dia(6) });
    expect(r.status).toBe(200);
    expect((await factura(F11)).fe).toBe(dia(6));
    const [c] = await q(`SELECT user_id, fecha_emision_antes::text AS antes, fecha_emision_despues::text AS despues
                           FROM invoice_cambios_fecha WHERE invoice_id = $1`, [F11]);
    expect(c).toEqual({ user_id: ADMIN.id, antes: dia(9), despues: dia(6) });
  });

  it('fuera de su sitio: 409, dice entre qué fechas, y no cambia', async () => {
    const r = await request.patch(`/api/invoices/${F11}/fechas`).set(como(ADMIN)).send({ fechaEmision: dia(20) });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('FECHA_FUERA_DE_ORDEN');
    expect(r.body.error).toContain(`entre el 05/03/${ANO} (${ANO}/0010) y el 07/03/${ANO} (${ANO}/0012)`);
    expect((await factura(F11)).fe).toBe(dia(6));
  });

  it('antes que la anterior, tampoco', async () => {
    const r = await request.patch(`/api/invoices/${F11}/fechas`).set(como(ADMIN)).send({ fechaEmision: dia(1) });
    expect(r.status).toBe(409);
  });

  it('la casilla «solo fechas» de una gestora también vale', async () => {
    const r = await request.patch(`/api/invoices/${F11}/fechas`).set(como(GESTORA_FECHAS)).send({ fechaEmision: dia(7) });
    expect(r.status).toBe(200);
    expect((await factura(F11)).fe).toBe(dia(7));
  });

  it('sin el permiso, aunque la factura sea suya: 403', async () => {
    const r = await request.patch(`/api/invoices/${F12}/fechas`).set(como(GESTORA)).send({ fechaEmision: dia(8) });
    expect(r.status).toBe(403);
    expect((await factura(F12)).fe).toBe(dia(7));
  });

  it('por aquí no cambia el importe, y por la edición general sigue cerrada', async () => {
    let r = await request.patch(`/api/invoices/${F11}/fechas`).set(como(ADMIN))
      .send({ fechaEmision: dia(6), total: 1, numero: 99 });
    expect(r.status).toBe(200);
    const f = await factura(F11);
    expect(Number(f.total)).toBe(100);
    expect(f.numero).toBe(11);
    r = await request.patch(`/api/invoices/${F11}`).set(como(ADMIN)).send({ total: 1 });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('FACTURA_EMITIDA');
    expect(Number((await factura(F11)).total)).toBe(100);
  });

  it('la ficha dice el rango y el historial', async () => {
    const r = await request.get(`/api/invoices/${F11}/fechas`).set(como(GESTORA_FECHAS));
    expect(r.status).toBe(200);
    expect(r.body.data.desde).toBe(dia(5));
    expect(r.body.data.hasta).toBe(dia(7));
    expect(r.body.data.historial.length).toBeGreaterThanOrEqual(3);
    expect(r.body.data.historial[0].usuario).toBe(`${MARCA} admin`);
  });
});
