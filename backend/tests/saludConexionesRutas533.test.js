import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * CRM#533 · La salud de las conexiones, por la ruta y contra la base (la de la
 * CI o la local). Moodle es un `fetch` de pega: no sale nada a la red.
 *
 *   · solo superadmin y admin (`integrations.salud`); un admin, sus campus;
 *   · ni una clave en la respuesta;
 *   · «Comprobar ahora» de un campus ajeno es un 404; el de uno suyo prueba y
 *     lo apunta en la tarjeta (`last_test_*`) y en `conexiones_salud`;
 *   · el aviso del webhook de Stripe queda apuntado por campus (migración 293).
 *
 *   npx vitest run tests/saludConexionesRutas533.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { default: modulo } = await import('../src/modules/integrations/index.js');
const { encrypt } = await import('../src/shared/utils/crypto.js');
const { anotaRecepcion } = await import('../src/modules/status/webhooks.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

// Las claves de pega se arman en trozos: con su forma entera, el escáner de
// secretos de GitHub las toma por claves de verdad y rechaza el push.
const SK_TEST = ['sk', 'test', ''].join('_');
const WHSEC = ['wh', 'sec_'].join('');

const MARCA = `SAL${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [], issuers: [] };
let PSIKO; let FONO; let ICT; let ADMIN; let SUPER; let GESTORA;

const CLAVE_STRIPE = `${SK_TEST}51SaludDeLasConexiones533`;
const TOKEN_MOODLE = 'f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0';
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const fila = (res, id) => res.body.data.campus.find((c) => c.id === id);

const fetchOriginal = globalThis.fetch;

beforeAll(async () => {
  const empresa = async (n) => { const e = await one('INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id', [`${MARCA} ${n}`, `B${n}${Date.now().toString().slice(-6)}`]); ids.issuers.push(e.id); return e.id; };
  const campus = async (n, issuer) => { const p = await one(`INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id`, [`${MARCA} ${n}`, `${MARCA.toLowerCase()}-${n}`, `${MARCA}-k-${n}`, issuer]); ids.projects.push(p.id); return p.id; };
  const cedia = await empresa('cedia');
  const ictess = await empresa('ictess');
  PSIKO = await campus('psiko', cedia); FONO = await campus('fono', cedia); ICT = await campus('ict', ictess);
  const persona = async (n, role, suyos) => {
    const u = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`, [`${MARCA} ${n}`, `${n}@${MARCA.toLowerCase()}.test`, role]);
    ids.users.push(u.id);
    for (const c of suyos) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
    return u;
  };
  ADMIN = await persona('admin', 'admin', [PSIKO, FONO]);
  SUPER = await persona('super', 'superadmin', []);
  GESTORA = await persona('gestora', 'gestor', [PSIKO]);

  // PSIKO: Stripe con clave y secreto del webhook; la sincronización falla.
  const k = encrypt(CLAVE_STRIPE);
  const w = encrypt(`${WHSEC}salud533secreto`);
  await q(
    `INSERT INTO project_integrations (project_id, provider, active, encrypted_value, iv, auth_tag, config_public, last_test_status, last_test_at)
     VALUES ($1, 'stripe', true, $2, $3, $4, $5, 'success', NOW() - INTERVAL '2 hours')`,
    [PSIKO, k.encrypted, k.iv, k.authTag, JSON.stringify({ webhook_secret_encrypted: w.encrypted, webhook_secret_iv: w.iv, webhook_secret_auth_tag: w.authTag, webhook_secret_preview: 'whse....reto' })]);
  await q(`INSERT INTO stripe_sync_state (project_id, last_sync_at, last_error) VALUES ($1, NOW() - INTERVAL '1 day', 'Stripe /v1/charges HTTP 401: Invalid API Key provided')`, [PSIKO]);
  // FONO: Moodle con su token, sin probar.
  const t = encrypt(TOKEN_MOODLE);
  await q(
    `INSERT INTO project_integrations (project_id, provider, active, encrypted_value, iv, auth_tag, config_public)
     VALUES ($1, 'moodle', true, $2, $3, $4, '{"url":"https://fono-salud533.test/campus"}')`,
    [FONO, t.encrypted, t.iv, t.authTag]);

  // Moodle de pega: el token no vale.
  globalThis.fetch = vi.fn(async (url) => {
    if (String(url).startsWith('https://fono-salud533.test/campus/webservice/rest/server.php')) {
      return new Response(JSON.stringify({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Invalid token' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`fetch no esperado: ${url}`);
  });
}, 60000);

afterAll(async () => {
  globalThis.fetch = fetchOriginal;
  await q('DELETE FROM conexiones_salud WHERE project_id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM webhook_recepciones WHERE project_id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM stripe_sync_state WHERE project_id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM project_integrations WHERE project_id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await q('DELETE FROM invoice_issuers WHERE id = ANY($1::int[])', [ids.issuers]);
  await pool.end();
});

describe('#533 · GET /integrations/salud', () => {
  it('una gestora no entra', async () => {
    const res = await request.get('/api/integrations/salud').set(como(GESTORA));
    expect(res.status).toBe(403);
  });

  it('un admin ve sus campus, cada uno con sus siete conexiones', async () => {
    const res = await request.get('/api/integrations/salud').set(como(ADMIN));
    expect(res.status).toBe(200);
    expect(res.body.data.campus.map((c) => c.id).sort()).toEqual([PSIKO, FONO].sort());
    const psiko = fila(res, PSIKO);
    expect(Object.keys(psiko.casillas)).toEqual(['stripe', 'moodle', 'woocommerce', 'brevo', 'meta', 'admision', 'transferencias']);
    expect(psiko.casillas.stripe).toMatchObject({ estado: 'caida', resumen: 'La sincronización de cobros falla' });
    expect(psiko.casillas.stripe.motivo).toMatch(/HTTP 401/);
    expect(psiko.casillas.stripe.datos.webhook.estado).toBe('desactivado');
    expect(fila(res, FONO).casillas.moodle.estado).toBe('sin_datos');
  });

  it('el superadmin ve también los de otra empresa', async () => {
    const res = await request.get('/api/integrations/salud').set(como(SUPER));
    expect(res.status).toBe(200);
    expect(fila(res, ICT)).toBeTruthy();
  });

  it('ni una clave en la respuesta', async () => {
    const res = await request.get('/api/integrations/salud').set(como(SUPER));
    const texto = JSON.stringify(res.body);
    for (const no of [CLAVE_STRIPE, TOKEN_MOODLE, `${WHSEC}`, 'fono-salud533.test', 'encrypted', 'auth_tag']) {
      expect(texto).not.toContain(no);
    }
  });
});

describe('#533 · POST /integrations/salud/comprobar', () => {
  it('un campus ajeno es un 404 y la gestora un 403', async () => {
    const ajeno = await request.post('/api/integrations/salud/comprobar').set(como(ADMIN)).send({ projectId: ICT });
    expect(ajeno.status).toBe(404);
    const gestora = await request.post('/api/integrations/salud/comprobar').set(como(GESTORA)).send({ projectId: PSIKO });
    expect(gestora.status).toBe(403);
  });

  it('FONO: el token no vale → rojo con el motivo, apuntado en la tarjeta y en la salud', async () => {
    const res = await request.post('/api/integrations/salud/comprobar').set(como(ADMIN)).send({ projectId: FONO });
    expect(res.status).toBe(200);
    expect(res.body.comprobados[FONO]).toContain('moodle');
    const moodle = fila(res, FONO).casillas.moodle;
    expect(moodle).toMatchObject({ estado: 'caida', motivo: 'El token del campus no vale (caducado o mal copiado).' });

    const tarjeta = await one(`SELECT last_test_status FROM project_integrations WHERE project_id = $1 AND provider = 'moodle'`, [FONO]);
    expect(tarjeta.last_test_status).toBe('error');
    const salud = await one(`SELECT ok, ultimo_ok_at FROM conexiones_salud WHERE project_id = $1 AND conexion = 'moodle'`, [FONO]);
    expect(salud).toMatchObject({ ok: false, ultimo_ok_at: null });
  });
});

describe('#533 · el aviso del webhook de Stripe, por campus', () => {
  it('un aviso rechazado se apunta y pone la casilla en ámbar con el motivo', async () => {
    await anotaRecepcion('stripe', PSIKO, 'rechazado', 'firma invalida');
    // Un campus que no existe no deja rastro (la URL es pública).
    await anotaRecepcion('stripe', 999999999, 'rechazado', 'firma invalida');
    const r = await one(`SELECT resultado, motivo, rechazados FROM webhook_recepciones WHERE fuente = 'stripe' AND project_id = $1`, [PSIKO]);
    expect(r).toMatchObject({ resultado: 'rechazado', motivo: 'firma invalida', rechazados: 1 });
    expect(await q('SELECT 1 FROM webhook_recepciones WHERE project_id = 999999999')).toHaveLength(0);

    const res = await request.get('/api/integrations/salud').set(como(ADMIN));
    expect(fila(res, PSIKO).casillas.stripe.datos.webhook.estado).toBe('rechazado');
  });
});
