// Justificante del envío del diploma (Diego, 05/11/2026), contra la base de verdad.
//
// «Necesito poder demostrar que el correo con el diploma salió»: la ficha del diploma
// enseña sus envíos (de Certifex, GET /api/crm/v1/envios) y descarga un PDF con la fecha y
// hora (Madrid y UTC), el destinatario, el asunto, el identificador de Brevo y quién lo
// aprobó. Lo ve quien ve Diplomas (`diplomas.view`), y solo de sus campus.
//
// Certifex no se toca: `fetch` se sustituye por uno que contesta como su API.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';

process.env.CERTIFEX_WEBHOOK_SECRETO = 'secreto-de-prueba-justificante';
process.env.CERTIFEX_API_URL = 'https://certifex-justificante.test';
process.env.CERTIFEX_CRM_CLAVE = 'cfx_crm_clave-de-prueba-justificante';

const { default: supertest } = await import('supertest');
const { default: jwt } = await import('jsonwebtoken');
const { default: app } = await import('../src/app.js');
const { default: pool } = await import('../src/shared/config/db.js');
const { contenidoJustificante, fechaHora, resultadoEnTexto } = await import('../src/modules/certifex/certifex.justificante.js');

const request = supertest(app);
const sufijo = `${Date.now()}`.slice(-7);
// Códigos que no casan con ningún otro proyecto y ninguno empieza por otro.
const [MIO, AJENO] = ['QJXUNO', 'QJXDOS'];
const NEXP_MIO = 'CTF-2026-000880-AAAA';
const NEXP_AJENO = 'CTF-2026-000881-AAAA';
const NEXP_ANTIGUO = 'CTF-2026-000882-AAAA';
const NEXP_SIN_ENVIOS = 'CTF-2026-000883-AAAA';
const MSG_ID = '<202611051303.1234@smtp-relay.mailin.fr>';

const credencial = (nexpediente, centro) => ({
  nexpediente, centro, alumno: 'Ana García Ruiz', titulacion: 'Máster en Psicología Clínica', emitidoEn: '2026-11-04T10:00:00Z', revocada: false,
});
const ENVIADO = {
  id: 41, tipo: 'credencial', en: '2026-11-05T13:03:12.000Z', resultado: 'enviado', aprobadoPor: 'gestora@prueba.test (CRM local)',
  destinatario: 'ana.alumna@example.com', asunto: 'Tu diploma está disponible', messageId: MSG_ID, sinDetalle: false,
};
const APAGADO = {
  id: 40, tipo: 'credencial', en: '2026-11-05T12:00:00.000Z', resultado: 'correo_apagado', aprobadoPor: 'gestora@prueba.test (CRM local)',
  destinatario: 'ana.alumna@example.com', asunto: null, messageId: null, sinDetalle: false,
};
const ANTIGUO = {
  id: 12, tipo: 'credencial', en: '2026-10-20T09:30:00.000Z', resultado: 'enviado', aprobadoPor: 'gestora@prueba.test (CRM local)',
  destinatario: null, asunto: null, messageId: null, sinDetalle: true,
};

let pedidas = [];
function certifex(p) {
  if (p.ruta === '/yo') return { status: 200, body: { nombre: 'CRM local', centros: [MIO, AJENO] } };
  if (p.ruta === '/envios') {
    const n = p.query.nexpediente;
    const conEstado = (e) => (p.query.estado === '1' && e.messageId
      ? { ...e, brevo: { ok: true, eventos: [{ evento: 'delivered', fecha: '2026-11-05T13:03:15.000Z', motivo: null }] } }
      : e);
    if (n === NEXP_MIO) return { status: 200, body: { credencial: credencial(n, MIO), matricula: null, envios: [ENVIADO, APAGADO].map(conEstado) } };
    if (n === NEXP_AJENO) return { status: 200, body: { credencial: credencial(n, AJENO), matricula: null, envios: [ENVIADO] } };
    if (n === NEXP_ANTIGUO) return { status: 200, body: { credencial: credencial(n, MIO), matricula: null, envios: [ANTIGUO] } };
    if (n === NEXP_SIN_ENVIOS) return { status: 200, body: { credencial: credencial(n, MIO), matricula: null, envios: [] } };
    return { status: 404, body: { error: 'Credencial no encontrada.' } };
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
    [`Justificante ${clave}`, `justificante.${clave}.${sufijo}@prueba.test`, role]);
  for (const pid of campus) await pool.query('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, pid]);
  if (verDiplomas) {
    await pool.query(
      `INSERT INTO user_permission_overrides (user_id, resource, action, allowed) VALUES ($1, 'diplomas', 'view', true)`, [u.id]);
  }
  gente[clave] = { ...u, token: jwt.sign({ userId: u.id, email: u.email, role, roles_extra: [] }, process.env.JWT_SECRET, { expiresIn: '5m' }) };
}

/**
 * El texto de un PDF de pdf-lib: sus contenidos van comprimidos (FlateDecode) y Helvetica
 * escribe cada línea como una cadena hexadecimal en Windows-1252 (latin1 para lo nuestro).
 */
function textoDelPdf(buf) {
  const s = buf.toString('latin1');
  const contenidos = [];
  for (const m of s.matchAll(/stream\r?\n/g)) {
    const ini = m.index + m[0].length;
    const fin = s.indexOf('endstream', ini);
    try { contenidos.push(inflateSync(buf.subarray(ini, fin)).toString('latin1')); } catch { /* no es Flate */ }
  }
  return contenidos.join('\n').split('\n')
    .flatMap((l) => [...l.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)].map((x) => Buffer.from(x[1], 'hex').toString('latin1')))
    .join('\n');
}

