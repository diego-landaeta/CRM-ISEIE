import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Un admin de empresa que lleva su empresa entera (Diego, 04/11): «que él pueda
 * poner, quitar y todo eso», pero sin ver nada de otras empresas.
 *
 * Hay permisos que de serie solo trae soporte (que ve el CRM entero) y cuyas
 * rutas no miraban campus: con la excepción dada, el admin habría restaurado
 * prospectos, resuelto avisos de spam, tocado reglas de comisión y configurado
 * campus de CUALQUIER empresa. Ahora, con la excepción, actúa en sus campus y
 * lo de otra empresa es un 404. Superadmin y soporte siguen viéndolo todo.
 *
 * Y el rol soporte no lo da un admin, aunque con excepciones llegue a tener
 * todos los permisos que trae.
 *
 *   npx vitest run tests/adminEmpresaExcepciones.test.js --pool=forks --poolOptions.forks.singleFork=true
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const modulos = await Promise.all([
  import('../src/modules/leads/index.js'),
  import('../src/modules/commissions/index.js'),
  import('../src/modules/projects/index.js'),
]);
const { exigirQueNoDeMasDeLoQueTiene } = await import('../src/modules/permissions/permissions.editar.js');
const { ACCIONES } = await import('../src/modules/permissions/catalogo.js');

const app = express();
app.use(express.json());
for (const { default: m } of modulos) app.use(m.prefix, m.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `AEX${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = (sql, p) => q(sql, p).then((r) => r[0]);
const ids = { users: [], projects: [], leads: [], issuers: [], products: [] };

// Las excepciones que se le dan al admin de empresa (las que se pueden acotar a sus campus).
const EXCEPCIONES = [['leads', 'restaurar'], ['leads', 'spam'], ['projects', 'edit'], ['commissions', 'reglas']];

let MIO; let AJENO; let EMPRESA; let OTRA_EMPRESA;
let SUPER; let SOPORTE; let ADMIN; let ADMIN_SIN; let ADMIN_TODO; let GESTORA;
let PROD_MIO; let PROD_AJENO;

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });

async function persona(n, role, campus = []) {
  const u = await one(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
    [`${MARCA} ${n}`, `${n.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]);
  ids.users.push(u.id);
  for (const c of campus) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
  return u;
}

async function leadBorrado(projectId, n) {
  const l = await one(
    `INSERT INTO leads (project_id, nombre, email, deleted_at, deleted_reason) VALUES ($1, $2, $3, NOW(), 'spam') RETURNING id`,
    [projectId, `${MARCA} ${n}`, `${n}@${MARCA.toLowerCase()}.test`]);
  ids.leads.push(l.id);
  return l.id;
}

async function leadConAviso(projectId, n, quien) {
  const l = await one('INSERT INTO leads (project_id, nombre, email) VALUES ($1, $2, $3) RETURNING id',
    [projectId, `${MARCA} ${n}`, `${n}@${MARCA.toLowerCase()}.test`]);
  ids.leads.push(l.id);
  const r = await one(
    `INSERT INTO lead_spam_reports (lead_id, project_id, reported_by, motivo) VALUES ($1, $2, $3, 'prueba') RETURNING id`,
    [l.id, projectId, quien.id]);
  return r.id;
}

const regla = (projectId, userId, productId) => one(
  `INSERT INTO commission_rules (project_id, user_id, product_id, pct, base_calc) VALUES ($1, $2, $3, 5, 'cobrado') RETURNING id`,
  [projectId, userId, productId]).then((r) => r.id);

