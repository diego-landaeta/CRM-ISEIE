import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

/**
 * CRM-ISEIE#455 (gemela CRM#767) · Matrícula automática en Moodle, fase 2.
 *
 * `hacerEnMoodle` llama a `local_crm_matricular` (plugin 1.12.0, Campus-Moodle#8) y la
 * vuelta actúa según lo que conteste: hecha (con su correo de bienvenida y la nota en la
 * ficha), hecha a medias, suspendido, rechazos del plugin, campus sin la 1.12.0 y fallos
 * de red. Moodle va simulado POR DEBAJO de `llamar` (su `fetch`), así que también se
 * prueba cómo se traduce cada respuesta. Con base real (la de db-preparar, con la 311).
 */

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

const { default: pool } = await import('../src/shared/config/db.js');
const conversionModel = await import('../src/modules/conversions/conversion.model.js');
const mm = await import('../src/modules/matricula-moodle/matricula-moodle.service.js');
const mmMoodle = await import('../src/modules/matricula-moodle/matricula-moodle.moodle.js');
const correo = await import('../src/modules/matricula-moodle/matricula-moodle.correo.js');
const { llamar, MoodleError } = await import('../src/shared/services/moodle.client.js');

const MARCA = `M455_${Date.now().toString(36)}`;
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const DESTINO = [987654321];
const CAMPUS_URL = 'https://campus.ejemplo.test';
const ENLACE = `${CAMPUS_URL}/local/crm/bienvenida.php?t=SECRETO455abcdef`;
const ENV = ['MATRICULA_MOODLE_ACTIVA', 'MATRICULA_MOODLE_CAMPUS', 'MATRICULA_MOODLE_INTENTOS',
  'MATRICULA_MOODLE_CORREO_EXISTENTES', 'EMAIL_LISTA_BLANCA', 'NODE_ENV'];
const guardadas = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

let proyecto;
let producto;   // dos cursos: 41 y 42
let n = 0;

async function venta({ email } = {}) {
  n += 1;
  const [lead] = await q(
    'INSERT INTO leads (nombre, email, project_id) VALUES ($1, $2, $3) RETURNING id',
    [`Lucía ${MARCA} Pérez`, email ?? `alumna${n}.455@ejemplo.test`, proyecto.id]
  );
  const v = await conversionModel.create({
    lead_id: lead.id, project_id: proyecto.id, producto_contratado: producto.nombre,
    producto_contratado_id: producto.id, importe_total: 900, importe_pagado: 0, metodo_pago: 'transferencia',
    fecha_conversion: new Date().toISOString().slice(0, 10), iva_incluido: true,
  });
  await conversionModel.addPayment(v.id, { importe: 300, metodo: 'transferencia' }, { allowDuplicate: true });
  return v;
}

const matriculaDe = (v) => q('SELECT * FROM matriculas_moodle WHERE conversion_id = $1 ORDER BY id', [v.id]).then((r) => r[0]);
const avisosDe = (id) => q(`SELECT * FROM admin_notifications WHERE (metadata->>'matricula_id')::int = $1 ORDER BY id`, [id]);
const notasDe = (v) => q('SELECT nota FROM lead_interactions WHERE lead_id = $1 ORDER BY id', [v.lead_id]).then((r) => r.map((x) => x.nota));

/** Un Moodle simulado: `fetch` que contesta lo que se le diga y apunta lo que le piden. */
function moodleQueContesta(respuesta) {
  const pedidas = [];
  const fetchImpl = async (url, opts) => {
    pedidas.push({ url, cuerpo: new URLSearchParams(opts.body) });
    const r = typeof respuesta === 'function' ? respuesta() : respuesta;
    return { ok: true, status: 200, json: async () => r };
  };
  const moodle = (fila, cursos) => mm.hacerEnMoodle(fila, cursos, {
    conexionImpl: async () => ({ url: CAMPUS_URL, token: 'token-de-prueba' }),
    llamarImpl: (con, f, p) => llamar(con, f, p, { fetchImpl }),
  });
  return { moodle, pedidas };
}

