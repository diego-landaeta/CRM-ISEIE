// Certifex · Emisiones: aprobar, rechazar y emitir titulos de Certifex desde el CRM.
//
// Aqui no se habla con ningun Certifex de verdad: `fetch` se sustituye por uno que
// apunta lo que se le pide y contesta como la API /api/crm/v1 (docs/integracion-crm.md
// en el repo de Certifex).
//
// Lo que se fija: que la clave va en la cabecera desde el servidor y nunca vuelve al
// navegador, que quien decide o emite es el usuario con sesion (no lo que diga el
// cuerpo), que solo administracion puede, y que sin configurar se dice claro.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, onTestFinished } from 'vitest';

const CLAVE = 'cfx_crm_clave-de-prueba-que-no-sale-del-servidor';
process.env.CERTIFEX_API_URL = 'https://certifex.test/';
process.env.CERTIFEX_CRM_CLAVE = CLAVE;

const { default: supertest } = await import('supertest');
const { default: app } = await import('../src/app.js');
const { default: pool } = await import('../src/shared/config/db.js');

const request = supertest(app);
let saToken;
let saUser;
let proyectoBase;
let proyectoCreado = false;
let pedidas = [];
let respuesta = () => ({ status: 200, body: {} });

const fetchReal = globalThis.fetch;
beforeAll(async () => {
  // La base local de ISEIE sale sin datos de ejemplo: el super admin lo pone la prueba.
  const { default: jwt } = await import('jsonwebtoken');
  const { rows: [u] } = await pool.query(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ('SA Certifex', $1, 'x', 'superadmin') RETURNING id, email`,
    [`sa.certifex.${Date.now()}.${Math.floor(Math.random() * 1e6)}@prueba.test`]);
  saUser = u;
  saToken = jwt.sign({ userId: u.id, email: u.email, role: 'superadmin', roles_extra: [] }, process.env.JWT_SECRET, { expiresIn: '10m' });
  // Y un proyecto, si no hay ninguno: las fichas de prueba cuelgan de uno.
  proyectoBase = (await pool.query('SELECT id FROM projects WHERE NOT COALESCE(es_prueba, false) ORDER BY id LIMIT 1')).rows[0]?.id;
  if (!proyectoBase) {
    proyectoBase = (await pool.query(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ('Prueba Certifex', $1, $1) RETURNING id`,
      [`prueba-certifex-${Date.now()}`])).rows[0].id;
    proyectoCreado = true;
  }
  // Solo se intercepta lo que va a Certifex; supertest no usa fetch.
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    if (!String(url).startsWith('https://certifex.test/')) return fetchReal(url, opts);
    pedidas.push({ url: String(url), metodo: opts.method, cabeceras: opts.headers, cuerpo: opts.body ? JSON.parse(opts.body) : null });
    const r = respuesta(String(url));
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  });
});
afterAll(async () => {
  globalThis.fetch = fetchReal;
  if (saUser) await pool.query('DELETE FROM users WHERE id = $1', [saUser.id]);
  if (proyectoCreado) await pool.query('DELETE FROM projects WHERE id = $1', [proyectoBase]);
  await pool.end();
});
beforeEach(() => {
  pedidas = [];
  respuesta = () => ({ status: 200, body: {} });
});

const conSesion = (req) => req.set('Authorization', `Bearer ${saToken}`);
// Una matrícula como la da Certifex, con su DNI: es obligatorio para emitir (Diego, 20/10/2026).
const conDni = (matriculaId, dni = '12345678Z') => ({
  matriculaId, centro: 'ISEIE', titular: { nombre: 'Ana Prueba', email: null, dni }, curso: { ref: 12, nombre: 'Máster' }, nexpediente: null,
});

