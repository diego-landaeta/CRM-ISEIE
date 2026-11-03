import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * El panel de Moodle del CRM (#335), con la base de verdad y Moodle simulado.
 *
 * Lo que se defiende:
 *   · cada campus sale con su estado (conectado o no) y, si lo está, sus cifras;
 *   · cursos, alumnos, estructura y recursos de un curso responden;
 *   · solo super admin y admin, y cada uno SOLO en sus campus (403 en uno ajeno);
 *   · el token y la dirección del Moodle no salen nunca.
 *
 *   npx vitest run tests/moodlePanel.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/moodle/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const credenciales = await import('../src/modules/credentials/credentials.model.js');
const moodleMod = await import('../src/modules/mcp/mcp.moodle.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `MPL${Date.now().toString(36)}`;
const ORIGEN = `https://${MARCA.toLowerCase()}.moodle.test`;
const TOKEN = `tok${MARCA}0123456789abcdef`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [], credenciales: [] };
let CON; let SIN; let OTRO; let REV; let IA; let ADMIN; let ADMIN_OTRO; let GESTORA; let SUPER;

// Los permisos salen de la base, no del token (#423): «solo super admin» se prueba con un super admin de verdad (se borra al acabar).
const comoSuper = () => como(SUPER);
const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const json = (c) => new Response(JSON.stringify(c), { status: 200, headers: { 'content-type': 'application/json' } });
const AHORA = () => Math.floor(Date.now() / 1000);
const ORIGEN_REV = `https://${MARCA.toLowerCase()}.revision.moodle.test`;
const TOKEN_REV = `rev${MARCA}0123456789abcdef`;
const ORIGEN_LIMITADO = `https://${MARCA.toLowerCase()}.limitado.moodle.test`;
const TOKEN_LIMITADO = `lim${MARCA}0123456789abcdef`;

const ALUMNO = [{ shortname: 'student' }];
const FUNCIONES = {
  core_course_get_courses_by_field: () => ({
    courses: [
      { id: 11, fullname: 'Máster en Psicología', displayname: 'Máster en Psicología', shortname: 'MP', categoryid: 5, categoryname: 'Másteres', startdate: AHORA() - 100 * 86400, enddate: 0, visible: 1, enablecompletion: 1, format: 'topics' },
      { id: 12, fullname: 'Curso oculto', displayname: 'Curso oculto', shortname: 'CO', categoryid: 5, categoryname: 'Másteres', startdate: 0, enddate: 0, visible: 0, enablecompletion: 0, format: 'topics' },
    ],
  }),
  core_course_get_categories: () => [{ id: 5, name: 'Másteres', parent: 0, depth: 1, coursecount: 2, visible: 1 }],
  core_enrol_get_enrolled_users: ({ courseid }) => (courseid === 11 ? [{ id: 1, roles: ALUMNO, lastcourseaccess: AHORA() - 86400, lastaccess: AHORA() - 86400 }, { id: 2, roles: ALUMNO, lastcourseaccess: 0, lastaccess: 0 }] : []),
  core_course_get_contents: () => [{ id: 1, section: 0, name: '', visible: 1, modules: [{ id: 5, name: 'Bienvenida', modname: 'forum', visible: 1 }] }],
  mod_url_get_urls_by_courses: () => ({ urls: [] }),
  core_completion_get_course_completion_status: () => ({ exception: 'moodle_exception', errorcode: 'nocriteriaset', message: 'No hay criterios' }),
};

// Un Moodle con 7 cursos activos, uno de cada caso de «Para revisar».
const HACE_1_DIA = () => AHORA() - 86400;
const HACE_90_DIAS = () => AHORA() - 90 * 86400;
const estudiante = (id, ultimo) => ({ id, roles: ALUMNO, lastcourseaccess: ultimo, lastaccess: ultimo });
const CURSOS_REV = [21, 22, 23, 24, 25, 26, 27].map((id) => ({ id, fullname: `Curso ${id}`, displayname: `Curso ${id}`, shortname: `C${id}`, categoryid: 5, categoryname: 'Másteres', startdate: AHORA() - 100 * 86400, enddate: 0, visible: 1, enablecompletion: 0, format: 'topics' }));
const MATRICULADOS_REV = {
  21: [estudiante(1, HACE_1_DIA()), estudiante(2, 0), estudiante(3, 0)], // hay actividad, pero a dos no se les ha visto nunca
  22: [],                                                                // sin alumnos
  23: [estudiante(4, HACE_90_DIAS()), estudiante(5, HACE_90_DIAS())],    // dormido: nadie ha entrado en 30 días
  24: [estudiante(6, HACE_1_DIA()), estudiante(7, HACE_1_DIA())],        // en orden
  26: [estudiante(8, HACE_1_DIA())],
  27: [estudiante(9, HACE_1_DIA())],
};
let lecturasRev = 0;
/** true: el Moodle responde «Database connection failed» a las lecturas de alumnos. */
let sobrecargaRev = false;
const FUNCIONES_REV = {
  core_course_get_courses_by_field: () => ({ courses: CURSOS_REV }),
  core_enrol_get_enrolled_users: async ({ courseid, opciones }) => {
    lecturasRev += 1;
    await new Promise((r) => setTimeout(r, 40));
    if (sobrecargaRev) return { exception: 'dml_connection_exception', errorcode: 'dbconnectionfailed', message: 'Database connection failed' };
    if (courseid === 25) return { exception: 'moodle_exception', errorcode: 'invalidrecord', message: 'curso raro' }; // este curso falla
    return Number(opciones.limitfrom || 0) ? [] : (MATRICULADOS_REV[courseid] ?? []);
  },
};

// El mismo Moodle, pero al servicio del token le faltan dos funciones.
const { core_enrol_get_enrolled_users: _sinAlumnos, core_course_get_contents: _sinContenido, ...FUNCIONES_LIMITADAS } = FUNCIONES;

function parametros(p) {
  const opciones = {};
  for (const [k, v] of p.entries()) {
    const o = k.match(/^options\[(\d+)\]\[name\]$/);
    if (o) opciones[v] = p.get(`options[${o[1]}][value]`);
  }
  return { courseid: p.get('courseid') ? Number(p.get('courseid')) : null, opciones };
}

beforeAll(async () => {
  const proy = async (c) => {
    const [p] = await q(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c}`, `${MARCA}-key-${c}`]);
    ids.projects.push(p.id);
    return p.id;
  };
  CON = await proy('con'); SIN = await proy('sin'); OTRO = await proy('otro'); REV = await proy('rev');
  // Una plataforma de IA no es un campus: no tiene Moodle y no debe salir en la lista.
  IA = await proy('ia');
  await q(`UPDATE projects SET type = 'ia' WHERE id = $1`, [IA]);
  const persona = async (n, role, campus) => {
    const [u] = await q(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
      [`${MARCA} ${n}`, `${n.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]);
    ids.users.push(u.id);
    for (const c of campus) await q(`INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)`, [u.id, c]);
    return u;
  };
  ADMIN = await persona('ADMIN', 'admin', [CON, SIN, REV, IA]);
  ADMIN_OTRO = await persona('ADMINOTRO', 'admin', [OTRO]);
  GESTORA = await persona('GESTORA', 'gestor', [CON]);
  SUPER = await persona('SUPER', 'superadmin', []);
  const cred = await credenciales.upsert({ project_id: CON, service: 'moodle', entorno: 'produccion', value: JSON.stringify({ url: ORIGEN, token: TOKEN }) });
  ids.credenciales.push(cred.id);
  const credRev = await credenciales.upsert({ project_id: REV, service: 'moodle', entorno: 'produccion', value: JSON.stringify({ url: ORIGEN_REV, token: TOKEN_REV }) });
  ids.credenciales.push(credRev.id);
}, 60000);

