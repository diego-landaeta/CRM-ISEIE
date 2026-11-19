import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import pool, { query } from '../src/shared/config/db.js';

/**
 * Los filtros rápidos, contados sobre TODO y no sobre la página (gemela de la
 * #132 del 360). En ISEIE la base de pruebas no trae usuarios ni campus: la
 * prueba crea su superadmin, su gestora y su campus, y los borra al final.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ SE ESTÁ ARREGLANDO
 *
 * `?qf=tomorrow` se aplicaba en `LeadsPage.tsx` sobre `leads`, que es una página
 * de 20 de `total`. Con 300 prospectos y doce para mañana, salían los que
 * cayeran en la página que estuvieras mirando: dos, o ninguno.
 *
 * Diego lo dijo dos veces en el ticket, y es la condición para poder mandar el
 * correo del resumen:
 *
 *     «Un aviso que dice "7 personas" y abre una lista con 2 es peor que no
 *      mandar nada.»
 *
 * POR QUÉ ESTA PRUEBA SIEMBRA 25 Y NO 3
 *
 * Porque con tres no se puede distinguir el filtro bueno del malo: caben en la
 * primera página y los dos dan el mismo resultado. El fallo SOLO aparece cuando
 * hay más de una página, así que la prueba tiene que cruzar ese límite. 25 con
 * `limit=20` obliga a que el que cuenta sea el servidor.
 *
 * Y contra Postgres de verdad: el filtro son subconsultas correlacionadas sobre
 * `lead_reminders` y `lead_interactions`, y una base simulada diría que sí a
 * cualquier cosa.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const request = supertest(app);
const MARCA = `qf-${Date.now().toString(36)}-`;
// 25 sin tocar + el que ademas esta contactado. Mas de una pagina con
// `limit=20`, que es lo unico que distingue el filtro del servidor del que se
// aplicaba en el navegador.
const PARA_MANANA = 26;
let token;
let proyecto;
// Los prospectos de esta prueba tienen responsable propio, y todo se pregunta
// filtrando por el. Sin eso, otro fichero que cree o borre un lead entre las
// dos peticiones mueve el numero y esta prueba falla por algo que no es suyo —
// paso: «no-contact=43» contra «44».
let gestora;
const EMAIL_GESTORA = `${MARCA}gestora@prueba.local`;
const EMAIL_SUPER = `${MARCA}super@prueba.local`;
let superadmin;
let tokenGestora;
const creados = [];

/**
 * Se siembra en bloque, no fila a fila.
 *
 * La primera version hacia un `INSERT` y un `UPDATE` por cada uno de los 29
 * prospectos, mas los recordatorios: unas sesenta idas y vueltas en el
 * `beforeAll`. En solitario iba; con la suite entera y todos los workers en
 * marcha, el worker de este fichero se caia —«Worker exited unexpectedly»— y
 * sus 14 pruebas no llegaban a correr. Verde por no ejecutarse.
 *
 * Ocho consultas hacen lo mismo.
 */
async function sembrar() {
  await query(
    `INSERT INTO leads (project_id, nombre, email, status, responsable_id, fecha_solicitud, created_at)
     SELECT $1, $2 || 'manana-' || g, $2 || 'manana-' || g || '@prueba.local',
            'por_contactar', $3, NOW(), NOW()
       FROM generate_series(0, 24) g`, [proyecto, MARCA, gestora]);

  await query(
    `INSERT INTO leads (project_id, nombre, email, status, responsable_id, fecha_solicitud, created_at)
     SELECT $1, $2 || n, $2 || n || '@prueba.local', 'por_contactar', $3, NOW(), NOW()
       FROM UNNEST(ARRAY['hoy','atrasado','sin-tocar','ya-contactado','manana-contactado']) n`,
    [proyecto, MARCA, gestora]);

  const recordatorio = (patron, cuando) => query(
    `INSERT INTO lead_reminders (lead_id, fecha_recordatorio, nota, completado, created_by)
     SELECT id, ${cuando}, 'prueba', false, $2 FROM leads WHERE nombre LIKE $1`, [MARCA + patron, superadmin]);

  // Las fechas las pone Postgres. Calculandolas en JavaScript, la prueba
  // compararia la medianoche de mi maquina con la del servidor y fallaria por
  // zona horaria, no por el filtro.
  await recordatorio('manana-%', 'CURRENT_DATE + 1');
  await recordatorio('hoy', 'CURRENT_DATE');
  await recordatorio('atrasado', 'CURRENT_DATE - 3');

  await query(
    `INSERT INTO lead_interactions (lead_id, tipo, nota, fecha, created_by)
     SELECT id, 'llamada', 'prueba', NOW(), $3 FROM leads
      WHERE nombre IN ($1, $2)`,
    [MARCA + 'ya-contactado', MARCA + 'manana-contactado', superadmin]);
}

