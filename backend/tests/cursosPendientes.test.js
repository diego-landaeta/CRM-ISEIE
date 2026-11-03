import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Cursos pendientes para las tutoras, por campus (#336), contra la base de verdad.
 *
 * Lo que se defiende (los criterios de aceptación de la issue):
 *   · vender una formación que no existe crea el pendiente en su campus; venderla
 *     otra vez en el mismo campus suma una alumna, sin duplicarlo;
 *   · no se pasa a «en desarrollo» sin fecha comprometida ni se mueve la fecha sin motivo;
 *   · «Marcar publicado» rechaza una URL de otro dominio o que no responde;
 *   · cuando todas las alumnas están habilitadas, el curso pasa solo a «cerrado»;
 *   · un pendiente con la fecha pasada sale como retrasado y avisa a tutora y admin;
 *   · cada una ve lo suyo: una tutora, sus cursos; un admin, sus campus;
 *   · los contadores salen por campus, también los que están a 0.
 *
 *   npx vitest run tests/cursosPendientes.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/cursos-pendientes/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { avisarVencimientos, resumenDeLaSemana } = await import('../src/modules/cursos-pendientes/cursos-pendientes.service.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `CPE${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [], leads: [], conversions: [], products: [] };
let P; let OTRO; let VACIO;
let SUPER; let ADMIN; let ADMIN_OTRO; let GESTORA; let GESTORA_OTRO; let TUTORA; let TUTORA2;
let LEAD_A; let LEAD_B; let LEAD_C; let LEAD_OTRO; let VENTA_A; let PRODUCTO; let PRODUCTO2;
const jwtDe = (u) => jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' });
const como = (u) => ({ Authorization: `Bearer ${jwtDe(u)}` });
// El día es el de Madrid, como el de la aplicación: pasada la medianoche allí y no en UTC, «hoy» ya es otro.
const ZONA = process.env.APP_TIMEZONE || 'Europe/Madrid';
// Por calendario y no por «n × 24 h»: un cambio de hora (a finales de octubre) desplazaría el día.
const manana = (n) => {
  const [a, m, d] = new Date().toLocaleDateString('en-CA', { timeZone: ZONA }).split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
};
const HOY_SQL = `(now() AT TIME ZONE '${ZONA}')::date`;

async function persona(nombre, role, campus = []) {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role, nombre`,
    [`${MARCA} ${nombre}`, `${nombre.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]
  );
  ids.users.push(u.id);
  for (const c of campus) await q(`INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)`, [u.id, c]);
  return u;
}

async function lead(nombre, proyecto) {
  const [l] = await q(`INSERT INTO leads (project_id, nombre, email, telefono) VALUES ($1, $2, $3, '+34600111222') RETURNING id`,
    [proyecto, `${MARCA} ${nombre}`, `${nombre.toLowerCase()}@lead.${MARCA.toLowerCase()}.test`]);
  ids.leads.push(l.id);
  return l.id;
}

beforeAll(async () => {
  const proy = async (clave) => {
    const [p] = await q(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
      [`${MARCA} ${clave}`, `${MARCA.toLowerCase()}-${clave}`, `${MARCA}-key-${clave}`]);
    ids.projects.push(p.id);
    return p.id;
  };
  P = await proy('a'); OTRO = await proy('b'); VACIO = await proy('c');
  SUPER = await persona('SUPER', 'superadmin');
  ADMIN = await persona('ADMIN', 'admin', [P, VACIO]);
  ADMIN_OTRO = await persona('ADMINOTRO', 'admin', [OTRO]);
  GESTORA = await persona('GESTORA', 'gestor', [P]);
  GESTORA_OTRO = await persona('GESTORAOTRO', 'gestor', [OTRO]);
  TUTORA = await persona('TUTORA', 'tutor', [P]);
  TUTORA2 = await persona('TUTORADOS', 'tutor', [P]);

  LEAD_A = await lead('Ana', P); LEAD_B = await lead('Berta', P); LEAD_C = await lead('Carla', P);
  LEAD_OTRO = await lead('Otra', OTRO);
  const [v] = await q(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion) VALUES ($1, $2, 'x', 500, 0, CURRENT_DATE) RETURNING id`,
    [LEAD_A, P]);
  VENTA_A = v.id; ids.conversions.push(v.id);
  // El dominio del campus se conoce por los enlaces de sus formaciones.
  const [pr] = await q(`INSERT INTO products (project_id, nombre, url_info) VALUES ($1, $2, 'https://campus-p.example.org/curso-uno/') RETURNING id`, [P, `${MARCA} Existente`]);
  PRODUCTO = pr.id; ids.products.push(pr.id);
  const [pr2] = await q(`INSERT INTO products (project_id, nombre, url_info) VALUES ($1, $2, 'https://campus-p.example.org/curso-dos/') RETURNING id`, [P, `${MARCA} Segunda`]);
  PRODUCTO2 = pr2.id; ids.products.push(pr2.id);
}, 60000);

afterAll(async () => {
  vi.unstubAllGlobals();
  const c = `(SELECT id FROM cursos_pendientes WHERE project_id = ANY($1::int[]))`;
  await q(`DELETE FROM admin_notifications WHERE metadata->>'marca' = $2 OR title LIKE $3 OR message LIKE $3`, [ids.projects, MARCA, `%${MARCA}%`]).catch(() => {});
  await q(`DELETE FROM cursos_pendientes_avisos WHERE curso_id IN ${c}`, [ids.projects]);
  await q(`DELETE FROM cursos_pendientes WHERE project_id = ANY($1::int[])`, [ids.projects]);
  await q(`DELETE FROM conversions WHERE id = ANY($1::int[])`, [ids.conversions]);
  await q(`DELETE FROM leads WHERE id = ANY($1::int[])`, [ids.leads]);
  await q(`DELETE FROM products WHERE id = ANY($1::int[])`, [ids.products]);
  await q(`DELETE FROM user_projects WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM projects WHERE id = ANY($1::int[])`, [ids.projects]);
  await pool.end();
}, 60000);

const nombre = (s) => `${MARCA} ${s}`;
const crear = (u, cuerpo) => request.post('/api/cursos-pendientes').set(como(u)).send({ project_id: P, tipo: 'curso', ...cuerpo });
const cambiar = (u, id, cuerpo) => request.patch(`/api/cursos-pendientes/${id}`).set(como(u)).send(cuerpo);
const ver = (u, id) => request.get(`/api/cursos-pendientes/${id}`).set(como(u));
const avisos = (tipo, userId) => q(`SELECT title FROM admin_notifications WHERE type = $1 AND $2 = ANY(target_user_ids)`, [tipo, userId]);

// ── Crear y sumar alumnas ────────────────────────────────────────────────

describe('crear un pendiente al vender algo que no existe', () => {
  let ID;

  it('lo crea en su campus, sin tutora, con la alumna y su venta', async () => {
    const r = await crear(GESTORA, { nombre: nombre('Máster en Coaching'), tipo: 'master', lead_id: LEAD_A, conversion_id: VENTA_A });
    expect(r.status).toBe(201);
    ID = r.body.data.curso.id;
    expect(r.body.data).toMatchObject({ nuevo: true, alumna_sumada: true });
    expect(r.body.data.curso).toMatchObject({ project_id: P, estado: 'pendiente_asignar', tipo: 'master', tutor_id: null, alumnas_esperando: 1, retrasado: false });
    const d = (await ver(ADMIN, ID)).body.data;
    expect(d.alumnas[0]).toMatchObject({ lead_id: LEAD_A, conversion_id: VENTA_A, estado: 'en_espera', avisada: false, falta_contacto: false });
    expect(d.alumnas[0].nombre).toBe(nombre('Ana'));
    expect(d.historial.map((h) => h.accion).sort()).toEqual(['alumna_sumada', 'creado']);
  });

  it('venderla OTRA VEZ en el mismo campus suma una alumna y NO duplica el pendiente (aunque cambie el uso de mayúsculas)', async () => {
    const r = await crear(GESTORA, { nombre: nombre('MÁSTER en coaching').toLowerCase(), lead_id: LEAD_B });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ nuevo: false, alumna_sumada: true });
    expect(r.body.data.curso.id).toBe(ID);
    expect(r.body.data.curso.alumnas_total).toBe(2);
    const filas = await q(`SELECT count(*)::int AS n FROM cursos_pendientes WHERE project_id = $1 AND lower(nombre) = lower($2)`, [P, nombre('Máster en Coaching')]);
    expect(filas[0].n).toBe(1);
  });

  it('la misma alumna dos veces no se repite', async () => {
    const r = await crear(GESTORA, { nombre: nombre('Máster en Coaching'), lead_id: LEAD_B });
    expect(r.body.data.alumna_sumada).toBe(false);
    expect(r.body.data.curso.alumnas_total).toBe(2);
  });

  it('la misma formación en OTRO campus es otro pendiente', async () => {
    const r = await request.post('/api/cursos-pendientes').set(como(GESTORA_OTRO))
      .send({ project_id: OTRO, nombre: nombre('Máster en Coaching'), lead_id: LEAD_OTRO });
    expect(r.status).toBe(201);
    expect(r.body.data.curso.id).not.toBe(ID);
  });

  it('con ficha del catálogo: un solo abierto por formación y campus', async () => {
    const a = await crear(GESTORA, { nombre: nombre('Existente (renombrado)'), product_id: PRODUCTO, lead_id: LEAD_A });
    expect(a.status).toBe(201);
    const b = await crear(GESTORA, { nombre: nombre('Otro nombre para lo mismo'), product_id: PRODUCTO, lead_id: LEAD_B });
    expect(b.body.data).toMatchObject({ nuevo: false });
    expect(b.body.data.curso.id).toBe(a.body.data.curso.id);
  });

  it('lo defiende la base: dos abiertos de la misma formación y campus no caben', async () => {
    await expect(q(`INSERT INTO cursos_pendientes (project_id, nombre) VALUES ($1, $2)`, [P, nombre('máster EN COACHING')])).rejects.toThrow(/uq_cp_abierto_nombre/);
  });

  it('una persona de otro campus, una venta ajena o un tipo raro: 400', async () => {
    expect((await crear(GESTORA, { nombre: nombre('X1'), lead_id: LEAD_OTRO })).status).toBe(400);
    expect((await crear(GESTORA, { nombre: nombre('X2'), lead_id: LEAD_B, conversion_id: VENTA_A })).status).toBe(400);
    expect((await crear(GESTORA, { nombre: nombre('X3'), tipo: 'taller' })).status).toBe(400);
    expect((await crear(GESTORA, { nombre: nombre('X4'), product_id: 2147483000 })).status).toBe(400);
  });

  it('quién puede crear: una gestora de OTRO campus no (403), una tutora tampoco', async () => {
    expect((await crear(GESTORA_OTRO, { nombre: nombre('X5') })).status).toBe(403);
    expect((await crear(TUTORA, { nombre: nombre('X6') })).status).toBe(403);
    expect((await request.post('/api/cursos-pendientes').send({})).status).toBe(401);
  });
});

// ── Asignar, fecha y estados ─────────────────────────────────────────────

describe('asignar, fecha comprometida y estados', () => {
  let ID;
  beforeAll(async () => {
    ID = (await crear(GESTORA, { nombre: nombre('Diplomado de Mindfulness'), tipo: 'diplomado', lead_id: LEAD_A })).body.data.curso.id;
  });

  it('solo un administrador asigna la tutora; pasa a «asignado» y a ella le llega el aviso', async () => {
    expect((await cambiar(GESTORA, ID, { tutor_id: TUTORA.id })).status).toBe(403);
    expect((await cambiar(ADMIN, ID, { tutor_id: GESTORA.id })).status).toBe(400); // no es una tutora
    const r = await cambiar(ADMIN, ID, { tutor_id: TUTORA.id });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ estado: 'asignado', tutor_id: TUTORA.id });
    expect((await avisos('curso_pendiente_asignado', TUTORA.id)).map((a) => a.title)).toContain(`Te han asignado un curso: ${nombre('Diplomado de Mindfulness')}`);
  });

  it('NO pasa a «en desarrollo» sin fecha comprometida', async () => {
    const r = await cambiar(TUTORA, ID, { estado: 'en_desarrollo' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('FECHA_REQUERIDA');
  });

  it('y lo defiende la base aunque falle el código', async () => {
    await expect(q(`UPDATE cursos_pendientes SET estado = 'en_desarrollo' WHERE id = $1`, [ID])).rejects.toThrow(/cp_fecha_para_avanzar/);
  });

  it('la primera fecha, sin motivo; en el pasado, una tutora no', async () => {
    expect((await cambiar(TUTORA, ID, { fecha_comprometida: manana(-2) })).status).toBe(400);
    const r = await cambiar(TUTORA, ID, { fecha_comprometida: manana(10) });
    expect(r.status).toBe(200);
    expect(r.body.data.fecha_comprometida.slice(0, 10)).toBe(manana(10));
    expect(r.body.data).toMatchObject({ veces_movida_fecha: 0, dias_para_la_fecha: 10 });
  });

  it('con fecha, pasa a «en desarrollo»', async () => {
    const r = await cambiar(TUTORA, ID, { estado: 'en_desarrollo' });
    expect(r.body.data.estado).toBe('en_desarrollo');
  });

  it('mover la fecha sin motivo, no; con motivo, sí, y queda en el historial', async () => {
    const sin = await cambiar(TUTORA, ID, { fecha_comprometida: manana(15) });
    expect(sin.status).toBe(400);
    expect(sin.body.code).toBe('MOTIVO_REQUERIDO');
    const con = await cambiar(TUTORA, ID, { fecha_comprometida: manana(15), motivo: 'Falta el material del módulo 3' });
    expect(con.body.data.veces_movida_fecha).toBe(1);
    const h = (await ver(TUTORA, ID)).body.data.historial.find((x) => x.accion === 'fecha_movida');
    expect(h).toMatchObject({ motivo: 'Falta el material del módulo 3', persona: TUTORA.nombre });
  });

  it('a la SEGUNDA vez que se mueve, avisa al admin del campus', async () => {
    expect((await avisos('curso_pendiente_fecha_movida', ADMIN.id))).toHaveLength(0);
    await cambiar(TUTORA, ID, { fecha_comprometida: manana(20), motivo: 'Otra vez' });
    expect((await avisos('curso_pendiente_fecha_movida', ADMIN.id)).length).toBe(1);
    expect((await avisos('curso_pendiente_fecha_movida', SUPER.id)).length).toBe(1);
    // El admin de otro campus no se entera.
    expect((await avisos('curso_pendiente_fecha_movida', ADMIN_OTRO.id))).toHaveLength(0);
  });

  it('el avance (foto, vídeo, módulos) lo pone la tutora', async () => {
    const r = await cambiar(TUTORA, ID, { avance_foto: true, avance_modulos: 50 });
    expect(r.body.data).toMatchObject({ avance_foto: true, avance_video: false, avance_modulos: 50 });
    expect((await cambiar(TUTORA, ID, { avance_modulos: 33 })).status).toBe(400);
  });

  it('una tutora no cancela ni reasigna ni cambia el tipo; un campo desconocido, 400', async () => {
    expect((await cambiar(TUTORA, ID, { estado: 'cancelado', motivo: 'no quiero' })).status).toBe(403);
    expect((await cambiar(TUTORA, ID, { tutor_id: TUTORA2.id })).status).toBe(403);
    expect((await cambiar(TUTORA, ID, { tipo: 'master' })).status).toBe(403);
    expect((await cambiar(TUTORA, ID, { project_id: OTRO })).status).toBe(400);
  });

  it('cancelar: solo un admin y con motivo; después no se toca más', async () => {
    const otro = (await crear(GESTORA, { nombre: nombre('Curso a cancelar'), lead_id: LEAD_C })).body.data.curso.id;
    const sin = await cambiar(ADMIN, otro, { estado: 'cancelado' });
    expect(sin.body.code).toBe('MOTIVO_REQUERIDO');
    const ok = await cambiar(ADMIN, otro, { estado: 'cancelado', motivo: 'Ya no se va a impartir' });
    expect(ok.body.data.estado).toBe('cancelado');
    expect((await cambiar(ADMIN, otro, { notas: 'x' })).status).toBe(409);
    // Cancelado, libera la formación: se puede abrir otro pendiente igual.
    const nuevo = await crear(GESTORA, { nombre: nombre('Curso a cancelar'), lead_id: LEAD_C });
    expect(nuevo.status).toBe(201);
  });
});

// ── Quién ve qué ─────────────────────────────────────────────────────────

describe('cada una ve lo suyo', () => {
  let DE_TUTORA; let SIN_TUTORA;
  beforeAll(async () => {
    DE_TUTORA = (await crear(GESTORA, { nombre: nombre('De la tutora uno'), lead_id: LEAD_A })).body.data.curso.id;
    await cambiar(ADMIN, DE_TUTORA, { tutor_id: TUTORA.id });
    SIN_TUTORA = (await crear(GESTORA, { nombre: nombre('Sin tutora todavía'), lead_id: LEAD_B })).body.data.curso.id;
  });

  it('una tutora, solo los que tiene asignados', async () => {
    const r = await request.get('/api/cursos-pendientes').set(como(TUTORA));
    const nombres = r.body.data.map((c) => c.nombre);
    expect(nombres).toContain(nombre('De la tutora uno'));
    expect(nombres).not.toContain(nombre('Sin tutora todavía'));
    expect(r.body.data.every((c) => c.tutor_id === TUTORA.id)).toBe(true);
    // La otra tutora no ve ninguno de ellos…
    expect((await request.get('/api/cursos-pendientes').set(como(TUTORA2))).body.data).toEqual([]);
    expect((await ver(TUTORA2, DE_TUTORA)).status).toBe(404);
    // …ni puede pedir los de otra por la URL.
    const forzado = await request.get(`/api/cursos-pendientes?tutorId=${TUTORA.id}`).set(como(TUTORA2));
    expect(forzado.body.data).toEqual([]);
  });

  it('un admin, los de sus campus; los de otro campus, 404', async () => {
    const r = await request.get('/api/cursos-pendientes').set(como(ADMIN));
    expect(r.body.data.every((c) => [P, VACIO].includes(c.project_id))).toBe(true);
    const deOtro = (await q(`SELECT id FROM cursos_pendientes WHERE project_id = $1 LIMIT 1`, [OTRO]))[0].id;
    expect((await ver(ADMIN, deOtro)).status).toBe(404);
    expect((await cambiar(ADMIN, deOtro, { notas: 'x' })).status).toBe(404);
    expect((await request.get(`/api/cursos-pendientes?projectId=${OTRO}`).set(como(ADMIN))).status).toBe(403);
  });

  it('el super admin, todos', async () => {
    const r = await request.get('/api/cursos-pendientes').set(como(SUPER));
    expect(new Set(r.body.data.map((c) => c.project_id)).has(OTRO)).toBe(true);
  });

  it('una gestora, los de sus campus', async () => {
    const r = await request.get('/api/cursos-pendientes').set(como(GESTORA));
    expect(r.body.data.every((c) => c.project_id === P)).toBe(true);
  });

  it('filtros: por estado, por tipo y solo retrasados', async () => {
    const soloSin = await request.get('/api/cursos-pendientes?estado=pendiente_asignar').set(como(ADMIN));
    expect(soloSin.body.data.every((c) => c.estado === 'pendiente_asignar')).toBe(true);
    await q(`UPDATE cursos_pendientes SET fecha_comprometida = ${HOY_SQL} - 5, estado = 'asignado' WHERE id = $1`, [DE_TUTORA]);
    const tarde = await request.get('/api/cursos-pendientes?soloRetrasados=true').set(como(ADMIN));
    expect(tarde.body.data.map((c) => c.id)).toContain(DE_TUTORA);
    expect(tarde.body.data.find((c) => c.id === DE_TUTORA)).toMatchObject({ retrasado: true, dias_para_la_fecha: -5 });
    expect(tarde.body.data.map((c) => c.id)).not.toContain(SIN_TUTORA);
  });
});

// ── Publicar y cerrar ────────────────────────────────────────────────────

describe('«Marcar publicado» y el cierre automático', () => {
  let ID; let A1; let A2;
  const publicar = (u, id, cuerpo) => request.post(`/api/cursos-pendientes/${id}/publicar`).set(como(u)).send(cuerpo);
  const marcar = (u, id, alumna, cuerpo) => request.patch(`/api/cursos-pendientes/${id}/alumnas/${alumna}`).set(como(u)).send(cuerpo);

  beforeAll(async () => {
    ID = (await crear(GESTORA, { nombre: nombre('Curso para publicar'), lead_id: LEAD_A, conversion_id: VENTA_A })).body.data.curso.id;
    await crear(GESTORA, { nombre: nombre('Curso para publicar'), lead_id: LEAD_B });
    await cambiar(ADMIN, ID, { tutor_id: TUTORA.id, fecha_comprometida: manana(5) });
    await cambiar(TUTORA, ID, { estado: 'en_desarrollo' });
    [A1, A2] = (await ver(TUTORA, ID)).body.data.alumnas.map((a) => a.id);
  });

  it('rechaza una URL de otro dominio, una que no es https y una que no es una dirección', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200 })));
    expect((await publicar(TUTORA, ID, { url: 'https://otra-web.example.com/curso/' })).body.code).toBe('URL_OTRO_DOMINIO');
    expect((await publicar(TUTORA, ID, { url: 'https://campus-p.example.org.malo.example.com/' })).body.code).toBe('URL_OTRO_DOMINIO');
    expect((await publicar(TUTORA, ID, { url: 'http://campus-p.example.org/curso/' })).body.code).toBe('URL_INVALIDA');
    expect((await publicar(TUTORA, ID, { url: 'no es una url' })).body.code).toBe('URL_INVALIDA');
    expect(fetch).not.toHaveBeenCalled(); // nunca se pide a un dominio que no es del campus
  });

  it('rechaza una URL del campus que no responde (404 o caída)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 404 })));
    expect((await publicar(TUTORA, ID, { url: 'https://campus-p.example.org/aun-no/' })).body.code).toBe('URL_NO_RESPONDE');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    expect((await publicar(TUTORA, ID, { url: 'https://campus-p.example.org/caida/' })).body.code).toBe('URL_NO_RESPONDE');
  });

  it('solo se habilita a una alumna con el curso publicado', async () => {
    const r = await marcar(TUTORA, ID, A1, { estado: 'habilitada' });
    expect(r.status).toBe(409);
  });

  it('publica con una URL del campus que responde, y enlaza la ficha si es la de una formación', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200 })));
    const r = await publicar(TUTORA, ID, { url: 'https://campus-p.example.org/curso-dos/' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ estado: 'publicado', url_publicada: 'https://campus-p.example.org/curso-dos/', product_id: PRODUCTO2 });
    expect(r.body.data.fecha_publicacion).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
  });

  it('y no se publica dos veces', async () => {
    expect((await publicar(TUTORA, ID, { url: 'https://campus-p.example.org/curso-dos/' })).status).toBe(409);
  });

  it('si la ficha de esa URL ya tiene OTRO pendiente abierto, publica igual pero sin enlazarla (no cabrían dos)', async () => {
    const otro = (await crear(GESTORA, { nombre: nombre('Curso con la ficha ocupada'), lead_id: LEAD_C })).body.data.curso.id;
    await cambiar(ADMIN, otro, { tutor_id: TUTORA.id, fecha_comprometida: manana(4) });
    await cambiar(TUTORA, otro, { estado: 'en_desarrollo' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200 })));
    // PRODUCTO ya es de «Existente (renombrado)», que sigue abierto.
    const r = await publicar(TUTORA, otro, { url: 'https://campus-p.example.org/curso-uno/' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ estado: 'publicado', product_id: null });
  });

  it('cuando TODAS las alumnas están habilitadas, pasa solo a «cerrado»', async () => {
    const una = await marcar(TUTORA, ID, A1, { estado: 'habilitada', avisada: true });
    expect(una.body.data.cerrado).toBe(false);
    expect(una.body.data.curso.estado).toBe('publicado');
    expect(una.body.data.alumnas.find((a) => a.id === A1)).toMatchObject({ estado: 'habilitada', avisada: true, habilitada_por: TUTORA.nombre });
    const dos = await marcar(TUTORA, ID, A2, { estado: 'cancelada' });
    expect(dos.body.data.cerrado).toBe(true);
    expect(dos.body.data.curso.estado).toBe('cerrado');
    const h = (await ver(ADMIN, ID)).body.data.historial.map((x) => x.accion);
    expect(h).toContain('cerrado_solo');
  });

  it('sin alumnas no se cierra solo, y un administrador sí puede publicar sin comprobar', async () => {
    const vacio = (await crear(GESTORA, { nombre: nombre('Curso sin nadie') })).body.data.curso.id;
    await cambiar(ADMIN, vacio, { tutor_id: TUTORA.id, fecha_comprometida: manana(3) });
    await cambiar(TUTORA, vacio, { estado: 'en_desarrollo' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200 })));
    expect((await publicar(TUTORA, vacio, { url: 'https://otra-web.example.com/x', sin_comprobar: true })).status).toBe(403);
    const r = await publicar(ADMIN, vacio, { url: 'https://campus-p.example.org/curso-sin-nadie/', sin_comprobar: true });
    expect(r.body.data.estado).toBe('publicado');
    expect(fetch).not.toHaveBeenCalled();
    expect((await ver(ADMIN, vacio)).body.data.estado).toBe('publicado');
  });

  it('un campus sin dominio conocido: 409 con la explicación', async () => {
    const r = await request.post('/api/cursos-pendientes').set(como(ADMIN)).send({ project_id: VACIO, nombre: nombre('Curso de otro campus') });
    const id = r.body.data.curso.id;
    await cambiar(ADMIN, id, { tutor_id: TUTORA.id, fecha_comprometida: manana(3) });
    await cambiar(ADMIN, id, { estado: 'en_desarrollo' });
    const p = await publicar(ADMIN, id, { url: 'https://cualquiera.example.com/x' });
    expect(p.status).toBe(409);
    expect(p.body.code).toBe('DOMINIO_DESCONOCIDO');
  });
});

// ── Resumen por campus ───────────────────────────────────────────────────

describe('los contadores, por campus', () => {
  it('salen TODOS los campus del admin, incluso el que está a cero', async () => {
    const r = (await request.get('/api/cursos-pendientes/resumen').set(como(ADMIN))).body.data;
    const porId = new Map(r.campus.map((c) => [c.project_id, c]));
    expect([...porId.keys()].sort()).toEqual([P, VACIO].sort());
    expect(porId.get(P).abiertos).toBeGreaterThan(0);
    expect(porId.get(P).alumnas_esperando).toBeGreaterThan(0);
    expect(porId.get(P).retrasados).toBeGreaterThan(0); // el de la sección anterior
    expect(porId.get(VACIO)).toMatchObject({ abiertos: expect.any(Number) });
    expect(r.total.abiertos).toBe(r.campus.reduce((s, c) => s + c.abiertos, 0));
    expect(Array.isArray(r.carga_por_tutora)).toBe(true);
    expect(r.carga_por_tutora.find((t) => t.tutor_id === TUTORA.id)).toMatchObject({ abiertos: expect.any(Number) });
    expect(Array.isArray(r.indicadores)).toBe(true);
  });

  it('un campus sin ningún pendiente sale con 0, no desaparece', async () => {
    const sin = await q(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
      [`${MARCA} d`, `${MARCA.toLowerCase()}-d`, `${MARCA}-key-d`]);
    ids.projects.push(sin[0].id);
    const r = (await request.get('/api/cursos-pendientes/resumen').set(como(SUPER))).body.data;
    expect(r.campus.find((c) => c.project_id === sin[0].id)).toMatchObject({ abiertos: 0, retrasados: 0, alumnas_esperando: 0 });
  });

  it('una tutora recibe solo sus números y sin supervisión; los de otro campus, nada', async () => {
    const r = (await request.get('/api/cursos-pendientes/resumen').set(como(TUTORA))).body.data;
    expect(r.carga_por_tutora).toBeNull();
    expect(r.indicadores).toBeNull();
    const otra = (await request.get('/api/cursos-pendientes/resumen').set(como(TUTORA2))).body.data;
    expect(otra.total.abiertos).toBe(0);
  });

  it('el tiempo medio venta → habilitada se calcula con las alumnas habilitadas', async () => {
    const r = (await request.get('/api/cursos-pendientes/resumen').set(como(ADMIN))).body.data;
    const p = r.indicadores.find((i) => i.project_id === P);
    expect(Number(p.dias_medios_venta_a_habilitada)).toBeGreaterThanOrEqual(0);
  });
});

// ── Avisos por fecha ─────────────────────────────────────────────────────

describe('los avisos por fecha, una sola vez', () => {
  let VENCE; let TARDE; let SIN; let SINHAB;
  beforeAll(async () => {
    const nuevo = async (n, extra = '') => (await crear(GESTORA, { nombre: nombre(n), lead_id: LEAD_C })).body.data.curso.id;
    VENCE = await nuevo('Vence en tres días');
    await cambiar(ADMIN, VENCE, { tutor_id: TUTORA2.id, fecha_comprometida: manana(3) });
    TARDE = await nuevo('Ya vencido');
    await cambiar(ADMIN, TARDE, { tutor_id: TUTORA2.id, fecha_comprometida: manana(2) });
    await q(`UPDATE cursos_pendientes SET fecha_comprometida = ${HOY_SQL} - 4 WHERE id = $1`, [TARDE]);
    SIN = await nuevo('Sin tutora hace tres días');
    await q(`UPDATE cursos_pendientes SET created_at = now() - interval '3 days', fecha_solicitud = ${HOY_SQL} - 3 WHERE id = $1`, [SIN]);
    SINHAB = await nuevo('Publicado sin habilitar');
    await cambiar(ADMIN, SINHAB, { tutor_id: TUTORA2.id, fecha_comprometida: manana(1) });
    await q(`UPDATE cursos_pendientes SET estado = 'publicado', fecha_publicacion = ${HOY_SQL} - 3 WHERE id = $1`, [SINHAB]);
  });

  it('manda cada aviso a quien toca', async () => {
    const r = await avisarVencimientos();
    expect(r.enviados).toBeGreaterThanOrEqual(4);
    expect((await avisos('curso_pendiente_vence', TUTORA2.id)).map((a) => a.title)).toContain(`Faltan 3 días: ${nombre('Vence en tres días')}`);
    // El retrasado, a la tutora Y al admin del campus (y al super admin).
    const tardeTitulo = `Retrasado: ${nombre('Ya vencido')}`;
    for (const u of [TUTORA2, ADMIN, SUPER]) expect((await avisos('curso_pendiente_retrasado', u.id)).map((a) => a.title)).toContain(tardeTitulo);
    expect((await avisos('curso_pendiente_retrasado', ADMIN_OTRO.id)).map((a) => a.title)).not.toContain(tardeTitulo);
    // Sin tutora más de 48 h: solo los admin.
    expect((await avisos('curso_pendiente_sin_tutora', ADMIN.id)).map((a) => a.title)).toContain(`Más de 48 h sin tutora: ${nombre('Sin tutora hace tres días')}`);
    expect((await avisos('curso_pendiente_sin_tutora', TUTORA2.id))).toHaveLength(0);
    // Publicado con alumnas sin habilitar.
    for (const u of [TUTORA2, ADMIN]) {
      expect((await avisos('curso_pendiente_sin_habilitar', u.id)).map((a) => a.title)).toContain(`Publicado y con alumnas sin habilitar: ${nombre('Publicado sin habilitar')}`);
    }
  });

  it('repetir la vuelta no repite ningún aviso', async () => {
    const antes = (await q(`SELECT count(*)::int AS n FROM admin_notifications WHERE type LIKE 'curso_pendiente_%'`))[0].n;
    const r = await avisarVencimientos();
    const despues = (await q(`SELECT count(*)::int AS n FROM admin_notifications WHERE type LIKE 'curso_pendiente_%'`))[0].n;
    expect(despues).toBe(antes);
    expect(r.enviados).toBe(0);
  });

  it('si se mueve la fecha, el nuevo vencimiento vuelve a avisar', async () => {
    await q(`UPDATE cursos_pendientes SET fecha_comprometida = ${HOY_SQL} - 1 WHERE id = $1`, [TARDE]);
    const r = await avisarVencimientos();
    expect(r.enviados).toBe(1);
  });

  it('un curso cerrado o cancelado no avisa', async () => {
    await q(`UPDATE cursos_pendientes SET estado = 'cancelado' WHERE id = ANY($1::int[])`, [[VENCE, TARDE, SIN, SINHAB]]);
    await q(`UPDATE cursos_pendientes SET fecha_comprometida = CURRENT_DATE - 9 WHERE id = ANY($1::int[])`, [[TARDE]]).catch(() => {});
    const r = await avisarVencimientos();
    expect(r.enviados).toBe(0);
  });
});

// ── El resumen de los lunes ──────────────────────────────────────────────

describe('el resumen de la semana, a los super admin', () => {
  const DEL_TIPO = `SELECT title, message, target_user_ids FROM admin_notifications WHERE type = 'curso_pendiente_semana' ORDER BY id DESC`;
  beforeAll(async () => {
    await q(`DELETE FROM admin_notifications WHERE type = 'curso_pendiente_semana'`);
    // Un curso abierto en P, para que haya algo que contar.
    await crear(GESTORA, { nombre: nombre('Curso para el resumen'), lead_id: LEAD_A });
  });
  afterAll(async () => { await q(`DELETE FROM admin_notifications WHERE type = 'curso_pendiente_semana'`); });

  it('manda UN resumen por campus y semana a los super admin, con los números', async () => {
    const r = await resumenDeLaSemana();
    expect(r).toMatchObject({ enviado: true });
    const [aviso] = await q(DEL_TIPO);
    expect(aviso.target_user_ids).toContain(SUPER.id);
    expect(aviso.title).toMatch(/^Cursos pendientes: \d+ abiertos, \d+ retrasados$/);
    expect(aviso.message).toContain(`${MARCA} a: `);
    expect(aviso.message).toMatch(/\d+ alumnas esperando/);
  });

  it('repetir la vuelta (o reiniciar) no lo duplica', async () => {
    const antes = (await q(DEL_TIPO)).length;
    expect(await resumenDeLaSemana()).toMatchObject({ enviado: false, motivo: 'ya enviado esta semana' });
    expect((await q(DEL_TIPO)).length).toBe(antes);
  });

  it('la semana siguiente sí vuelve a mandarlo', async () => {
    const dentroDeOcho = new Date(Date.now() + 8 * 86400000);
    expect(await resumenDeLaSemana({ ahora: dentroDeOcho })).toMatchObject({ enviado: true });
  });
});