afterAll(async () => {
  await q(`DELETE FROM api_credentials WHERE id = ANY($1::int[]) OR project_id = ANY($2::int[])`, [ids.credenciales, ids.projects]);
  await q(`DELETE FROM user_projects WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM projects WHERE id = ANY($1::int[])`, [ids.projects]);
  await pool.end();
}, 60000);

beforeEach(() => {
  moodleMod.vaciarCacheMoodle();
  const original = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const mundo = { [ORIGEN]: { token: TOKEN, f: FUNCIONES }, [ORIGEN_LIMITADO]: { token: TOKEN_LIMITADO, f: FUNCIONES_LIMITADAS }, [ORIGEN_REV]: { token: TOKEN_REV, f: FUNCIONES_REV } };
    const m = Object.entries(mundo).find(([o]) => String(url) === `${o}/webservice/rest/server.php`);
    if (!m) return original(url, init);
    const p = new URLSearchParams(init.body);
    if (p.get('wstoken') !== m[1].token) return json({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'x' });
    const f = m[1].f[p.get('wsfunction')];
    return f ? json(await f(parametros(p))) : json({ exception: 'webservice_access_exception', errorcode: 'accessexception', message: 'x' });
  }));
});

describe('el panel de Moodle', () => {
  it('cada campus con su estado: el conectado trae sus cifras y el otro, nada inventado', async () => {
    const r = await request.get('/api/moodle/campus').set(como(ADMIN));
    expect(r.status).toBe(200);
    const por = Object.fromEntries(r.body.data.campus.map((c) => [c.id, c]));
    expect(por[CON]).toMatchObject({ configurado: true, cursos: { total: 2, activos: 1, ocultos: 1 } });
    expect(por[SIN]).toMatchObject({ configurado: false });
    expect(por[SIN].cursos).toBeUndefined();
    // Los conectados, primero.
    const orden = r.body.data.campus.map((c) => c.configurado);
    expect(orden).toEqual([...orden].sort((x, y) => Number(y) - Number(x)));
  });

  it('las plataformas de IA no son campus: no salen en la lista ni se pueden consultar', async () => {
    const r = await request.get('/api/moodle/campus').set(como(ADMIN));
    expect(r.body.data.campus.map((c) => c.id)).not.toContain(IA);
    expect((await request.get(`/api/moodle/campus?proyecto_id=${IA}`).set(como(ADMIN))).status).toBe(403);
  });

  it('con proyecto_id solo ese campus, y uno ajeno es un 403', async () => {
    const uno = await request.get(`/api/moodle/campus?proyecto_id=${CON}`).set(como(ADMIN));
    expect(uno.body.data.campus).toHaveLength(1);
    expect(uno.body.data.campus[0]).toMatchObject({ id: CON, configurado: true, cursos: { activos: 1 } });
    expect((await request.get(`/api/moodle/campus?proyecto_id=${CON}`).set(como(ADMIN_OTRO))).status).toBe(403);
  });

  it('los cursos de un campus, con su número de alumnos', async () => {
    const r = await request.get(`/api/moodle/cursos?proyecto_id=${CON}&estado=todos`).set(como(ADMIN));
    expect(r.status).toBe(200);
    expect(r.body.data.total).toBe(2);
    expect(r.body.data.cursos.find((c) => c.curso_id === 11)).toMatchObject({ nombre: 'Máster en Psicología', alumnos: 2, visible: true, estado: 'activo' });
  });

  it('las categorías, para filtrar', async () => {
    const r = await request.get(`/api/moodle/categorias?proyecto_id=${CON}`).set(como(ADMIN));
    expect(r.body.data.categorias).toEqual([expect.objectContaining({ id: 5, nombre: 'Másteres', cursos: 2 })]);
  });

  it('un curso: alumnos (con el motivo de que no haya «terminados»), estructura y recursos', async () => {
    const a = await request.get(`/api/moodle/cursos/11/alumnos?proyecto_id=${CON}`).set(como(ADMIN));
    expect(a.body.data).toMatchObject({ matriculados: 2, nunca_han_entrado: 1, terminados: null, criterios_de_finalizacion: false });
    const e = await request.get(`/api/moodle/cursos/11/estructura?proyecto_id=${CON}`).set(como(ADMIN));
    expect(e.body.data).toMatchObject({ total_secciones: 1, total_actividades: 1 });
    const r = await request.get(`/api/moodle/cursos/11/recursos?proyecto_id=${CON}`).set(como(ADMIN));
    expect(r.body.data.total_recursos_externos).toBe(0);
  });

  it('un campus sin Moodle da un error claro, no un cero', async () => {
    const r = await request.get(`/api/moodle/cursos?proyecto_id=${SIN}`).set(como(ADMIN));
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(r.body)).toMatch(/sin Moodle configurado|no se pudo consultar/i);
  });
});

