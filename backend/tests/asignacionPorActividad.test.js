import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Brevo simulado: se ve qué correo habría salido al mailhook, sin mandar nada.
const sendEmail = vi.fn(async () => ({ sent: true, messageId: '<prueba-asignacion>' }));
vi.mock('../src/shared/services/brevo.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendEmail,
}));

const supertest = (await import('supertest')).default;
const jwt = (await import('jsonwebtoken')).default;
const app = (await import('../src/app.js')).default;
const pool = (await import('../src/shared/config/db.js')).default;
const { cuentasDe } = await import('../src/modules/asignacion/asignacion.actividad.js');
const { _memoria: memoriaDelWidget } = await import('../src/modules/asignacion/asignacion.widget.js');
const { upsertConfig: configDelWidget } = await import('../src/modules/widget/widget.model.js');
const service = await import('../src/modules/asignacion/asignacion.service.js');

/**
 * Asignación de leads por actividad, de punta a punta (CRM#513; Carlos y Diego, 27/10/2026).
 *
 *   «Una gestora está activa si ha hecho al menos una acción válida en los
 *   últimos 15 minutos.» Con alguna activa, el CRM crea el lead con ella y lo
 *   manda al escenario 2; sin ninguna, al escenario 1 sin crearlo.
 *
 *   cd backend && npx vitest run tests/asignacionPorActividad.test.js
 */

const request = supertest(app);
const MARCA = `ASIG_${Date.now().toString(36)}`;
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const one = async (sql, params) => (await q(sql, params))[0];
const U = {};
const T = {};
const ids = { issuer: null, project: null, otro: null, config: null };
let clave;
const MAIL1 = `escenario1_${MARCA.toLowerCase()}@hook.eu2.make.com`;
const MAIL2 = `escenario2_${MARCA.toLowerCase()}@hook.eu2.make.com`;