beforeAll(async () => {
  EMPRESA = (await one('INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id', [`${MARCA} EMPRESA`, `${MARCA}-E`])).id;
  OTRA_EMPRESA = (await one('INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id', [`${MARCA} OTRA`, `${MARCA}-O`])).id;
  ids.issuers.push(EMPRESA, OTRA_EMPRESA);
  const proy = async (c, issuer) => {
    const p = await one(
      'INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c}`, `${MARCA}-key-${c}`, issuer]);
    ids.projects.push(p.id);
    return p.id;
  };
  MIO = await proy('mio', EMPRESA);
  AJENO = await proy('ajeno', OTRA_EMPRESA);

  SUPER = await persona('Super', 'superadmin');
  SOPORTE = await persona('Soporte', 'soporte');
  ADMIN = await persona('Admin', 'admin', [MIO]);
  ADMIN_SIN = await persona('AdminSin', 'admin', [MIO]);
  ADMIN_TODO = await persona('AdminTodo', 'admin', [MIO]);
  GESTORA = await persona('Gestora', 'gestor', [MIO]);
  for (const [resource, action] of EXCEPCIONES) {
    await q('INSERT INTO user_permission_overrides (user_id, resource, action, allowed) VALUES ($1, $2, $3, true)',
      [ADMIN.id, resource, action]);
  }
  // El peor caso: un admin con TODO el catálogo dado como excepción.
  for (const x of ACCIONES) {
    await q('INSERT INTO user_permission_overrides (user_id, resource, action, allowed) VALUES ($1, $2, $3, true) ON CONFLICT DO NOTHING',
      [ADMIN_TODO.id, x.recurso, x.accion]);
  }

  PROD_MIO = (await one(`INSERT INTO products (project_id, nombre, precio, moneda, active) VALUES ($1, $2, 100, 'EUR', true) RETURNING id`, [MIO, `${MARCA} P1`])).id;
  PROD_AJENO = (await one(`INSERT INTO products (project_id, nombre, precio, moneda, active) VALUES ($1, $2, 100, 'EUR', true) RETURNING id`, [AJENO, `${MARCA} P2`])).id;
  ids.products.push(PROD_MIO, PROD_AJENO);
}, 60000);

afterAll(async () => {
  const intenta = (sql, p) => q(sql, p).catch(() => {});
  await intenta('DELETE FROM commission_rules WHERE project_id = ANY($1::int[])', [ids.projects]);
  await intenta('DELETE FROM lead_spam_reports WHERE project_id = ANY($1::int[])', [ids.projects]);
  await intenta('DELETE FROM lead_interactions WHERE lead_id = ANY($1::int[])', [ids.leads]);
  await intenta('DELETE FROM leads WHERE id = ANY($1::int[])', [ids.leads]);
  await intenta('DELETE FROM products WHERE id = ANY($1::int[])', [ids.products]);
  await intenta('DELETE FROM user_permission_overrides WHERE user_id = ANY($1::int[])', [ids.users]);
  await intenta('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await intenta('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await intenta('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await intenta('DELETE FROM invoice_issuers WHERE id = ANY($1::int[])', [ids.issuers]);
  await pool.end();
}, 60000);

describe('leads.restaurar: solo los prospectos de sus campus', () => {
  it('sin la excepción, 403', async () => {
    const id = await leadBorrado(MIO, 'sin');
    expect((await request.patch(`/api/leads/${id}/restore`).set(como(ADMIN_SIN))).status).toBe(403);
  });

  it('con la excepción, restaura uno de su campus', async () => {
    const id = await leadBorrado(MIO, 'mio');
    const r = await request.patch(`/api/leads/${id}/restore`).set(como(ADMIN));
    expect(r.status).toBe(200);
    expect((await one('SELECT deleted_at FROM leads WHERE id = $1', [id])).deleted_at).toBeNull();
  });

  it('el de otra empresa es un 404 y sigue borrado', async () => {
    const id = await leadBorrado(AJENO, 'ajeno');
    const r = await request.patch(`/api/leads/${id}/restore`).set(como(ADMIN));
    expect(r.status).toBe(404);
    expect((await one('SELECT deleted_at FROM leads WHERE id = $1', [id])).deleted_at).not.toBeNull();
  });

  it('superadmin y soporte restauran en cualquier campus', async () => {
    const a = await leadBorrado(AJENO, 'super');
    const b = await leadBorrado(AJENO, 'soporte');
    expect((await request.patch(`/api/leads/${a}/restore`).set(como(SUPER))).status).toBe(200);
    expect((await request.patch(`/api/leads/${b}/restore`).set(como(SOPORTE))).status).toBe(200);
  });
});

describe('leads.spam: solo los avisos de sus campus', () => {
  let AVISO_MIO; let AVISO_AJENO; let AVISO_AJENO_2;
  beforeAll(async () => {
    AVISO_MIO = await leadConAviso(MIO, 'spammio', GESTORA);
    AVISO_AJENO = await leadConAviso(AJENO, 'spamajeno', SUPER);
    AVISO_AJENO_2 = await leadConAviso(AJENO, 'spamajeno2', SUPER);
  });

  it('la lista y la cuenta, solo los de su campus', async () => {
    const r = await request.get('/api/leads/spam-reports').set(como(ADMIN));
    expect(r.status).toBe(200);
    const vistos = r.body.data.map((x) => x.id);
    expect(vistos).toContain(AVISO_MIO);
    expect(vistos).not.toContain(AVISO_AJENO);
    const c = await request.get('/api/leads/spam-reports/count').set(como(ADMIN));
    expect(c.body.data.count).toBe(1);
  });

  it('resolver el de otra empresa es un 404 y sigue pendiente', async () => {
    const r = await request.patch(`/api/leads/spam-reports/${AVISO_AJENO}`).set(como(ADMIN)).send({ action: 'dismiss' });
    expect(r.status).toBe(404);
    expect((await one('SELECT status FROM lead_spam_reports WHERE id = $1', [AVISO_AJENO])).status).toBe('pending');
  });

  it('el de su campus lo resuelve', async () => {
    const r = await request.patch(`/api/leads/spam-reports/${AVISO_MIO}`).set(como(ADMIN)).send({ action: 'dismiss' });
    expect(r.status).toBe(200);
  });

  it('superadmin y soporte ven y resuelven todos', async () => {
    const vistos = (await request.get('/api/leads/spam-reports').set(como(SUPER))).body.data.map((x) => x.id);
    expect(vistos).toEqual(expect.arrayContaining([AVISO_AJENO, AVISO_AJENO_2]));
    const deSoporte = (await request.get('/api/leads/spam-reports').set(como(SOPORTE))).body.data.map((x) => x.id);
    expect(deSoporte).toContain(AVISO_AJENO_2);
    expect((await request.patch(`/api/leads/spam-reports/${AVISO_AJENO_2}`).set(como(SOPORTE)).send({ action: 'dismiss' })).status).toBe(200);
  });
});

describe('commissions.reglas: solo las reglas de sus campus', () => {
  it('crea una en su campus; en el de otra empresa, 404', async () => {
    const bien = await request.post('/api/commissions/rules').set(como(ADMIN))
      .send({ project_id: MIO, user_id: GESTORA.id, product_id: PROD_MIO, pct: 10 });
    expect(bien.status).toBe(201);
    const mal = await request.post('/api/commissions/rules').set(como(ADMIN))
      .send({ project_id: AJENO, user_id: GESTORA.id, product_id: PROD_AJENO, pct: 10 });
    expect(mal.status).toBe(404);
    expect((await q('SELECT 1 FROM commission_rules WHERE project_id = $1', [AJENO])).length).toBe(0);
  });

  it('cambiar o quitar la de otra empresa es un 404 y no se toca', async () => {
    const id = await regla(AJENO, SUPER.id, PROD_AJENO);
    expect((await request.patch(`/api/commissions/rules/${id}`).set(como(ADMIN)).send({ pct: 50 })).status).toBe(404);
    expect((await request.delete(`/api/commissions/rules/${id}`).set(como(ADMIN))).status).toBe(404);
    const r = await one('SELECT pct FROM commission_rules WHERE id = $1', [id]);
    expect(Number(r.pct)).toBe(5);
  });

  it('la de su campus la cambia', async () => {
    const id = await regla(MIO, ADMIN_SIN.id, PROD_MIO);
    expect((await request.patch(`/api/commissions/rules/${id}`).set(como(ADMIN)).send({ pct: 7 })).status).toBe(200);
  });

  it('superadmin y soporte, en cualquier campus', async () => {
    const id = await regla(AJENO, ADMIN.id, PROD_AJENO);
    expect((await request.patch(`/api/commissions/rules/${id}`).set(como(SUPER)).send({ pct: 6 })).status).toBe(200);
    expect((await request.patch(`/api/commissions/rules/${id}`).set(como(SOPORTE)).send({ pct: 8 })).status).toBe(200);
  });
});

describe('projects.edit: configurar sus campus, no los de otra empresa', () => {
  it('sin la excepción, 403', async () => {
    expect((await request.patch(`/api/projects/${MIO}`).set(como(ADMIN_SIN)).send({ dias_alerta_inactividad: 4 })).status).toBe(403);
  });

  it('su campus lo configura y le renueva la clave del webhook', async () => {
    expect((await request.patch(`/api/projects/${MIO}`).set(como(ADMIN)).send({ dias_alerta_inactividad: 5 })).status).toBe(200);
    expect((await request.post(`/api/projects/${MIO}/regenerate-webhook-key`).set(como(ADMIN))).status).toBe(200);
  });

  it('el de otra empresa es un 404 y no cambia ni su clave', async () => {
    const antes = await one('SELECT dias_alerta_inactividad, webhook_api_key FROM projects WHERE id = $1', [AJENO]);
    expect((await request.patch(`/api/projects/${AJENO}`).set(como(ADMIN)).send({ dias_alerta_inactividad: 9 })).status).toBe(404);
    expect((await request.post(`/api/projects/${AJENO}/regenerate-webhook-key`).set(como(ADMIN))).status).toBe(404);
    expect(await one('SELECT dias_alerta_inactividad, webhook_api_key FROM projects WHERE id = $1', [AJENO])).toEqual(antes);
  });

  it('no pasa su campus a otra empresa (403); dejarlo en la suya, sí', async () => {
    expect((await request.patch(`/api/projects/${MIO}`).set(como(ADMIN)).send({ sociedad_emisora_id: OTRA_EMPRESA })).status).toBe(403);
    expect(Number((await one('SELECT sociedad_emisora_id FROM projects WHERE id = $1', [MIO])).sociedad_emisora_id)).toBe(EMPRESA);
    expect((await request.patch(`/api/projects/${MIO}`).set(como(ADMIN)).send({ sociedad_emisora_id: EMPRESA })).status).toBe(200);
  });

  it('superadmin y soporte configuran cualquiera', async () => {
    expect((await request.patch(`/api/projects/${AJENO}`).set(como(SUPER)).send({ dias_alerta_inactividad: 6 })).status).toBe(200);
    expect((await request.patch(`/api/projects/${AJENO}`).set(como(SOPORTE)).send({ dias_alerta_inactividad: 7 })).status).toBe(200);
  });
});

describe('el rol soporte no lo da un admin de empresa', () => {
  const quien = (u) => ({ userId: u.id, role: u.role });
  const codigo = (p) => p.then(() => 'ok', (e) => e.code);

  it('ni con TODO el catálogo como excepción: ni en el alta ni como rol de más', async () => {
    expect(await codigo(exigirQueNoDeMasDeLoQueTiene(quien(ADMIN_TODO), null, { role: 'soporte', roles_extra: [] })))
      .toBe('SOPORTE_SOLO_SUPERADMIN');
    expect(await codigo(exigirQueNoDeMasDeLoQueTiene(quien(ADMIN_TODO), null, { role: 'gestor', roles_extra: ['soporte'] })))
      .toBe('SOPORTE_SOLO_SUPERADMIN');
    expect(await codigo(exigirQueNoDeMasDeLoQueTiene(quien(ADMIN_TODO), GESTORA.id, { role: 'soporte' })))
      .toBe('SOPORTE_SOLO_SUPERADMIN');
  });

  it('el admin con las excepciones de su empresa, tampoco', async () => {
    const c = await codigo(exigirQueNoDeMasDeLoQueTiene(quien(ADMIN), null, { role: 'soporte', roles_extra: [] }));
    expect(['SOPORTE_SOLO_SUPERADMIN', 'NO_LO_TIENES']).toContain(c);
    expect(c).not.toBe('ok');
  });

  it('el superadmin sí, y soporte sigue dando de alta a otro soporte', async () => {
    expect(await codigo(exigirQueNoDeMasDeLoQueTiene(quien(SUPER), null, { role: 'soporte', roles_extra: [] }))).toBe('ok');
    expect(await codigo(exigirQueNoDeMasDeLoQueTiene(quien(SOPORTE), null, { role: 'soporte', roles_extra: [] }))).toBe('ok');
  });
});