describe('quién puede', () => {
  it('un admin de otro campus: 403 en el Moodle ajeno', async () => {
    for (const ruta of ['/api/moodle/cursos', '/api/moodle/categorias', '/api/moodle/cursos/11/alumnos', '/api/moodle/cursos/11/estructura', '/api/moodle/cursos/11/recursos']) {
      const r = await request.get(`${ruta}?proyecto_id=${CON}`).set(como(ADMIN_OTRO));
      expect(r.status, ruta).toBe(403);
    }
  });

  it('una gestora no entra al panel, ni a su propio campus', async () => {
    expect((await request.get('/api/moodle/campus').set(como(GESTORA))).status).toBe(403);
    expect((await request.get(`/api/moodle/cursos?proyecto_id=${CON}`).set(como(GESTORA))).status).toBe(403);
  });

  it('sin sesión, 401', async () => {
    expect((await request.get('/api/moodle/campus')).status).toBe(401);
  });

  it('ni el token ni la dirección del Moodle salen en ninguna respuesta', async () => {
    const todo = [];
    for (const ruta of ['/api/moodle/campus', `/api/moodle/cursos?proyecto_id=${CON}&estado=todos`, `/api/moodle/categorias?proyecto_id=${CON}`, `/api/moodle/cursos/11/alumnos?proyecto_id=${CON}`, `/api/moodle/cursos/11/estructura?proyecto_id=${CON}`, `/api/moodle/cursos/11/recursos?proyecto_id=${CON}`]) {
      todo.push(JSON.stringify((await request.get(ruta).set(como(ADMIN))).body));
    }
    const texto = todo.join('\n');
    expect(texto).not.toContain(TOKEN);
    expect(texto).not.toContain(ORIGEN);
  });
});