/** El correo, capturado en vez de mandado. */
function buzon(resultado = { sent: true, messageId: 'm1' }) {
  const enviados = [];
  return { enviados, enviar: async (c) => { enviados.push(c); return resultado; } };
}

const ok = (cursos, extra = {}) => ({
  userid: 77, nuevo: true, estado: 'ok', enlace: ENLACE, mensaje: '',
  cursos: cursos.map(([id, resultado, mensaje = '']) => ({ id, resultado, mensaje })), ...extra,
});

// El texto que LEE el alumno: sin las direcciones (la del enlace lleva la ruta del
// plugin, `/local/crm/…`, que no es texto).
const sinDirecciones = (t) => String(t).replace(/https?:\/\/\S+/g, '');

const vueltaCon = (moodle, b = buzon()) => mm.vuelta({ destinatarios: DESTINO, moodle, enviar: b.enviar });

beforeAll(async () => {
  [proyecto] = await q(
    'INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id, nombre, slug',
    [`Campus ${MARCA}`, MARCA.toLowerCase(), MARCA]
  );
  [producto] = await q('INSERT INTO products (project_id, nombre) VALUES ($1, $2) RETURNING id, nombre', [proyecto.id, `${MARCA} Máster`]);
  await q(
    `INSERT INTO moodle_cursos_producto (product_id, project_id, curso_moodle_id, curso_nombre)
     VALUES ($1, $2, 41, 'Máster de prueba'), ($1, $2, 42, 'Prácticas')`,
    [producto.id, proyecto.id]
  );
});

afterEach(async () => {
  for (const k of ENV) {
    if (guardadas[k] === undefined) delete process.env[k]; else process.env[k] = guardadas[k];
  }
  // Que una matrícula de una prueba no se cuele en la vuelta de la siguiente.
  await q(`UPDATE matriculas_moodle SET estado = 'cancelada' WHERE project_id = $1 AND estado = 'programada'`, [proyecto.id]);
});

afterAll(async () => {
  if (proyecto) {
    const c = [[proyecto.id]];
    const ventas = 'SELECT id FROM conversions WHERE project_id = ANY($1::int[])';
    await q(`DELETE FROM admin_notifications WHERE (metadata->>'campus_id')::int = ANY($1::int[])`, c);
    await q('DELETE FROM email_envios WHERE project_id = ANY($1::int[])', c);
    await q('DELETE FROM matriculas_moodle WHERE project_id = ANY($1::int[])', c);
    await q(`DELETE FROM conversion_installments WHERE conversion_id IN (${ventas})`, c);
    await q(`DELETE FROM conversion_payments WHERE conversion_id IN (${ventas})`, c);
    await q(`DELETE FROM conversion_items WHERE conversion_id IN (${ventas})`, c);
    await q('DELETE FROM conversions WHERE project_id = ANY($1::int[])', c);
    await q('DELETE FROM lead_interactions WHERE lead_id IN (SELECT id FROM leads WHERE project_id = ANY($1::int[]))', c);
    await q('DELETE FROM leads WHERE project_id = ANY($1::int[])', c);
    await q('DELETE FROM moodle_cursos_producto WHERE project_id = ANY($1::int[])', c);
    await q('DELETE FROM products WHERE project_id = ANY($1::int[])', c);
    await q('DELETE FROM projects WHERE id = ANY($1::int[])', c);
  }
  await pool.end();
});

function encender() {
  process.env.MATRICULA_MOODLE_ACTIVA = '1';
  process.env.MATRICULA_MOODLE_CAMPUS = String(proyecto.id);
}

