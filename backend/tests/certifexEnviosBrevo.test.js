// Justificante del envío del diploma (Diego, 05/11/2026), contra la base de verdad.
//
// La ficha del diploma enseña sus correos: Certifex da el diploma y el correo del alumno, y
// Brevo (la misma cuenta que usa Certifex) los eventos de ese correo. Lo ve quien ve
// Diplomas (`diplomas.view`), y solo de sus campus. Brevo es opcional: sin clave o si falla,
// 200 con la lista vacía y el motivo, nunca 500; y la clave no sale nunca.
//
// Ni Certifex ni Brevo se tocan: `fetch` se sustituye por uno que contesta como los dos.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

process.env.CERTIFEX_WEBHOOK_SECRETO = 'secreto-de-prueba-envios';
process.env.CERTIFEX_API_URL = 'https://certifex-envios.test';
process.env.CERTIFEX_CRM_CLAVE = 'cfx_crm_clave-de-prueba-envios';
const CLAVE_BREVO = 'xkeysib-clave-de-prueba-que-no-debe-salir';

const { default: supertest } = await import('supertest');
const { default: jwt } = await import('jsonwebtoken');
const { default: app } = await import('../src/app.js');
const { default: pool } = await import('../src/shared/config/db.js');
const { agruparEventos, esDeDiploma } = await import('../src/modules/certifex/certifex.envios.js');

const request = supertest(app);
const sufijo = `${Date.now()}`.slice(-7);
const [MIO, AJENO] = ['QEVUNO', 'QEVDOS'];
const NEXP_MIO = 'CEDIA-2026-000890-B5HQ';
const NEXP_AJENO = 'CEDIA-2026-000891-B5HQ';
const NEXP_SIN_CORREO = 'CEDIA-2026-000892-B5HQ';
const CORREO = 'ana.alumna@example.com';
const MSG = '<202611051828.1234@smtp-relay.mailin.fr>';

const diploma = (nexpediente, centro, alumno = 'Ana García Ruiz') => ({
  nexpediente, centro, alumno, titulacion: 'Máster en Psicología Clínica', cursoRef: 12, emitidoEn: '2026-11-05T10:00:00Z',
  emitidaPor: 'x', revocada: false, revocacion: null, verificarUrl: null, diplomaUrl: null, aviso: null,
});
const candidato = (nexpediente, centro, email) => ({ matriculaId: 1, centro, nexpediente, titular: { nombre: 'Ana García Ruiz', email, dni: null }, curso: { ref: 12, nombre: 'Máster' } });

const EVENTOS = [
  { email: CORREO, date: '2026-11-05T19:40:00.000+01:00', subject: 'Tu diploma está disponible', messageId: MSG, event: 'opened', from: 'no-reply@certifex.tech' },
  { email: CORREO, date: '2026-11-05T19:28:05.000+01:00', subject: 'Tu diploma está disponible', messageId: MSG, event: 'delivered', from: 'no-reply@certifex.tech' },
  { email: CORREO, date: '2026-11-05T19:28:01.000+01:00', subject: 'Tu diploma está disponible', messageId: MSG, event: 'requests', from: 'no-reply@certifex.tech' },
  // Otro correo a la misma dirección, que no es del diploma: fuera.
  { email: CORREO, date: '2026-11-04T10:00:00.000+01:00', subject: 'Tu cita de mañana', messageId: '<otro@x>', event: 'delivered', from: 'avisos@crm.test' },
];

let brevo = { modo: 'ok' };
let pedidas = [];
function certifex(p) {
  if (p.ruta === '/yo') return { status: 200, body: { nombre: 'CRM local', centros: [MIO, AJENO] } };
  if (p.ruta === '/diplomas') {
    const avisado = { ...diploma(NEXP_MIO, MIO), emitidaPor: 'x (CRM local)', aviso: { resultado: 'enviado', en: '2026-11-05T18:28:00.000Z', por: `${gente.conPermiso.email} (CRM local)` } };
    const filas = [avisado, diploma(NEXP_AJENO, AJENO), diploma(NEXP_SIN_CORREO, MIO, 'Luis Sin Correo')]
      .filter((d) => !p.query.q || d.nexpediente.includes(p.query.q));
    return { status: 200, body: { filas, total: filas.length, pagina: 1, tam: 5 } };
  }
  if (p.ruta === '/candidatos') {
    const filas = [candidato(NEXP_MIO, MIO, CORREO), candidato(NEXP_AJENO, AJENO, CORREO), candidato(NEXP_SIN_CORREO, MIO, null)];
    return { status: 200, body: { filas, total: filas.length, pagina: 1, tam: 200 } };
  }
  return { status: 404, body: { error: 'No encontrado.' } };
}