describe('quien puede', () => {
  // `roleGuard` deja pasar a soporte antes de mirar la lista; emitir es SOLO administracion.
  it('soporte no aprueba ni emite: 403 y no se llama a Certifex', async () => {
    const { default: jwt } = await import('jsonwebtoken');
    // Una persona de soporte DE VERDAD: desde #423 lo que puede se lee de la
    // base, no del token (un id que no existe no puede nada).
    const { default: pool } = await import('../src/shared/config/db.js');
    const { rows: [u] } = await pool.query(
      `INSERT INTO users (nombre, email, password_hash, role) VALUES ('Soporte prueba', $1, 'x', 'soporte') RETURNING id`,
      [`soporte_${Date.now()}@prueba.test`]);
    onTestFinished(() => pool.query('DELETE FROM users WHERE id = $1', [u.id]));
    const soporte = jwt.sign({ userId: u.id, email: 'soporte@prueba.test', role: 'soporte', roles_extra: [] },
      process.env.JWT_SECRET, { expiresIn: '5m' });
    const con = (req) => req.set('Authorization', `Bearer ${soporte}`);
    expect((await con(request.get('/api/certifex/emisiones'))).status).toBe(403);
    expect((await con(request.post('/api/certifex/emisiones/decisiones')).send({ items: [{ matriculaId: 7, decision: 'aprobada' }] })).status).toBe(403);
    expect((await con(request.post('/api/certifex/emisiones/emitir')).send({ matriculaIds: [7] })).status).toBe(403);
    expect(pedidas).toHaveLength(0);
    // Las consultas de la web si las ve.
    expect((await con(request.get('/api/certifex/consultas'))).status).toBe(200);
  });
});

describe('conexion', () => {
  it('conectado: dice que CRM es y sus centros, sin ensenar la clave', async () => {
    respuesta = () => ({ status: 200, body: { nombre: 'CRM', centros: ['ISEIE', 'ISEIH'] } });
    const r = await conSesion(request.get('/api/certifex/emisiones/estado'));
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({
      conectado: true, nombre: 'CRM', centros: ['ISEIE', 'ISEIH'], urlPublica: 'https://certifex.test',
      direccionPublica: { ok: true, motivos: [] },
    });
    expect(JSON.stringify(r.body)).not.toContain(CLAVE);
    // La clave va en la cabecera, y la URL se monta bien aunque acabe en barra.
    expect(pedidas[0].url).toBe('https://certifex.test/api/crm/v1/yo');
    expect(pedidas[0].cabeceras.Authorization).toBe(`Bearer ${CLAVE}`);
  });

  it('clave rechazada por Certifex: no conectado, con el motivo', async () => {
    respuesta = () => ({ status: 401, body: { error: 'No autorizado.' } });
    const r = await conSesion(request.get('/api/certifex/emisiones/estado'));
    expect(r.body.data.conectado).toBe(false);
    expect(r.body.data.error).toMatch(/clave/i);
  });

  it('sin configurar: no conectado, y el listado lo dice con un 503', async () => {
    const url = process.env.CERTIFEX_API_URL;
    delete process.env.CERTIFEX_API_URL;
    try {
      const e = await conSesion(request.get('/api/certifex/emisiones/estado'));
      expect(e.body.data).toEqual({ conectado: false });
      const l = await conSesion(request.get('/api/certifex/emisiones'));
      expect(l.status).toBe(503);
      expect(pedidas).toHaveLength(0);
    } finally {
      process.env.CERTIFEX_API_URL = url;
    }
  });
});