describe('#455 · alumno nuevo: matriculado y con su correo de bienvenida', () => {
  it('llama a local_crm_matricular con su correo, nombre, apellidos y cursos; queda «hecha»', async () => {
    encender();
    const v = await venta();
    const { moodle, pedidas } = moodleQueContesta(ok([[41, 'matriculado'], [42, 'matriculado']]));
    const b = buzon();
    const r = await vueltaCon(moodle, b);
    expect(r.hecha).toBe(1);

    expect(pedidas).toHaveLength(1);
    const p = pedidas[0].cuerpo;
    expect(p.get('wsfunction')).toBe('local_crm_matricular');
    expect(p.get('correo')).toBe(`alumna${n}.455@ejemplo.test`);
    expect(p.get('nombre')).toBe('Lucía');
    expect(p.get('apellidos')).toBe(`${MARCA} Pérez`);
    expect([p.get('cursos[0]'), p.get('cursos[1]')]).toEqual(['41', '42']);

    const m = await matriculaDe(v);
    expect(m.estado).toBe('hecha');
    expect(Number(m.moodle_user_id)).toBe(77);
    expect(m.motivo).toBeNull();
    expect(m.cursos.map((c) => c.resultado)).toEqual(['matriculado', 'matriculado']);
    // Hecha sin problemas: ningún aviso (antes, «lista» avisaba para hacerla a mano).
    expect(await avisosDe(m.id)).toHaveLength(0);

    // El correo: al alumno, con el enlace, los cursos y la dirección del campus.
    expect(b.enviados).toHaveLength(1);
    const c = b.enviados[0];
    expect(c.to.email).toBe(`alumna${n}.455@ejemplo.test`);
    expect(c.projectId).toBe(proyecto.id);
    expect(c.fromName).toBe(`Campus ${MARCA}`); // el campus, no «CRM ISEIE»
    expect(c.clave).toBe(`matricula-moodle:${m.id}:bienvenida`);
    expect(c.subject).toBe(`Campus ${MARCA} · tu acceso al campus`);
    expect(c.htmlContent).toContain(ENLACE);
    expect(c.htmlContent).toContain('Máster de prueba');
    expect(c.htmlContent).toContain(`${CAMPUS_URL}/course/view.php?id=41`);
    expect(c.htmlContent).toContain(`${CAMPUS_URL}/login/index.php`);
    expect(c.textContent).toContain(ENLACE);
    // Ningún texto al alumno dice «CRM».
    expect(sinDirecciones(c.textContent)).not.toMatch(/crm/i);
    expect(c.subject).not.toMatch(/crm/i);

    // En la ficha: qué se hizo y qué se mandó, SIN el enlace (es una credencial).
    const notas = await notasDe(v);
    expect(notas).toHaveLength(1);
    expect(notas[0]).toMatch(/Matriculado en Moodle .*Máster de prueba \(id 41\), Prácticas \(id 42\)/);
    expect(notas[0]).toMatch(/Cuenta nueva en el campus \(id 77\)/);
    expect(notas[0]).toMatch(/Correo de bienvenida enviado con el enlace para poner su contraseña/);
    expect(notas[0]).not.toContain('SECRETO455');
    expect(notas[0]).not.toContain('bienvenida.php');

    // Otra vuelta no la repite.
    await vueltaCon(moodle, b);
    expect(pedidas).toHaveLength(1);
    expect(b.enviados).toHaveLength(1);
  });

  it('un enlace que no es del campus no se manda: sin correo y anotado', async () => {
    encender();
    const v = await venta();
    const { moodle } = moodleQueContesta(ok([[41, 'matriculado'], [42, 'matriculado']], { enlace: 'https://otro.sitio.test/x?t=1' }));
    const b = buzon();
    await vueltaCon(moodle, b);
    expect((await matriculaDe(v)).estado).toBe('hecha');
    expect(b.enviados).toHaveLength(0);
    expect((await notasDe(v))[0]).toMatch(/no ha dado el enlace/);
  });

  it('con el freno de pruebas (sin lista blanca) no sale, y la ficha lo dice', async () => {
    encender();
    process.env.NODE_ENV = 'test';
    delete process.env.EMAIL_LISTA_BLANCA;
    const v = await venta();
    const { moodle } = moodleQueContesta(ok([[41, 'matriculado'], [42, 'matriculado']]));
    // Sin `enviar`: el `sendEmail` de verdad, que frena antes de Brevo.
    const r = await mm.vuelta({ destinatarios: DESTINO, moodle });
    expect(r.hecha).toBe(1);
    const m = await matriculaDe(v);
    expect(m.estado).toBe('hecha');
    const [envio] = await q('SELECT estado, asunto FROM email_envios WHERE clave = $1', [`matricula-moodle:${m.id}:bienvenida`]);
    expect(envio.estado).toBe('bloqueado');
    expect((await notasDe(v))[0]).toMatch(/preparado, pero no enviado: freno de correos de pruebas/);
  });

  it('si el correo no sale (Brevo lo rechaza), la matrícula queda hecha y se avisa', async () => {
    encender();
    const v = await venta();
    const { moodle } = moodleQueContesta(ok([[41, 'matriculado'], [42, 'matriculado']]));
    await vueltaCon(moodle, buzon({ sent: false, reason: 'HTTP_400' }));
    const m = await matriculaDe(v);
    expect(m.estado).toBe('hecha');
    const [aviso] = await avisosDe(m.id);
    expect(aviso.type).toBe(mm.TIPO_REVISAR);
    expect(aviso.title).toMatch(/No salió la bienvenida/);
    expect(aviso.message).toMatch(/HTTP_400/);
    expect(aviso.message).not.toContain('SECRETO455');
  });
});

