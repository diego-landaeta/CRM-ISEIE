import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * #236 · Monitask en el CRM, contra la base de verdad y con Monitask SIMULADO
 * (sin red): se sustituye `fetch`.
 *
 *   · con el interruptor apagado: 404 en las rutas y en la vuelta del OAuth, ni red ni datos;
 *   · OAuth: la vuelta con un `state` que no es el nuestro se rechaza; con el bueno se
 *     cambia el código (con PKCE) por los tokens, que quedan cifrados, y el `state` no
 *     vale dos veces;
 *   · el token se renueva solo (una vez aunque lo pidan tres a la vez), también ante un
 *     401 de la API; si Monitask retira el permiso, se borran los tokens y se dice;
 *   · la sincronización resume por día (Madrid), sin capturas, y repetirla no suma dos veces;
 *   · el emparejado por correo, y el hecho a mano no lo pisa la siguiente vuelta;
 *   · el cotejo con las facturas del mes, el margen, el ámbito y el aviso (una vez).
 *
 *   npx vitest run tests/monitask236.test.js
 */

vi.setConfig({ testTimeout: 60000 });

process.env.CRM_BASE_URL = 'https://crm.iseie.com/staging';

const { query } = await import('../src/shared/config/db.js');
const { decrypt } = await import('../src/shared/utils/crypto.js');
const servicio = await import('../src/modules/monitask/monitask.service.js');
const { URL_TOKEN } = await import('../src/modules/monitask/monitask.client.js');
const { default: modulo } = await import('../src/modules/monitask/index.js');
const { vueltaNocturna } = await import('../src/jobs/monitaskSyncScheduler.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const MARCA = `MT236${Date.now().toString(36)}`;
const marca = MARCA.toLowerCase();
const CLIENT_ID = `crm-${marca}`;
const SECRETO = `secreto-${marca}-de-prueba`;
const REDIRECT = 'https://crm.iseie.com/staging/api/monitask/oauth/callback';
const base = 9_000_000_000 + Math.floor(Math.random() * 1_000_000) * 10;
const MT = { ana: base + 1, beto: base + 2, carla: base + 3 };
const ids = { users: [], colaboradores: [], issuers: [], facturas: [] };
let SUPER; let ADMIN_OTRA; let GESTORA; let COL_ANA; let COL_DANI; let EMPRESA; let OTRA;

// ─── Monitask de mentira ───────────────────────────────────────────────────
const mt = {
  usuarios: [], entradas: {}, actividad: {}, llamadas: [], pedidosDeToken: [],
  challenge: null, refreshVivo: null, accessValido: null, vueltas: 0,
};
const respuesta = (body, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body, text: async () => JSON.stringify(body),
});
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const nuevosTokens = () => {
  mt.vueltas += 1;
  mt.accessValido = `acc-${mt.vueltas}`;
  mt.refreshVivo = `ref-${mt.vueltas}`;
  return respuesta({ access_token: mt.accessValido, refresh_token: mt.refreshVivo, expires_in: 3600, token_type: 'Bearer' });
};
const enRango = (lista, u) => {
  const [ini, fin] = [Date.parse(u.searchParams.get('start')), Date.parse(u.searchParams.get('end'))];
  return (lista || []).filter((x) => { const t = Date.parse(x.startedAt || x.start); return t >= ini && t < fin; });
};
function fetchFalso(url, opts = {}) {
  const u = new URL(url);
  mt.llamadas.push(`${opts.method || 'GET'} ${u.host}${u.pathname}`);
  if (`${u.origin}${u.pathname}` === URL_TOKEN) {
    const b = Object.fromEntries(new URLSearchParams(opts.body));
    mt.pedidosDeToken.push(b);
    if (b.client_id !== CLIENT_ID || b.client_secret !== SECRETO) return respuesta({ error: 'invalid_client' }, 400);
    if (b.grant_type === 'authorization_code') {
      const pkce = b64url(crypto.createHash('sha256').update(b.code_verifier || '').digest());
      if (b.code !== 'COD-1' || b.redirect_uri !== REDIRECT || pkce !== mt.challenge) return respuesta({ error: 'invalid_grant' }, 400);
      return nuevosTokens();
    }
    if (b.grant_type === 'refresh_token') {
      if (b.refresh_token !== mt.refreshVivo) return respuesta({ error: 'invalid_grant' }, 400);
      return nuevosTokens();
    }
    return respuesta({ error: 'unsupported_grant_type' }, 400);
  }
  if (u.host !== 'external.monitask.com') throw new Error(`fuera de Monitask: ${url}`);
  if (opts.headers?.Authorization !== `Bearer ${mt.accessValido}`) return respuesta({}, 401);
  const p = u.pathname.replace('/api/v1/external', '');
  if (p === '/users') return respuesta(mt.usuarios);
  if (p === '/projects') return respuesta([{ id: 11, name: 'CRM' }, { id: 12, name: 'Web' }]);
  const uid = u.searchParams.get('userId');
  if (p === '/timeEntry/getByDateRange') return respuesta(enRango(mt.entradas[uid], u));
  if (p === '/activity/getByDateRange') return respuesta({ data: enRango(mt.actividad[uid], u) });
  return respuesta({ error: 'no' }, 404);
}

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(modulo.publicMount.prefix, modulo.publicMount.router);
app.use(errorHandler);
const api = supertest(app);
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const one = (sql, p) => query(sql, p).then((r) => r.rows[0]);
const conexion = () => one('SELECT * FROM monitask_conexion WHERE id = 1');
const dia = (id, d) => one(`SELECT * FROM monitask_dias WHERE monitask_id = $1 AND dia = $2`, [id, d]);
const persona = (id) => one('SELECT * FROM monitask_personas WHERE monitask_id = $1', [id]);
const esperarSync = async () => { for (let i = 0; i < 400 && servicio.sincronizando(); i++) await new Promise((r) => setTimeout(r, 25)); };

