import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Brevo simulado: se ve qué correo se habría mandado y a quién, sin mandar nada.
const sendEmail = vi.fn(async () => ({ sent: true, messageId: '<prueba>' }));
vi.mock('../src/shared/services/brevo.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendEmail,
}));

const supertest = (await import('supertest')).default;
const jwt = (await import('jsonwebtoken')).default;
const app = (await import('../src/app.js')).default;
const pool = (await import('../src/shared/config/db.js')).default;

/**
 * El equipo de desarrollo en el CRM (Diego, 26/10/2026), contra la base de verdad:
 *
 *   A · las tareas van POR EMPRESA: un encargado asigna y pone supervisor a
 *       cualquiera de su empresa aunque no compartan campus (Julián pone una
 *       tarea a Diana y la supervisa Ángel), y a nadie de otra empresa.
 *   B · el supervisor: le llega el correo al ponerlo y cuando está para revisar,
 *       la ve y la aprueba o devuelve sin «Aprobar y cerrar».
 *   C · quien no es encargado crea SUS tareas; asignar a otro o poner
 *       supervisor es 403 en el servidor.
 *   D · Meta Ads, solo ver, a quien tiene `meta_ads.view`, y solo de sus campus.
 *   E · la empresa de un colaborador no le da campus; «Mi factura» con el rol
 *       colaborador añadido.
 *
 *   npm --prefix backend run db:preparar
 *   cd backend && npx vitest run tests/equipoDesarrolloTareas.test.js
 */

const request = supertest(app);
const MARCA = `EQUIPO_${Date.now().toString(36)}`;
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const one = async (sql, params) => (await q(sql, params))[0];

const U = {};
const T = {};
const E = {};
const P = {};
const ids = { issuers: [], projects: [] };
const correoAnterior = process.env.TAREAS_CORREOS_ACTIVOS;

async function persona(clave, role, { campus = [], empresas = [], encargado = false, meta = false, extra = [] } = {}) {
  const u = await one(
    `INSERT INTO users (nombre, email, password_hash, role, roles_extra)
     VALUES ($1, $2, 'x', $3, $4::user_role[]) RETURNING id, email, role`,
    [`${MARCA} ${clave}`, `${clave.toLowerCase()}_${MARCA.toLowerCase()}@test.local`, role, extra]
  );
  for (const c of campus) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, P[c]]);
  for (const e of empresas) await q('INSERT INTO user_empresas (user_id, issuer_id) VALUES ($1, $2)', [u.id, E[e]]);
  if (encargado) {
    await q(`INSERT INTO user_permission_overrides (user_id, resource, action, allowed)
             VALUES ($1, 'tasks', 'assign', true), ($1, 'tasks', 'view_all', true)`, [u.id]);
  }
  if (meta) {
    await q(`INSERT INTO user_permission_overrides (user_id, resource, action, allowed) VALUES ($1, 'meta_ads', 'view', true)`, [u.id]);
  }
  U[clave] = u;
  T[clave] = jwt.sign({ userId: u.id, email: u.email, role, roles_extra: extra, customRoleId: null },
    process.env.JWT_SECRET, { expiresIn: '1h' });
}
const como = (clave) => ({ Authorization: `Bearer ${T[clave]}` });
const correosA = (clave) => sendEmail.mock.calls.map(([a]) => a).filter((c) => c.to?.[0]?.email === U[clave].email);
const esperar = () => new Promise((s) => setTimeout(s, 300));