describe('#455 · alumno que ya tenía cuenta', () => {
  const existente = (cursos) => ok(cursos, { nuevo: false, enlace: '' });

  it('con MATRICULA_MOODLE_CORREO_EXISTENTES apagado: hecha, sin correo, y la ficha lo dice', async () => {
    encender();
    const v = await venta();
    const { moodle } = moodleQueContesta(existente([[41, 'matriculado'], [42, 'ya_estaba']]));
    const b = buzon();
    await vueltaCon(moodle, b);
    expect((await matriculaDe(v)).estado).toBe('hecha');
    expect(b.enviados).toHaveLength(0);
    const [nota] = await notasDe(v);
    expect(nota).toMatch(/Ya tenía cuenta en el campus/);
    expect(nota).toMatch(/MATRICULA_MOODLE_CORREO_EXISTENTES apagado/);
  });

  it('encendido: correo con SOLO sus cursos nuevos, el acceso y «¿Has olvidado tu contraseña?»', async () => {
    encender();
    process.env.MATRICULA_MOODLE_CORREO_EXISTENTES = '1';
    const v = await venta();
    const { moodle } = moodleQueContesta(existente([[41, 'matriculado'], [42, 'ya_estaba']]));
    const b = buzon();
    await vueltaCon(moodle, b);
    expect(b.enviados).toHaveLength(1);
    const c = b.enviados[0];
    expect(c.subject).toMatch(/tus cursos nuevos en el campus/);
    expect(c.htmlContent).toContain('Máster de prueba');
    expect(c.htmlContent).not.toContain('Prácticas'); // ya estaba: no es nuevo
    expect(c.htmlContent).toContain(`${CAMPUS_URL}/login/forgot_password.php`);
    expect(c.htmlContent).toContain('¿Has olvidado tu contraseña?');
    expect(c.htmlContent).not.toContain('bienvenida.php');
    expect(sinDirecciones(c.textContent)).not.toMatch(/crm/i);
    expect((await notasDe(v))[0]).toMatch(/Correo de bienvenida enviado con sus cursos nuevos/);
  });

  it('encendido, pero ya estaba en todos: sin correo', async () => {
    encender();
    process.env.MATRICULA_MOODLE_CORREO_EXISTENTES = '1';
    const v = await venta();
    const { moodle } = moodleQueContesta(existente([[41, 'ya_estaba'], [42, 'ya_estaba']]));
    const b = buzon();
    await vueltaCon(moodle, b);
    expect((await matriculaDe(v)).estado).toBe('hecha');
    expect(b.enviados).toHaveLength(0);
  });
});

