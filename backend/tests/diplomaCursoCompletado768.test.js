import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

/**
 * CRM#768, paso 1 · Moodle avisa de que el alumno terminó un curso con TODO corregido
 * (plugin local_crm 1.14.0, `evento: 'curso_completado'`) y el CRM pide sola la
 * confirmación de datos del diploma, la misma de «Pedir datos».
 *
 *   interruptor apagado → nada; encendido → se pide (una vez: el aviso repetido no la
 *   repite); sin pedir el diploma en Certifex → el CRM lo pasa a pendientes (el «Pasar a
 *   pendientes» del panel) y pide (regla de Diego en la CRM#1048); sin ficha, curso sin
 *   producto o Certifex que no acepta el paso a pendientes → campana a administración
 *   (una por aviso) y 200; Certifex caído → 503 (el plugin reintenta, sin repetir lo
 *   hecho); y por la puerta firmada de verdad, sin romper el aviso de mensajes.
 *
 * Con base real (la de db-preparar). Certifex, Brevo y la campana, simulados (la campana
 * se guarda en admin_notifications para poder comprobar que no se repite).
 *
 * El Certifex simulado: `/candidatos` con `solicitadas: '1'` (lo que usa `pedir()`) solo
 * da las que tienen solicitud; `POST /matriculas` engancha la matrícula de Moodle del
 * mismo correo, curso y campus y le pone la solicitud (lo que hace Certifex de verdad).
 */

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