async function usuario(n, role) {
  const u = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
    [`${MARCA} ${n}`, `${n}@${marca}.test`, role]);
  ids.users.push(u.id);
  return u;
}

beforeAll(async () => {
  await query('DELETE FROM monitask_conexion WHERE id = 1');
  SUPER = await usuario('super', 'superadmin');
  GESTORA = await usuario('gestora', 'gestor');
  ADMIN_OTRA = await usuario('admin', 'admin');
  // Beto: usuario del CRM sin ficha de colaborador.
  await usuario('beto', 'gestor');
  EMPRESA = (await one('INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id', [`${MARCA} EMPRESA`, `${MARCA}-E`])).id;
  OTRA = (await one('INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id', [`${MARCA} OTRA`, `${MARCA}-O`])).id;
  ids.issuers.push(EMPRESA, OTRA);
  // El admin lleva un campus de la OTRA empresa: no ve a Ana.
  const campus = await one(`INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`${MARCA} Campus`, marca, `${MARCA}-key`, OTRA]);
  ids.project = campus.id;
  await query('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [ADMIN_OTRA.id, campus.id]);
  COL_ANA = (await one(`INSERT INTO colaboradores (nombre, email) VALUES ($1, $2) RETURNING id`, [`Ana ${MARCA}`, `ana@${marca}.test`])).id;
  COL_DANI = (await one(`INSERT INTO colaboradores (nombre, email) VALUES ($1, $2) RETURNING id`, [`Dani ${MARCA}`, `dani@${marca}.test`])).id;
  ids.colaboradores.push(COL_ANA, COL_DANI);
  await query(`INSERT INTO colaborador_empresas (colaborador_id, issuer_id, modalidad, tarifa_hora) VALUES ($1, $2, 'hora', 20), ($3, $2, 'fijo', NULL)`,
    [COL_ANA, EMPRESA, COL_DANI]);

  mt.usuarios = [
    { id: MT.ana, firstName: 'Ana', lastName: MARCA, userName: `ANA@${marca}.test` },
    { id: MT.beto, firstName: 'Beto', lastName: MARCA, userName: `beto@${marca}.test` },
    { id: MT.carla, firstName: 'Carla', lastName: MARCA, userName: `carla@${marca}.test` },
  ];
  mt.entradas[MT.ana] = [
    { id: 1, startedAt: '2026-10-05T08:00:00Z', endedAt: '2026-10-05T12:00:00Z', projectId: 11, noteId: 21, noteText: 'Maquetar landing' },
    // Se pisa una hora con la anterior: cuenta una.
    { id: 2, startedAt: '2026-10-05T11:00:00Z', endedAt: '2026-10-05T13:00:00Z', projectId: 12 },
    // 23:00 a 01:00 de Madrid: una hora el 6 y otra el 7.
    { id: 3, startedAt: '2026-10-06T21:00:00Z', endedAt: '2026-10-06T23:00:00Z', projectId: 11 },
  ];
  mt.actividad[MT.ana] = [
    { start: '2026-10-05T08:00:00Z', end: '2026-10-05T10:00:00Z', activityLevel: 50 },
    { start: '2026-10-05T10:00:00Z', end: '2026-10-05T13:00:00Z', activityLevel: 100 },
  ];
  mt.entradas[MT.beto] = [{ id: 4, startedAt: '2026-10-08T07:00:00Z', endedAt: '2026-10-08T10:00:00Z', projectId: 12 }];
}, 60000);

beforeEach(() => {
  mt.llamadas = [];
  vi.stubGlobal('fetch', vi.fn(fetchFalso));
  process.env.MONITASK_ACTIVO = '1';
});

afterAll(async () => {
  vi.unstubAllGlobals();
  delete process.env.MONITASK_ACTIVO;
  await esperarSync();
  for (const [sql, v] of [
    ['DELETE FROM monitask_avisos WHERE factura_id = ANY($1::int[])', ids.facturas],
    [`DELETE FROM admin_notifications WHERE type = 'monitask_descuadre' AND metadata->>'factura_id' = ANY($1::text[])`, ids.facturas.map(String)],
    ['DELETE FROM facturas_colaborador WHERE id = ANY($1::int[])', ids.facturas],
    ['DELETE FROM monitask_dias WHERE monitask_id = ANY($1::bigint[])', Object.values(MT)],
    ['DELETE FROM monitask_personas WHERE monitask_id = ANY($1::bigint[])', Object.values(MT)],
    ['DELETE FROM monitask_conexion WHERE id = 1', null],
    ['DELETE FROM colaborador_empresas WHERE colaborador_id = ANY($1::int[])', ids.colaboradores],
    ['DELETE FROM colaboradores WHERE id = ANY($1::int[])', ids.colaboradores],
    ['DELETE FROM user_projects WHERE project_id = $1', ids.project],
    ['DELETE FROM projects WHERE id = $1', ids.project],
    ['DELETE FROM invoice_issuers WHERE id = ANY($1::int[])', ids.issuers],
    ['DELETE FROM users WHERE id = ANY($1::int[])', ids.users],
  ]) {
    try { await query(sql, v === null ? [] : [v]); } catch { /* sigue limpiando */ }
  }
});

describe('#236 · con MONITASK_ACTIVO apagado no pasa nada', () => {
  it('las rutas y la vuelta del OAuth contestan 404, sin llamar a Monitask', async () => {
    delete process.env.MONITASK_ACTIVO;
    expect((await api.get('/api/monitask/estado').set(como(SUPER))).status).toBe(404);
    expect((await api.put('/api/monitask/conexion').set(como(SUPER)).send({ client_id: CLIENT_ID, client_secret: SECRETO })).status).toBe(404);
    expect((await api.get('/api/monitask/oauth/callback?code=COD-1&state=x')).status).toBe(404);
    expect(await servicio.sincronizar({ desde: '2026-10-01', hasta: '2026-10-31' }, {})).toEqual({ apagado: true });
    expect(await vueltaNocturna({ env: {} })).toEqual({ omitido: 'apagado' });
    expect(mt.llamadas).toEqual([]);
    expect(await conexion()).toBeUndefined();
  });
});

describe('#236 · permisos', () => {
  it('una gestora no entra (403); el admin ve, el superadmin configura', async () => {
    expect((await api.get('/api/monitask/estado').set(como(GESTORA))).status).toBe(403);
    expect((await api.get('/api/monitask/cotejo?mes=2026-10').set(como(GESTORA))).status).toBe(403);
    expect((await api.get('/api/monitask/estado').set(como(ADMIN_OTRA))).status).toBe(200);
    expect((await api.get('/api/monitask/estado')).status).toBe(401);
  });
});

describe('#236 · conectar por OAuth', () => {
  let state;

  it('guarda el Client ID y el secreto cifrado, y enseña la redirect URI exacta', async () => {
    const r = await api.put('/api/monitask/conexion').set(como(SUPER)).send({ client_id: CLIENT_ID, client_secret: SECRETO });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({
      client_id: CLIENT_ID, tiene_secreto: true, secreto_cola: SECRETO.slice(-4), conectada: false, redirect_uri: REDIRECT, margen_pct: 10,
    });
    expect(JSON.stringify(r.body)).not.toContain(SECRETO);
    const c = await conexion();
    expect(c.secreto_cifrado).not.toContain(SECRETO);
    expect(decrypt(c.secreto_cifrado, c.secreto_iv, c.secreto_tag)).toBe(SECRETO);
  });

  it('«Conectar» da la dirección de Monitask con PKCE', async () => {
    const r = await api.post('/api/monitask/conexion/autorizar').set(como(SUPER));
    expect(r.status).toBe(200);
    const u = new URL(r.body.data.url);
    expect(`${u.origin}${u.pathname}`).toBe('https://app.monitask.com/identity/connect/authorize');
    expect(u.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(u.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    state = u.searchParams.get('state');
    mt.challenge = u.searchParams.get('code_challenge');
    expect(state).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  });

  it('una vuelta con otro `state` se rechaza y no cambia el código', async () => {
    const r = await api.get('/api/monitask/oauth/callback?code=COD-1&state=inventado');
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe('https://crm.iseie.com/staging/accounting/integrations?monitask=error&motivo=estado_no_valido');
    expect(mt.pedidosDeToken).toEqual([]);
  });

  it('con el `state` bueno cambia el código por los tokens, cifrados, y el `state` no vale dos veces', async () => {
    mt.usuarios = [];   // la primera carga, que sale sola al conectar, sin nadie
    const r = await api.get(`/api/monitask/oauth/callback?code=COD-1&state=${state}`);
    expect(r.headers.location).toBe('https://crm.iseie.com/staging/accounting/integrations?monitask=conectado');
    await esperarSync();
    const c = await conexion();
    expect(c.access_cifrado).not.toContain('acc-1');
    expect(decrypt(c.access_cifrado, c.access_iv, c.access_tag)).toBe('acc-1');
    expect(decrypt(c.refresh_cifrado, c.refresh_iv, c.refresh_tag)).toBe('ref-1');
    expect(c.conectada_por).toBe(SUPER.id);
    expect(mt.pedidosDeToken[0]).toMatchObject({ grant_type: 'authorization_code', redirect_uri: REDIRECT });
    const otra = await api.get(`/api/monitask/oauth/callback?code=COD-1&state=${state}`);
    expect(otra.headers.location).toContain('motivo=estado_no_valido');
    const e = await api.get('/api/monitask/estado').set(como(SUPER));
    expect(e.body.data).toMatchObject({ conectada: true, renueva_sola: true });
    expect(JSON.stringify(e.body)).not.toMatch(/acc-1|ref-1/);
  });
});

describe('#236 · el token se renueva solo', () => {
  it('a punto de caducar, se renueva UNA vez aunque lo pidan tres a la vez, y se guarda el refresh nuevo', async () => {
    await query(`UPDATE monitask_conexion SET access_caduca_at = NOW() + interval '30 seconds' WHERE id = 1`);
    const antes = mt.pedidosDeToken.length;
    const tokens = await Promise.all([servicio.tokenVigente(), servicio.tokenVigente(), servicio.tokenVigente()]);
    expect(new Set(tokens)).toEqual(new Set(['acc-2']));
    expect(mt.pedidosDeToken.length - antes).toBe(1);
    expect(mt.pedidosDeToken.at(-1)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'ref-1' });
    const c = await conexion();
    expect(decrypt(c.refresh_cifrado, c.refresh_iv, c.refresh_tag)).toBe('ref-2');
    expect(new Date(c.access_caduca_at).getTime()).toBeGreaterThan(Date.now() + 3000 * 1000);
  });

  it('si la API contesta 401 con un token aún vigente, renueva y repite', async () => {
    mt.accessValido = 'revocado-en-monitask';
    mt.usuarios = [];
    await servicio.sincronizar({ desde: '2026-10-01', hasta: '2026-10-01' });
    expect(mt.llamadas.filter((l) => l.endsWith('/users'))).toHaveLength(2);
    expect(mt.pedidosDeToken.at(-1)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'ref-2' });
  });
});

describe('#236 · sincronizar y emparejar', () => {
  beforeAll(() => {
    mt.usuarios = [
      { id: MT.ana, firstName: 'Ana', lastName: MARCA, userName: `ANA@${marca}.test` },
      { id: MT.beto, firstName: 'Beto', lastName: MARCA, userName: `beto@${marca}.test` },
      { id: MT.carla, firstName: 'Carla', lastName: MARCA, userName: `carla@${marca}.test` },
    ];
  });

  it('trae a cada persona, resume por día de Madrid y no pide capturas', async () => {
    const r = await servicio.sincronizar({ desde: '2026-10-01', hasta: '2026-10-31' });
    expect(r).toMatchObject({ personas: 3, emparejadas: 2, sin_actividad: false });
    expect(r.errores).toEqual([]);
    const d5 = await dia(MT.ana, '2026-10-05');
    expect(d5).toMatchObject({ segundos: 5 * 3600, segundos_activos: 4 * 3600, entradas: 2 });
    expect(Number(d5.actividad_pct)).toBe(80);
    expect(d5.proyectos).toEqual([{ id: 11, nombre: 'CRM', segundos: 4 * 3600 }, { id: 12, nombre: 'Web', segundos: 3600 }]);
    expect(d5.tareas[0]).toMatchObject({ nombre: 'Maquetar landing', segundos: 4 * 3600 });
    expect((await dia(MT.ana, '2026-10-06')).segundos).toBe(3600);
    expect((await dia(MT.ana, '2026-10-07')).segundos).toBe(3600);
    expect((await dia(MT.beto, '2026-10-08')).segundos_activos).toBeNull();
    expect(mt.llamadas.some((l) => /screenshot/i.test(l))).toBe(false);
    // 31 días en tramos de 7: cinco peticiones de entradas por persona.
    expect(mt.llamadas.filter((l) => l.endsWith('/timeEntry/getByDateRange'))).toHaveLength(15);
  });

  it('empareja por correo: Ana con su ficha de colaborador, Beto con su usuario; Carla queda sin emparejar', async () => {
    expect(await persona(MT.ana)).toMatchObject({ colaborador_id: COL_ANA, emparejado: 'correo', correo: `ana@${marca}.test` });
    const beto = await persona(MT.beto);
    expect(beto).toMatchObject({ colaborador_id: null, emparejado: 'correo' });
    expect(beto.user_id).toBe(ids.users[3]);
    expect(await persona(MT.carla)).toMatchObject({ colaborador_id: null, user_id: null, emparejado: null });
  });

  it('a mano: Carla es Dani; la siguiente vuelta no lo pisa', async () => {
    const r = await api.patch(`/api/monitask/personas/${MT.carla}`).set(como(SUPER)).send({ colaborador_id: COL_DANI });
    expect(r.status).toBe(200);
    await servicio.sincronizar({ desde: '2026-10-01', hasta: '2026-10-31' });
    expect(await persona(MT.carla)).toMatchObject({ colaborador_id: COL_DANI, emparejado: 'manual', emparejado_por: SUPER.id });
  });

  it('volver a sincronizar no suma dos veces, y lo borrado en Monitask desaparece', async () => {
    const quitada = mt.entradas[MT.ana].pop();
    await servicio.sincronizar({ desde: '2026-10-01', hasta: '2026-10-31' });
    expect((await dia(MT.ana, '2026-10-05')).segundos).toBe(5 * 3600);
    expect(await dia(MT.ana, '2026-10-06')).toBeUndefined();
    mt.entradas[MT.ana].push(quitada);
    await servicio.sincronizar({ desde: '2026-10-01', hasta: '2026-10-31' });
    expect((await dia(MT.ana, '2026-10-06')).segundos).toBe(3600);
  });

  it('«Actividad»: horas, % y proyectos por persona; el admin de otra empresa no ve a Ana', async () => {
    const r = await api.get('/api/monitask/actividad?desde=2026-10-01&hasta=2026-10-31').set(como(SUPER));
    expect(r.status).toBe(200);
    const ana = r.body.data.find((p) => p.monitask_id === MT.ana);
    expect(ana).toMatchObject({ horas: 7, horas_activas: 4, dias: 3, colaborador_id: COL_ANA });
    expect(ana.actividad_pct).toBe(80);
    expect(ana.proyectos[0]).toEqual({ nombre: 'CRM', horas: 6 });
    const dias = await api.get(`/api/monitask/actividad/${MT.ana}/dias?desde=2026-10-01&hasta=2026-10-31`).set(como(SUPER));
    expect(dias.body.data.dias.map((d) => d.dia)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
    const otro = await api.get('/api/monitask/actividad?desde=2026-10-01&hasta=2026-10-31').set(como(ADMIN_OTRA));
    expect(otro.body.data.some((p) => p.monitask_id === MT.ana)).toBe(false);
    expect((await api.get(`/api/monitask/actividad/${MT.ana}/dias?desde=2026-10-01&hasta=2026-10-31`).set(como(ADMIN_OTRA))).status).toBe(404);
  });
});

describe('#236 · el cotejo con las facturas de colaboradores', () => {
  beforeAll(async () => {
    const f = await one(
      `INSERT INTO facturas_colaborador (colaborador_id, issuer_id, periodo, subida_at, importe, horas, numero_factura)
       VALUES ($1, $2, '2026-10-01', NOW(), 160, 8, $3) RETURNING id`, [COL_ANA, EMPRESA, `${MARCA}-A`]);
    const g = await one(
      `INSERT INTO facturas_colaborador (colaborador_id, issuer_id, periodo, subida_at, importe, horas, numero_factura)
       VALUES ($1, $2, '2026-10-01', NOW(), 900, NULL, $3) RETURNING id`, [COL_DANI, EMPRESA, `${MARCA}-D`]);
    ids.facturas.push(f.id, g.id);
  });

  it('factura 8 h y Monitask 7 h: +1 h, +14,29 %, en rojo con el margen del 10 %', async () => {
    const r = await api.get('/api/monitask/cotejo?mes=2026-10').set(como(SUPER));
    expect(r.status).toBe(200);
    const ana = r.body.data.filas.find((f) => f.colaborador_id === COL_ANA);
    expect(ana).toMatchObject({
      horas_facturadas: 8, horas_monitask: 7, diferencia_horas: 1, diferencia_pct: 14.29, fuera_de_margen: true, sin_cotejo: false,
    });
    expect(r.body.data.resumen.factura_de_mas).toContain(COL_ANA);
    // Dani cobra un fijo: solo actividad, sin cotejo.
    expect(r.body.data.filas.find((f) => f.colaborador_id === COL_DANI)).toMatchObject({ sin_cotejo: true, fuera_de_margen: false });
  });

  it('con un margen del 20 % ya no sale en rojo; el admin de otra empresa no ve a Ana', async () => {
    await api.put('/api/monitask/conexion').set(como(SUPER)).send({ client_id: CLIENT_ID, margen_pct: 20 });
    const r = await servicio.cotejo({ periodo: '2026-10-01', ambito: null, colaboradorId: COL_ANA });
    expect(r.filas[0]).toMatchObject({ fuera_de_margen: false, diferencia_pct: 14.29 });
    await api.put('/api/monitask/conexion').set(como(SUPER)).send({ client_id: CLIENT_ID, margen_pct: 10 });
    const otro = await api.get('/api/monitask/cotejo?mes=2026-10').set(como(ADMIN_OTRA));
    expect(otro.body.data.filas.some((f) => f.colaborador_id === COL_ANA)).toBe(false);
  });

  it('avisa en la campana de la factura sin pagar que se pasa, una sola vez', async () => {
    await query('DELETE FROM monitask_avisos WHERE factura_id = ANY($1::int[])', [ids.facturas]);
    const ahora = new Date('2026-11-17T12:00:00Z');
    expect(await servicio.avisarDescuadres({ ahora })).toBeGreaterThanOrEqual(1);
    const n = await one(`SELECT * FROM admin_notifications WHERE type = 'monitask_descuadre' AND metadata->>'factura_id' = $1`, [String(ids.facturas[0])]);
    expect(n.title).toContain('Ana');
    expect(n.target_user_ids).toContain(SUPER.id);
    expect(await servicio.avisarDescuadres({ ahora })).toBe(0);
    // La de Dani (fijo) no avisa nunca.
    expect(await one('SELECT 1 FROM monitask_avisos WHERE factura_id = $1', [ids.facturas[1]])).toBeUndefined();
  });
});

describe('#236 · la vuelta de cada noche', () => {
  it('antes de la hora no hace nada; después, una vez por día', async () => {
    const env = { MONITASK_ACTIVO: '1', CRM_BASE_URL: process.env.CRM_BASE_URL };
    expect(await vueltaNocturna({ ahora: new Date('2026-10-07T00:30:00Z'), env })).toEqual({ omitido: 'fuera de hora' });
    const r = await vueltaNocturna({ ahora: new Date('2026-10-07T02:30:00Z'), env });
    expect(r).toMatchObject({ personas: 3 });
    expect((await dia(MT.ana, '2026-10-05')).segundos).toBe(5 * 3600);
    expect(await vueltaNocturna({ ahora: new Date('2026-10-07T05:00:00Z'), env })).toEqual({ omitido: 'ya hecha hoy' });
  });
});

describe('#236 · si Monitask retira el permiso', () => {
  it('la renovación con invalid_grant borra los tokens y lo dice; sincronizar contesta 409', async () => {
    mt.refreshVivo = 'otro-ya-no-es-el-nuestro';
    await query(`UPDATE monitask_conexion SET access_caduca_at = NOW() - interval '1 minute' WHERE id = 1`);
    await expect(servicio.tokenVigente()).rejects.toMatchObject({ statusCode: 409, code: 'MONITASK_CADUCADO' });
    const c = await conexion();
    expect(c.access_cifrado).toBeNull();
    expect(c.refresh_cifrado).toBeNull();
    expect(c.ultimo_error).toContain('Conectar con Monitask');
    expect(c.client_id).toBe(CLIENT_ID);
    const r = await api.post('/api/monitask/sincronizar').set(como(SUPER)).send({});
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('MONITASK_SIN_CONECTAR');
  });
});