describe('#455 · lo que no se reintenta', () => {
  it('prospecto borrado (deleted_at): no se llama a Moodle ni se le escribe; reintento con su motivo', async () => {
    encender();
    const v = await venta();
    await q('UPDATE leads SET deleted_at = NOW() WHERE id = $1', [v.lead_id]);
    const { moodle, pedidas } = moodleQueContesta(ok([[41, 'matriculado'], [42, 'matriculado']]));
    const b = buzon();
    const r = await vueltaCon(moodle, b);
    expect(r.reintento).toBe(1);
    expect(pedidas).toHaveLength(0);
    expect(b.enviados).toHaveLength(0);
    const m = await matriculaDe(v);
    expect(m.estado).toBe('programada');
    expect(m.motivo).toBe('La ficha del alumno ya no existe');
    expect(await notasDe(v)).toHaveLength(0);
  });

  it('cuenta suspendida: «fallo» a la primera, aviso a administración y nota en la ficha', async () => {
    encender();
    const v = await venta();
    const { moodle, pedidas } = moodleQueContesta({
      userid: 90, nuevo: false, estado: 'suspendido', enlace: '', mensaje: 'La cuenta está suspendida en el campus',
      cursos: [{ id: 41, resultado: 'error', mensaje: 'suspendida' }, { id: 42, resultado: 'error', mensaje: 'suspendida' }],
    });
    const b = buzon();
    const r = await vueltaCon(moodle, b);
    expect(r.suspendido).toBe(1);
    const m = await matriculaDe(v);
    expect(m.estado).toBe('fallo');
    expect(m.intentos).toBe(1);
    expect(m.motivo).toMatch(/suspendida en Moodle \(id 90\): no se reactiva sola/);
    expect(b.enviados).toHaveLength(0);
    const [aviso] = await avisosDe(m.id);
    expect(aviso.type).toBe(mm.TIPO_REVISAR);
    expect(aviso.title).toMatch(/Alumno suspendido en Moodle/);
    expect(aviso.target_user_ids).toEqual(DESTINO);
    expect((await notasDe(v))[0]).toMatch(/Matrícula en Moodle sin hacer/);
    // No se vuelve a intentar.
    await vueltaCon(moodle, b);
    expect(pedidas).toHaveLength(1);
  });

  it('matrícula suspendida en el curso (todos los cursos): igual que la cuenta suspendida', async () => {
    encender();
    const v = await venta();
    const msg = 'El alumno tiene la matrícula suspendida en el curso 41: no se reactiva sola.';
    const { moodle } = moodleQueContesta(ok([[41, 'error', msg], [42, 'error', msg.replace('41', '42')]], { nuevo: false, enlace: '' }));
    const r = await vueltaCon(moodle);
    expect(r.suspendido).toBe(1);
    const m = await matriculaDe(v);
    expect(m.estado).toBe('fallo');
    expect((await avisosDe(m.id))[0].title).toMatch(/Alumno suspendido/);
  });

  it.each([
    ['matricular_correo_repetido', 'Hay varias cuentas con el correo x (ids 3, 4): no se sabe cuál es la del alumno y no se toca ninguna.'],
    ['matricular_es_admin', 'Ese correo es de una cuenta de administración del sitio: no se matricula ni se le da enlace.'],
    ['matricular_rol_no_alumno', 'El rol «editingteacher» no es de tipo alumno.'],
    ['matricular_correo_malo', 'El correo «x» no es válido.'],
    ['matricular_sin_nombre', 'Faltan el nombre o los apellidos del alumno.'],
  ])('rechazo %s: «fallo» a la primera con aviso, sin 5 reintentos', async (errorcode, message) => {
    encender();
    const v = await venta();
    const { moodle } = moodleQueContesta({ exception: 'moodle_exception', errorcode, message });
    const r = await vueltaCon(moodle);
    expect(r.fallo).toBe(1);
    const m = await matriculaDe(v);
    expect(m.estado).toBe('fallo');
    expect(m.intentos).toBe(1);
    expect(m.motivo).toBe(`El campus ha rechazado la matrícula: ${message.replace(/\.$/, '')}.`);
    const [aviso] = await avisosDe(m.id);
    expect(aviso.type).toBe(mm.TIPO_REVISAR);
    expect(aviso.title).toMatch(/Matrícula rechazada por Moodle/);
  });

  it('ningún curso se pudo (curso inexistente, sin matrícula manual): «fallo» con los motivos', async () => {
    encender();
    const v = await venta();
    const { moodle } = moodleQueContesta(ok([[41, 'error', 'El curso 41 no existe en el campus.'], [42, 'error', 'El curso 42 no tiene matrícula manual.']]));
    await vueltaCon(moodle);
    const m = await matriculaDe(v);
    expect(m.estado).toBe('fallo');
    expect(m.motivo).toMatch(/Máster de prueba \(El curso 41 no existe en el campus\.\); Prácticas/);
  });
});