describe('listar', () => {
  it('pasa los filtros a Certifex y devuelve lo que contesta', async () => {
    respuesta = () => ({ status: 200, body: { filas: [{ matriculaId: 7 }], total: 1, pagina: 1, tam: 50 } });
    const r = await conSesion(request.get('/api/certifex/emisiones?estado=aprobada&centro=ISEIE&pagina=2'));
    expect(r.status).toBe(200);
    // Sin correo no hay con que cruzar: `crm` va a null.
    expect(r.body.data.filas).toEqual([{ matriculaId: 7, crm: null }]);
    const u = new URL(pedidas[0].url);
    expect(u.pathname).toBe('/api/crm/v1/candidatos');
    expect(Object.fromEntries(u.searchParams)).toEqual({ estado: 'aprobada', centro: 'ISEIE', pagina: '2' });
  });

  it('cada alumno trae lo que sabe el CRM: si compró, lo cobrado y lo que debe', async () => {
    const correo = `certifex.cruce.${Date.now()}@prueba.test`;
    const { rows: [lead] } = await pool.query(
      `INSERT INTO leads (project_id, nombre, email) VALUES ($2, 'Alumna Certifex', $1) RETURNING id`, [correo.toUpperCase(), proyectoBase]);
    await pool.query(
      `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado)
       VALUES ($1, $2, 'Máster de prueba', 1200, 900)`, [lead.id, proyectoBase]);
    try {
      respuesta = () => ({ status: 200, body: { total: 2, pagina: 1, tam: 50, filas: [
        { matriculaId: 1, titular: { nombre: 'Alumna Certifex', email: correo, dni: null } },
        { matriculaId: 2, titular: { nombre: 'Otra', email: 'no-esta-en-el-crm@prueba.test', dni: null } },
      ] } });
      const r = await conSesion(request.get('/api/certifex/emisiones?centro=PSIKO'));
      expect(r.status).toBe(200);
      const [ella, otra] = r.body.data.filas;
      // El correo se compara sin mayúsculas: en la ficha está en MAYÚSCULAS.
      expect(ella.crm).toEqual({ leadId: lead.id, fichas: 1, ventas: 1, vendido: 1200, cobrado: 900, pendiente: 300 });
      expect(otra.crm).toBeNull();
    } finally {
      await pool.query('DELETE FROM conversions WHERE lead_id = $1', [lead.id]);
      await pool.query('DELETE FROM leads WHERE id = $1', [lead.id]);
    }
  });

  it('curso y busqueda tambien viajan', async () => {
    respuesta = () => ({ status: 200, body: { filas: [], total: 0, pagina: 1, tam: 50 } });
    await conSesion(request.get('/api/certifex/emisiones?centro=ISEIE&curso=12&q=ana'));
    const u = new URL(pedidas[0].url);
    expect(Object.fromEntries(u.searchParams)).toEqual({ centro: 'ISEIE', curso: '12', q: 'ana' });
  });

  it('campus y cursos salen de Certifex tal cual', async () => {
    respuesta = (url) => url.includes('/centros')
      ? { status: 200, body: [{ codigo: 'ISEIE', nombre: 'ISEIE', porDecidir: 3 }] }
      : { status: 200, body: [{ cursoRef: 12, cursoNombre: 'Master', porDecidir: 3 }] };
    const c = await conSesion(request.get('/api/certifex/emisiones/centros'));
    expect(c.body.data[0].codigo).toBe('ISEIE');
    const k = await conSesion(request.get('/api/certifex/emisiones/cursos?centro=iseie'));
    expect(k.body.data[0].cursoRef).toBe(12);
    expect(pedidas[1].url).toBe('https://certifex.test/api/crm/v1/cursos?centro=ISEIE');
    expect((await conSesion(request.get('/api/certifex/emisiones/cursos'))).status).toBe(400);
  });

  it('los campus traen la salud del enlace con su Moodle tal cual; un Certifex antiguo, sin ella', async () => {
    const salud = { cron: 'sin_latido', latidoEn: '2026-10-07T03:00:00Z', avisoEn: null, plugin: '2.7.0', moodle: '4.1.2' };
    respuesta = () => ({ status: 200, body: [
      { codigo: 'ISEIE', nombre: 'ISEIE', porDecidir: 3, salud },
      { codigo: 'PSIKO', nombre: 'Psiko Aprende', porDecidir: 0, salud: { cron: 'ok', latidoEn: '2026-10-09T03:00:00Z', avisoEn: null, plugin: '2.7.0', moodle: '4.3' } },
      { codigo: 'ANTIGUO', nombre: 'Sin salud', porDecidir: 0 },
    ] });
    const r = await conSesion(request.get('/api/certifex/emisiones/centros'));
    expect(r.status).toBe(200);
    expect(r.body.data[0].salud).toEqual(salud);
    expect(r.body.data[1].salud.cron).toBe('ok');
    expect(r.body.data[2].salud).toBeUndefined();
    expect(new URL(pedidas[0].url).pathname).toBe('/api/crm/v1/centros');
  });

  it('un filtro raro no llega a Certifex', async () => {
    const r = await conSesion(request.get('/api/certifex/emisiones?estado=todo-emitido'));
    expect(r.status).toBe(400);
    expect(pedidas).toHaveLength(0);
  });
});