// caido: todo Certifex; caidoAlPasar: solo POST /matriculas; caidoAlPedir: solo la lista de `pedir()`.
const estado = { candidatos: [], caido: null, caidoAlPasar: false, caidoAlPedir: false, engancharOtra: false };
const llamadas = [];
vi.mock('../src/modules/certifex/certifex.cliente.js', async () => {
  const { AppError } = await import('../src/shared/utils/AppError.js');
  const noResponde = () => new AppError('Certifex no responde. Prueba de nuevo en un momento.', 502, 'CERTIFEX_NO_RESPONDE');
  return {
    certifex: vi.fn(async (metodo, ruta, cuerpo) => {
      llamadas.push({ metodo, ruta, cuerpo });
      if (estado.caido) throw new AppError(estado.caido.msg, estado.caido.status, estado.caido.code);
      if (metodo === 'POST' && ruta === '/matriculas') {
        if (estado.caidoAlPasar) throw noResponde();
        const c = estado.candidatos.find((x) => x.centro === cuerpo.centro && x.titular.email === cuerpo.email
          && x.curso.nombre === cuerpo.curso);
        if (!c || estado.engancharOtra) return { matriculaId: 1, vinculadaMoodle: false, yaExistia: false };
        const yaExistia = !!c.solicitud;
        c.solicitud ??= { nombre: cuerpo.nombre, en: new Date().toISOString() };
        return { matriculaId: c.matriculaId, vinculadaMoodle: true, yaExistia, nexpediente: c.nexpediente };
      }
      return {};
    }),
    recorrer: vi.fn(async (ruta, params, { filtro }) => {
      llamadas.push({ ruta, params });
      if (estado.caido) throw new AppError(estado.caido.msg, estado.caido.status, estado.caido.code);
      if (params?.solicitadas === '1' && estado.caidoAlPedir) throw noResponde();
      const filas = estado.candidatos.filter((c) => params?.solicitadas !== '1' || c.solicitud);
      return { filas: filas.filter(filtro), truncado: false };
    }),
    TAM_CERTIFEX: 200,
  };
});
const pasos = () => llamadas.filter((l) => l.metodo === 'POST' && l.ruta === '/matriculas');
const correos = [];
vi.mock('../src/shared/services/brevo.service.js', () => ({
  sendEmail: vi.fn(async (c) => { correos.push(c); return { sent: true }; }),
}));
const campanas = [];
vi.mock('../src/modules/notifications/notifications.service.js', async () => {
  const { query } = await import('../src/shared/config/db.js');
  return {
    notifyUsers: vi.fn(async (n) => {
      campanas.push(n);
      await query(
        `INSERT INTO admin_notifications (type, title, message, link_path, metadata, target_user_ids)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [n.type, n.title, n.message, n.link_path, n.metadata, n.targetUserIds]);
    }),
    notifyAdmins: vi.fn(async () => {}),
  };
});

const { default: pool } = await import('../src/shared/config/db.js');
const { recibirCursoCompletado } = await import('../src/modules/diploma-confirmacion/diploma-confirmacion.moodle.js');
const { recibirAviso } = await import('../src/modules/consultas/consultas.avisos.js');
const { crearClave, firmar } = await import('../src/modules/consultas/consultas.plugin.js');

const MARCA = `CC${Date.now().toString(36).slice(-6).toUpperCase()}`;
const BASE = 7_681_000_000 + (Date.now() % 1_000_000) * 100;
const CURSO = 4321;
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
let proyecto;
let producto;
let n = 0;
// Quien recibe la campana. La base de pruebas de ISEIE no trae ningún superadmin ni
// admin (como en diplomaConfirmacion768): sin esta persona no hay a quién avisar.
let adminDelCampus;

/** Un alumno: su ficha, su venta del producto del curso y (si se pide) su matrícula en Certifex. */
async function alumno({ ficha = true, venta = true, certifex = true, solicitud = true, nombre } = {}) {
  n += 1;
  const email = `alumno.${BASE + n}@example.com`;
  let leadId = null;
  if (ficha) {
    [{ id: leadId }] = await q('INSERT INTO leads (project_id, nombre, email) VALUES ($1, $2, $3) RETURNING id',
      [proyecto.id, `Alumno ${n}`, email]);
    if (venta) {
      await q(`INSERT INTO conversions (lead_id, project_id, producto_contratado, producto_contratado_id, importe_total, importe_pagado, fecha_conversion)
               VALUES ($1, $2, 'Curso', $3, 100, 100, NOW())`, [leadId, proyecto.id, producto.id]);
    }
  }
  const c = {
    matriculaId: BASE + n, centro: MARCA,
    titular: { nombre: nombre ?? 'Alumno De Prueba', email, dni: '12345678Z' },
    solicitud: solicitud ? { nombre: `Alumno Prueba ${n}`, en: new Date().toISOString() } : null,
    curso: { ref: CURSO, nombre: 'Curso 768' }, nexpediente: null,
  };
  if (certifex) estado.candidatos.push(c);
  return { email, leadId, c };
}

const aviso = (email, { cambio = `c${Date.now()}${Math.random().toString(36).slice(2, 8)}`, pendientes = 0, personal = false } = {}) => ({
  evento: 'curso_completado',
  sitio: 'http://localhost:8085',
  completado: { cambio_id: cambio, fecha: Math.floor(Date.now() / 1000), porcentaje: 100, notas_pendientes: pendientes },
  alumno: { id: 900 + n, nombre: 'Alumno', email, personal },
  curso: { id: CURSO, nombre: 'Curso 768' },
});

const filas = (matriculaId) => q(`SELECT * FROM diploma_confirmaciones WHERE matricula_id = $1`, [matriculaId]);

beforeAll(async () => {
  [proyecto] = await q('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id, nombre',
    [MARCA, MARCA.toLowerCase(), MARCA]);
  [adminDelCampus] = await q(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'admin') RETURNING id`,
    [`${MARCA} admin`, `admin.${MARCA.toLowerCase()}@test.local`]);
  await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [adminDelCampus.id, proyecto.id]);
  [producto] = await q(`INSERT INTO products (project_id, nombre, precio, moneda, active) VALUES ($1, 'Curso 768', 100, 'EUR', true) RETURNING id`,
    [proyecto.id]);
  await q('INSERT INTO moodle_cursos_producto (product_id, project_id, curso_moodle_id, curso_nombre) VALUES ($1, $2, $3, $4)',
    [producto.id, proyecto.id, CURSO, 'Curso 768']);
});

beforeEach(() => {
  llamadas.length = 0;
  correos.length = 0;
  campanas.length = 0;
  estado.caido = null;
  estado.caidoAlPasar = false;
  estado.caidoAlPedir = false;
  estado.engancharOtra = false;
  process.env.DIPLOMA_CONFIRMACION_ACTIVA = '1';
  process.env.DIPLOMA_CONFIRMACION_AUTO = '1';
  process.env.DIPLOMA_CONFIRMACION_CENTROS = MARCA;
  delete process.env.DIPLOMA_CONFIRMACION_ENVIAR_CORREO;
});

afterAll(async () => {
  for (const k of ['ACTIVA', 'AUTO', 'CENTROS']) delete process.env[`DIPLOMA_CONFIRMACION_${k}`];
  if (proyecto) {
    await q('DELETE FROM diploma_confirmaciones WHERE matricula_id >= $1 AND matricula_id < $2', [BASE, BASE + 100]);
    await q(`DELETE FROM admin_notifications WHERE metadata->>'project_id' = $1`, [String(proyecto.id)]);
    await q('DELETE FROM moodle_plugin_campus WHERE project_id = $1', [proyecto.id]);
    await q('DELETE FROM conversions WHERE project_id = $1', [proyecto.id]);
    await q('DELETE FROM leads WHERE project_id = $1', [proyecto.id]);
    await q('DELETE FROM moodle_cursos_producto WHERE project_id = $1', [proyecto.id]);
    await q('DELETE FROM products WHERE project_id = $1', [proyecto.id]);
    if (adminDelCampus) {
      await q('DELETE FROM user_projects WHERE user_id = $1', [adminDelCampus.id]);
      await q('DELETE FROM users WHERE id = $1', [adminDelCampus.id]);
    }
    await q('DELETE FROM projects WHERE id = $1', [proyecto.id]);
  }
  await pool.end();
});

describe('#768 paso 1 · los interruptores', () => {
  it('con DIPLOMA_CONFIRMACION_AUTO apagado no hace nada (ni pregunta a Certifex)', async () => {
    process.env.DIPLOMA_CONFIRMACION_AUTO = '0';
    const { email, c } = await alumno();
    const r = await recibirCursoCompletado(proyecto.id, aviso(email));
    expect(r.resultado).toBe('ignorado');
    expect(llamadas).toHaveLength(0);
    expect(await filas(c.matriculaId)).toHaveLength(0);
  });

  it('con AUTO encendido pero ACTIVA apagada, tampoco', async () => {
    process.env.DIPLOMA_CONFIRMACION_ACTIVA = '0';
    const { email, c } = await alumno();
    expect((await recibirCursoCompletado(proyecto.id, aviso(email))).resultado).toBe('ignorado');
    expect(await filas(c.matriculaId)).toHaveLength(0);
  });
});

describe('#768 paso 1 · encendido', () => {
  it('pide la confirmación, con la ficha y la venta del producto del curso; sin correo de verdad', async () => {
    const { email, leadId, c } = await alumno();
    const r = await recibirCursoCompletado(proyecto.id, aviso(email));
    expect(r).toMatchObject({ resultado: 'pedida', matriculaId: c.matriculaId, leadId, productoId: producto.id, simulado: true });
    expect(r.conversionId).toBeGreaterThan(0);
    expect(r).not.toHaveProperty('enlace');
    const [f] = await filas(c.matriculaId);
    expect(f).toMatchObject({ estado: 'pendiente', pedido_por: 'Moodle (curso terminado)', centro: MARCA });
    expect(Number(f.lead_id)).toBe(leadId);
    expect(correos).toHaveLength(0);
    expect(campanas).toHaveLength(0);
  });

  it('el mismo aviso otra vez (u otro del mismo curso) no la repite', async () => {
    const { email, c } = await alumno();
    const a = aviso(email);
    expect((await recibirCursoCompletado(proyecto.id, a)).resultado).toBe('pedida');
    expect((await recibirCursoCompletado(proyecto.id, a)).resultado).toBe('repetido');
    expect((await recibirCursoCompletado(proyecto.id, aviso(email))).resultado).toBe('repetido');
    expect(await filas(c.matriculaId)).toHaveLength(1);
  });

  it('sin venta del producto la pide igual (la venta solo se informa)', async () => {
    const { email } = await alumno({ venta: false });
    const r = await recibirCursoCompletado(proyecto.id, aviso(email));
    expect(r.resultado).toBe('pedida');
    expect(r.conversionId).toBeNull();
  });

  it('con entregas sin calificar o de personal del campus, no', async () => {
    const { email, c } = await alumno();
    expect((await recibirCursoCompletado(proyecto.id, aviso(email, { pendientes: 2 }))).resultado).toBe('ignorado');
    expect((await recibirCursoCompletado(proyecto.id, aviso(email, { personal: true }))).resultado).toBe('ignorado');
    expect(await filas(c.matriculaId)).toHaveLength(0);
  });
});

describe('#768 paso 1 · sin pedir el diploma: el CRM lo pasa a pendientes y pide (CRM#1048)', () => {
  it('sin solicitud en Certifex: la pasa a pendientes (como el botón del panel) y pide los datos', async () => {
    const { email, c } = await alumno({ solicitud: false });
    const r = await recibirCursoCompletado(proyecto.id, aviso(email));
    expect(r).toMatchObject({ resultado: 'pedida', matriculaId: c.matriculaId, pasado: true });
    expect(pasos()).toHaveLength(1);
    expect(pasos()[0].cuerpo).toMatchObject({
      centro: MARCA, email, dni: '12345678Z', curso: 'Curso 768', creadoPor: 'Moodle (curso terminado)',
    });
    expect(pasos()[0].cuerpo.nombre).toBeTruthy();
    expect(c.solicitud).not.toBeNull();
    const [f] = await filas(c.matriculaId);
    expect(f).toMatchObject({ estado: 'pendiente', pedido_por: 'Moodle (curso terminado)' });
    expect(campanas).toHaveLength(0);
  });

  it('ya pendiente (pidió el diploma): solo pide, no pasa nada a Certifex', async () => {
    const { email, c } = await alumno({ solicitud: true });
    const r = await recibirCursoCompletado(proyecto.id, aviso(email));
    expect(r).toMatchObject({ resultado: 'pedida', matriculaId: c.matriculaId, pasado: false });
    expect(pasos()).toHaveLength(0);
    expect(await filas(c.matriculaId)).toHaveLength(1);
  });

  it('repetido: el mismo aviso otra vez no pasa ni pide nada', async () => {
    const { email, c } = await alumno({ solicitud: false });
    const a = aviso(email);
    expect((await recibirCursoCompletado(proyecto.id, a)).resultado).toBe('pedida');
    llamadas.length = 0;
    expect((await recibirCursoCompletado(proyecto.id, a)).resultado).toBe('repetido');
    expect((await recibirCursoCompletado(proyecto.id, aviso(email))).resultado).toBe('repetido');
    expect(pasos()).toHaveLength(0);
    expect(await filas(c.matriculaId)).toHaveLength(1);
    expect(campanas).toHaveLength(0);
  });

  it('Certifex caído al pasar a pendientes: 503 y nada hecho; el reintento lo pasa y pide', async () => {
    const { email, c } = await alumno({ solicitud: false });
    const a = aviso(email);
    estado.caidoAlPasar = true;
    await expect(recibirCursoCompletado(proyecto.id, a)).rejects.toMatchObject({ statusCode: 503, code: 'CERTIFEX_NO_RESPONDE' });
    expect(c.solicitud).toBeNull();
    expect(await filas(c.matriculaId)).toHaveLength(0);
    expect(campanas).toHaveLength(0);
    estado.caidoAlPasar = false;
    expect(await recibirCursoCompletado(proyecto.id, a)).toMatchObject({ resultado: 'pedida', pasado: true });
    expect(await filas(c.matriculaId)).toHaveLength(1);
  });

  it('Certifex caído al pedir, ya pasado a pendientes: 503; el reintento solo pide', async () => {
    const { email, c } = await alumno({ solicitud: false });
    const a = aviso(email);
    estado.caidoAlPedir = true;
    await expect(recibirCursoCompletado(proyecto.id, a)).rejects.toMatchObject({ statusCode: 503 });
    expect(c.solicitud).not.toBeNull();
    expect(await filas(c.matriculaId)).toHaveLength(0);
    estado.caidoAlPedir = false;
    llamadas.length = 0;
    expect(await recibirCursoCompletado(proyecto.id, a)).toMatchObject({ resultado: 'pedida', pasado: false });
    expect(pasos()).toHaveLength(0);
    expect(await filas(c.matriculaId)).toHaveLength(1);
  });

  it('Certifex no lo acepta por los datos (nombre que no vale): campana, ni pasa ni pide', async () => {
    const { email, c } = await alumno({ solicitud: false, nombre: 'X' });
    const a = aviso(email);
    expect(await recibirCursoCompletado(proyecto.id, a)).toMatchObject({ resultado: 'no_pasada', codigo: 'NOMBRE_NO_VALIDO' });
    expect((await recibirCursoCompletado(proyecto.id, a)).resultado).toBe('no_pasada');
    expect(pasos()).toHaveLength(0);
    expect(campanas).toHaveLength(1);
    expect(campanas[0].title).toMatch(/no se pudo pasar a pendientes/);
    expect(await filas(c.matriculaId)).toHaveLength(0);
  });

  it('Certifex engancha otra matrícula: no se da por hecho, campana', async () => {
    const { email, c } = await alumno({ solicitud: false });
    estado.engancharOtra = true;
    expect(await recibirCursoCompletado(proyecto.id, aviso(email))).toMatchObject({ resultado: 'no_pasada', codigo: 'CERTIFEX_NO_ENGANCHA' });
    expect(campanas).toHaveLength(1);
    expect(await filas(c.matriculaId)).toHaveLength(0);
  });

  it('con la confirmación apagada en ese campus (CENTROS) no se pasa a pendientes', async () => {
    process.env.DIPLOMA_CONFIRMACION_CENTROS = 'OTRO';
    const { email, c } = await alumno({ solicitud: false });
    expect((await recibirCursoCompletado(proyecto.id, aviso(email))).resultado).toBe('ignorado');
    expect(pasos()).toHaveLength(0);
    expect(c.solicitud).toBeNull();
    expect(await filas(c.matriculaId)).toHaveLength(0);
  });
});

describe('#768 paso 1 · lo que no se resuelve solo: campana a administración', () => {
  it('sin ficha del alumno: campana (una por aviso) y 200', async () => {
    const { email, c } = await alumno({ ficha: false });
    const a = aviso(email);
    expect((await recibirCursoCompletado(proyecto.id, a)).resultado).toBe('sin_alumno');
    expect((await recibirCursoCompletado(proyecto.id, a)).resultado).toBe('sin_alumno');
    expect(campanas).toHaveLength(1);
    expect(campanas[0]).toMatchObject({ type: 'diploma_confirmacion', title: expect.stringMatching(/no se encuentra al alumno/) });
    expect(campanas[0].targetUserIds).toContain(adminDelCampus.id);
    // En ISEIE el panel Diplomas está en /matriculas/diplomas (en el 360, /clientes/matriculas/diplomas).
    expect(campanas[0].link_path).toBe('/matriculas/diplomas');
    expect(await filas(c.matriculaId)).toHaveLength(0);
  });

  it('el curso sin producto: campana y no se pide', async () => {
    const { email } = await alumno();
    const a = { ...aviso(email), curso: { id: CURSO + 1, nombre: 'Otro' } };
    expect((await recibirCursoCompletado(proyecto.id, a)).resultado).toBe('sin_producto');
    expect(campanas).toHaveLength(1);
    expect(campanas[0].title).toMatch(/no tiene producto/);
  });

  it('sin matrícula en Certifex: campana', async () => {
    const { email } = await alumno({ certifex: false });
    expect((await recibirCursoCompletado(proyecto.id, aviso(email))).resultado).toBe('sin_matricula_certifex');
    expect(campanas).toHaveLength(1);
  });

  it('Certifex caído: 503 para que el plugin lo reintente; sin configurar: campana', async () => {
    const { email } = await alumno();
    estado.caido = { msg: 'Certifex no responde', status: 502, code: 'CERTIFEX_NO_RESPONDE' };
    await expect(recibirCursoCompletado(proyecto.id, aviso(email))).rejects.toMatchObject({ statusCode: 503 });
    estado.caido = { msg: 'sin configurar', status: 503, code: 'CERTIFEX_SIN_CONFIGURAR' };
    expect((await recibirCursoCompletado(proyecto.id, aviso(email))).resultado).toBe('sin_certifex');
    expect(campanas).toHaveLength(1);
  });
});

describe('#768 paso 1 · por la puerta firmada del plugin', () => {
  it('el aviso firmado llega a la confirmación; uno mal formado es 400; el de mensajes no cambia', async () => {
    const secreto = await crearClave(proyecto.id);
    const enviar = (cuerpo) => {
      const crudo = Buffer.from(JSON.stringify(cuerpo));
      return recibirAviso(proyecto.id, crudo, firmar(crudo, secreto, Math.floor(Date.now() / 1000)));
    };
    const { email, c } = await alumno();
    expect((await enviar(aviso(email))).resultado).toBe('pedida');
    expect(await filas(c.matriculaId)).toHaveLength(1);

    const roto = aviso(email);
    delete roto.completado.cambio_id;
    await expect(enviar(roto)).rejects.toMatchObject({ statusCode: 400 });

    // Un mensaje sigue yendo por su camino (aquí, sin «Leer las consultas»: ignorado).
    const r = await enviar({
      evento: 'mensaje',
      mensaje: { id: 1, conversacion_id: 2, html: '<p>Hola</p>', fecha: Math.floor(Date.now() / 1000) },
      de: { id: 900, nombre: 'A', email: 'a@example.com', personal: false },
      para: [{ id: 901, nombre: 'B', personal: true }],
    });
    expect(r.resultado).toBe('ignorado');
  });
});

describe('#791 · la ficha de ESTE campus y el 503 que entiende el plugin', () => {
  let otro;
  beforeAll(async () => {
    [otro] = await q('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
      [`${MARCA}OTRO`, `${MARCA.toLowerCase()}-otro`, `${MARCA}OTRO`]);
  });
  afterAll(async () => {
    if (!otro) return;
    await q('DELETE FROM leads WHERE project_id = $1', [otro.id]);
    await q('DELETE FROM projects WHERE id = $1', [otro.id]);
  });

  it('el mismo correo con ficha más reciente en otro campus: la confirmación queda en la de este', async () => {
    const { email, leadId, c } = await alumno();
    const [{ id: ajena }] = await q('INSERT INTO leads (project_id, nombre, email) VALUES ($1, $2, $3) RETURNING id',
      [otro.id, 'Alumno en otro campus', email]);
    expect(Number(ajena)).toBeGreaterThan(leadId);
    expect(await recibirCursoCompletado(proyecto.id, aviso(email))).toMatchObject({ resultado: 'pedida', leadId });
    const [f] = await filas(c.matriculaId);
    expect(Number(f.lead_id)).toBe(leadId);
  });

  it('Certifex caído: el plugin recibe 503 «Certifex no responde, se reintentará», no el genérico', async () => {
    const { default: supertest } = await import('supertest');
    const { default: express } = await import('express');
    const { default: puerta } = await import('../src/modules/consultas/consultas.webhook.js');
    const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
    const app = express();
    app.use('/api/moodle-avisos', puerta);
    app.use(errorHandler);

    const secreto = await crearClave(proyecto.id);
    const { email } = await alumno();
    const crudo = Buffer.from(JSON.stringify(aviso(email)));
    estado.caido = { msg: 'Certifex no responde', status: 502, code: 'CERTIFEX_NO_RESPONDE' };
    const r = await supertest(app).post(`/api/moodle-avisos/${proyecto.id}`)
      .set('Content-Type', 'application/json')
      .set('x-crm-firma', firmar(crudo, secreto, Math.floor(Date.now() / 1000)))
      .send(crudo.toString('utf8'));
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ success: false, code: 'CERTIFEX_NO_RESPONDE', error: 'Certifex no responde, se reintentará' });
    expect(r.body.ref).toBeTruthy();
  });
});