describe('#455 · hecha a medias', () => {
  it('un curso falla y el otro no: «hecha» con el motivo, aviso de cuál y correo con el bueno', async () => {
    encender();
    const v = await venta();
    const { moodle } = moodleQueContesta(ok([[41, 'matriculado'], [42, 'error', 'El curso 42 no tiene matrícula manual.']]));
    const b = buzon();
    const r = await vueltaCon(moodle, b);
    expect(r.parcial).toBe(1);
    const m = await matriculaDe(v);
    expect(m.estado).toBe('hecha');
    expect(m.motivo).toBe('No se pudo en: Prácticas (El curso 42 no tiene matrícula manual.)');
    expect(m.cursos.find((c) => c.curso_moodle_id === 42).resultado).toBe('error');
    const [aviso] = await avisosDe(m.id);
    expect(aviso.type).toBe(mm.TIPO_REVISAR);
    expect(aviso.title).toMatch(/Matrícula a medias/);
    expect(aviso.message).toMatch(/Prácticas \(El curso 42 no tiene matrícula manual\.\)/);
    expect(b.enviados).toHaveLength(1);
    expect(b.enviados[0].htmlContent).toContain('Máster de prueba');
    expect(b.enviados[0].htmlContent).not.toContain('Prácticas');
  });
});

describe('#455 · campus sin preparar y fallos pasajeros', () => {
  it('«function not found» (campus sin la 1.12.0): aviso una vez y reintento al día siguiente', async () => {
    encender();
    const v = await venta();
    const { moodle } = moodleQueContesta({
      exception: 'dml_missing_record_exception', errorcode: 'invalidrecord',
      message: "Can't find data record in database table external_functions.",
    });
    const r = await vueltaCon(moodle);
    expect(r.espera).toBe(1);
    let m = await matriculaDe(v);
    expect(m.estado).toBe('programada');
    expect(m.intentos).toBe(1);
    expect(m.motivo).toMatch(/no tiene el plugin 1\.12\.0/);
    const horas = (new Date(m.proximo_intento_at) - Date.now()) / 3600000;
    expect(horas).toBeGreaterThan(23);
    let avisos = await avisosDe(m.id);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].type).toBe(mm.TIPO_REVISAR);
    expect(avisos[0].message).toMatch(/se vuelve a intentar mañana/);

    // Al día siguiente, lo mismo: no se repite el aviso.
    await q(`UPDATE matriculas_moodle SET proximo_intento_at = NOW() - interval '1 minute' WHERE id = $1`, [m.id]);
    await vueltaCon(moodle);
    m = await matriculaDe(v);
    expect(m.intentos).toBe(2);
    avisos = await avisosDe(m.id);
    expect(avisos).toHaveLength(1);
  });

  it('token sin permiso para la función: también espera, con su motivo', async () => {
    encender();
    const v = await venta();
    const { moodle } = moodleQueContesta({ exception: 'webservice_access_exception', errorcode: 'accessexception', message: 'Access control exception' });
    await vueltaCon(moodle);
    const m = await matriculaDe(v);
    expect(m.estado).toBe('programada');
    expect(m.motivo).toMatch(/no tiene permiso para «local_crm_matricular»/);
  });

  it('sin red: reintento en una hora, sin aviso, como en la fase 1', async () => {
    encender();
    const v = await venta();
    const moodle = (fila, cursos) => mm.hacerEnMoodle(fila, cursos, {
      conexionImpl: async () => ({ url: CAMPUS_URL, token: 't' }),
      llamarImpl: (con, f, p) => llamar(con, f, p, { fetchImpl: async () => { throw new TypeError('fetch failed'); } }),
    });
    const r = await vueltaCon(moodle);
    expect(r.reintento).toBe(1);
    const m = await matriculaDe(v);
    expect(m.estado).toBe('programada');
    expect(m.intentos).toBe(1);
    expect(m.motivo).toMatch(/^Error al matricular: No se ha podido llegar al campus/);
    const horas = (new Date(m.proximo_intento_at) - Date.now()) / 3600000;
    expect(horas).toBeLessThan(1.1);
    expect(await avisosDe(m.id)).toHaveLength(0);
  });

  it('campus sin el plugin conectado: «lista» y aviso para hacerla a mano (fase 1)', async () => {
    encender();
    const v = await venta();
    const moodle = (fila, cursos) => mm.hacerEnMoodle(fila, cursos, { conexionImpl: async () => null });
    const r = await vueltaCon(moodle);
    expect(r.lista).toBe(1);
    const m = await matriculaDe(v);
    expect(m.estado).toBe('lista');
    const [aviso] = await avisosDe(m.id);
    expect(aviso.type).toBe(mm.TIPO_LISTA);
    expect(aviso.message).toMatch(/se hace a mano/);
  });
});