beforeAll(async () => {
  process.env.TAREAS_CORREOS_ACTIVOS = 'true';
  // CEDIA con dos campus, ICTESS con uno y OTRA con uno.
  for (const clave of ['CEDIA', 'ICTESS', 'OTRA']) {
    const s = await one('INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id', [`${MARCA} ${clave}`, `${MARCA}-${clave}`]);
    ids.issuers.push(s.id);
    E[clave] = s.id;
  }
  for (const [c, s] of [['A', 'CEDIA'], ['B', 'CEDIA'], ['C', 'ICTESS'], ['D', 'OTRA']]) {
    const p = await one(
      `INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c.toLowerCase()}`, `${MARCA}-${c}`, E[s]]
    );
    ids.projects.push(p.id);
    P[c] = p.id;
  }
  await persona('superadmin', 'superadmin');
  // Encargados, sin campus: solo su empresa.
  await persona('julian', 'colaborador', { empresas: ['CEDIA', 'ICTESS'], encargado: true, meta: true });
  await persona('angel', 'colaborador', { empresas: ['CEDIA', 'ICTESS'], encargado: true });
  // El resto del equipo.
  await persona('diana', 'colaborador', { empresas: ['CEDIA'] });
  await persona('pedro', 'colaborador', { empresas: ['CEDIA'] });
  await persona('ajeno', 'colaborador', { empresas: ['OTRA'] });
  // Un admin con UN campus de CEDIA y una persona de otro campus de CEDIA.
  await persona('adminA', 'admin', { campus: ['A'] });
  await persona('deB', 'colaborador', { campus: ['B'] });
  // Meta, por campus.
  await persona('conMeta', 'colaborador', { campus: ['A'], meta: true });
  await persona('sinMeta', 'colaborador', { campus: ['A'] });
  // Soporte que además factura como colaborador (Diego).
  await persona('soporte', 'soporte', { campus: ['A'], extra: ['colaborador'] });
});

