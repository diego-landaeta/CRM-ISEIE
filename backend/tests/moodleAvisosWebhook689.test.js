import {
  describe, it, expect, vi, afterEach, beforeEach,
} from 'vitest';
import express from 'express';
import supertest from 'supertest';

/**
 * Lo que llama el plugin desde cada Moodle (`/api/moodle-avisos`), con Zod y con límite de
 * ritmo (revisión de la PR #689, punto 8e):
 *   · la firma se comprueba ANTES de leer el cuerpo: sin firma buena, 401 aunque el cuerpo
 *     esté roto;
 *   · con la firma buena, un aviso que no tiene la forma del plugin es un 400 de Zod y no
 *     llega a la base;
 *   · una ráfaga de avisos de un campus da 429 (el plugin reintenta luego); otro campus no
 *     se entera;
 *   · /conectar valida el cuerpo con topes antes de buscar el código;
 *   · /plugin/* también tiene su límite.
 *
 * Sin base: `query` es de mentira (la clave del campus y nada más).
 */

const SECRETO = 'secreto-del-plugin';
const llamadas = [];
const query = vi.fn(async (sql) => {
  llamadas.push(String(sql));
  if (/SELECT secreto_cifrado/.test(sql)) {
    const { encrypt } = await import('../src/shared/utils/crypto.js');
    const e = encrypt(SECRETO);
    return { rows: [{ secreto_cifrado: e.encrypted, secreto_iv: e.iv, secreto_tag: e.authTag }], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
});
vi.mock('../src/shared/config/db.js', () => ({
  query,
  getClient: vi.fn(async () => ({ query, release: () => {} })),
}));
const conectarCampus = vi.fn(async () => ({ ok: true, campus: 'Campus', avisos: 'https://crm.test/api/moodle-avisos/4', secreto: 's' }));
vi.mock('../src/modules/consultas/consultas.conexion.js', () => ({ conectarCampus }));

const { default: webhook } = await import('../src/modules/consultas/consultas.webhook.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { firmar } = await import('../src/modules/consultas/consultas.plugin.js');
const { avisoSchema } = await import('../src/modules/consultas/consultas.validation.js');

const app = express();
app.use('/api/moodle-avisos', webhook);
app.use(errorHandler);
const api = supertest(app);

/** Un POST del plugin, firmado (o no) con la clave del campus. */
function avisar(projectId, cuerpo, { firma = true } = {}) {
  const crudo = typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
  const r = api.post(`/api/moodle-avisos/${projectId}`).set('Content-Type', 'application/json');
  if (firma) r.set('X-Crm-Firma', firmar(Buffer.from(crudo), SECRETO, Math.floor(Date.now() / 1000)));
  return r.send(crudo);
}

const privado = () => ({
  evento: 'mensaje',
  mensaje: { id: 10, conversacion_id: 20, curso_id: null, html: '<p>Hola</p>', fecha: 1762000000 },
  de: { id: 900, nombre: 'Alumna', email: 'a@test.local', personal: false },
  para: [{ id: 701, nombre: 'Laura', personal: true }],
});

beforeEach(() => { llamadas.length = 0; conectarCampus.mockClear(); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('8e · el aviso: primero la firma, después Zod', () => {
  it('sin firma, 401, aunque el cuerpo esté roto', async () => {
    const r = await avisar(1, '{esto no es json', { firma: false });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('INVALID_SIGNATURE');
  });

  it('con firma buena, lo que no es JSON es un 400', async () => {
    const r = await avisar(1, '{esto no es json');
    expect(r.status).toBe(400);
  });

  it('con firma buena, un aviso sin a quién va es un 400 de Zod y no toca las consultas', async () => {
    const a = privado();
    delete a.para;
    const r = await avisar(1, a);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
    expect(r.body.error).toMatch(/para/);
    expect(llamadas.some((s) => /consultas|consulta_mensajes/.test(s))).toBe(false);
  });

  it('ids que no son números, un evento que no es «mensaje» o un texto enorme: 400', async () => {
    for (const roto of [
      { ...privado(), mensaje: { ...privado().mensaje, id: 'abc' } },
      { ...privado(), de: { id: -3 } },
      { ...privado(), evento: 'otra_cosa' },
      { ...privado(), mensaje: { ...privado().mensaje, html: 'x'.repeat(1_000_001) } },
    ]) {
      const r = await avisar(1, roto);
      expect(r.status, JSON.stringify(roto).slice(0, 80)).toBe(400);
      expect(r.body.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('8e · el esquema del aviso acepta lo que manda el plugin', () => {
  const grupoPlugin = {
    ...privado(),
    mensaje: { ...privado().mensaje, curso_id: 7, tipo: 'grupo' },
    grupo: { alumno: { id: 900, nombre: 'Alumna' }, curso: { id: 7, nombre: 'Curso' }, miembros: [{ id: 900, tutora: false, alumno: true }] },
  };
  const grupoCurso = {
    ...privado(),
    para: [],
    mensaje: { ...privado().mensaje, curso_id: 7, tipo: 'grupo_curso' },
    de: { id: 701, nombre: 'Laura', personal: true, tutora: true },
    grupo: { tipo: 'curso', nombre: 'Grupo A', alumno: null, curso: { id: 7, nombre: 'Curso' }, miembros: [] },
  };
  it('privado, chat de grupo del plugin y grupo del curso (con una tutora que escribe: sin alumno)', () => {
    expect(avisoSchema.safeParse(privado()).success).toBe(true);
    expect(avisoSchema.safeParse(grupoPlugin).success).toBe(true);
    expect(avisoSchema.safeParse(grupoCurso).success).toBe(true);
    // Los ids de PHP pueden venir como texto: se quedan en número.
    const r = avisoSchema.safeParse({ ...privado(), mensaje: { ...privado().mensaje, id: '10' } });
    expect(r.success && r.data.mensaje.id).toBe(10);
  });
  it('un chat de grupo del plugin sin su alumno no vale', () => {
    expect(avisoSchema.safeParse({ ...grupoPlugin, grupo: { ...grupoPlugin.grupo, alumno: null } }).success).toBe(false);
  });
});

describe('8e · límite de ritmo', () => {
  it('una ráfaga de avisos de un campus da 429; otro campus sigue entrando', async () => {
    vi.stubEnv('MOODLE_AVISOS_POR_MINUTO', '3');
    const estados = [];
    for (let i = 0; i < 4; i += 1) estados.push((await avisar(77, privado(), { firma: false })).status);
    expect(estados).toEqual([401, 401, 401, 429]);
    const r = await avisar(77, privado(), { firma: false });
    expect(r.status).toBe(429);
    expect(r.body.code).toBe('DEMASIADOS_AVISOS');
    expect((await avisar(78, privado(), { firma: false })).status).toBe(401);
  });

  it('/plugin/*: pasado el tope, 429', async () => {
    const estados = new Set();
    for (let i = 0; i < 60; i += 1) estados.add((await api.get('/api/moodle-avisos/plugin/ultima')).status);
    // Sin versión publicada (no hay backend/plugin-moodle en las pruebas): 404.
    expect([...estados]).toEqual([404]);
    expect((await api.get('/api/moodle-avisos/plugin/ultima')).status).toBe(429);
    expect((await api.get('/api/moodle-avisos/plugin/local_crm.zip')).status).toBe(429);
  });
});

describe('8e · /conectar valida el cuerpo antes de buscar el código', () => {
  it('sin datos, o con un token, código o dirección desmedidos: 400 con un texto que el plugin enseña', async () => {
    for (const [cuerpo, texto] of [
      [{}, /Faltan datos/],
      [{ codigo: 'abc', sitio: 'https://campus.test', token: 'x'.repeat(201) }, /token/],
      [{ codigo: 'a'.repeat(201), sitio: 'https://campus.test', token: 't' }, /código/],
      [{ codigo: 'abc', sitio: `https://campus.test/${'x'.repeat(500)}`, token: 't' }, /dirección/],
      [{ codigo: 123, sitio: 'https://campus.test', token: 't' }, /Faltan datos/],
    ]) {
      const r = await api.post('/api/moodle-avisos/conectar').send(cuerpo);
      expect(r.status).toBe(400);
      expect(r.body).toMatchObject({ success: false, code: 'VALIDATION_ERROR' });
      expect(r.body.error).toMatch(texto);
    }
    expect(conectarCampus).not.toHaveBeenCalled();
  });

  it('con datos buenos, pasa a conectar (con los espacios quitados)', async () => {
    const r = await api.post('/api/moodle-avisos/conectar').send({ codigo: ' abc ', sitio: 'https://campus.test', token: 'tok' });
    expect(r.status).toBe(200);
    expect(conectarCampus).toHaveBeenCalledWith({ codigo: 'abc', sitio: 'https://campus.test', token: 'tok' });
  });
});