describe('decidir y emitir', () => {
  it('quien decide es el usuario con sesion, aunque el cuerpo diga otra cosa', async () => {
    respuesta = () => ({ status: 200, body: { resultados: [{ matriculaId: 7, ok: true, decision: 'aprobada' }] } });
    const r = await conSesion(request.post('/api/certifex/emisiones/decisiones'))
      .send({ items: [{ matriculaId: 7, decision: 'aprobada', decididoPor: 'otra@persona.test' }] });
    expect(r.status).toBe(200);
    expect(pedidas[0].cuerpo).toEqual({ decisiones: [{ matriculaId: 7, decision: 'aprobada', decididoPor: saUser.email }] });
  });

  it('emitir pasa por la emision comun (con el programa del CRM) y el usuario con sesion como emisor', async () => {
    respuesta = (url) => (url.includes('/candidatos')
      ? { status: 200, body: { filas: [conDni(7)], total: 1, pagina: 1, tam: 200 } }
      : { status: 200, body: { resultados: [{ matriculaId: 7, ok: true, nexpediente: 'CTF-2026-000001-AAAA' }] } });
    const r = await conSesion(request.post('/api/certifex/emisiones/emitir')).send({ matriculaIds: [7], emitidaPor: 'otra@persona.test' });
    expect(r.status).toBe(200);
    expect(r.body.data.resultados[0]).toMatchObject({ matriculaId: 7, ok: true, nexpediente: 'CTF-2026-000001-AAAA' });
    // Primero se busca la matricula para su programa y su DNI (la misma emision que Diplomas).
    expect(new URL(pedidas[0].url).pathname).toBe('/api/crm/v1/candidatos');
    expect(pedidas[1].url).toBe('https://certifex.test/api/crm/v1/emitir');
    expect(pedidas[1].cuerpo).toEqual({ items: [{ matriculaId: 7 }], emitidaPor: saUser.email });
    // Sin correo no hay con que buscar su venta: sin programa, y se dice, igual que en Diplomas.
    expect(r.body.data.resultados[0].sinPrograma).toMatch(/Sin correo/);
  });

  it('sin DNI no se emite (es obligatorio): vuelve con el motivo y no llega a /emitir', async () => {
    respuesta = (url) => (url.includes('/candidatos')
      ? { status: 200, body: { filas: [conDni(7, null)], total: 1, pagina: 1, tam: 200 } }
      : { status: 200, body: { resultados: [{ matriculaId: 7, ok: true, nexpediente: 'CTF-2026-000001-AAAA' }] } });
    const r = await conSesion(request.post('/api/certifex/emisiones/emitir')).send({ matriculaIds: [7] });
    expect(r.status).toBe(200);
    expect(r.body.data.resultados[0]).toMatchObject({ matriculaId: 7, ok: false, fase: 'emitir_bloqueado', codigo: 'FALTA_DNI' });
    expect(r.body.data.resultados[0].error).toMatch(/falta el DNI/);
    expect(pedidas.some((p) => p.url.endsWith('/emitir'))).toBe(false);
  });

  it('mas de 10 por vez no sale: se divide en tandas (50 pasaban del minuto de nginx)', async () => {
    const r = await conSesion(request.post('/api/certifex/emisiones/emitir')).send({ matriculaIds: Array.from({ length: 11 }, (_, i) => i + 1) });
    expect(r.status).toBe(400);
    expect(pedidas).toHaveLength(0);
  });

  it('el error de Certifex llega tal cual a la pantalla', async () => {
    respuesta = (url) => (url.includes('/candidatos')
      ? { status: 200, body: { filas: [conDni(7)], total: 1, pagina: 1, tam: 200 } }
      : { status: 400, body: { error: 'Máximo 50 emisiones por llamada.' } });
    const r = await conSesion(request.post('/api/certifex/emisiones/emitir')).send({ matriculaIds: [7] });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('Máximo 50 emisiones por llamada.');
  });
});