async function pedir(qs) {
  const res = await request.get(`/api/leads?projectId=${proyecto}&responsableId=${gestora}&${qs}`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body;
}

beforeAll(async () => {
  superadmin = (await query(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ('QF Super', $1, 'x', 'superadmin') RETURNING id`,
    [EMAIL_SUPER])).rows[0].id;
  token = jwt.sign({ userId: superadmin, email: EMAIL_SUPER, role: 'superadmin', roles_extra: [] }, process.env.JWT_SECRET, { expiresIn: '1h' });
  proyecto = (await query(
    `INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA}campus`, `${MARCA}campus`, `${MARCA}clave`])).rows[0].id;
  gestora = (await query(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ('QF Gestora', $1, 'x', 'gestor') RETURNING id`,
    [EMAIL_GESTORA])).rows[0].id;
  await query('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [gestora, proyecto]);
  tokenGestora = jwt.sign({ userId: gestora, email: EMAIL_GESTORA, role: 'gestor', roles_extra: [] }, process.env.JWT_SECRET, { expiresIn: '1h' });
  await sembrar();
});
afterAll(async () => {
  await query(
    `DELETE FROM lead_reminders WHERE lead_id IN (SELECT id FROM leads WHERE nombre LIKE $1)`, [MARCA + '%']);
  await query(
    `DELETE FROM lead_interactions WHERE lead_id IN (SELECT id FROM leads WHERE nombre LIKE $1)`, [MARCA + '%']);
  await query(`DELETE FROM leads WHERE nombre LIKE $1`, [MARCA + '%']);
  await query('DELETE FROM user_projects WHERE user_id = $1', [gestora]);
  await query('DELETE FROM users WHERE id = ANY($1::int[])', [[gestora, superadmin]]);
  await query('DELETE FROM projects WHERE id = $1', [proyecto]);
  await pool.end();
});

describe('el número no depende de la página que estés mirando', () => {
  it('«mañana» encuentra los 25, no los que caben en la primera página', async () => {
    // ESTA es la prueba del ticket. Con el filtro en el navegador, esto
    // devolvia como mucho 20 —y en la practica muchos menos, porque el orden
    // no agrupa los de mañana—.
    const r = await pedir('qf=tomorrow&limit=20');
    expect(r.pagination.total).toBe(PARA_MANANA);
  });

  it('y la segunda página trae los cinco que faltan', async () => {
    const r = await pedir('qf=tomorrow&limit=20&page=2');
    expect(r.data).toHaveLength(PARA_MANANA - 20);
    expect(r.pagination.total).toBe(PARA_MANANA);
  });

  it('todas las filas que devuelve son de mañana de verdad', async () => {
    // Que el total cuadre no basta: podria estar contando bien y filtrando mal.
    const r = await pedir('qf=tomorrow&limit=100');
    const manana = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const nuestras = r.data.filter((l) => String(l.nombre).startsWith(MARCA));
    expect(nuestras.length).toBe(PARA_MANANA);
    for (const l of nuestras) {
      expect(String(l.next_reminder_at).slice(0, 10)).toBe(manana);
    }
  });
});

describe('cada filtro dice lo suyo', () => {
  it('«hoy» no se lleva los de mañana', async () => {
    const r = await pedir('qf=today&limit=100');
    const nuestras = r.data.filter((l) => String(l.nombre).startsWith(MARCA));
    expect(nuestras.map((l) => l.nombre)).toEqual([MARCA + 'hoy']);
  });

  it('«atrasado» no se lleva los de hoy', async () => {
    const r = await pedir('qf=overdue&limit=100');
    const nuestras = r.data.filter((l) => String(l.nombre).startsWith(MARCA));
    expect(nuestras.map((l) => l.nombre)).toEqual([MARCA + 'atrasado']);
  });

  it('«sin recordatorio» no arrastra a los que sí tienen', async () => {
    const r = await pedir('qf=no-reminder&limit=200');
    const nombres = r.data.filter((l) => String(l.nombre).startsWith(MARCA)).map((l) => l.nombre);
    expect(nombres).toContain(MARCA + 'sin-tocar');
    expect(nombres).not.toContain(MARCA + 'hoy');
  });

  it('«sin contactar» excluye al que ya tiene una interaccion', async () => {
    const r = await pedir('qf=no-contact&limit=200');
    const nombres = r.data.filter((l) => String(l.nombre).startsWith(MARCA)).map((l) => l.nombre);
    expect(nombres).toContain(MARCA + 'sin-tocar');
    expect(nombres).not.toContain(MARCA + 'ya-contactado');
  });

  it('«urgente» junta lo vencido y lo que nadie ha tocado', async () => {
    const r = await pedir('qf=urgent&limit=200');
    const nombres = r.data.filter((l) => String(l.nombre).startsWith(MARCA)).map((l) => l.nombre);
    expect(nombres).toContain(MARCA + 'atrasado');
    expect(nombres).toContain(MARCA + 'hoy');
    expect(nombres).toContain(MARCA + 'sin-tocar');
  });

  it('y deja fuera al que tiene fecha futura y ya esta contactado', async () => {
    // Escribi primero que un «manana-*» no debia salir en urgente, y estaba
    // equivocado: no tienen ninguna interaccion, asi que entran por la segunda
    // mitad de la regla —igual que en el frontend—. Lo que de verdad queda
    // fuera es esto: fecha futura Y ya tocado.
    const r = await pedir('qf=urgent&limit=200');
    const nombres = r.data.filter((l) => String(l.nombre).startsWith(MARCA)).map((l) => l.nombre);
    expect(nombres).not.toContain(MARCA + 'manana-contactado');
  });

  it('un filtro inventado se rechaza, no se ignora', async () => {
    // Ignorarlo devolveria la lista entera y quien la mire creera que ese es el
    // resultado del filtro.
    const res = await request.get(`/api/leads?projectId=${proyecto}&qf=loquesea`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});

describe('los contadores y la lista dicen el mismo numero', () => {
  it('«mañana» cuenta lo mismo en las dos partes', async () => {
    // Es el criterio del ticket: «el numero del correo y el numero de la lista
    // tienen que ser el mismo». El correo usara estos contadores.
    const cuentas = await request.get(`/api/leads/quick-counts?projectId=${proyecto}&responsableId=${gestora}`)
      .set('Authorization', `Bearer ${token}`);
    expect(cuentas.status).toBe(200);

    const lista = await pedir('qf=tomorrow&limit=1');
    expect(cuentas.body.data.tomorrow).toBe(lista.pagination.total);
  });

  it('y lo mismo para todos los demas', async () => {
    const cuentas = (await request.get(`/api/leads/quick-counts?projectId=${proyecto}&responsableId=${gestora}`)
      .set('Authorization', `Bearer ${token}`)).body.data;

    for (const [clave, campo] of [
      ['overdue', 'overdue'], ['today', 'today'], ['week', 'week'],
      ['no-reminder', 'no_reminder'], ['no-contact', 'no_contact'], ['urgent', 'urgent'],
    ]) {
      const lista = await pedir(`qf=${clave}&limit=1`);
      expect(`${clave}=${cuentas[campo]}`).toBe(`${clave}=${lista.pagination.total}`);
    }
  });

  it('la ruta existe y no se la come `/:id`', async () => {
    const res = await request.get(`/api/leads/quick-counts?projectId=${proyecto}`)
      .set('Authorization', `Bearer ${token}`);
    // Si la absorbiera el comodin, intentaria buscar el lead «quick-counts» y
    // contestaria 400 de id invalido o 404.
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('tomorrow');
  });

  it('sin sesion no se cuenta nada', async () => {
    expect((await request.get('/api/leads/quick-counts')).status).toBe(401);
  });

  it('una gestora cuenta lo suyo, aunque pida el de otra', async () => {
    const r = await request.get(`/api/leads/quick-counts?projectId=${proyecto}&responsableId=${superadmin}`)
      .set('Authorization', `Bearer ${tokenGestora}`);
    expect(r.status).toBe(200);
    expect(r.body.data.tomorrow).toBe(PARA_MANANA);
  });

  it('un campus ajeno: 403', async () => {
    const otro = (await query(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
      [`${MARCA}otro`, `${MARCA}otro`, `${MARCA}otra-clave`])).rows[0].id;
    try {
      const r = await request.get(`/api/leads/quick-counts?projectId=${otro}`).set('Authorization', `Bearer ${tokenGestora}`);
      expect(r.status).toBe(403);
    } finally {
      await query('DELETE FROM projects WHERE id = $1', [otro]);
    }
  });
});