const fetchReal = globalThis.fetch;
const proyectos = [];
const gente = {};
const como = (quien) => (req) => req.set('Authorization', `Bearer ${gente[quien].token}`);

async function persona(clave, role, campus, { verDiplomas = false } = {}) {
  const { rows: [u] } = await pool.query(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, email`,
    [`Envios ${clave}`, `envios.${clave}.${sufijo}@prueba.test`, role]);
  for (const pid of campus) await pool.query('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, pid]);
  if (verDiplomas) {
    await pool.query(`INSERT INTO user_permission_overrides (user_id, resource, action, allowed) VALUES ($1, 'diplomas', 'view', true)`, [u.id]);
  }
  gente[clave] = { ...u, token: jwt.sign({ userId: u.id, email: u.email, role, roles_extra: [] }, process.env.JWT_SECRET, { expiresIn: '5m' }) };
}

beforeAll(async () => {
  for (const codigo of [MIO, AJENO]) {
    proyectos.push((await pool.query(
      `INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, 'whk_test') RETURNING id`,
      [`${codigo} campus`, `${codigo.toLowerCase()}-${sufijo}`])).rows[0].id);
  }
  await persona('conPermiso', 'gestor', [proyectos[0]], { verDiplomas: true });
  await persona('sinPermiso', 'gestor', [proyectos[0]]);
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = new URL(String(url));
    if (u.origin === 'https://api.brevo.com') {
      pedidas.push({ brevo: true, query: Object.fromEntries(u.searchParams), clave: opts.headers?.['api-key'] });
      if (brevo.modo === 'cae') throw new TypeError('fetch failed');
      if (brevo.modo === '401') return new Response(JSON.stringify({ message: 'Key not found' }), { status: 401 });
      const events = EVENTOS.filter((e) => e.email === u.searchParams.get('email'));
      return new Response(JSON.stringify({ events }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (!String(url).startsWith('https://certifex-envios.test/')) return fetchReal(url, opts);
    const p = { ruta: u.pathname.replace('/api/crm/v1', ''), query: Object.fromEntries(u.searchParams) };
    pedidas.push(p);
    const r = certifex(p);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  });
});
afterAll(async () => {
  globalThis.fetch = fetchReal;
  delete process.env.BREVO_API_KEY;
  const ids = Object.values(gente).map((g) => g.id);
  await pool.query('DELETE FROM user_permission_overrides WHERE user_id = ANY($1::int[])', [ids]);
  await pool.query('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids]);
  await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [ids]);
  await pool.query('DELETE FROM projects WHERE id = ANY($1::int[])', [proyectos]);
  await pool.end();
});
beforeEach(() => {
  pedidas = [];
  brevo = { modo: 'ok' };
  process.env.BREVO_API_KEY = CLAVE_BREVO;
});

const pedir = (exp, quien = 'conPermiso') => como(quien)(request.get(`/api/certifex/diplomas/envios?exp=${encodeURIComponent(exp)}`));

describe('GET /api/certifex/diplomas/envios', () => {
  it('con diplomas.view: los correos del diploma, agrupados, con fechas, asunto, remitente e identificador', async () => {
    const r = await pedir(NEXP_MIO.toLowerCase());
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ nexpediente: NEXP_MIO, centro: MIO, alumno: 'Ana García Ruiz', email: CORREO, motivo: null });
    expect(r.body.data.envios).toEqual([{
      messageId: MSG, asunto: 'Tu diploma está disponible', remitente: 'no-reply@certifex.tech', destinatario: CORREO,
      enviadoEn: '2026-11-05T18:28:01.000Z', entregadoEn: '2026-11-05T18:28:05.000Z', abiertoEn: '2026-11-05T18:40:00.000Z', problemas: [],
    }]);
    const aBrevo = pedidas.find((p) => p.brevo);
    expect(aBrevo.query).toEqual({ email: CORREO, days: '90', limit: '50', sort: 'desc' });
    // La clave va a Brevo y a ningún otro sitio: tampoco en la respuesta.
    expect(JSON.stringify(r.body)).not.toContain(CLAVE_BREVO);
  });

  it('un diploma de otro campus, como si no existiera (404), sin preguntar a Brevo', async () => {
    expect((await pedir(NEXP_AJENO)).status).toBe(404);
    expect(pedidas.some((p) => p.brevo)).toBe(false);
  });

  it('sin el permiso, 403 y nada sale del CRM', async () => {
    expect((await pedir(NEXP_MIO, 'sinPermiso')).status).toBe(403);
    expect(pedidas).toHaveLength(0);
  });

  it('expediente raro: 400; que no existe: 404', async () => {
    expect((await pedir('no-es-un-numero')).status).toBe(400);
    expect((await pedir('CEDIA-2026-000999-ZZZZ')).status).toBe(404);
  });

  it('sin clave de Brevo: 200, lista vacía y el motivo', async () => {
    process.env.BREVO_API_KEY = '';
    const r = await pedir(NEXP_MIO);
    expect(r.status).toBe(200);
    expect(r.body.data.envios).toEqual([]);
    expect(r.body.data.motivo).toMatch(/Brevo no está configurado/);
  });

  it('Brevo caído o con la clave mal: 200 con el motivo, nunca 500', async () => {
    brevo.modo = 'cae';
    let r = await pedir(NEXP_MIO);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ envios: [], motivo: expect.stringMatching(/Brevo no responde/) });
    brevo.modo = '401';
    r = await pedir(NEXP_MIO);
    expect(r.status).toBe(200);
    expect(r.body.data.motivo).toMatch(/Brevo respondió 401/);
    expect(JSON.stringify(r.body)).not.toContain(CLAVE_BREVO);
  });

  it('el alumno sin correo en Certifex: 200 y lo dice', async () => {
    const r = await pedir(NEXP_SIN_CORREO);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ email: null, envios: [], motivo: expect.stringMatching(/no tiene el correo/) });
  });
});

describe('«Aviso al alumno» en Emitidos', () => {
  it('cada fila trae a QUIÉN se manda (el titular) y el nombre de quien lo aprobó', async () => {
    const r = await como('conPermiso')(request.get(`/api/certifex/diplomas?estado=vigentes&centro=${MIO}`));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = r.body.data.filas.find((x) => x.nexpediente === NEXP_MIO);
    expect(d.titularEmail).toBe(CORREO);
    expect(d.aviso).toMatchObject({ resultado: 'enviado', porNombre: 'Envios conPermiso' });
    // Lo emitido fuera del CRM y sin aviso no se busca: sin correo, sin romper nada.
    expect(r.body.data.filas.find((x) => x.nexpediente === NEXP_SIN_CORREO).titularEmail).toBeNull();
  });
});

describe('agruparEventos', () => {
  it('rebotes y errores van aparte, y lo más reciente primero', () => {
    const g = agruparEventos([
      { messageId: '<a>', date: '2026-11-01T10:00:00Z', event: 'requests', subject: 'Tu diploma', from: 'no-reply@certifex.tech', email: 'x@example.com' },
      { messageId: '<a>', date: '2026-11-01T10:00:09Z', event: 'hardBounces', reason: 'mailbox does not exist' },
      { messageId: '<b>', date: '2026-11-03T10:00:00Z', event: 'requests', subject: 'Tu diploma' },
    ]);
    expect(g.map((x) => x.messageId)).toEqual(['<b>', '<a>']);
    expect(g[1].problemas).toEqual([{ evento: 'hardBounces', fecha: '2026-11-01T10:00:09.000Z', motivo: 'mailbox does not exist' }]);
    expect(g[1].entregadoEn).toBeNull();
  });

  it('se queda con los correos de diploma (asunto) o de Certifex (remitente)', () => {
    expect(esDeDiploma({ subject: 'Your diploma is available' })).toBe(true);
    expect(esDeDiploma({ subject: 'Tu DIPLOMA está disponible' })).toBe(true);
    expect(esDeDiploma({ subject: 'Recordatorio', from: 'no-reply@certifex.tech' })).toBe(true);
    expect(esDeDiploma({ subject: 'Tu cita de mañana', from: 'avisos@crm.test' })).toBe(false);
  });
});