afterAll(async () => {
  process.env.TAREAS_CORREOS_ACTIVOS = correoAnterior;
  const usuarios = Object.values(U).map((u) => u.id);
  await q('DELETE FROM tasks WHERE created_by = ANY($1::int[]) OR assigned_to = ANY($1::int[])', [usuarios]);
  await q('DELETE FROM admin_notifications WHERE target_user_ids && $1::int[]', [usuarios]);
  await q('DELETE FROM user_permission_overrides WHERE user_id = ANY($1::int[])', [usuarios]);
  await q('DELETE FROM user_empresas WHERE user_id = ANY($1::int[])', [usuarios]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [usuarios]);
  await q('DELETE FROM user_activity_log WHERE user_id = ANY($1::int[])', [usuarios]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [usuarios]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM invoice_issuers WHERE id = ANY($1::int[])', [ids.issuers]);
  await pool.end();
}, 60000);

describe('A · por empresa, no por campus', () => {
  let tarea;

  it('Julián pone una tarea a Diana y la supervisa Ángel, sin compartir campus: 201', async () => {
    sendEmail.mockClear();
    const res = await request.post('/api/tasks').set(como('julian'))
      .send({ title: `${MARCA} Para Diana`, assigned_to: U.diana.id, supervisor_id: U.angel.id });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    tarea = res.body.data;
    expect(tarea.assigned_to).toBe(U.diana.id);
    expect(tarea.supervisor_id).toBe(U.angel.id);
    expect(tarea.supervisor_name).toBe(`${MARCA} angel`);
    await esperar();
    // Los dos correos: a Diana, la tarea; a Ángel, que la supervisa.
    expect(correosA('diana').map((c) => c.subject)).toEqual([`Tarea asignada: ${MARCA} Para Diana`]);
    expect(correosA('angel').map((c) => c.subject)).toEqual([`Supervisas: ${MARCA} Para Diana`]);
    // Con el momento del cambio (26/10/2026): si lo quitan y lo vuelven a poner, vuelve a llegar.
    expect(correosA('angel')[0].clave).toMatch(new RegExp(`^tarea_supervisor-${tarea.id}-${U.angel.id}-[0-9]+$`));
    // Y la campana del supervisor.
    const aviso = await one(
      `SELECT title FROM admin_notifications WHERE $1 = ANY(target_user_ids) AND type = 'task_supervisor'`, [U.angel.id]);
    expect(aviso.title).toContain('Supervisas una tarea');
  });

  it('el equipo de su empresa sale como asignable; el de otra empresa, no', async () => {
    const res = await request.get('/api/tasks/assignees').set(como('julian'));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const asignables = res.body.data.filter((p) => p.asignable).map((p) => p.id);
    expect(asignables).toEqual(expect.arrayContaining([U.diana.id, U.angel.id, U.pedro.id, U.adminA.id, U.deB.id]));
    expect(res.body.data.map((p) => p.id)).not.toContain(U.ajeno.id);
  });

  it('a alguien de otra empresa, ni asignarle ni ponerle de supervisor: 403', async () => {
    expect((await request.post('/api/tasks').set(como('julian'))
      .send({ title: `${MARCA} Ajeno`, assigned_to: U.ajeno.id })).status).toBe(403);
    const r = await request.post('/api/tasks').set(como('julian'))
      .send({ title: `${MARCA} Sup ajeno`, assigned_to: U.diana.id, supervisor_id: U.ajeno.id });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/de tu empresa/);
  });

  it('un admin de UN campus de CEDIA asigna a gente de otro campus de CEDIA y a quien solo tiene la empresa', async () => {
    expect((await request.post('/api/tasks').set(como('adminA'))
      .send({ title: `${MARCA} A para B`, assigned_to: U.deB.id })).status).toBe(201);
    expect((await request.post('/api/tasks').set(como('adminA'))
      .send({ title: `${MARCA} A para Diana`, assigned_to: U.diana.id })).status).toBe(201);
    // Diana (solo empresa CEDIA) ve la de Julián; la tarea de B la ve el admin de A.
    const ve = await request.get('/api/tasks').set(como('adminA'));
    expect(ve.body.data.map((t) => t.title)).toEqual(expect.arrayContaining([`${MARCA} A para B`, `${MARCA} Para Diana`]));
  });

  it('el supervisor no puede ser quien la lleva: 400', async () => {
    const r = await request.post('/api/tasks').set(como('julian'))
      .send({ title: `${MARCA} Misma`, assigned_to: U.diana.id, supervisor_id: U.diana.id });
    expect(r.status).toBe(400);
  });

  describe('B · el supervisor', () => {
    it('la ve y la comenta, aunque no la lleve ni tenga «Ver todo»', async () => {
      expect((await request.get(`/api/tasks/${tarea.id}`).set(como('angel'))).status).toBe(200);
    });

    it('cuando Diana la pasa a «En revisión», a Ángel le llega el correo, y la aprueba sin «Aprobar y cerrar»', async () => {
      sendEmail.mockClear();
      const mov = await request.patch(`/api/tasks/${tarea.id}/move`).set(como('diana')).send({ status: 'en_revision' });
      expect(mov.status, JSON.stringify(mov.body)).toBe(200);
      await esperar();
      expect(correosA('angel').map((c) => c.subject)).toEqual([`Para revisar: ${MARCA} Para Diana`]);
      // En su «Por revisar» le salen las que supervisa (26/10/2026), sin «Aprobar y cerrar».
      const lista = await request.get('/api/tasks/review').set(como('angel'));
      expect(lista.status).toBe(200);
      expect(lista.body.data.map((x) => x.id)).toContain(tarea.id);
      const ok = await request.patch(`/api/tasks/${tarea.id}/approve`).set(como('angel'));
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body.data.status).toBe('hecha');
    });

    it('quien no la supervisa ni tiene «Aprobar y cerrar» no la aprueba: 403', async () => {
      const t = (await request.post('/api/tasks').set(como('julian'))
        .send({ title: `${MARCA} Para Pedro`, assigned_to: U.pedro.id, supervisor_id: U.angel.id })).body.data;
      await request.patch(`/api/tasks/${t.id}/move`).set(como('pedro')).send({ status: 'en_revision' });
      expect((await request.patch(`/api/tasks/${t.id}/approve`).set(como('diana'))).status).toBe(403);
      expect((await request.patch(`/api/tasks/${t.id}/return`).set(como('angel')).send({ comment: 'Falta X' })).status).toBe(200);
    });

    it('cambiar el supervisor lo avisa y lo deja comentado', async () => {
      sendEmail.mockClear();
      const t = (await request.post('/api/tasks').set(como('julian'))
        .send({ title: `${MARCA} Cambio`, assigned_to: U.diana.id })).body.data;
      const r = await request.patch(`/api/tasks/${t.id}`).set(como('julian')).send({ supervisor_id: U.angel.id });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data.supervisor_id).toBe(U.angel.id);
      await esperar();
      expect(correosA('angel').map((c) => c.subject)).toEqual([`Supervisas: ${MARCA} Cambio`]);
      const det = await request.get(`/api/tasks/${t.id}`).set(como('julian'));
      expect(det.body.data.comments.map((c) => c.content).join('\n')).toMatch(/Cambió el supervisor de «nadie» a «.* angel»/);
    });
  });
});