beforeAll(async () => {
  for (const codigo of [MIO, AJENO]) {
    proyectos.push((await pool.query(
      `INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, 'whk_test') RETURNING id`,
      [`${codigo} campus`, `${codigo.toLowerCase()}-${sufijo}`])).rows[0].id);
  }
  await persona('conPermiso', 'gestor', [proyectos[0]], { verDiplomas: true });
  await persona('sinPermiso', 'gestor', [proyectos[0]]);
  await persona('super', 'superadmin', []);
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    if (!String(url).startsWith('https://certifex-justificante.test/')) return fetchReal(url, opts);
    const u = new URL(String(url));
    const p = { ruta: u.pathname.replace('/api/crm/v1', ''), query: Object.fromEntries(u.searchParams), metodo: opts.method };
    pedidas.push(p);
    const r = certifex(p);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  });
});
afterAll(async () => {
  globalThis.fetch = fetchReal;
  const ids = Object.values(gente).map((g) => g.id);
  await pool.query('DELETE FROM user_permission_overrides WHERE user_id = ANY($1::int[])', [ids]);
  await pool.query('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids]);
  await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [ids]);
  await pool.query('DELETE FROM projects WHERE id = ANY($1::int[])', [proyectos]);
  await pool.end();
});
beforeEach(() => { pedidas = []; });

describe('Envíos de la ficha del diploma', () => {
  it('con diplomas.view: los envíos de un diploma de su campus, tal cual los da Certifex', async () => {
    const r = await como('conPermiso')(request.get(`/api/certifex/diplomas/${NEXP_MIO}/envios`));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.credencial).toMatchObject({ nexpediente: NEXP_MIO, centro: MIO });
    expect(r.body.data.envios.map((e) => e.id)).toEqual([41, 40]);
    expect(r.body.data.envios[0]).toMatchObject({ destinatario: 'ana.alumna@example.com', messageId: MSG_ID });
    expect(pedidas.find((p) => p.ruta === '/envios').query).toEqual({ nexpediente: NEXP_MIO });
  });

  it('un diploma de otro campus, como si no existiera (404)', async () => {
    const r = await como('conPermiso')(request.get(`/api/certifex/diplomas/${NEXP_AJENO}/envios`));
    expect(r.status).toBe(404);
    expect((await como('conPermiso')(request.get(`/api/certifex/diplomas/${NEXP_AJENO}/justificante`))).status).toBe(404);
  });

  it('sin el permiso, 403 y nada llega a Certifex', async () => {
    expect((await como('sinPermiso')(request.get(`/api/certifex/diplomas/${NEXP_MIO}/envios`))).status).toBe(403);
    expect((await como('sinPermiso')(request.get(`/api/certifex/diplomas/${NEXP_MIO}/justificante`))).status).toBe(403);
    expect(pedidas).toHaveLength(0);
  });

  it('un número de expediente raro: 400', async () => {
    expect((await como('conPermiso')(request.get('/api/certifex/diplomas/no-es-un-numero/envios'))).status).toBe(400);
  });

  it('el super admin ve los de cualquier campus', async () => {
    expect((await como('super')(request.get(`/api/certifex/diplomas/${NEXP_AJENO}/envios`))).status).toBe(200);
  });
});