describe('#455 · piezas sueltas', () => {
  it('partirNombre: la primera palabra es el nombre; una sola palabra lleva «-» de apellidos', () => {
    expect(mmMoodle.partirNombre('  María José  García ')).toEqual({ nombre: 'María', apellidos: 'José García' });
    expect(mmMoodle.partirNombre('Pedro')).toEqual({ nombre: 'Pedro', apellidos: '-' });
    expect(mmMoodle.partirNombre('')).toEqual({ nombre: '', apellidos: '' });
  });

  it('llamar conserva el errorcode de Moodle en el error', async () => {
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ exception: 'x', errorcode: 'matricular_es_admin', message: 'No.' }) });
    const err = await llamar({ url: CAMPUS_URL, token: 't' }, 'local_crm_matricular', {}, { fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(MoodleError);
    expect(err.codigo).toBe('MOODLE');
    expect(err.errorcode).toBe('matricular_es_admin');
  });

  it('el correo del alumno nuevo: enlace en el botón, cursos, campus y nada de «CRM»', () => {
    const { asunto, htmlContent, textContent } = correo.armarNuevo({
      alumno: 'Ana <b>Ruiz</b>', proyecto: { id: 1, nombre: 'ISEIE' }, campusUrl: CAMPUS_URL,
      cursos: [{ curso_moodle_id: 5, curso_nombre: 'Curso & Taller' }], enlace: ENLACE,
    });
    expect(asunto).toBe('ISEIE · tu acceso al campus');
    expect(htmlContent).toContain(`href="${ENLACE}"`);
    expect(htmlContent).toContain('Curso &amp; Taller');
    expect(htmlContent).toContain('Hola Ana,'); // escapado y solo el nombre
    expect(htmlContent).not.toContain('<b>Ruiz');
    expect(htmlContent).toContain('campus.ejemplo.test');
    expect(htmlContent).toMatch(/te has matriculado en\s*<strong[^>]*>ISEIE<\/strong>/);
    expect(sinDirecciones(textContent)).not.toMatch(/crm/i);
  });

  it('el pie de siempre («Te lo manda el CRM…») sigue igual en los correos del equipo', async () => {
    const P = await import('../src/shared/services/email-plantilla.service.js');
    expect(P.correo({ proyecto: { nombre: 'ISEIE' }, titulo: 't', bloques: [] }).textContent).toMatch(/Te lo manda el CRM de ISEIE/);
  });
});
