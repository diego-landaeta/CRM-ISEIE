import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';

/**
 * CRM#768 (gemela CRM-ISEIE#456) · El alumno confirma los datos de su diploma
 * antes de emitirlo.
 *
 *   interruptor apagado → nada cambia; encendido en un campus → sin
 *   confirmación no se emite; pedir → enlace (correo simulado); confirmar →
 *   se emite y queda con qué datos; corregir → pasa a Certifex; Certifex
 *   falla → no se emite; datos malos → intentos; 7 días → vencida y se emite;
 *   enlace usado, falso o de otro campus → no vale.
 *
 * Con base real (la de db-preparar). Lo de fuera, simulado: Certifex, Brevo
 * (no sale nada) y las notificaciones.
 */

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

// El número de expediente con la forma de Certifex (CEDIA-2026-000123-AB12).
const nexpDe = (id) => `PRB-2026-${String(id % 1_000_000).padStart(6, '0')}-AAAA`;
const llamadas = [];
const estado = { candidatos: [], fallaDni: null };
vi.mock('../src/modules/certifex/certifex.cliente.js', async () => {
  const { AppError } = await import('../src/shared/utils/AppError.js');
  return {
    certifex: vi.fn(async (metodo, ruta, cuerpo) => {
      llamadas.push({ metodo, ruta, cuerpo });
      if (ruta === '/yo') return { centros: estado.candidatos.map((c) => c.centro) };
      if (ruta === '/solicitudes/dni') {
        if (estado.fallaDni) throw new AppError(estado.fallaDni, 409, 'CERTIFEX_ERROR');
        return { dni: cuerpo.dni };
      }
      if (ruta === '/solicitudes/nombre') return { nombre: cuerpo.nombre };
      if (ruta === '/decisiones') return { resultados: cuerpo.decisiones.map((d) => ({ matriculaId: d.matriculaId, ok: true })) };
      if (ruta === '/emitir') return { resultados: cuerpo.items.map((it) => ({ matriculaId: it.matriculaId, ok: true, nexpediente: nexpDe(it.matriculaId) })) };
      if (ruta === '/avisos') return { correoActivo: true, resultados: cuerpo.nexpedientes.map((n) => ({ nexpediente: n, ok: true })) };
      return {};
    }),
    recorrer: vi.fn(async (ruta, params, { filtro }) => {
      llamadas.push({ ruta, params });
      return { filas: estado.candidatos.filter(filtro), truncado: false };
    }),
    TAM_CERTIFEX: 200,
  };
});

const correos = [];
vi.mock('../src/shared/services/brevo.service.js', () => ({
  sendEmail: vi.fn(async (c) => { correos.push(c); return { sent: true }; }),
}));
const avisos = [];
vi.mock('../src/modules/notifications/notifications.service.js', () => ({
  notifyUsers: vi.fn(async (n) => { avisos.push(n); }),
  notifyAdmins: vi.fn(async () => {}),
}));