async function persona(c, role, campus = []) {
  const u = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, email`,
    [`${MARCA} ${c}`, `${c.toLowerCase()}_${MARCA.toLowerCase()}@test.local`, role]);
  for (const p of campus) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, p]);
  U[c] = u;
  T[c] = jwt.sign({ userId: u.id, email: u.email, role, roles_extra: [], customRoleId: null }, process.env.JWT_SECRET, { expiresIn: '1h' });
}
const como = (c) => ({ Authorization: `Bearer ${T[c]}` });
const entrar = (uid, extra = {}) => request.post('/api/asignacion/entrada').set('Authorization', `Bearer ${clave}`)
  .send({ uid: `${MARCA}-${uid}`, nombre: `${MARCA} cliente ${uid}`, email: `${uid}_${MARCA.toLowerCase()}@cliente.test`, telefono: '+34600000000', ...extra });
const esperar = () => new Promise((s) => setTimeout(s, 400));
const correosA = (dir) => sendEmail.mock.calls.map(([a]) => a).filter((m) => m.to?.[0]?.email === dir);
let leadDePrueba;
const nota = (c, texto) => q('INSERT INTO lead_interactions (lead_id, tipo, nota, created_by) VALUES ($1, $2, $3, $4)', [leadDePrueba, 'nota', texto, U[c].id]);
const llamada = (c) => q('INSERT INTO lead_interactions (lead_id, tipo, nota, created_by) VALUES ($1, $2, $3, $4)', [leadDePrueba, 'llamada', 'contestó', U[c].id]);
const sinActividad = () => q('DELETE FROM lead_interactions WHERE lead_id = $1', [leadDePrueba]);

beforeAll(async () => {
  const s = await one('INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id', [`${MARCA} EMPRESA`, `${MARCA}-E`]);
  ids.issuer = s.id;
  for (const k of ['project', 'otro']) {
    const p = await one('INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [`${MARCA} ${k}`, `${MARCA.toLowerCase()}-${k}`, `${MARCA}-${k}`, s.id]);
    ids[k] = p.id;
  }
  await persona('superadmin', 'superadmin');
  await persona('admin', 'admin', [ids.project]);
  await persona('adminOtro', 'admin', [ids.otro]);
  for (const g of ['ana', 'bea', 'cris']) await persona(g, 'gestor', [ids.project]);
  // Un lead del campus sobre el que las gestoras «trabajan» en las pruebas.
  leadDePrueba = (await one('INSERT INTO leads (project_id, nombre, email) VALUES ($1, $2, $3) RETURNING id',
    [ids.project, `${MARCA} lead de trabajo`, `trabajo_${MARCA.toLowerCase()}@x.test`])).id;
});

afterAll(async () => {
  const us = Object.values(U).map((u) => u.id);
  await q('DELETE FROM wa_conversaciones WHERE instancia = ANY($1::text[])', [us.map((id) => `crm-u${id}`)]);
  await q('DELETE FROM project_widget_config WHERE project_id = ANY($1::int[])', [[ids.project, ids.otro]]);
  await q('DELETE FROM asignacion_decisiones WHERE project_id = ANY($1::int[])', [[ids.project, ids.otro]]);
  await q('DELETE FROM asignacion_destinos WHERE project_id = ANY($1::int[])', [[ids.project, ids.otro]]);
  await q('DELETE FROM actividad_crm WHERE user_id = ANY($1::int[])', [us]);
  await q('DELETE FROM leads WHERE project_id = ANY($1::int[])', [[ids.project, ids.otro]]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [us]);
  await q('DELETE FROM user_activity_log WHERE user_id = ANY($1::int[])', [us]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [us]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [[ids.project, ids.otro]]);
  await q('DELETE FROM invoice_issuers WHERE id = $1', [ids.issuer]);
  await pool.end();
}, 60000);

describe('la configuración (Conexión › Asignación de leads)', () => {
  it('el admin la crea para su campus y ve la clave UNA vez; los destinos, solo su cola', async () => {
    const r = await request.post('/api/asignacion').set(como('admin')).send({
      nombre: `${MARCA} campus`, ambito: 'campus', project_id: ids.project, ventana_min: 15,
      escenario1: { tipo: 'mailhook', valor: MAIL1 }, escenario2: { tipo: 'mailhook', valor: MAIL2 },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    clave = r.body.data.clave;
    ids.config = r.body.data.id;
    expect(clave).toMatch(/^asig_/);
    expect(JSON.stringify(r.body.data)).not.toContain(MAIL1);
    const lista = await request.get('/api/asignacion').set(como('admin'));
    expect(lista.body.data.find((c) => c.id === ids.config).clave).toBeUndefined();
  });
  it('un admin de otro campus no la ve ni la toca; la de «todas», solo el superadmin', async () => {
    const lista = await request.get('/api/asignacion').set(como('adminOtro'));
    expect(lista.body.data.some((c) => c.id === ids.config)).toBe(false);
    expect((await request.patch(`/api/asignacion/${ids.config}`).set(como('adminOtro')).send({ ventana_min: 20 })).status).toBe(403);
    expect((await request.post('/api/asignacion').set(como('admin')).send({
      nombre: 'x', ambito: 'todas', escenario1: { tipo: 'mailhook', valor: MAIL1 }, escenario2: { tipo: 'mailhook', valor: MAIL2 },
    })).status).toBe(403);
  });
  it('una gestora no entra', async () => {
    expect((await request.get('/api/asignacion').set(como('ana'))).status).toBe(403);
  });
});

describe('la entrada', () => {
  it('sin clave o con una que no es, 401 (y Make lo manda al escenario 1)', async () => {
    expect((await request.post('/api/asignacion/entrada').send({ uid: 'x', nombre: 'x', email: 'x@x.test' })).status).toBe(401);
    expect((await request.post('/api/asignacion/entrada').set('X-API-Key', 'asig_mala').send({ uid: 'x', nombre: 'x', email: 'x@x.test' })).status).toBe(401);
  });
  it('sin forma de contacto, 400 con el motivo', async () => {
    const r = await request.post('/api/asignacion/entrada').set('Authorization', `Bearer ${clave}`).send({ uid: `${MARCA}-sin`, nombre: 'Sin contacto' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/forma de contacto/);
  });
});

describe('a quién y a qué escenario', () => {
  it('nadie activo: escenario 1, el CRM NO crea el lead, y el correo va al mailhook del 1', async () => {
    await sinActividad();
    sendEmail.mockClear();
    const r = await entrar('nadie');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ escenario: 1, gestora: null, lead_id: null });
    expect(r.body.data.motivo).toMatch(/Ninguna gestora activa/);
    await esperar();
    expect(correosA(MAIL1)).toHaveLength(1);
    expect(await q('SELECT 1 FROM leads WHERE email = $1', [`nadie_${MARCA.toLowerCase()}@cliente.test`])).toHaveLength(0);
  });

  it('el mismo formulario otra vez (Make reintenta): la misma respuesta y ningún correo más', async () => {
    sendEmail.mockClear();
    const r = await entrar('nadie');
    expect(r.body.data.escenario).toBe(1);
    await esperar();
    expect(correosA(MAIL1)).toHaveLength(0);
  });

  it('una nota de menos de 20 caracteres no hace activa a nadie', async () => {
    await sinActividad();
    await nota('ana', 'ok, llamo luego');
    expect((await entrar('nota-corta')).body.data.escenario).toBe(1);
  });

  it('un cambio de estado deshecho en menos de 10 min no cuenta', async () => {
    await sinActividad();
    await q(`INSERT INTO lead_status_history (lead_id, status_anterior, status_nuevo, changed_by) VALUES
               ($1, 'nuevo', 'contactado', $2), ($1, 'contactado', 'nuevo', $2)`, [leadDePrueba, U.bea.id]);
    expect((await entrar('deshecho')).body.data.escenario).toBe(1);
    await q('DELETE FROM lead_status_history WHERE lead_id = $1', [leadDePrueba]);
  });

  it('con una activa (una llamada hace un momento): escenario 2, el CRM crea el lead con ella', async () => {
    await sinActividad();
    await llamada('ana');
    sendEmail.mockClear();
    const r = await entrar('ana');
    expect(r.body.data).toMatchObject({ escenario: 2, gestora: { id: U.ana.id } });
    expect(r.body.data.motivo).toMatch(/activa (ahora mismo|hace \d+ min) \(contacto\) · 0 hoy · 0 en total/);
    const lead = await one('SELECT id, responsable_id FROM leads WHERE email = $1', [`ana_${MARCA.toLowerCase()}@cliente.test`]);
    expect(lead.responsable_id).toBe(U.ana.id);
    expect(r.body.data.lead_id).toBe(lead.id);
    await esperar();
    const [correo] = correosA(MAIL2);
    expect(correo.textContent).toContain(`GESTORA ASIGNADA: ${MARCA} ana`);
  });

  it('con dos activas, la que menos lleva hoy (Ana ya tiene uno)', async () => {
    await llamada('bea');
    const r = await entrar('ana-y-bea');
    expect(r.body.data.gestora.id).toBe(U.bea.id);
  });

  it('crear un lead a mano cuenta como acción (actividad_crm)', async () => {
    await sinActividad();
    const r = await request.post('/api/leads').set(como('cris')).send({ project_id: ids.project, nombre: `${MARCA} a mano`, email: `mano_${MARCA.toLowerCase()}@x.test` });
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    await esperar();
    expect(await q("SELECT 1 FROM actividad_crm WHERE user_id = $1 AND accion = 'crear_lead'", [U.cris.id])).toHaveLength(1);
    const d = await entrar('cris');
    expect(d.body.data.escenario).toBe(2);
    expect(d.body.data.gestora.id).toBe(U.cris.id);
  });

  it('apagada: todo al escenario 1 aunque haya alguien activa', async () => {
    await request.patch(`/api/asignacion/${ids.config}`).set(como('admin')).send({ activo: false });
    await llamada('ana');
    const r = await entrar('apagada');
    expect(r.body.data).toMatchObject({ escenario: 1 });
    expect(r.body.data.motivo).toMatch(/apagada/);
    await request.patch(`/api/asignacion/${ids.config}`).set(como('admin')).send({ activo: true });
  });

  it('el registro enseña cada decisión con su porqué', async () => {
    const r = await request.get(`/api/asignacion/decisiones?destino_id=${ids.config}`).set(como('admin'));
    expect(r.status).toBe(200);
    const escenarios = r.body.data.map((d) => d.escenario);
    expect(escenarios).toContain(1);
    expect(escenarios).toContain(2);
    expect(r.body.data.every((d) => d.motivo?.texto)).toBe(true);
  });
});

describe('WhatsApp (fase 5)', () => {
  // Cada conversación, en el número conectado de la gestora (instancia `crm-u<id>`).
  let n = 0;
  const conversacion = async (c, { grupo = false } = {}) => (await one(
    `INSERT INTO wa_conversaciones (instancia, jid, telefono, project_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`crm-u${U[c].id}`, `34611${String(++n).padStart(6, '0')}@${grupo ? 'g.us' : 's.whatsapp.net'}`, `+34611${String(n).padStart(6, '0')}`, ids.project])).id;
  const mensaje = (conv, direccion, { haceMin = 0, enviadoPor = null } = {}) => q(
    `INSERT INTO wa_mensajes (conversacion_id, direccion, texto, enviado_por, ts) VALUES ($1, $2, 'hola', $3, NOW() - make_interval(mins => $4::int))`,
    [conv, direccion, enviadoPor, haceMin]);
  const limpiarTodo = async () => {
    await sinActividad();
    await q('DELETE FROM actividad_crm WHERE user_id = ANY($1::int[])', [Object.values(U).map((u) => u.id)]);
    await q('DELETE FROM wa_conversaciones WHERE instancia = ANY($1::text[])', [Object.values(U).map((u) => `crm-u${u.id}`)]);
  };

  it('lo que manda desde su móvil con el número conectado la hace activa', async () => {
    await limpiarTodo();
    await mensaje(await conversacion('bea'), 'saliente');
    const r = await entrar('wa-movil');
    expect(r.body.data).toMatchObject({ escenario: 2, gestora: { id: U.bea.id } });
    expect(r.body.data.motivo).toMatch(/\(whatsapp\)/);
  });

  it('el historial que baja al emparejar el número no cuenta (hora de WhatsApp antigua)', async () => {
    await limpiarTodo();
    await mensaje(await conversacion('bea'), 'saliente', { haceMin: 3 * 24 * 60 });
    expect((await entrar('wa-historial')).body.data.escenario).toBe(1);
  });

  it('lo que escribe en un grupo no cuenta', async () => {
    await limpiarTodo();
    await mensaje(await conversacion('bea', { grupo: true }), 'saliente');
    expect((await entrar('wa-grupo')).body.data.escenario).toBe(1);
  });

  it('una conversación que le abre la persona hoy cuenta como asignada; si luego es su lead, cuenta una vez', async () => {
    await limpiarTodo();
    const antes = (await cuentasDe([U.ana.id], ids.project)).get(U.ana.id);
    const conv = await conversacion('ana');
    await mensaje(conv, 'entrante', { haceMin: 2 });
    await mensaje(conv, 'saliente', { haceMin: 1 });
    const despues = (await cuentasDe([U.ana.id], ids.project)).get(U.ana.id);
    expect(despues.hoy).toBe(antes.hoy + 1);
    expect(despues.whatsapp).toBe(1);
    // La gestora registra el lead de esa conversación: sigue contando uno.
    const lead = await one('INSERT INTO leads (project_id, nombre, email, responsable_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [ids.project, `${MARCA} de WhatsApp`, `wa_${MARCA.toLowerCase()}@x.test`, U.ana.id]);
    await q('UPDATE wa_conversaciones SET lead_id = $1 WHERE id = $2', [lead.id, conv]);
    const registrado = (await cuentasDe([U.ana.id], ids.project)).get(U.ana.id);
    expect(registrado.hoy).toBe(antes.hoy + 1);
    expect(registrado.whatsapp).toBe(0);
  });

  it('la conversación que empieza la gestora no cuenta como asignada', async () => {
    await limpiarTodo();
    const antes = (await cuentasDe([U.bea.id], ids.project)).get(U.bea.id);
    const conv = await conversacion('bea');
    await mensaje(conv, 'saliente', { haceMin: 5 });
    await mensaje(conv, 'entrante', { haceMin: 1 });
    expect((await cuentasDe([U.bea.id], ids.project)).get(U.bea.id).hoy).toBe(antes.hoy);
  });

  it('el widget de la web: con alguien activo, solo ella; sin nadie, todas (y sigue al azar)', async () => {
    await limpiarTodo();
    await configDelWidget(ids.project, { enabled: true });
    await q(`UPDATE users SET whatsapp_phone = '34600000001', whatsapp_widget_active = true WHERE id = ANY($1::int[])`, [[U.ana.id, U.bea.id]]);
    const datos = async () => { memoriaDelWidget.clear(); return (await request.get(`/api/w/data/${ids.project}.json`)).body; };
    const nombres = (d) => d.gestoras.map(([nombre]) => nombre).sort();
    expect((await datos()).gestoras).toHaveLength(2);
    await llamada('bea');
    expect(nombres(await datos())).toEqual([MARCA]); // el nombre visible es la primera palabra: la marca
    const js = (memoriaDelWidget.clear(), (await request.get(`/api/w/whatsapp/${ids.project}.js`)).text);
    expect((js.match(/\["[^"]*","34600000001"\]/g) || [])).toHaveLength(1);
    // Apagada la asignación del campus, otra vez todas.
    await request.patch(`/api/asignacion/${ids.config}`).set(como('admin')).send({ activo: false });
    expect((await datos()).gestoras).toHaveLength(2);
    await request.patch(`/api/asignacion/${ids.config}`).set(como('admin')).send({ activo: true });
  });
});

describe('cada campus reparte aparte (Diego, 28/10)', () => {
  it('los leads que una gestora recibe en otro campus no cuentan para el «menos hoy» de este', async () => {
    const antes = (await cuentasDe([U.bea.id], ids.project)).get(U.bea.id);
    for (let i = 0; i < 3; i++) {
      await q('INSERT INTO leads (project_id, nombre, email, responsable_id) VALUES ($1, $2, $3, $4)',
        [ids.otro, `${MARCA} otro campus ${i}`, `otro${i}_${MARCA.toLowerCase()}@x.test`, U.bea.id]);
    }
    expect((await cuentasDe([U.bea.id], ids.project)).get(U.bea.id).hoy).toBe(antes.hoy);
    expect((await cuentasDe([U.bea.id], ids.otro)).get(U.bea.id).hoy).toBe(3);
  });
  it('el escenario recibe también el WhatsApp de la gestora (para la plantilla de Wasapi)', async () => {
    await q(`UPDATE users SET whatsapp_phone = '34600111222' WHERE id = $1`, [U.cris.id]);
    await q('DELETE FROM lead_interactions WHERE lead_id = $1', [leadDePrueba]);
    await q('DELETE FROM actividad_crm WHERE user_id = ANY($1::int[])', [Object.values(U).map((u) => u.id)]);
    await q('DELETE FROM wa_conversaciones WHERE instancia = ANY($1::text[])', [Object.values(U).map((u) => `crm-u${u.id}`)]);
    await q('INSERT INTO lead_interactions (lead_id, tipo, nota, created_by) VALUES ($1, $2, $3, $4)', [leadDePrueba, 'llamada', 'contestó', U.cris.id]);
    sendEmail.mockClear();
    const r = await entrar('wa-de-la-gestora');
    expect(r.body.data.gestora).toMatchObject({ id: U.cris.id, whatsapp: '34600111222' });
    await esperar();
    const [correo] = correosA(MAIL2);
    expect(correo).toBeTruthy();
  });
});

describe('«Probar escenario 2» (visto probando la pantalla, 28/10)', () => {
  it('lleva una gestora de ejemplo, para poder enlazar sus campos en Make', async () => {
    sendEmail.mockClear();
    const r = await request.post(`/api/asignacion/${ids.config}/prueba`).set(como('admin')).send({ escenario: 2 });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const [correo] = correosA(MAIL2);
    expect(correo.textContent).toContain('GESTORA ASIGNADA: Gestora de prueba');
  });
  it('la del escenario 1 sigue sin gestora', async () => {
    sendEmail.mockClear();
    await request.post(`/api/asignacion/${ids.config}/prueba`).set(como('admin')).send({ escenario: 1 });
    const [correo] = correosA(MAIL1);
    expect(correo.textContent).not.toContain('GESTORA ASIGNADA');
  });
});

describe('la entrada con el JSON de Make (28/10)', () => {
  it('sin uid y con full_name/phone_complete: entra, y repetido no duplica', async () => {
    const cuerpo = { full_name: `${MARCA} de Make`, email: `make_${MARCA.toLowerCase()}@cliente.test`, phone_complete: '+34600000088', course: 'Curso X' };
    const a = await request.post('/api/asignacion/entrada').set('Authorization', `Bearer ${clave}`).send(cuerpo);
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    const b = await request.post('/api/asignacion/entrada').set('Authorization', `Bearer ${clave}`).send(cuerpo);
    expect(b.body.data.decision_id).toBe(a.body.data.decision_id);
    const d = await one('SELECT uid, datos FROM asignacion_decisiones WHERE id = $1', [a.body.data.decision_id]);
    expect(d.uid).toMatch(/^auto-/);
    expect(d.datos).toMatchObject({ nombre: cuerpo.full_name, telefono: cuerpo.phone_complete, full_name: cuerpo.full_name });
  });
});

describe('la entrada como formulario codificado, con el correo original (28/10)', () => {
  it('entra y el escenario recibe el correo tal cual', async () => {
    const r = await request.post('/api/asignacion/entrada').set('Authorization', `Bearer ${clave}`).type('form').send({
      json: JSON.stringify({ full_name: `${MARCA} codificado`, email: `cod_${MARCA.toLowerCase()}@cliente.test` }),
      asunto: 'Nuevo formulario del Curso X', texto: 'Nombre: codificado', html: '<p>codificado</p>',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = await one('SELECT datos FROM asignacion_decisiones WHERE id = $1', [r.body.data.decision_id]);
    expect(d.datos.original).toMatchObject({ asunto: 'Nuevo formulario del Curso X', texto: 'Nombre: codificado' });
  });
});

describe('sin freno de pruebas (Diego, 28/10: «quita el freno»)', () => {
  it('un formulario @ejemplo.com ya es como cualquier otro: con una activa, crea el lead', async () => {
    await q('DELETE FROM lead_interactions WHERE lead_id = $1', [leadDePrueba]);
    await q('INSERT INTO lead_interactions (lead_id, tipo, nota, created_by) VALUES ($1, $2, $3, $4)', [leadDePrueba, 'llamada', 'contestó', U.ana.id]);
    const correo = `sinfreno_${MARCA.toLowerCase()}@ejemplo.com`;
    const r = await entrar('sin-freno', { email: correo });
    expect(r.body.data.escenario).toBe(2);
    expect(r.body.data.lead_id).toBeTruthy();
    expect(await q('SELECT 1 FROM leads WHERE email = $1', [correo])).toHaveLength(1);
  });
});

describe('con una sola persona en el reparto (Diego, 28/10)', () => {
  it('va al escenario 1 aunque esté activa, hasta que sean dos', async () => {
    const solo = await one('INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [`${MARCA} solo`, `${MARCA.toLowerCase()}-solo`, `${MARCA}-solo`, ids.issuer]);
    await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [U.ana.id, solo.id]);
    const c = await request.post('/api/asignacion').set(como('superadmin')).send({
      nombre: `${MARCA} solo`, ambito: 'campus', project_id: solo.id, ventana_min: 15,
      escenario1: { tipo: 'mailhook', valor: MAIL1 }, escenario2: { tipo: 'mailhook', valor: MAIL2 },
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    await q('INSERT INTO lead_interactions (lead_id, tipo, nota, created_by) VALUES ($1, $2, $3, $4)', [leadDePrueba, 'llamada', 'contestó', U.ana.id]);
    const r = await request.post('/api/asignacion/entrada').set('Authorization', `Bearer ${c.body.data.clave}`)
      .send({ uid: `${MARCA}-solo`, nombre: 'Uno solo', email: `solo_${MARCA.toLowerCase()}@cliente.test` });
    expect(r.body.data).toMatchObject({ escenario: 1, gestora: null, lead_id: null });
    expect(r.body.data.motivo).toMatch(/Solo una persona/);
    await q('DELETE FROM asignacion_decisiones WHERE project_id = $1', [solo.id]);
    await q('DELETE FROM asignacion_destinos WHERE project_id = $1', [solo.id]);
    await q('DELETE FROM user_projects WHERE project_id = $1', [solo.id]);
    await q('DELETE FROM projects WHERE id = $1', [solo.id]);
  });
});

describe('el registro por empresa (Diego, 28/10: «tengo que verlo por empresa y campus»)', () => {
  it('con issuer_id salen las decisiones de sus campus; con otra empresa, ninguna', async () => {
    const r = await request.get(`/api/asignacion/decisiones?issuer_id=${ids.issuer}`).set(como('superadmin'));
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThan(0);
    expect(r.body.data.every((d) => d.project_id === ids.project || d.project_id === ids.otro)).toBe(true);
    const otra = await one('INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id', [`${MARCA} OTRA`, `${MARCA}-O`]);
    const vacia = await request.get(`/api/asignacion/decisiones?issuer_id=${otra.id}`).set(como('superadmin'));
    expect(vacia.body.data).toHaveLength(0);
    await q('DELETE FROM invoice_issuers WHERE id = $1', [otra.id]);
  });
});

describe('formularios que entran directos al CRM (Diego, 29/10: «arregla todo»)', () => {
  it('con alguien activa: la elige; la decisión queda en el registro ya cerrada, sin envío a Make', async () => {
    await q('DELETE FROM lead_interactions WHERE lead_id = $1', [leadDePrueba]);
    await q('INSERT INTO lead_interactions (lead_id, tipo, nota, created_by) VALUES ($1, $2, $3, $4)', [leadDePrueba, 'llamada', 'contestó', U.bea.id]);
    const decision = await service.decidirFormulario(ids.project);
    expect(decision?.elegida?.id).toBe(U.bea.id);
    const lead = await one('INSERT INTO leads (project_id, nombre, email, responsable_id) VALUES ($1, $2, $3, $4) RETURNING id, project_id, nombre, responsable_id',
      [ids.project, `${MARCA} por formulario`, `formulario_${MARCA.toLowerCase()}@cliente.test`, U.bea.id]);
    await service.apuntarFormulario(decision, lead, { email: `formulario_${MARCA.toLowerCase()}@cliente.test` });
    const d = await one('SELECT escenario, estado, responsable_id, lead_id, respuesta, proximo_intento_at FROM asignacion_decisiones WHERE uid = $1', [`formulario-${lead.id}`]);
    expect(d).toMatchObject({ escenario: 2, estado: 'enviado', responsable_id: U.bea.id, lead_id: lead.id, proximo_intento_at: null });
    expect(d.respuesta).toMatch(/directo al CRM/);
  });
  it('sin nadie activa: no elige (sigue el turno)', async () => {
    await q('DELETE FROM lead_interactions WHERE lead_id = $1', [leadDePrueba]);
    await q('DELETE FROM actividad_crm WHERE user_id = ANY($1::int[])', [Object.values(U).map((u) => u.id)]);
    await q('DELETE FROM wa_conversaciones WHERE instancia = ANY($1::text[])', [Object.values(U).map((u) => `crm-u${u.id}`)]);
    const decision = await service.decidirFormulario(ids.project);
    expect(decision?.elegida ?? null).toBeNull();
  });
});