describe('Descargar justificante (PDF)', () => {
  it('el del último envío: un PDF de una página con todo lo pedido y el estado de Brevo', async () => {
    const r = await como('conPermiso')(request.get(`/api/certifex/diplomas/${NEXP_MIO}/justificante`)).buffer(true).parse((res, cb) => {
      const trozos = [];
      res.on('data', (c) => trozos.push(c));
      res.on('end', () => cb(null, Buffer.concat(trozos)));
    });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('application/pdf');
    expect(r.headers['content-disposition']).toContain(`justificante-envio-${NEXP_MIO}.pdf`);
    expect(r.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await PDFDocument.load(r.body)).getPageCount()).toBe(1);
    const t = textoDelPdf(r.body);
    for (const esperado of [
      'Justificante de envío del diploma', 'Ana García Ruiz', 'Máster en Psicología Clínica', NEXP_MIO,
      '05/11/2026 14:03:12 (hora de Madrid)', '05/11/2026 13:03:12 (UTC)', 'ana.alumna@example.com',
      'Tu diploma está disponible', 'gestora@prueba.test (CRM local)', 'Enviado', 'Entregado al servidor del destinatario',
      'desde el CRM',
    ]) expect(t, esperado).toContain(esperado);
    // El identificador va en Courier y puede partirse en dos líneas: sin saltos, entero.
    expect(t.replace(/\n/g, '')).toContain(MSG_ID);
    // Para el PDF se pide el estado a Brevo.
    expect(pedidas.find((p) => p.ruta === '/envios').query).toEqual({ nexpediente: NEXP_MIO, estado: '1' });
  });

  it('uno concreto (?envio=): el que no salió dice por qué', async () => {
    const r = await como('conPermiso')(request.get(`/api/certifex/diplomas/${NEXP_MIO}/justificante?envio=40`)).buffer(true).parse((res, cb) => {
      const trozos = [];
      res.on('data', (c) => trozos.push(c));
      res.on('end', () => cb(null, Buffer.concat(trozos)));
    });
    expect(r.status).toBe(200);
    expect(textoDelPdf(r.body)).toContain('No ha salido: el envío de correo estaba apagado en Certifex');
    expect((await como('conPermiso')(request.get(`/api/certifex/diplomas/${NEXP_MIO}/justificante?envio=999`))).status).toBe(404);
    expect((await como('conPermiso')(request.get(`/api/certifex/diplomas/${NEXP_MIO}/justificante?envio=abc`))).status).toBe(400);
  });

  it('un envío de antes del cambio: dice lo que hay y que el resto no se guardaba', async () => {
    const r = await como('conPermiso')(request.get(`/api/certifex/diplomas/${NEXP_ANTIGUO}/justificante`)).buffer(true).parse((res, cb) => {
      const trozos = [];
      res.on('data', (c) => trozos.push(c));
      res.on('end', () => cb(null, Buffer.concat(trozos)));
    });
    expect(r.status).toBe(200);
    const t = textoDelPdf(r.body).replace(/\n/g, ' ');
    expect(t).toContain('20/10/2026 11:30:00 (hora de Madrid)');
    expect(t).toContain('No consta');
    expect(t).toContain('anterior a que Certifex guardara el destinatario');
  });

  it('sin ningún envío: 404 con el motivo', async () => {
    const r = await como('conPermiso')(request.get(`/api/certifex/diplomas/${NEXP_SIN_ENVIOS}/justificante`));
    expect(r.status).toBe(404);
  });
});

describe('contenidoJustificante', () => {
  it('Madrid en invierno y en verano, y UTC', () => {
    expect(fechaHora('2026-11-05T13:03:12Z')).toBe('05/11/2026 14:03:12');
    expect(fechaHora('2026-07-05T13:03:12Z')).toBe('05/07/2026 15:03:12');
    expect(fechaHora('2026-11-05T23:30:00Z', 'UTC')).toBe('05/11/2026 23:30:00');
    expect(fechaHora('2026-11-05T23:30:00Z')).toBe('06/11/2026 00:30:00');
  });

  it('los motivos de lo que no salió', () => {
    expect(resultadoEnTexto('enviado')).toBe('Enviado');
    expect(resultadoEnTexto('sin_correo')).toBe('No ha salido: el alumno no tenía correo en Certifex');
    expect(resultadoEnTexto('error')).toBe('No ha salido: Brevo devolvió un error al enviarlo');
  });

  it('nota de generación con la fecha y quién; Brevo sin eventos o sin respuesta, dicho', () => {
    const c = contenidoJustificante({
      credencial: credencial(NEXP_MIO, MIO), envio: { ...ENVIADO, brevo: { ok: false, motivo: 'Brevo no contestó a tiempo.' } },
      generadoPor: 'admin@prueba.test', ahora: new Date('2026-11-05T15:00:00Z'),
    });
    expect(c.pie).toMatch(/^Generado el 05\/11\/2026 16:00 \(hora de Madrid\) desde el CRM por admin@prueba\.test/);
    expect(c.brevo[0]).toContain('Brevo no contestó a tiempo.');
    const sin = contenidoJustificante({ credencial: credencial(NEXP_MIO, MIO), envio: { ...ENVIADO, brevo: { ok: true, eventos: [] } } });
    expect(sin.brevo[0]).toMatch(/no conserva ya eventos/);
  });
});