describe('conectar el Moodle de un campus', () => {
  const conectar = (u, id, cuerpo) => request.post(`/api/moodle/campus/${id}/conexion`).set(u).send(cuerpo);
  const estaConectado = async (id) => (await request.get(`/api/moodle/campus?proyecto_id=${id}`).set(como(ADMIN))).body.data.campus[0].configurado;

  it('solo super admin: un admin, ni en su campus', async () => {
    const r = await conectar(como(ADMIN), SIN, { url: ORIGEN, token: TOKEN });
    expect(r.status).toBe(403);
    expect(await estaConectado(SIN)).toBe(false);
  });

  it('un token que vale: se prueba, se guarda cifrado y dice cuántos cursos hay', async () => {
    const r = await conectar(comoSuper(), SIN, { url: `${ORIGEN}/`, token: TOKEN });
    expect(r.status).toBe(201);
    expect(r.body.data).toEqual({ cursos: 2, faltan: [] });
    expect(await estaConectado(SIN)).toBe(true);
    const [fila] = await q(`SELECT encrypted_value, metadata FROM api_credentials WHERE project_id = $1 AND service = 'moodle' AND active`, [SIN]);
    expect(fila.encrypted_value).not.toContain(TOKEN);
    expect(JSON.stringify(fila.metadata)).not.toContain(TOKEN);
  });

  it('un token que no vale: error claro y NO se toca lo que había', async () => {
    const r = await conectar(comoSuper(), CON, { url: ORIGEN, token: 'token-que-no-existe-0000' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('MOODLE_NO_CONECTA');
    expect(r.body.error).toMatch(/token no válido o caducado/);
    expect(JSON.stringify(r.body)).not.toContain('token-que-no-existe');
    // El campus seguía conectado con su token bueno.
    const c = await request.get(`/api/moodle/campus?proyecto_id=${CON}`).set(como(ADMIN));
    expect(c.body.data.campus[0]).toMatchObject({ configurado: true, cursos: { total: 2 } });
  });

  it('un Moodle que no responde: error claro', async () => {
    const r = await conectar(comoSuper(), SIN, { url: `https://${MARCA.toLowerCase()}.apagado.moodle.test`, token: TOKEN });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('MOODLE_NO_CONECTA');
  });

  it('un token al que le faltan funciones: se guarda y dice qué se pierde con cada una', async () => {
    const r = await conectar(comoSuper(), SIN, { url: ORIGEN_LIMITADO, token: TOKEN_LIMITADO });
    expect(r.status).toBe(201);
    expect(r.body.data.cursos).toBe(2);
    expect(r.body.data.faltan).toEqual([
      { funcion: 'core_enrol_get_enrolled_users', consecuencia: 'no se contarán los alumnos' },
      { funcion: 'core_course_get_contents', consecuencia: 'no se verá el contenido de los cursos ni sus recursos externos' },
    ]);
    expect(await estaConectado(SIN)).toBe(true);
  });

  it('cambiar solo el token: no se pide la dirección, se reutiliza la guardada', async () => {
    // SIN está conectado al Moodle «limitado»: su token solo vale allí, así que si pasa la
    // prueba es porque se usó la dirección que ya había.
    const r = await conectar(comoSuper(), SIN, { token: TOKEN_LIMITADO });
    expect(r.status).toBe(201);
    expect(r.body.data.cursos).toBe(2);
    expect((await conectar(comoSuper(), SIN, { token: TOKEN })).status).toBe(400); // ese token no es de ese Moodle
  });

  it('una dirección que no vale, o sin token, es un 400', async () => {
    for (const cuerpo of [{ url: 'ftp://moodle.test', token: TOKEN }, { url: 'https://usuario:clave@moodle.test', token: TOKEN }, { url: ORIGEN, token: '' }]) {
      expect((await conectar(comoSuper(), SIN, cuerpo)).status).toBe(400);
    }
  });

  it('un admin no conecta, ni siquiera un campus suyo: 403', async () => {
    expect((await conectar(como(ADMIN), CON, { url: ORIGEN, token: TOKEN })).status).toBe(403);
  });

  it('ni el token ni la dirección salen en ninguna respuesta', async () => {
    const r = await conectar(comoSuper(), SIN, { url: ORIGEN, token: TOKEN });
    const texto = JSON.stringify(r.body);
    expect(texto).not.toContain(TOKEN);
    expect(texto).not.toContain(ORIGEN);
  });

  it('el panel lista las funciones que ha de tener el servicio del token', async () => {
    const r = await request.get('/api/moodle/campus').set(como(ADMIN));
    expect(r.body.data.funciones).toEqual(expect.arrayContaining(['core_course_get_courses_by_field', 'core_enrol_get_enrolled_users']));
  });

  it('desconectar: solo super admin, y el campus vuelve a «sin conectar»', async () => {
    expect((await request.delete(`/api/moodle/campus/${SIN}/conexion`).set(como(ADMIN))).status).toBe(403);
    const r = await request.delete(`/api/moodle/campus/${SIN}/conexion`).set(comoSuper());
    expect(r.status).toBe(200);
    expect(r.body.data.desconectados).toBeGreaterThanOrEqual(1);
    expect(await estaConectado(SIN)).toBe(false);
  });

  it('sin Moodle conectado y sin dirección, se pide la dirección', async () => {
    const r = await conectar(comoSuper(), SIN, { token: TOKEN });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/dirección/);
  });
});

describe('«Para revisar»: los cursos activos que conviene mirar', () => {
  const revisar = (u, id, q = '') => request.get(`/api/moodle/campus/${id}/revision${q}`).set(u);
  beforeEach(() => { lecturasRev = 0; sobrecargaRev = false; delete process.env.MCP_MOODLE_REVISION_MS; delete process.env.MCP_MOODLE_REVISION_ESPERA_MS; });

  it('cada curso cae en UN caso: sin alumnos, dormido, o con alumnos que nunca han entrado', async () => {
    const r = await revisar(como(ADMIN), REV);
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d).toMatchObject({ total: 7, revisados: 6, no_leidos: 1, pendientes: 0 });
    expect(d.hallazgos.sin_alumnos.map((c) => c.curso_id)).toEqual([22]);
    expect(d.hallazgos.dormidos.map((c) => [c.curso_id, c.alumnos])).toEqual([[23, 2]]);
    expect(d.hallazgos.con_nunca_entraron.map((c) => [c.curso_id, c.alumnos, c.nunca_han_entrado])).toEqual([[21, 3, 2]]);
    // El curso en orden (24) y los de un alumno activo (26, 27) no salen en ninguna lista.
    const todos = Object.values(d.hallazgos).flat().map((c) => c.curso_id);
    expect(todos).not.toEqual(expect.arrayContaining([24]));
  });

  it('un curso que falla se cuenta aparte: ni bloquea la revisión ni se disfraza de «sin alumnos»', async () => {
    const d = (await revisar(como(ADMIN), REV)).body.data;
    expect(d.no_leidos).toBe(1);
    expect(d.hallazgos.sin_alumnos.map((c) => c.curso_id)).not.toContain(25);
  });

  it('por tandas: con poco tiempo devuelve lo que lleve, y lo ya leído no se vuelve a leer', async () => {
    process.env.MCP_MOODLE_REVISION_MS = '1';
    const primera = (await revisar(como(ADMIN), REV)).body.data;
    expect(primera.pendientes).toBeGreaterThan(0);
    expect(primera.revisados).toBeLessThan(6);
    const leidasAntes = lecturasRev;
    delete process.env.MCP_MOODLE_REVISION_MS;
    const segunda = (await revisar(como(ADMIN), REV)).body.data;
    expect(segunda).toMatchObject({ pendientes: 0, revisados: 6, no_leidos: 1 });
    // La segunda solo leyó los cursos que faltaban.
    expect(lecturasRev - leidasAntes).toBe(7 - primera.revisados - primera.no_leidos);
  });

  it('si Moodle dice que va justo de carga, la revisión PARA y espera: no insiste, no lo da por fallo del curso', async () => {
    process.env.MCP_MOODLE_REVISION_ESPERA_MS = '300';
    sobrecargaRev = true;
    const primera = (await revisar(como(ADMIN), REV)).body.data;
    expect(primera.saturado).toBe(true);
    expect(primera.espera_s).toBeGreaterThan(0);
    expect(primera.no_leidos).toBe(0); // los que fallaron por carga no se dan por «no leídos»
    expect(primera.pendientes).toBeGreaterThan(0);
    // Mientras dura la espera no se le pide NADA más a ese Moodle.
    const antes = lecturasRev;
    const seguida = (await revisar(como(ADMIN), REV)).body.data;
    expect(lecturasRev).toBe(antes);
    expect(seguida.saturado).toBe(true);
    // Pasada la espera y recuperado el Moodle, se acaba la revisión.
    sobrecargaRev = false;
    await new Promise((r) => setTimeout(r, 400));
    const final = (await revisar(como(ADMIN), REV)).body.data;
    expect(final).toMatchObject({ saturado: false, pendientes: 0, revisados: 6, no_leidos: 1 });
  });

  it('lee pocos cursos a la vez, no todos de golpe', async () => {
    let maximo = 0; let ahora = 0;
    const original = FUNCIONES_REV.core_enrol_get_enrolled_users;
    FUNCIONES_REV.core_enrol_get_enrolled_users = async (...a) => { ahora += 1; maximo = Math.max(maximo, ahora); try { return await original(...a); } finally { ahora -= 1; } };
    try {
      await revisar(como(ADMIN), REV);
      expect(maximo).toBeLessThanOrEqual(2);
    } finally { FUNCIONES_REV.core_enrol_get_enrolled_users = original; }
  });

  it('con la caché caliente no vuelve a preguntar a Moodle; con refrescar, sí', async () => {
    await revisar(como(ADMIN), REV);
    const antes = lecturasRev;
    await revisar(como(ADMIN), REV);
    expect(lecturasRev).toBe(antes);
    await revisar(como(ADMIN), REV, '?refrescar=1');
    expect(lecturasRev).toBeGreaterThan(antes);
  });

  it('un campus sin Moodle: error claro; uno ajeno: 403; una gestora, fuera', async () => {
    expect((await revisar(como(ADMIN), SIN)).status).toBe(409);
    expect((await revisar(como(ADMIN_OTRO), REV)).status).toBe(403);
    expect((await revisar(como(GESTORA), REV)).status).toBe(403);
  });

  it('solo recuentos: ni un nombre de persona ni el token ni la dirección', async () => {
    const texto = JSON.stringify((await revisar(como(ADMIN), REV)).body);
    expect(texto).not.toContain(TOKEN_REV);
    expect(texto).not.toContain(ORIGEN_REV);
    expect(texto).not.toMatch(/email|fullname|@/);
  });
});