describe('C · quien no es encargado, solo sus tareas', () => {
  let suya;

  it('crea la suya: 201, y queda para él', async () => {
    const r = await request.post('/api/tasks').set(como('pedro')).send({ title: `${MARCA} De Pedro` });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.assigned_to).toBe(U.pedro.id);
    suya = r.body.data;
  });

  it('asignarla a otro, al crear o al reasignar: 403', async () => {
    expect((await request.post('/api/tasks').set(como('pedro'))
      .send({ title: `${MARCA} Pedro a Diana`, assigned_to: U.diana.id })).status).toBe(403);
    expect((await request.patch(`/api/tasks/${suya.id}`).set(como('pedro')).send({ assigned_to: U.diana.id })).status).toBe(403);
  });

  it('ponerle supervisor: 403', async () => {
    expect((await request.post('/api/tasks').set(como('pedro'))
      .send({ title: `${MARCA} Pedro con sup`, supervisor_id: U.angel.id })).status).toBe(403);
    expect((await request.patch(`/api/tasks/${suya.id}`).set(como('pedro')).send({ supervisor_id: U.angel.id })).status).toBe(403);
  });

  it('ve las suyas y las que le asignan, no las de los demás', async () => {
    const r = await request.get('/api/tasks').set(como('pedro'));
    const titulos = r.body.data.map((t) => t.title);
    expect(titulos).toEqual(expect.arrayContaining([`${MARCA} De Pedro`, `${MARCA} Para Pedro`]));
    expect(titulos).not.toContain(`${MARCA} Para Diana`);
  });
});

describe('D · Meta Ads, solo ver', () => {
  it('con meta_ads.view ve la de su campus: 200', async () => {
    const r = await request.get(`/api/meta-ads/accounts?projectId=${P.A}`).set(como('conMeta'));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  it('de un campus que no es suyo: 403', async () => {
    expect((await request.get(`/api/meta-ads/accounts?projectId=${P.D}`).set(como('conMeta'))).status).toBe(403);
  });

  it('configurar (conectar, sincronizar, asociar) sigue siendo del admin: 403', async () => {
    expect((await request.post('/api/meta-ads/connect').set(como('conMeta'))
      .send({ project_id: P.A, ad_account_id: 'act_1', access_token: 'x' })).status).toBe(403);
    expect((await request.post('/api/meta-ads/associations').set(como('conMeta'))
      .send({ project_id: P.A, campaign_id: '1', product_ids: [] })).status).toBe(403);
  });

  it('sin el permiso, nada: 403 (y prospectos, ventas y facturas siguen cerrados)', async () => {
    expect((await request.get(`/api/meta-ads/accounts?projectId=${P.A}`).set(como('sinMeta'))).status).toBe(403);
    for (const ruta of ['/api/leads', '/api/conversions', '/api/invoices']) {
      expect((await request.get(ruta).set(como('conMeta'))).status, ruta).toBe(403);
    }
  });

  it('/auth/me le dice al frontal que tiene Meta', async () => {
    const r = await request.get('/api/auth/me').set(como('conMeta'));
    expect(r.body.data.permissions['meta_ads.view']).toBe(true);
    const s = await request.get('/api/auth/me').set(como('sinMeta'));
    expect(s.body.data.permissions['meta_ads.view']).toBe(false);
  });
});

describe('E · empresa y factura del colaborador', () => {
  it('el superadmin le da la empresa a un colaborador: queda la empresa, SIN campus', async () => {
    const r = await request.patch(`/api/users/${U.pedro.id}`).set(como('superadmin')).send({ empresaIds: [E.CEDIA, E.ICTESS] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.empresa_ids).toEqual([E.CEDIA, E.ICTESS].sort((a, b) => a - b));
    const campus = await q('SELECT 1 FROM user_projects WHERE user_id = $1 AND active', [U.pedro.id]);
    expect(campus).toHaveLength(0);
  });

  it('soporte con el rol colaborador añadido entra en «Mi factura»: 200', async () => {
    expect((await request.get('/api/facturas-colaborador/mias').set(como('soporte'))).status).toBe(200);
    expect((await request.get('/api/facturas-colaborador/mias').set(como('adminA'))).status).toBe(403);
  });
});