describe('ver el titulo emitido', () => {
  it('el diploma llega en PDF desde la web publica, sin la clave del CRM', async () => {
    const fetchAntes = globalThis.fetch;
    let pedida;
    globalThis.fetch = vi.fn(async (url, opts = {}) => {
      if (!String(url).startsWith('https://certifex.test/')) return fetchReal(url, opts);
      pedida = { url: String(url), cabeceras: opts.headers };
      return new Response(Buffer.from('%PDF-1.7 prueba'), { status: 200, headers: { 'Content-Type': 'application/pdf' } });
    });
    try {
      const r = await conSesion(request.get('/api/certifex/emisiones/diploma/ctf-2026-000001-u2lh'));
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toContain('application/pdf');
      expect(pedida.url).toBe('https://certifex.test/diploma.pdf?exp=CTF-2026-000001-U2LH');
      expect(JSON.stringify(pedida.cabeceras ?? {})).not.toContain(CLAVE);
    } finally {
      globalThis.fetch = fetchAntes;
    }
  });

  it('un numero con otra forma no sale del CRM', async () => {
    const r = await conSesion(request.get('/api/certifex/emisiones/diploma/..%2F..%2Fapi'));
    expect(r.status).toBe(400);
    expect(pedidas).toHaveLength(0);
  });

  it('el A3 de imprenta se pide a la API de Certifex CON la clave, y baja como fichero', async () => {
    const fetchAntes = globalThis.fetch;
    let pedida;
    globalThis.fetch = vi.fn(async (url, opts = {}) => {
      if (!String(url).startsWith('https://certifex.test/')) return fetchReal(url, opts);
      pedida = { url: String(url), cabeceras: opts.headers };
      return new Response(Buffer.from('%PDF-1.7 A3'), { status: 200, headers: { 'Content-Type': 'application/pdf' } });
    });
    try {
      const r = await conSesion(request.get('/api/certifex/emisiones/diploma/ctf-2026-000001-u2lh?formato=imprenta'));
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toContain('application/pdf');
      expect(r.headers['content-disposition']).toBe('attachment; filename="CTF-2026-000001-U2LH-imprenta-A3.pdf"');
      expect(r.headers['cache-control']).toContain('no-store');
      // No es público: va a /api/crm/v1 con la clave en la cabecera, no a /diploma.pdf.
      expect(pedida.url).toBe('https://certifex.test/api/crm/v1/diplomas/CTF-2026-000001-U2LH/pdf?formato=imprenta');
      expect(pedida.cabeceras.Authorization).toBe(`Bearer ${CLAVE}`);
      // Y la clave no vuelve al navegador.
      expect(JSON.stringify(r.headers)).not.toContain(CLAVE);
    } finally {
      globalThis.fetch = fetchAntes;
    }
  });

  it('un formato desconocido no sale del CRM', async () => {
    const r = await conSesion(request.get('/api/certifex/emisiones/diploma/ctf-2026-000001-u2lh?formato=A0'));
    expect(r.status).toBe(400);
    expect(pedidas).toHaveLength(0);
  });

  it('si Certifex no da el A3 (revocado, o su campus no lo tiene), se dice con su mensaje', async () => {
    respuesta = () => ({ status: 409, body: { error: 'El diploma de este centro no tiene versión de imprenta.' } });
    const r = await conSesion(request.get('/api/certifex/emisiones/diploma/ctf-2026-000001-u2lh?formato=imprenta'));
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).toContain('no tiene versión de imprenta');
  });

  it('el estado trae la web publica, para enlazar la verificacion', async () => {
    respuesta = () => ({ status: 200, body: { nombre: 'CRM', centros: ['ISEIE'] } });
    const r = await conSesion(request.get('/api/certifex/emisiones/estado'));
    expect(r.body.data.urlPublica).toBe('https://certifex.test');
  });
});