const { default: pool } = await import('../src/shared/config/db.js');
const svc = await import('../src/modules/diploma-confirmacion/diploma-confirmacion.service.js');
const { documentoTapado } = await import('../src/modules/diploma-confirmacion/diploma-confirmacion.emails.js');
const { prepararEmision, emitirMatriculas } = await import('../src/modules/certifex/certifex.emision.js');
const diplomas = await import('../src/modules/certifex/certifex.diplomas.js');
const { default: modulo } = await import('../src/modules/diploma-confirmacion/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
// #791: el diploma en la ficha y en Pendientes.
const { diplomaDelAlumno } = await import('../src/modules/leads/lead.controller.js');
const { conConfirmacion } = await import('../src/modules/diploma-confirmacion/diploma-confirmacion.puerta.js');

const MARCA = `D7${Date.now().toString(36).slice(-6).toUpperCase()}`;
const BASE = 7_680_000_000 + (Date.now() % 1_000_000) * 100;
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const SUPER = { userId: 1, email: 'admin.prueba@crm.test', role: 'superadmin', roles_extra: [] };
let proyecto;
let n = 0;

const app = express();
app.set('trust proxy', false);
app.use(express.json());
app.use(modulo.publicMount.prefix, modulo.publicMount.router);
app.use(errorHandler);

/** Una solicitud de diploma en Certifex (simulado), de un alumno de prueba. */
function alumno({ dni = '12345678Z', nombre = 'Ana Pérez López', centro = MARCA } = {}) {
  n += 1;
  const c = {
    matriculaId: BASE + n, centro,
    titular: { nombre, email: `alumno.${BASE + n}@example.com`, dni },
    solicitud: { nombre, en: new Date().toISOString() },
    curso: { ref: 1, nombre: 'Curso de prueba 768' }, nexpediente: null,
  };
  estado.candidatos.push(c);
  return c;
}

const tokenDe = (enlace) => /confirmar-diploma\/([A-Za-z0-9_.-]+)/.exec(enlace)?.[1];
const filaDe = (id) => q('SELECT * FROM diploma_confirmaciones WHERE matricula_id = $1 AND estado <> \'anulado\'', [id]).then((r) => r[0]);

async function pedirUno(c) {
  const [r] = await svc.pedir(SUPER, [c.matriculaId]);
  expect(r.ok, r.error).toBe(true);
  return tokenDe(r.enlace);
}

// Quien recibe los avisos de administración del campus. La base de pruebas de
// ISEIE no trae ningún superadmin ni admin: sin esta persona, «se avisa a
// administración» dependía de que otra prueba tuviera uno creado en ese momento
// (falló a ratos en la CI de staging, 18/11).
let adminDelCampus;

beforeAll(async () => {
  [proyecto] = await q(
    'INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id, nombre',
    [MARCA, MARCA.toLowerCase(), MARCA]);
  [adminDelCampus] = await q(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'admin') RETURNING id`,
    [`${MARCA} admin`, `admin.${MARCA.toLowerCase()}@test.local`]);
  await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [adminDelCampus.id, proyecto.id]);
});

beforeEach(() => {
  llamadas.length = 0;
  correos.length = 0;
  avisos.length = 0;
  estado.fallaDni = null;
  process.env.DIPLOMA_CONFIRMACION_ACTIVA = '1';
  process.env.DIPLOMA_CONFIRMACION_CENTROS = MARCA;
  delete process.env.DIPLOMA_CONFIRMACION_ENVIAR_CORREO;
});

afterAll(async () => {
  delete process.env.DIPLOMA_CONFIRMACION_ACTIVA;
  delete process.env.DIPLOMA_CONFIRMACION_CENTROS;
  await q('DELETE FROM diploma_confirmaciones WHERE centro = $1 OR matricula_id >= $2', [MARCA, BASE]);
  await q('DELETE FROM certifex_solicitudes WHERE centro = $1', [MARCA]);
  if (adminDelCampus) {
    await q('DELETE FROM user_projects WHERE user_id = $1', [adminDelCampus.id]);
    await q('DELETE FROM users WHERE id = $1', [adminDelCampus.id]);
  }
  if (proyecto) await q('DELETE FROM projects WHERE id = $1', [proyecto.id]);
  await pool.end();
});

describe('#768 · el interruptor', () => {
  it('apagado: la emisión no mira la confirmación y no se puede pedir', async () => {
    process.env.DIPLOMA_CONFIRMACION_ACTIVA = '0';
    const c = alumno();
    const p = await prepararEmision([c.matriculaId]);
    expect(p.bloqueadas.has(c.matriculaId)).toBe(false);
    await expect(svc.pedir(SUPER, [c.matriculaId])).rejects.toMatchObject({ code: 'APAGADA' });
  });

  it('encendido en OTRO campus: este emite como siempre', async () => {
    process.env.DIPLOMA_CONFIRMACION_CENTROS = 'OTROCAMPUS';
    const c = alumno();
    const p = await prepararEmision([c.matriculaId]);
    expect(p.bloqueadas.has(c.matriculaId)).toBe(false);
  });
});

describe('#768 · sin confirmación no se emite', () => {
  it('sin pedirla: bloqueada con DATOS_SIN_PEDIR, y no llega a Certifex', async () => {
    const c = alumno();
    const p = await prepararEmision([c.matriculaId]);
    expect(p.codigos.get(c.matriculaId)).toBe('DATOS_SIN_PEDIR');
    const [r] = await emitirMatriculas(SUPER, [c.matriculaId]);
    expect(r).toMatchObject({ ok: false, fase: 'emitir_bloqueado', codigo: 'DATOS_SIN_PEDIR' });
    expect(llamadas.some((l) => l.ruta === '/emitir')).toBe(false);
  });

  it('el DNI que falta sigue mandando: FALTA_DNI antes que la confirmación', async () => {
    const c = alumno({ dni: null });
    const p = await prepararEmision([c.matriculaId]);
    expect(p.codigos.get(c.matriculaId)).toBe('FALTA_DNI');
  });
});

describe('#768 · pedir la confirmación', () => {
  it('crea la fila con lo propuesto y, con el correo apagado, NO manda nada: da el enlace', async () => {
    const c = alumno();
    const [r] = await svc.pedir(SUPER, [c.matriculaId]);
    expect(r).toMatchObject({ ok: true, estado: 'pendiente', enviado: false, simulado: true });
    expect(correos).toHaveLength(0);
    const f = await filaDe(c.matriculaId);
    expect(f).toMatchObject({
      estado: 'pendiente', centro: MARCA, project_id: proyecto.id, nombre_propuesto: 'Ana Pérez López',
      documento_propuesto: '12345678Z', curso_nombre: 'Curso de prueba 768', envio_simulado: true,
      enviado_a: c.titular.email, pedido_por: SUPER.email,
    });
    // En la base, solo la huella del enlace.
    expect(f.token_hash).toHaveLength(64);
    expect(f.token_hash).not.toBe(tokenDe(r.enlace));
    // Pendiente: sigue sin emitirse.
    const p = await prepararEmision([c.matriculaId]);
    expect(p.codigos.get(c.matriculaId)).toBe('DATOS_SIN_CONFIRMAR');
  });

  it('la fecha es la de fin de Moodle, en día de Madrid, y la página la da sin huso (AAAA-MM-DD)', async () => {
    const c = alumno();
    // 23:30 UTC del 9 = día 10 en Madrid.
    await q(
      `INSERT INTO certifex_solicitudes (matricula_id, centro, completado_en, completado_recibido_en)
       VALUES ($1, $2, '2026-11-09T23:30:00Z', NOW())`,
      [c.matriculaId, MARCA]);
    const token = await pedirUno(c);
    expect((await svc.verFormulario(token)).fecha).toBe('2026-11-10');
  });

  it('pedirla dos veces: la segunda dice que ya está esperando', async () => {
    const c = alumno();
    await pedirUno(c);
    const [r] = await svc.pedir(SUPER, [c.matriculaId]);
    expect(r).toMatchObject({ ok: false, codigo: 'YA_PEDIDA' });
  });

  it('con el correo encendido sale (simulado en Brevo) con el enlace y el documento tapado', async () => {
    process.env.DIPLOMA_CONFIRMACION_ENVIAR_CORREO = '1';
    const c = alumno();
    const [r] = await svc.pedir(SUPER, [c.matriculaId]);
    expect(r).toMatchObject({ ok: true, enviado: true });
    expect(r.enlace).toBeUndefined();
    expect(correos).toHaveLength(1);
    expect(correos[0].to[0].email).toBe(c.titular.email);
    expect(correos[0].htmlContent).toMatch(/confirmar-diploma\//);
    expect(correos[0].htmlContent).toContain('678Z');
    expect(correos[0].htmlContent).not.toContain('12345678Z');
  });

  it('una admin sin ese campus no puede pedirla (404)', async () => {
    const c = alumno();
    await expect(svc.pedir({ userId: 999999, email: 'x@crm.test', role: 'admin', roles_extra: [] }, [c.matriculaId]))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(await filaDe(c.matriculaId)).toBeUndefined();
  });
});

describe('#768 · la página del alumno', () => {
  it('enseña los datos con el documento tapado; un enlace falso o usado no vale', async () => {
    const c = alumno();
    const token = await pedirUno(c);
    const g = await supertest(app).get(`/api/cd/${token}`);
    expect(g.status).toBe(200);
    expect(g.body.data).toMatchObject({ marca: MARCA, nombre: 'Ana Pérez López', documento: documentoTapado('12345678Z'), tiene_documento: true });
    expect(JSON.stringify(g.body)).not.toContain('12345678Z');

    expect((await supertest(app).get('/api/cd/inventado')).status).toBe(404);
    const falso = `${'a'.repeat(32)}.${'b'.repeat(22)}`;
    expect((await supertest(app).get(`/api/cd/${falso}`)).body.code).toBe('ENLACE_NO_VALE');

    const r = await supertest(app).post(`/api/cd/${token}`).send({ accion: 'confirmar' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ guardado: true, estado: 'confirmado' });
    // Un solo uso.
    expect((await supertest(app).post(`/api/cd/${token}`).send({ accion: 'confirmar' })).status).toBe(404);
  });

  it('confirmar: se puede emitir, no se toca Certifex y queda con qué datos salió y cuándo se envió', async () => {
    const c = alumno();
    const token = await pedirUno(c);
    llamadas.length = 0;
    await svc.responder(token, { accion: 'confirmar', comentario: 'Todo bien' });
    expect(llamadas.some((l) => l.ruta?.startsWith('/solicitudes/'))).toBe(false);
    const f = await filaDe(c.matriculaId);
    expect(f).toMatchObject({ estado: 'confirmado', nombre_confirmado: 'Ana Pérez López', documento_confirmado: '12345678Z', comentario: 'Todo bien', token_hash: null });
    expect(f.aplicado_at).not.toBeNull();
    // Se avisa a administración: listo para emitir (no se emite solo).
    expect(avisos.some((a) => a.type === 'diploma_confirmacion' && /confirmó/.test(a.title))).toBe(true);
    expect(llamadas.some((l) => l.ruta === '/emitir')).toBe(false);

    const [r] = await emitirMatriculas(SUPER, [c.matriculaId]);
    expect(r).toMatchObject({ ok: true, nexpediente: nexpDe(c.matriculaId) });
    const e = await filaDe(c.matriculaId);
    expect(e.nexpediente).toBe(nexpDe(c.matriculaId));
    expect(e.emitido_at).not.toBeNull();
    expect(e.datos_emision).toMatchObject({ nombre: 'Ana Pérez López', documento: '12345678Z', curso: 'Curso de prueba 768', origen: 'confirmado', emitidaPor: SUPER.email });

    // «Enviar diploma al alumno» apunta cuándo salió.
    const res = { json: () => res };
    await diplomas.avisos({ body: { nexpedientes: [e.nexpediente] }, user: SUPER }, res, (err) => { throw err; });
    expect((await filaDe(c.matriculaId)).diploma_enviado_at).not.toBeNull();
  });

  it('corregir nombre y documento: se pasan a Certifex como el alumno y se puede emitir', async () => {
    const c = alumno({ nombre: 'ana perez' });
    const token = await pedirUno(c);
    llamadas.length = 0;
    const r = await svc.responder(token, { accion: 'corregir', nombre: '  Ana   Pérez López ', documento: 'x1234567l' });
    expect(r.estado).toBe('corregido');
    const dni = llamadas.find((l) => l.ruta === '/solicitudes/dni');
    const nom = llamadas.find((l) => l.ruta === '/solicitudes/nombre');
    expect(dni.cuerpo).toMatchObject({ matriculaId: c.matriculaId, dni: 'X1234567L' });
    expect(nom.cuerpo).toMatchObject({ matriculaId: c.matriculaId, nombre: 'Ana Pérez López' });
    expect(dni.cuerpo.editadoPor).toMatch(/alumno/i);
    const f = await filaDe(c.matriculaId);
    expect(f).toMatchObject({ estado: 'corregido', nombre_confirmado: 'Ana Pérez López', documento_confirmado: 'X1234567L', aplicar_error: null });
    expect(f.aplicado_at).not.toBeNull();
    const p = await prepararEmision([c.matriculaId]);
    expect(p.bloqueadas.has(c.matriculaId)).toBe(false);
  });

  it('si Certifex no acepta lo corregido, no se emite hasta volver a pasarlo', async () => {
    const c = alumno();
    const token = await pedirUno(c);
    estado.fallaDni = 'Ese documento ya lo tiene otro alumno';
    await svc.responder(token, { accion: 'corregir', documento: '00000000T' });
    let f = await filaDe(c.matriculaId);
    expect(f.aplicado_at).toBeNull();
    expect(f.aplicar_error).toMatch(/otro alumno/);
    const p = await prepararEmision([c.matriculaId]);
    expect(p.codigos.get(c.matriculaId)).toBe('DATOS_SIN_APLICAR');
    expect(avisos.some((a) => /sin pasar a Certifex/.test(a.title))).toBe(true);

    estado.fallaDni = null;
    await svc.reaplicar(SUPER, c.matriculaId);
    f = await filaDe(c.matriculaId);
    expect(f.aplicado_at).not.toBeNull();
    expect((await prepararEmision([c.matriculaId])).bloqueadas.has(c.matriculaId)).toBe(false);
  });

  it('datos que no valen: 400 y cuentan como intento; al tope, el enlace muere', async () => {
    process.env.DIPLOMA_CONFIRMACION_INTENTOS = '2';
    try {
      const c = alumno();
      const token = await pedirUno(c);
      await expect(svc.responder(token, { accion: 'corregir', nombre: 'Ana' })).rejects.toMatchObject({ statusCode: 400, code: 'DATOS_NO_VALIDOS' });
      await expect(svc.responder(token, { accion: 'corregir', documento: '12' })).rejects.toMatchObject({ statusCode: 429, code: 'SIN_INTENTOS' });
      await expect(svc.verFormulario(token)).rejects.toMatchObject({ code: 'ENLACE_NO_VALE' });
      expect((await filaDe(c.matriculaId)).estado).toBe('pendiente');
    } finally {
      delete process.env.DIPLOMA_CONFIRMACION_INTENTOS;
    }
  });

  it('sin documento en Certifex no se puede «confirmar»: hay que escribirlo', async () => {
    const c = alumno({ dni: null });
    const token = await pedirUno(c);
    await expect(svc.responder(token, { accion: 'confirmar' })).rejects.toMatchObject({ code: 'DATOS_NO_VALIDOS' });
    const r = await svc.responder(token, { accion: 'corregir', documento: '12345678Z' });
    expect(r.estado).toBe('corregido');
  });

  it('apagado en el campus, los enlaces que ya salieron no abren', async () => {
    const c = alumno();
    const token = await pedirUno(c);
    process.env.DIPLOMA_CONFIRMACION_CENTROS = 'OTROCAMPUS';
    await expect(svc.verFormulario(token)).rejects.toMatchObject({ code: 'ENLACE_NO_VALE' });
  });
});

describe('#768 · el plazo de 7 días', () => {
  it('sin respuesta, la confirmación vence, el enlace muere y el diploma ya puede salir', async () => {
    const c = alumno();
    const token = await pedirUno(c);
    await q('UPDATE diploma_confirmaciones SET caduca_at = NOW() - INTERVAL \'1 minute\' WHERE matricula_id = $1', [c.matriculaId]);
    const r = await svc.vuelta();
    expect(r.vencidas).toBeGreaterThanOrEqual(1);
    const f = await filaDe(c.matriculaId);
    expect(f).toMatchObject({ estado: 'vencido', token_hash: null });
    await expect(svc.verFormulario(token)).rejects.toMatchObject({ code: 'ENLACE_NO_VALE' });
    expect((await prepararEmision([c.matriculaId])).bloqueadas.has(c.matriculaId)).toBe(false);
    expect(avisos.some((a) => /7 días/.test(a.title))).toBe(true);
  });
});

describe('#774 · la confirmación se une a la ficha del alumno en SU campus', () => {
  // El mismo alumno puede tener ficha en varios campus. La confirmación es del
  // campus del aviso (el centro de la solicitud de Certifex): su lead_id tiene
  // que ser la ficha de ESE campus, nunca la de otro aunque sea más reciente.
  let otro;
  const leads = [];
  const matriculas = [];
  const ficha = async (projectId, email) => {
    const [{ id }] = await q('INSERT INTO leads (project_id, nombre, email) VALUES ($1, $2, $3) RETURNING id',
      [projectId, 'Alumno 1119', email]);
    leads.push(id);
    return Number(id);
  };

  beforeAll(async () => {
    [otro] = await q(
      'INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
      [`${MARCA}OTRO`, `${MARCA.toLowerCase()}-otro`, `${MARCA}OTRO`]);
  });

  afterAll(async () => {
    await q('DELETE FROM diploma_confirmaciones WHERE matricula_id = ANY($1::bigint[])', [matriculas]);
    if (leads.length) await q('DELETE FROM leads WHERE id = ANY($1::int[])', [leads]);
    if (otro) await q('DELETE FROM projects WHERE id = $1', [otro.id]);
  });

  it('mismo correo en dos campus: enlaza con la ficha del campus del aviso, no con la más reciente del otro', async () => {
    const c = alumno();
    matriculas.push(c.matriculaId);
    const suya = await ficha(proyecto.id, c.titular.email);
    const ajena = await ficha(otro.id, c.titular.email.toUpperCase());
    expect(ajena).toBeGreaterThan(suya); // la del otro campus es la más reciente
    await pedirUno(c);
    const f = await filaDe(c.matriculaId);
    expect(Number(f.project_id)).toBe(proyecto.id);
    expect(Number(f.lead_id)).toBe(suya);
  });

  it('sin ficha en su campus: lead_id vacío, aunque haya una en otro campus', async () => {
    const c = alumno();
    matriculas.push(c.matriculaId);
    await ficha(otro.id, c.titular.email);
    await pedirUno(c);
    expect((await filaDe(c.matriculaId)).lead_id).toBeNull();
  });
});

describe('#791 · el estado del diploma, en la ficha y en Pendientes', () => {
  let otro;
  const leads = [];
  const matriculas = [];
  const ficha = async (projectId, email) => {
    const [{ id }] = await q('INSERT INTO leads (project_id, nombre, email) VALUES ($1, $2, $3) RETURNING id',
      [projectId, 'Alumno 1135', email]);
    leads.push(id);
    return Number(id);
  };
  /** Lo que contesta GET /api/leads/:id/diploma, como superadmin. */
  const verFicha = async (id) => {
    let cuerpo; let fallo;
    await diplomaDelAlumno({ params: { id: String(id) }, user: SUPER, query: {} },
      { json: (b) => { cuerpo = b; } }, (e) => { fallo = e; });
    if (fallo) throw fallo;
    return cuerpo.data;
  };

  beforeAll(async () => {
    [otro] = await q(
      'INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
      [`${MARCA}FICHA`, `${MARCA.toLowerCase()}-ficha`, `${MARCA}FICHA`]);
  });
  afterAll(async () => {
    await q('DELETE FROM diploma_confirmaciones WHERE matricula_id = ANY($1::bigint[])', [matriculas]);
    if (leads.length) await q('DELETE FROM leads WHERE id = ANY($1::int[])', [leads]);
    if (otro) await q('DELETE FROM projects WHERE id = $1', [otro.id]);
  });

  it('la ficha de su campus dice «datos pedidos», luego «contestados» y «emitido»; la del otro campus, nada', async () => {
    const c = alumno();
    matriculas.push(c.matriculaId);
    const suya = await ficha(proyecto.id, c.titular.email);
    const ajena = await ficha(otro.id, c.titular.email);
    expect(await verFicha(suya)).toEqual([]);
    await pedirUno(c);

    const [pedida] = await verFicha(suya);
    expect(pedida).toMatchObject({
      matricula_id: c.matriculaId, centro: MARCA, campus: MARCA, estado: 'pendiente',
      curso_nombre: 'Curso de prueba 768', envio_simulado: true, nexpediente: null,
    });
    expect(pedida.pedido_at).toBeTruthy();
    expect(pedida.caduca_at).toBeTruthy();
    // Ni el enlace, ni la IP, ni el documento.
    expect(pedida).not.toHaveProperty('token_hash');
    expect(pedida).not.toHaveProperty('respondido_ip');
    expect(pedida).not.toHaveProperty('documento_propuesto');
    expect(await verFicha(ajena)).toEqual([]);

    await q(`UPDATE diploma_confirmaciones SET estado = 'confirmado', respondido_at = NOW() WHERE matricula_id = $1`, [c.matriculaId]);
    expect((await verFicha(suya))[0]).toMatchObject({ estado: 'confirmado' });
    await q(`UPDATE diploma_confirmaciones SET nexpediente = 'PRB-2026-000001-AAAA', emitido_at = NOW() WHERE matricula_id = $1`, [c.matriculaId]);
    expect((await verFicha(suya))[0]).toMatchObject({ estado: 'confirmado', nexpediente: 'PRB-2026-000001-AAAA' });
  });

  it('Pendientes: la fila de quien ya tiene los datos pedidos lo dice; las demás, null', async () => {
    const pedida = alumno();
    const sinPedir = alumno();
    matriculas.push(pedida.matriculaId, sinPedir.matriculaId);
    await pedirUno(pedida);
    const filasPanel = [{ matriculaId: pedida.matriculaId }, { matriculaId: sinPedir.matriculaId }];
    await conConfirmacion(filasPanel);
    expect(filasPanel[0].confirmacion).toMatchObject({ estado: 'pendiente', simulado: true, sinAplicar: false });
    expect(filasPanel[0].confirmacion.caducaEn).toBeTruthy();
    expect(filasPanel[0].confirmacion).not.toHaveProperty('token_hash');
    expect(filasPanel[1].confirmacion).toBeNull();

    // Con el interruptor apagado, nada (como el resto de la confirmación).
    process.env.DIPLOMA_CONFIRMACION_ACTIVA = '0';
    const otra = [{ matriculaId: pedida.matriculaId }];
    await conConfirmacion(otra);
    expect(otra[0].confirmacion).toBeNull();
  });
});

describe('#791 · la ficha solo enseña el diploma de los campus de quien mira', () => {
  // Una ficha puede tener confirmaciones de otro campus: una venta allí, o las filas de
  // antes de #1135, que se unieron por correo a la ficha de cualquier campus. Quien solo
  // tiene el campus A no ve la del campus B (Diego, revisión de CRM-ISEIE#810).
  let otro;
  const leads = [];
  const matriculas = [];
  const personas = [];
  const persona = async (nombre, role, campus) => {
    const [u] = await q(
      `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id`,
      [`${MARCA} ${nombre}`, `${nombre}.${MARCA.toLowerCase()}@diploma-campus.test`, role]);
    personas.push(u.id);
    for (const p of campus) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, p]);
    // Un objeto nuevo en cada llamada: el alcance comercial se guarda por petición.
    return () => ({ userId: u.id, email: `${nombre}@diploma-campus.test`, role, roles_extra: [] });
  };
  /** GET /api/leads/:id/diploma como `user`: { data } o { error }. */
  const verComo = async (user, id) => {
    let cuerpo; let error;
    await diplomaDelAlumno({ params: { id: String(id) }, user, query: {} },
      { json: (b) => { cuerpo = b; } }, (e) => { error = e; });
    return error ? { error } : { data: cuerpo.data };
  };

  let suya; let deA; let deB;
  beforeAll(async () => {
    [otro] = await q(
      'INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id, nombre',
      [`${MARCA}B`, `${MARCA.toLowerCase()}-b`, `${MARCA}B`]);
    // beforeAll va antes que el beforeEach de arriba, y la prueba anterior la deja apagada.
    process.env.DIPLOMA_CONFIRMACION_ACTIVA = '1';
    process.env.DIPLOMA_CONFIRMACION_CENTROS = MARCA;
    deA = alumno();
    deB = alumno();
    matriculas.push(deA.matriculaId, deB.matriculaId);
    const [{ id }] = await q('INSERT INTO leads (project_id, nombre, email) VALUES ($1, $2, $3) RETURNING id',
      [proyecto.id, 'Alumno de dos campus', deA.titular.email]);
    suya = Number(id);
    leads.push(suya);
    await pedirUno(deA);
    await pedirUno(deB);
    // La de B, como una fila antigua unida por correo a la ficha del campus A.
    await q('UPDATE diploma_confirmaciones SET lead_id = $1, project_id = $2 WHERE matricula_id = $3 AND estado <> \'anulado\'',
      [suya, otro.id, deB.matriculaId]);
  });
  afterAll(async () => {
    await q('DELETE FROM diploma_confirmaciones WHERE matricula_id = ANY($1::bigint[])', [matriculas]);
    if (leads.length) await q('DELETE FROM leads WHERE id = ANY($1::int[])', [leads]);
    if (personas.length) {
      await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [personas]);
      await q('DELETE FROM users WHERE id = ANY($1::int[])', [personas]);
    }
    if (otro) await q('DELETE FROM projects WHERE id = $1', [otro.id]);
  });

  const matriculasDe = (filas) => filas.map((f) => f.matricula_id).sort();

  it('el superadmin ve las dos; un admin con solo el campus A, solo la de A', async () => {
    const todas = await verComo(SUPER, suya);
    expect(matriculasDe(todas.data)).toEqual([deA.matriculaId, deB.matriculaId].sort());

    const adminA = await persona('admin-a', 'admin', [proyecto.id]);
    const r = await verComo(adminA(), suya);
    expect(r.error).toBeUndefined();
    expect(r.data.map((f) => f.matricula_id)).toEqual([deA.matriculaId]);
    expect(r.data.every((f) => Number(f.project_id) === proyecto.id)).toBe(true);

    // Con los dos campus, las dos.
    const adminAB = await persona('admin-ab', 'admin', [proyecto.id, otro.id]);
    expect(matriculasDe((await verComo(adminAB(), suya)).data)).toEqual([deA.matriculaId, deB.matriculaId].sort());
  });

  it('un admin con solo el campus B no abre la ficha del campus A (404)', async () => {
    const adminB = await persona('admin-b', 'admin', [otro.id]);
    const r = await verComo(adminB(), suya);
    expect(r.data).toBeUndefined();
    expect(r.error).toMatchObject({ statusCode: 404 });
  });

  it('una gestora del campus que no lleva la ficha: 403, sin datos', async () => {
    const ajena = await persona('gestora-ajena', 'gestor', [proyecto.id, otro.id]);
    const r = await verComo(ajena(), suya);
    expect(r.data).toBeUndefined();
    expect(r.error).toMatchObject({ statusCode: 403, code: 'NO_ES_TUYO' });

    // La que sí la lleva la ve (y solo lo de sus campus).
    const lleva = await persona('gestora-lleva', 'gestor', [proyecto.id]);
    const { userId } = lleva();
    await q('UPDATE leads SET responsable_id = $1 WHERE id = $2', [userId, suya]);
    try {
      const v = await verComo(lleva(), suya);
      expect(v.error).toBeUndefined();
      expect(v.data.map((f) => f.matricula_id)).toEqual([deA.matriculaId]);
    } finally {
      await q('UPDATE leads SET responsable_id = NULL WHERE id = $1', [suya]);
    }
  });
});