describe('nunca un enlace local (Certifex#96)', () => {
  // El 12/10 el Certifex de pruebas escuchaba en 127.0.0.1:3017: «Ver diploma» llevaba a una
  // pagina que no abre. Desde el servidor si vale (el PDF se trae por aqui); enlazarlo, no.
  const conEntorno = async (vars, fn) => {
    const antes = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    try { await fn(); } finally {
      for (const [k, v] of Object.entries(antes)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  };

  it('si el CRM enlaza Certifex en una direccion local, no la da y dice por que', async () => {
    respuesta = () => ({ status: 200, body: { nombre: 'CRM', centros: ['ISEIE'] } });
    await conEntorno({ CERTIFEX_PUBLICO_URL: 'http://127.0.0.1:3017', NODE_ENV: 'production' }, async () => {
      const r = await conSesion(request.get('/api/certifex/emisiones/estado'));
      expect(r.body.data.urlPublica).toBeNull();
      expect(r.body.data.direccionPublica.ok).toBe(false);
      expect(r.body.data.direccionPublica.motivos.join(' ')).toMatch(/127.0.0.1:3017.*CERTIFEX_PUBLICO_URL/);
    });
  });

  it('si es Certifex el que no tiene direccion publica, se pasa su motivo', async () => {
    respuesta = () => ({ status: 200, body: { nombre: 'CRM', centros: ['ISEIE'], direccionPublica: { ok: false, base: null, motivo: 'La dirección pública de Certifex (VERIFICAR_BASE_URL) es local.' } } });
    const r = await conSesion(request.get('/api/certifex/emisiones/estado'));
    expect(r.body.data.urlPublica).toBe('https://certifex.test');
    expect(r.body.data.direccionPublica).toEqual({ ok: false, motivos: ['La dirección pública de Certifex (VERIFICAR_BASE_URL) es local.'] });
  });

  it('en desarrollo, localhost vale', async () => {
    respuesta = () => ({ status: 200, body: { nombre: 'CRM', centros: ['ISEIE'] } });
    await conEntorno({ CERTIFEX_PUBLICO_URL: 'http://localhost:8787', NODE_ENV: 'development' }, async () => {
      const r = await conSesion(request.get('/api/certifex/emisiones/estado'));
      expect(r.body.data.urlPublica).toBe('http://localhost:8787');
      expect(r.body.data.direccionPublica.ok).toBe(true);
    });
  });

  it('reconoce las direcciones que solo abren desde el servidor', async () => {
    const { esDireccionLocal } = await import('../src/modules/certifex/certifex.cliente.js');
    for (const u of ['http://localhost:8787', 'http://127.0.0.1:3017', 'http://10.1.2.3', 'http://192.168.0.9', 'http://172.18.0.2:80', 'http://[::1]:3000', 'no-es-url']) {
      expect(esDireccionLocal(u), u).toBe(true);
    }
    for (const u of ['https://certifex.tech', 'http://72.60.90.135', 'https://172.32.0.1']) expect(esDireccionLocal(u), u).toBe(false);
  });
});

describe('logos de los campus', () => {
  it('solo rutas de logo de Certifex: nada de proxy abierto', async () => {
    for (const ruta of ['https://otro.test/x.png', '/api/crm/v1/candidatos', '/images/../../etc/passwd.png', '/images/x.exe']) {
      const r = await conSesion(request.get(`/api/certifex/emisiones/logo?ruta=${encodeURIComponent(ruta)}`));
      expect(r.status).toBe(400);
    }
    expect(pedidas).toHaveLength(0);
  });

  it('un logo valido llega como imagen', async () => {
    const antes = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, opts = {}) => {
      if (!String(url).startsWith('https://certifex.test/')) return fetchReal(url, opts);
      return new Response(Buffer.from('RIFF....WEBP'), { status: 200, headers: { 'Content-Type': 'image/webp' } });
    });
    try {
      const r = await conSesion(request.get(`/api/certifex/emisiones/logo?ruta=${encodeURIComponent('/api/centros/ISEIE/logo?v=abc123def456')}`));
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toContain('image/webp');
    } finally {
      globalThis.fetch = antes;
    }
  });
});

describe('quien puede', () => {
  it('sin sesion, nada; y nada llega a Certifex', async () => {
    expect((await request.get('/api/certifex/emisiones')).status).toBe(401);
    expect((await request.post('/api/certifex/emisiones/emitir').send({ matriculaIds: [1] })).status).toBe(401);
    expect(pedidas).toHaveLength(0);
  });
});
