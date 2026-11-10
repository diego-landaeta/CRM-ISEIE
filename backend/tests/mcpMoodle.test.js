import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * MCP de Claude: el Moodle de cada campus (#335).
 *
 * NO HAY UN MOODLE REAL DETRAS DE ESTAS PRUEBAS. Ni URL ni token. `fetch` esta
 * simulado y contesta con el formato documentado de los servicios web de Moodle
 * (`/webservice/rest/server.php`), incluido lo que mas engaña: cuando Moodle
 * falla, contesta HTTP 200 con `{exception, errorcode, message}`.
 *
 * Lo que se vigila, por orden de gravedad:
 *   1. El token no sale nunca (ni en un resultado, ni en un error, ni en la URL).
 *   2. Solo se llama a funciones de LECTURA de una lista cerrada.
 *   3. Un campus que no se pudo mirar se DICE; jamas un cero.
 *   4. Los enlaces de fuera no se usan para tocar la red interna.
 *   5. Mismos permisos que el resto del MCP.
 */

const hoisted = vi.hoisted(() => ({ consultas: [], guardadas: new Map(), dns: new Map() }));
const { consultas, guardadas } = hoisted;

vi.mock('../src/shared/config/db.js', () => ({
  query: vi.fn(async (sql, params) => {
    hoisted.consultas.push({ sql, params });
    if (/FROM api_credentials/.test(sql)) {
      const ids = params[1];
      return { rows: [...hoisted.guardadas.values()].filter((r) => ids.includes(r.project_id)) };
    }
    return { rows: [], rowCount: 0 };
  }),
  getClient: vi.fn(),
  default: {},
}));

// La resolucion de nombres, simulada: nada de red de verdad.
vi.mock('node:dns/promises', () => {
  const lookup = vi.fn(async (host) => {
    if (hoisted.dns.has(host)) {
      const v = hoisted.dns.get(host);
      if (v instanceof Error) throw v;
      return v.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
    }
    return [{ address: '93.184.216.34', family: 4 }];
  });
  return { lookup, default: { lookup } };
});

const { encrypt } = await import('../src/shared/utils/crypto.js');
const { construirAmbito } = await import('../src/modules/mcp/mcp.acceso.js');
const { HERRAMIENTAS } = await import('../src/modules/mcp/mcp.tools.js');
const moodleMod = await import('../src/modules/mcp/mcp.moodle.js');
const cliente = await import('../src/modules/mcp/mcp.moodle.cliente.js');
const enlaces = await import('../src/modules/mcp/mcp.moodle.enlaces.js');
const { protegerDatos } = await import('../src/modules/mcp/mcp.privacidad.js');
const { upsertCredentialSchema } = await import('../src/modules/credentials/credentials.validation.js');

// ─── El mundo simulado ────────────────────────────────────────────────────

const PROYECTOS = [
  { id: 10, nombre: 'ISEIE', sociedad_id: 1, sociedad_nombre: 'CEDIA' },
  { id: 20, nombre: 'FONO', sociedad_id: 1, sociedad_nombre: 'CEDIA' },
  { id: 30, nombre: 'PSIKO', sociedad_id: 2, sociedad_nombre: 'Otra' },
];
const persona = (role) => ({ id: 7, nombre: 'Ana', role, active: true, usa_mcp: true });
const ambitoDe = (role, proyectos = PROYECTOS) => construirAmbito(persona(role), proyectos);
const T = (nombre) => HERRAMIENTAS.find((h) => h.nombre === nombre);

const ISEIE = { origen: 'https://campus.iseie.test', token: 'iseietoken0123456789abcdef' };
const FONO = { origen: 'https://campus.fono.test/moodle', token: 'fonotoken0123456789abcdef' };
const PSIKO = { origen: 'https://campus.psiko.test', token: 'psikotoken0123456789abcdef' };

/** Guarda la credencial `moodle` de un campus, cifrada de verdad. */
function configurar(projectId, { origen, token }, valor = null) {
  const { encrypted, iv, authTag } = encrypt(valor ?? JSON.stringify({ url: origen, token }));
  guardadas.set(projectId, { project_id: projectId, encrypted_value: encrypted, iv, auth_tag: authTag });
}

const moodles = new Map();
const llamadas = [];
let externo;

const json = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });
const AHORA = () => Math.floor(Date.now() / 1000);
const DIA = 86400;

/** Los parametros de una llamada a Moodle, desanidados. */
function parametros(p) {
  const opciones = {};
  const courseids = [];
  for (const [k, v] of p.entries()) {
    const o = k.match(/^options\[(\d+)\]\[name\]$/);
    if (o) opciones[v] = p.get(`options[${o[1]}][value]`);
    if (/^courseids\[\d+\]$/.test(k)) courseids.push(Number(v));
  }
  return { courseid: p.get('courseid') ? Number(p.get('courseid')) : null, courseids, opciones };
}

/** Registra un Moodle simulado. `funciones` = {nombreFuncion: (params) => cuerpo}. */
function moodle({ origen, token }, funciones, extra = {}) {
  moodles.set(origen, { token, funciones, ...extra });
}

beforeEach(() => {
  consultas.length = 0;
  guardadas.clear();
  moodles.clear();
  llamadas.length = 0;
  hoisted.dns.clear();
  moodleMod.vaciarCacheMoodle();
  externo = async () => new Response('', { status: 200 });
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const u = String(url);
    llamadas.push({ url: u, init });
    const m = [...moodles.entries()].find(([o]) => u === `${o}/webservice/rest/server.php`);
    if (!m) return externo(u, init);
    const [, def] = m;
    if (def.caido) throw new TypeError(`fetch failed: ${u}?wstoken=${def.token}`);
    if (def.colgado) {
      return new Promise((_, rechazar) => init.signal.addEventListener('abort', () => rechazar(init.signal.reason)));
    }
    if (def.http) return new Response('Bad gateway', { status: def.http });
    if (def.html) return new Response('<html>Mantenimiento</html>', { status: 200 });
    const p = new URLSearchParams(init.body);
    if (p.get('wstoken') !== def.token) {
      return json({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Invalid token - token not found' });
    }
    const f = def.funciones[p.get('wsfunction')];
    if (!f) {
      return json({ exception: 'webservice_access_exception', errorcode: 'accessexception', message: 'Access control exception' });
    }
    const r = await f(parametros(p), p);
    return r instanceof Response ? r : json(r);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const k of Object.keys(process.env)) if (k.startsWith('MCP_MOODLE_')) delete process.env[k];
});

const deMoodle = () => llamadas.filter((l) => l.url.endsWith('/webservice/rest/server.php'));
const funcionesLlamadas = () => deMoodle().map((l) => new URLSearchParams(l.init.body).get('wsfunction'));
const externas = () => llamadas.filter((l) => !l.url.endsWith('/webservice/rest/server.php'));

// Cursos de ejemplo, en el formato de core_course_get_courses_by_field.
const curso = (id, fullname, extra = {}) => ({
  id, fullname, displayname: fullname, shortname: `C${id}`, categoryid: 5, categoryname: 'Másteres',
  summary: '<p>mucho texto</p>', summaryformat: 1, format: 'topics', startdate: AHORA() - 100 * DIA, enddate: 0,
  visible: 1, enablecompletion: 1, ...extra,
});
const CURSOS = [
  { id: 1, fullname: 'Portada del sitio', shortname: 'Sitio', format: 'site', visible: 1 },
  curso(11, 'Máster en Psicología Clínica'),
  curso(12, 'Curso de Mindfulness', { categoryid: 6, categoryname: 'Cursos', enddate: AHORA() - 10 * DIA, enablecompletion: 0 }),
  curso(13, 'Experto en Duelo', { startdate: AHORA() + 30 * DIA }),
  curso(14, 'Curso en preparación', { visible: 0 }),
];
const listaCursos = (cursos = CURSOS) => () => ({ courses: cursos, warnings: [] });

/** Un Moodle sencillo que solo sabe dar su lista de cursos. */
function moodleConCursos(campus, cursos = CURSOS) {
  moodle(campus, { core_course_get_courses_by_field: listaCursos(cursos) });
}

// ─── 1. Solo lectura: lista blanca ────────────────────────────────────────

describe('solo lectura: una lista cerrada de funciones de Moodle', () => {
  it('son las cinco de la issue mas la de finalizacion, y todas son «get»', () => {
    expect([...cliente.FUNCIONES_MOODLE].sort()).toEqual([
      'core_completion_get_course_completion_status',
      'core_course_get_categories',
      'core_course_get_contents',
      'core_course_get_courses_by_field',
      'core_enrol_get_enrolled_users',
      'mod_url_get_urls_by_courses',
    ]);
    for (const f of cliente.FUNCIONES_MOODLE) expect(f).toMatch(/_get_/);
    expect(Object.isFrozen(cliente.FUNCIONES_MOODLE)).toBe(true);
  });

  it('cualquier otra funcion se niega SIN llegar a la red', async () => {
    const cred = { url: ISEIE.origen, token: ISEIE.token };
    for (const f of ['core_user_update_users', 'core_enrol_enrol_users', 'core_course_delete_courses',
      'core_webservice_get_site_info', 'core_course_create_courses', 'mod_url_get_urls', '']) {
      await expect(cliente.llamarMoodle(cred, f, {})).rejects.toThrow(/no permitida/);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('en TODAS las herramientas, cada llamada a Moodle es un POST a server.php con una funcion de la lista', async () => {
    configurar(10, ISEIE);
    moodle(ISEIE, {
      core_course_get_courses_by_field: listaCursos(),
      core_course_get_categories: () => [],
      core_enrol_get_enrolled_users: () => [],
      core_course_get_contents: () => [],
      mod_url_get_urls_by_courses: () => ({ urls: [] }),
    });
    const a = ambitoDe('admin', [PROYECTOS[0]]);
    await T('moodle_cursos').ejecutar(a, {});
    await T('moodle_estructura').ejecutar(a, {});
    await T('moodle_alumnos').ejecutar(a, { texto: 'máster' });
    await T('moodle_recursos_externos').ejecutar(a, { texto: 'máster' });
    expect(deMoodle().length).toBeGreaterThan(4);
    for (const l of deMoodle()) {
      expect(l.init.method).toBe('POST');
      expect(cliente.FUNCIONES_MOODLE).toContain(new URLSearchParams(l.init.body).get('wsfunction'));
    }
  });

  it('y en la base solo se lee (la unica escritura es el sello de «ultimo uso» de la credencial)', async () => {
    configurar(10, ISEIE);
    moodleConCursos(ISEIE);
    await T('moodle_cursos').ejecutar(ambitoDe('admin', [PROYECTOS[0]]), {});
    for (const { sql } of consultas) {
      if (/^\s*UPDATE api_credentials/i.test(sql)) continue;
      expect(sql.trim()).toMatch(/^SELECT\b/i);
    }
    const lectura = consultas.find((c) => /FROM api_credentials/.test(c.sql));
    expect(lectura.sql).toMatch(/project_id = ANY\(\$2::int\[\]\)/);
    expect(lectura.sql).toMatch(/'produccion'/);
    expect(lectura.params).toEqual(['moodle', [10]]);
  });

  it('ningun nombre de herramienta nuevo suena a escribir', () => {
    for (const n of ['moodle_cursos', 'moodle_alumnos', 'moodle_recursos_externos', 'moodle_estructura']) {
      expect(T(n)).toBeTruthy();
      expect(n).not.toMatch(/crear|editar|cambiar|borrar|eliminar|actualizar|enviar|marcar/);
    }
  });
});

// ─── 2. El token no sale ──────────────────────────────────────────────────

describe('el token de Moodle es un secreto', () => {
  it('va en el cuerpo del POST, nunca en la URL', async () => {
    configurar(10, ISEIE);
    moodleConCursos(ISEIE);
    await T('moodle_cursos').ejecutar(ambitoDe('admin', [PROYECTOS[0]]), {});
    const l = deMoodle()[0];
    expect(l.url).toBe(`${ISEIE.origen}/webservice/rest/server.php`);
    expect(l.url).not.toContain(ISEIE.token);
    expect(l.init.redirect).toBe('manual'); // un 307 no reenvia el token a otro host
    const p = new URLSearchParams(l.init.body);
    expect(p.get('wstoken')).toBe(ISEIE.token);
    expect(p.get('moodlewsrestformat')).toBe('json');
  });

  it('no sale en el resultado de una consulta buena', async () => {
    configurar(10, ISEIE);
    moodleConCursos(ISEIE);
    const r = await T('moodle_cursos').ejecutar(ambitoDe('admin', [PROYECTOS[0]]), { estado: 'todos' });
    expect(JSON.stringify(r)).not.toContain(ISEIE.token);
    expect(JSON.stringify(r)).not.toContain('wstoken');
  });

  it('no sale cuando la red falla aunque el error de Node lleve la URL con el token', async () => {
    configurar(10, ISEIE);
    configurar(20, FONO);
    moodleConCursos(ISEIE);
    moodle(FONO, {}, { caido: true }); // su error de fetch contiene «?wstoken=…»
    const r = await T('moodle_cursos').ejecutar(ambitoDe('admin', PROYECTOS.slice(0, 2)), {});
    const texto = JSON.stringify(r);
    expect(r.campus_con_error).toHaveLength(1);
    expect(texto).not.toContain(FONO.token);
    expect(texto).not.toContain('campus.fono.test');
    expect(texto).not.toContain('wstoken');
  });

  it('no sale cuando Moodle devuelve un error que lo repite en su mensaje', async () => {
    configurar(10, ISEIE);
    moodle(ISEIE, {
      core_course_get_courses_by_field: () => ({
        exception: 'moodle_exception', errorcode: 'cosarara',
        message: `Fallo con wstoken=${ISEIE.token} y token=${ISEIE.token}`,
      }),
    });
    const error = await T('moodle_cursos').ejecutar(ambitoDe('admin', [PROYECTOS[0]]), {}).catch((e) => e);
    expect(error.code).toBe('MOODLE_NO_DISPONIBLE');
    expect(error.message).toMatch(/cosarara/);
    expect(error.message).not.toContain(ISEIE.token);
    expect(error.message).toContain('[token]');
  });

  it('limpiarSecretos tapa el token suelto y el de una URL', () => {
    const t = 'abcdef0123456789';
    expect(cliente.limpiarSecretos(`error en ${t}`, t)).toBe('error en [token]');
    expect(cliente.limpiarSecretos('GET /x?wstoken=zzz999&a=1')).toBe('GET /x?wstoken=[token]&a=1');
  });

  it('una credencial mal escrita se dice SIN repetir su contenido', async () => {
    configurar(10, ISEIE, `esto no es json pero lleva ${ISEIE.token}`);
    configurar(20, FONO, JSON.stringify({ url: 'ftp://campus.fono.test', token: FONO.token }));
    configurar(30, PSIKO, JSON.stringify({ url: 'https://usuario:clave@campus.psiko.test', token: PSIKO.token }));
    const error = await T('moodle_cursos').ejecutar(ambitoDe('admin'), {}).catch((e) => e);
    expect(error.code).toBe('MOODLE_NO_DISPONIBLE');
    expect(error.message).toMatch(/ISEIE: la credencial de Moodle no es un JSON/);
    expect(error.message).toMatch(/FONO: la URL de Moodle/);
    expect(error.message).toMatch(/PSIKO: la URL de Moodle/);
    for (const t of [ISEIE.token, FONO.token, PSIKO.token, 'clave']) expect(error.message).not.toContain(t);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('una credencial que no se puede descifrar no destapa nada', async () => {
    guardadas.set(10, { project_id: 10, encrypted_value: 'zz', iv: 'zz', auth_tag: 'zz' });
    const error = await T('moodle_cursos').ejecutar(ambitoDe('admin', [PROYECTOS[0]]), {}).catch((e) => e);
    expect(error.message).toMatch(/ISEIE: no se pudo leer la credencial/);
  });

  it('el servicio «moodle» se puede guardar en el panel de claves', () => {
    const ok = upsertCredentialSchema.safeParse({
      project_id: 10, service: 'moodle', value: JSON.stringify({ url: ISEIE.origen, token: ISEIE.token }),
    });
    expect(ok.success).toBe(true);
  });
});

// ─── 3. Un campus que no se puede mirar se dice, no es un cero ────────────

describe('campus sin Moodle, con token malo o que no responde', () => {
  it('sin credencial: «ISEIE: sin Moodle configurado», un error, no una lista vacia', async () => {
    const error = await T('moodle_cursos').ejecutar(ambitoDe('admin', [PROYECTOS[0]]), {}).catch((e) => e);
    expect(error.code).toBe('MOODLE_NO_DISPONIBLE');
    expect(error.message).toContain('ISEIE: sin Moodle configurado');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('token no valido: Moodle contesta 200 con la excepcion y se trata como fallo', async () => {
    configurar(20, { origen: FONO.origen, token: 'tokenviejo0123456789abcdef' });
    moodle(FONO, { core_course_get_courses_by_field: listaCursos() }); // el token bueno es otro
    const error = await T('moodle_cursos').ejecutar(ambitoDe('admin', [PROYECTOS[1]]), {}).catch((e) => e);
    expect(error.code).toBe('MOODLE_NO_DISPONIBLE');
    expect(error.message).toContain('FONO: token no válido');
    expect(deMoodle()).toHaveLength(1);
  });

  it('sin respuesta: red caida, tiempo agotado, HTTP 5xx y pagina HTML son errores distintos', async () => {
    configurar(10, ISEIE);
    const a = ambitoDe('admin', [PROYECTOS[0]]);
    const pedir = () => T('moodle_cursos').ejecutar(a, {}).catch((e) => e.message);

    moodle(ISEIE, {}, { caido: true });
    expect(await pedir()).toContain('ISEIE: Moodle no responde');

    moodle(ISEIE, {}, { http: 502 });
    expect(await pedir()).toContain('ISEIE: Moodle contestó HTTP 502');

    moodle(ISEIE, {}, { html: true });
    expect(await pedir()).toMatch(/ISEIE: Moodle no contestó JSON/);

    process.env.MCP_MOODLE_TIMEOUT_MS = '30';
    moodle(ISEIE, {}, { colgado: true });
    expect(await pedir()).toContain('ISEIE: Moodle no ha contestado a tiempo');
  });

  it('una redireccion no se sigue (llevaria el token a otro sitio)', async () => {
    configurar(10, ISEIE);
    moodle(ISEIE, { core_course_get_courses_by_field: () => new Response('', { status: 307, headers: { location: 'https://otro.test/' } }) });
    const error = await T('moodle_cursos').ejecutar(ambitoDe('admin', [PROYECTOS[0]]), {}).catch((e) => e);
    expect(error.message).toMatch(/ISEIE: Moodle redirige/);
    expect(deMoodle()).toHaveLength(1);
  });

  it('servicios web apagados, sin permiso en la funcion y respuesta rara: cada uno con su mensaje', async () => {
    configurar(10, ISEIE);
    const a = ambitoDe('admin', [PROYECTOS[0]]);
    const pedir = () => T('moodle_cursos').ejecutar(a, {}).catch((e) => e.message);

    moodle(ISEIE, { core_course_get_courses_by_field: () => ({ error: 'Web services must be enabled', errorcode: 'enablewsdescription' }) });
    expect(await pedir()).toMatch(/servicios web no están activados/);

    moodle(ISEIE, {}); // la funcion no esta en el servicio del token
    expect(await pedir()).toMatch(/no tiene permiso para «core_course_get_courses_by_field»/);

    // Contesta bien en el HTTP pero sin la lista: NO es «cero cursos».
    moodle(ISEIE, { core_course_get_courses_by_field: () => ({ warnings: [] }) });
    expect(await pedir()).toMatch(/formato esperado/);
  });

  it('se piden varios campus y falla uno: el resto contesta y el fallido va en campus_con_error', async () => {
    configurar(10, ISEIE);
    configurar(20, FONO);
    // PSIKO sin credencial.
    moodleConCursos(ISEIE);
    moodle(FONO, {}, { caido: true });
    const r = await T('moodle_cursos').ejecutar(ambitoDe('admin'), {});
    expect(r.por_campus.map((c) => c.campus)).toEqual(['ISEIE']);
    expect(r.cursos.every((c) => c.campus === 'ISEIE')).toBe(true);
    expect(r.cursos.length).toBeGreaterThan(0);
    expect(r.campus_con_error.map((e) => e.error).sort()).toEqual([
      'FONO: Moodle no responde',
      'PSIKO: sin Moodle configurado',
    ]);
    expect(r.campus_con_error.find((e) => e.campus === 'PSIKO')).toMatchObject({ campus_id: 30, codigo: 'sin_configurar' });
  });

  it('fallan todos: un error que los nombra a todos', async () => {
    configurar(10, ISEIE);
    moodle(ISEIE, {}, { caido: true });
    const error = await T('moodle_estructura').ejecutar(ambitoDe('admin', PROYECTOS.slice(0, 2)), {}).catch((e) => e);
    expect(error.code).toBe('MOODLE_NO_DISPONIBLE');
    expect(error.message).toContain('ISEIE: Moodle no responde');
    expect(error.message).toContain('FONO: sin Moodle configurado');
  });

  it('sin fallos, campus_con_error viene vacio (se ve que se miro)', async () => {
    configurar(10, ISEIE);
    moodleConCursos(ISEIE);
    const r = await T('moodle_cursos').ejecutar(ambitoDe('admin', [PROYECTOS[0]]), {});
    expect(r.campus_con_error).toEqual([]);
  });
});

// ─── 4. moodle_cursos ─────────────────────────────────────────────────────

// Categorias de ejemplo: 5 «Másteres» (con 7 dentro) y 6 «Cursos».
const CATEGORIAS = [
  { id: 5, name: 'Másteres', parent: 0, depth: 1, coursecount: 3, visible: 1 },
  { id: 7, name: 'Psicología', parent: 5, depth: 2, coursecount: 1, visible: 1 },
  { id: 6, name: 'Cursos', parent: 0, depth: 1, coursecount: 1, visible: 1 },
];

describe('moodle_cursos', () => {
  beforeEach(() => {
    configurar(10, ISEIE);
    moodleConCursos(ISEIE);
  });
  const a = () => ambitoDe('admin', [PROYECTOS[0]]);

  it('por defecto, solo los activos; la portada del sitio no cuenta', async () => {
    const r = await T('moodle_cursos').ejecutar(a(), {});
    expect(r.cursos.map((c) => c.curso_id)).toEqual([11]);
    expect(r.cursos[0]).toMatchObject({
      campus: 'ISEIE', nombre: 'Máster en Psicología Clínica', estado: 'activo', fin: null, finalizacion_activada: true, categoria: 'Másteres',
    });
    expect(r.por_campus[0]).toMatchObject({ cursos_en_moodle: 4, activos: 1, proximos: 1, terminados: 1, ocultos: 1, coincidentes: 1 });
    expect(JSON.stringify(r)).not.toContain('mucho texto'); // el resumen del curso no se trae
  });

  it('cada estado y «todos»', async () => {
    const ids = async (estado) => (await T('moodle_cursos').ejecutar(a(), { estado })).cursos.map((c) => c.curso_id).sort();
    expect(await ids('proximos')).toEqual([13]);
    expect(await ids('terminados')).toEqual([12]);
    expect(await ids('ocultos')).toEqual([14]);
    expect(await ids('todos')).toEqual([11, 12, 13, 14]);
  });

  it('busca por texto sin distinguir tildes ni mayusculas, y por categoria', async () => {
    moodle(ISEIE, { core_course_get_courses_by_field: listaCursos(), core_course_get_categories: () => CATEGORIAS });
    expect((await T('moodle_cursos').ejecutar(a(), { estado: 'todos', texto: 'PSICOLOGIA' })).cursos.map((c) => c.curso_id)).toEqual([11]);
    expect((await T('moodle_cursos').ejecutar(a(), { estado: 'todos', categoria_id: 6 })).cursos.map((c) => c.curso_id)).toEqual([12]);
  });

  it('ordena por nombre, inicio, fin o categoría, en los dos sentidos, con los que no tienen el dato al final', async () => {
    const nombres = async (extra) => (await T('moodle_cursos').ejecutar(a(), { estado: 'todos', con_alumnos: false, ...extra })).cursos.map((c) => c.curso_id);
    // Inicio: 11, 12 y 14 empezaron el mismo día (empatan: se desempata por nombre, siempre de la A a la Z); el 13 empieza dentro de un mes.
    expect(await nombres({ orden: 'inicio', sentido: 'desc' })).toEqual([13, 12, 14, 11]);
    expect(await nombres({ orden: 'inicio', sentido: 'asc' })).toEqual([12, 14, 11, 13]);
    // Fin: solo el 12 tiene; los demás, al final y por nombre, ordene como ordene.
    expect(await nombres({ orden: 'fin', sentido: 'asc' })).toEqual([12, 14, 13, 11]);
    expect(await nombres({ orden: 'fin', sentido: 'desc' })).toEqual([12, 14, 13, 11]);
    expect(await nombres({ orden: 'nombre', sentido: 'asc' })).toEqual([12, 14, 13, 11]);
    expect(await nombres({ orden: 'nombre', sentido: 'desc' })).toEqual([11, 13, 14, 12]);
    // Categoría: «Cursos» (12) antes que «Másteres» (11, 13, 14).
    expect((await nombres({ orden: 'categoria', sentido: 'asc' }))[0]).toBe(12);
  });

  it('pagina', async () => {
    const r = await T('moodle_cursos').ejecutar(a(), { estado: 'todos', pagina: 2, limite: 3 });
    expect(r).toMatchObject({ total: 4, pagina: 2, limite: 3 });
    expect(r.cursos).toHaveLength(1);
  });

  it('un filtro que no encaja da total 0 CON los cursos que hay en el Moodle a la vista', async () => {
    const r = await T('moodle_cursos').ejecutar(a(), { texto: 'no existe' });
    expect(r.total).toBe(0);
    expect(r.por_campus[0].cursos_en_moodle).toBe(4);
  });

  it('una gestora tambien ve los cursos de su campus', async () => {
    const r = await T('moodle_cursos').ejecutar(ambitoDe('gestor', [PROYECTOS[0]]), {});
    expect(r.total).toBe(1);
  });
});

// ─── 5. La cache de la lista de cursos ────────────────────────────────────

describe('cache de la lista de cursos', () => {
  const a = () => ambitoDe('admin', [PROYECTOS[0]]);
  const pedidosDeCursos = () => funcionesLlamadas().filter((f) => f === 'core_course_get_courses_by_field').length;
  beforeEach(() => {
    configurar(10, ISEIE);
    configurar(20, FONO);
    configurar(30, PSIKO);
    moodleConCursos(ISEIE);
    moodleConCursos(FONO);
    moodleConCursos(PSIKO);
  });

  it('la segunda llamada no le pregunta a Moodle; con refrescar, si', async () => {
    const r1 = await T('moodle_cursos').ejecutar(a(), {});
    expect(r1.por_campus[0].de_cache).toBe(false);
    const r2 = await T('moodle_cursos').ejecutar(a(), { estado: 'todos' });
    expect(pedidosDeCursos()).toBe(1);
    expect(r2.por_campus[0].de_cache).toBe(true);
    await T('moodle_cursos').ejecutar(a(), { refrescar: true });
    expect(pedidosDeCursos()).toBe(2);
  });

  it('la cache la comparten las tres herramientas de cursos (alumnos y recursos tambien la usan)', async () => {
    moodle(ISEIE, {
      core_course_get_courses_by_field: listaCursos(),
      core_enrol_get_enrolled_users: () => [],
      core_course_get_contents: () => [],
      mod_url_get_urls_by_courses: () => ({ urls: [] }),
    });
    await T('moodle_cursos').ejecutar(a(), {});
    await T('moodle_alumnos').ejecutar(a(), { texto: 'máster' });
    await T('moodle_recursos_externos').ejecutar(a(), { texto: 'máster' });
    expect(pedidosDeCursos()).toBe(1);
  });

  it('caduca a los 5 minutos por defecto, o a los que diga MCP_MOODLE_CACHE_MIN', async () => {
    const t0 = Date.now();
    const reloj = vi.spyOn(Date, 'now');
    reloj.mockReturnValue(t0);
    await T('moodle_cursos').ejecutar(a(), {});
    reloj.mockReturnValue(t0 + 4 * 60_000);
    await T('moodle_cursos').ejecutar(a(), {});
    expect(pedidosDeCursos()).toBe(1);
    reloj.mockReturnValue(t0 + 5 * 60_000 + 1000);
    await T('moodle_cursos').ejecutar(a(), {});
    expect(pedidosDeCursos()).toBe(2);

    process.env.MCP_MOODLE_CACHE_MIN = '1';
    reloj.mockReturnValue(t0 + 5 * 60_000 + 1000 + 61_000);
    await T('moodle_cursos').ejecutar(a(), {});
    expect(pedidosDeCursos()).toBe(3);
  });

  it('MCP_MOODLE_CACHE_MIN=0 la apaga', async () => {
    process.env.MCP_MOODLE_CACHE_MIN = '0';
    await T('moodle_cursos').ejecutar(a(), {});
    await T('moodle_cursos').ejecutar(a(), {});
    expect(pedidosDeCursos()).toBe(2);
    expect(moodleMod.entradasEnCacheMoodle()).toBe(0);
  });

  it('tiene un tope de entradas: al pasarse, tira la mas antigua', async () => {
    process.env.MCP_MOODLE_CACHE_MAX = '2';
    await T('moodle_cursos').ejecutar(ambitoDe('admin', [PROYECTOS[0]]), {});
    await T('moodle_cursos').ejecutar(ambitoDe('admin', [PROYECTOS[1]]), {});
    await T('moodle_cursos').ejecutar(ambitoDe('admin', [PROYECTOS[2]]), {});
    expect(moodleMod.entradasEnCacheMoodle()).toBe(2);
    expect(pedidosDeCursos()).toBe(3);
    await T('moodle_cursos').ejecutar(ambitoDe('admin', [PROYECTOS[0]]), {}); // la de ISEIE ya no esta
    expect(pedidosDeCursos()).toBe(4);
  });

  it('un fallo no se guarda en cache', async () => {
    moodle(ISEIE, {}, { caido: true });
    await T('moodle_cursos').ejecutar(a(), {}).catch(() => {});
    expect(moodleMod.entradasEnCacheMoodle()).toBe(0);
    moodleConCursos(ISEIE);
    const r = await T('moodle_cursos').ejecutar(a(), {});
    expect(r.total).toBe(1);
  });

  it('si se cambia el token, la cache vieja no vale', async () => {
    await T('moodle_cursos').ejecutar(a(), {});
    const nuevo = { origen: ISEIE.origen, token: 'tokennuevo0123456789abcdef' };
    configurar(10, nuevo);
    moodleConCursos(nuevo);
    await T('moodle_cursos').ejecutar(a(), {});
    expect(pedidosDeCursos()).toBe(2);
  });

  it('quitar la credencial se nota aunque haya cache: no se sirve el Moodle de un campus sin credencial', async () => {
    await T('moodle_cursos').ejecutar(a(), {});
    guardadas.delete(10);
    const error = await T('moodle_cursos').ejecutar(a(), {}).catch((e) => e);
    expect(error.message).toContain('ISEIE: sin Moodle configurado');
  });
});

// ─── 6. moodle_alumnos ────────────────────────────────────────────────────

describe('moodle_alumnos', () => {
  const S = [{ roleid: 5, name: 'Student', shortname: 'student' }];
  const P = [{ roleid: 3, name: 'Teacher', shortname: 'editingteacher' }];
  const usuario = (id, nombre, dias, { roles = S, suspendido = false } = {}) => ({
    id, fullname: nombre, email: `u${id}@correo.test`, roles,
    lastaccess: dias === null ? 0 : AHORA() - dias * DIA,
    lastcourseaccess: dias === null ? 0 : AHORA() - dias * DIA,
    _suspendido: suspendido,
  });
  // Curso 11: A reciente, B hace 60 dias, C nunca, D reciente pero suspendida, T es profesora.
  const MATRICULADOS = {
    11: [usuario(1, 'Ana Alumna Perez', 2), usuario(2, 'Beto Bueno Gil', 60), usuario(3, 'Carla Nunca Vino', null),
      usuario(4, 'Dora Suspendida Ruiz', 1, { suspendido: true }), usuario(9, 'Tomas Tutor Sanz', 0, { roles: P })],
  };
  let pedidosDeUsuarios;
  const enrolados = ({ courseid, opciones }) => {
    pedidosDeUsuarios.push({ courseid, opciones });
    let lista = MATRICULADOS[courseid] || [];
    if (opciones.onlyactive === '1') lista = lista.filter((u) => !u._suspendido);
    const desde = Number(opciones.limitfrom || 0);
    const n = Number(opciones.limitnumber || lista.length);
    const campos = String(opciones.userfields || '').split(',');
    return lista.slice(desde, desde + n).map((u) => {
      const salida = {};
      for (const c of campos) if (c in u && !c.startsWith('_')) salida[c] = u[c];
      return salida;
    });
  };
  beforeEach(() => {
    pedidosDeUsuarios = [];
    configurar(10, ISEIE);
    moodle(ISEIE, { core_course_get_courses_by_field: listaCursos(), core_enrol_get_enrolled_users: enrolados });
  });
  const admin = () => ambitoDe('admin', [PROYECTOS[0]]);

  it('cuenta matriculados, matricula activa, suspendidos, activos a 30 dias y los que nunca entraron', async () => {
    const r = await T('moodle_alumnos').ejecutar(admin(), { curso_id: 11 });
    expect(r.cursos).toHaveLength(1);
    expect(r.cursos[0]).toMatchObject({
      campus: 'ISEIE', curso_id: 11, matriculados: 4, matricula_activa: 3, suspendidos: 1,
      activos_ultimos_30_dias: 1, nunca_han_entrado: 1, otros_roles: 1, terminados: null, finalizacion_activada: true,
    });
    expect(r.totales_suma_de_matriculas).toMatchObject({ matriculados: 4, suspendidos: 1, activos_ultimos_30_dias: 1 });
    expect(r.nota).toMatch(/Terminados/);
  });

  it('los dias de actividad se pueden cambiar', async () => {
    const r = await T('moodle_alumnos').ejecutar(admin(), { curso_id: 11, dias_actividad: 90 });
    expect(r.cursos[0].activos_ultimos_90_dias).toBe(2); // Ana y Beto (Dora, suspendida, no)
    expect(r.cursos[0].activos_ultimos_30_dias).toBeUndefined();
  });

  it('por defecto NO sale ni un nombre ni un correo, y ni se le piden a Moodle', async () => {
    const r = await T('moodle_alumnos').ejecutar(admin(), { curso_id: 11 });
    const texto = JSON.stringify(protegerDatos(r));
    expect(texto).not.toMatch(/@correo\.test|Alumna|Bueno|Nunca Vino|Suspendida|Tutor/);
    expect(r.cursos[0].alumnos).toBeUndefined();
    for (const p of pedidosDeUsuarios) {
      expect(p.opciones.userfields).not.toMatch(/email|fullname/);
    }
  });

  it('con datos_completos, un admin ve nombre y correo de cada alumno (no de la profesora)', async () => {
    const r = await T('moodle_alumnos').ejecutar(admin(), { curso_id: 11, datos_completos: true });
    const lista = r.cursos[0].alumnos;
    expect(lista).toHaveLength(4);
    expect(lista[0]).toMatchObject({ nombre: 'Ana Alumna Perez', email: 'u1@correo.test', matricula: 'activa' });
    expect(lista.find((x) => x.nombre.startsWith('Dora')).matricula).toBe('suspendida');
    expect(lista.find((x) => x.nombre.startsWith('Carla')).ultimo_acceso).toBeNull();
    expect(JSON.stringify(lista)).not.toContain('Tomas');
  });

  it('una gestora ve los recuentos de su campus pero NO los nombres (403 sin llegar a Moodle)', async () => {
    const gestora = ambitoDe('gestor', [PROYECTOS[0]]);
    const r = await T('moodle_alumnos').ejecutar(gestora, { curso_id: 11 });
    expect(r.cursos[0].matriculados).toBe(4);
    const n = deMoodle().length;
    const error = await T('moodle_alumnos').ejecutar(gestora, { curso_id: 11, datos_completos: true }).catch((e) => e);
    expect(error.code).toBe('MCP_SOLO_ADMIN');
    expect(error.statusCode).toBe(403);
    expect(deMoodle()).toHaveLength(n);
  });

  it('lee a los matriculados de 500 en 500', async () => {
    MATRICULADOS[11] = Array.from({ length: 1200 }, (_, i) => usuario(100 + i, `Alumno ${i}`, 1));
    try {
      const r = await T('moodle_alumnos').ejecutar(admin(), { curso_id: 11 });
      expect(r.cursos[0]).toMatchObject({ matriculados: 1200, activos_ultimos_30_dias: 1200, suspendidos: 0 });
      const todos = pedidosDeUsuarios.filter((p) => !p.opciones.onlyactive);
      expect(todos.map((p) => p.opciones.limitfrom)).toEqual(['0', '500', '1000']);
    } finally {
      MATRICULADOS[11] = [usuario(1, 'Ana Alumna Perez', 2), usuario(2, 'Beto Bueno Gil', 60), usuario(3, 'Carla Nunca Vino', null),
        usuario(4, 'Dora Suspendida Ruiz', 1, { suspendido: true }), usuario(9, 'Tomas Tutor Sanz', 0, { roles: P })];
    }
  });

  it('si el token no puede revisar matriculas, los suspendidos son null con su aviso, no 0', async () => {
    moodle(ISEIE, {
      core_course_get_courses_by_field: listaCursos(),
      core_enrol_get_enrolled_users: (p) => {
        if (p.opciones.onlyactive === '1') return { exception: 'required_capability_exception', errorcode: 'nopermissions', message: 'sin permiso' };
        return enrolados(p);
      },
    });
    const r = await T('moodle_alumnos').ejecutar(admin(), { curso_id: 11 });
    expect(r.cursos[0]).toMatchObject({ matriculados: 4, suspendidos: null, matricula_activa: null });
    expect(r.cursos[0].avisos[0]).toMatch(/suspendidas/);
    expect(r.totales_suma_de_matriculas.suspendidos).toBeNull();
  });

  it('si Moodle no devuelve el ultimo acceso, los activos son null y se avisa', async () => {
    moodle(ISEIE, {
      core_course_get_courses_by_field: listaCursos(),
      core_enrol_get_enrolled_users: () => [{ id: 1, roles: S }, { id: 2, roles: S }],
    });
    const r = await T('moodle_alumnos').ejecutar(admin(), { curso_id: 11 });
    expect(r.cursos[0]).toMatchObject({ matriculados: 2, activos_ultimos_30_dias: null, nunca_han_entrado: null });
    expect(r.cursos[0].avisos.join(' ')).toMatch(/último acceso/);
  });

  it('una respuesta que no es una lista no es «cero alumnos»', async () => {
    moodle(ISEIE, { core_course_get_courses_by_field: listaCursos(), core_enrol_get_enrolled_users: () => ({ users: [] }) });
    const r = await T('moodle_alumnos').ejecutar(admin(), { curso_id: 11 });
    expect(r.cursos[0].error).toMatch(/ISEIE: Moodle no devolvió la lista de matriculados/);
    expect(r.cursos[0].matriculados).toBeUndefined();
    expect(r.cursos_con_error).toBe(1);
  });

  it('un curso que falla no tumba a los demas', async () => {
    moodle(ISEIE, {
      core_course_get_courses_by_field: listaCursos(),
      core_enrol_get_enrolled_users: (p) => (p.courseid === 12
        ? { exception: 'webservice_access_exception', errorcode: 'accessexception', message: 'x' }
        : enrolados(p)),
    });
    const r = await T('moodle_alumnos').ejecutar(admin(), { estado: 'todos', texto: 'm' }); // Máster y Mindfulness
    const porId = Object.fromEntries(r.cursos.map((c) => [c.curso_id, c]));
    expect(porId[11].matriculados).toBe(4);
    expect(porId[12].error).toMatch(/no tiene permiso/);
  });

  it('un curso que no existe en ese Moodle se dice (y sugiere refrescar), no es 0 alumnos', async () => {
    const error = await T('moodle_alumnos').ejecutar(admin(), { curso_id: 999 }).catch((e) => e);
    expect(error.code).toBe('MOODLE_NO_DISPONIBLE');
    expect(error.message).toMatch(/ISEIE: el curso 999 no existe/);
    expect(error.message).toMatch(/refrescar/);
  });

  it('con un curso y varios campus hay que decir cual (los ids se repiten entre Moodles)', async () => {
    const error = await T('moodle_alumnos').ejecutar(ambitoDe('admin'), { curso_id: 11 }).catch((e) => e);
    expect(error.code).toBe('MCP_FALTA_CAMPUS');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('si ningun curso encaja lo dice con un aviso, y sugiere estado «todos»', async () => {
    const r = await T('moodle_alumnos').ejecutar(admin(), { texto: 'mindfulness' }); // terminado
    expect(r.cursos).toEqual([]);
    expect(r.cursos_consultados).toBe(0);
    expect(r.aviso).toMatch(/NO significa que no haya alumnos/);
    expect(r.aviso).toMatch(/estado: "todos"/);
  });

  it('tope de cursos por peticion: los que quedan fuera se cuentan y se avisa', async () => {
    const r = await T('moodle_alumnos').ejecutar(admin(), { estado: 'todos', limite_cursos: 2 });
    expect(r.cursos_consultados).toBe(2);
    expect(r.cursos_sin_consultar).toBe(2);
    expect(r.cursos_que_encajan).toBe(4);
    expect(r.aviso).toMatch(/2 cursos más/);
  });

  it('con varios campus y uno caido, el resto cuenta y el caido va en campus_con_error', async () => {
    configurar(20, FONO);
    moodle(FONO, {}, { caido: true });
    const r = await T('moodle_alumnos').ejecutar(ambitoDe('admin', PROYECTOS.slice(0, 2)), { texto: 'máster' });
    expect(r.cursos.map((c) => c.campus)).toEqual(['ISEIE']);
    expect(r.campus_con_error).toEqual([expect.objectContaining({ campus: 'FONO', error: 'FONO: Moodle no responde' })]);
  });

  it('un campus ajeno es un 403 y no llega ni a la base ni a Moodle', async () => {
    const soloIseie = ambitoDe('admin', [PROYECTOS[0]]);
    const error = await T('moodle_alumnos').ejecutar(soloIseie, { proyecto_id: 20, texto: 'x' }).catch((e) => e);
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('MCP_FUERA_DE_AMBITO');
    expect(consultas).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

// ─── 7. moodle_recursos_externos ──────────────────────────────────────────

describe('moodle_recursos_externos', () => {
  // core_course_get_contents: secciones con modulos.
  const contenidos = {
    11: [
      { id: 1, name: 'Bienvenida', modules: [
        { id: 101, name: 'Video de presentación', modname: 'url', visible: 1 },
        { id: 102, name: 'Charla en Vimeo', modname: 'url', visible: 1 },
        { id: 103, name: 'Carpeta del curso', modname: 'url', visible: 1 },
        { id: 104, name: 'Bibliografía', modname: 'url', visible: 0 },
        { id: 105, name: 'Aula virtual', modname: 'lti', visible: 1 },
        { id: 106, name: 'Texto', modname: 'label', visible: 1,
          description: '<p><iframe src="https://www.youtube.com/embed/ZZZ999"></iframe> y <a href="https://campus.iseie.test/pluginfile.php/1/a.pdf">interno</a> y <a href="mailto:a@b.test">correo</a></p>' },
        { id: 107, name: 'Guía', modname: 'resource', visible: 1, contents: [{ type: 'file', fileurl: 'https://campus.iseie.test/webservice/pluginfile.php/9/guia.pdf' }] },
        { id: 108, name: 'Enlace sin dirección', modname: 'url', visible: 1 },
      ] },
    ],
    12: [{ id: 2, name: 'Único', modules: [{ id: 201, name: 'Foro', modname: 'forum', visible: 1 }] }],
  };
  const URLS = [
    { id: 1, coursemodule: 101, course: 11, name: 'Video', externalurl: 'https://youtu.be/AAA111' },
    { id: 2, coursemodule: 102, course: 11, name: 'Vimeo', externalurl: 'https://vimeo.com/12345' },
    { id: 3, coursemodule: 103, course: 11, name: 'Drive', externalurl: 'https://drive.google.com/drive/folders/XYZ' },
    { id: 4, coursemodule: 104, course: 11, name: 'Biblio', externalurl: 'http://biblioteca.test/lista.html' },
  ];
  beforeEach(() => {
    configurar(10, ISEIE);
    moodle(ISEIE, {
      core_course_get_courses_by_field: listaCursos(),
      core_course_get_contents: ({ courseid }) => contenidos[courseid] || [],
      mod_url_get_urls_by_courses: ({ courseids }) => ({ urls: URLS.filter((u) => courseids.includes(u.course)), warnings: [] }),
    });
  });
  const admin = () => ambitoDe('admin', [PROYECTOS[0]]);
  const recursoDe = (r, nombre) => r.cursos.flatMap((c) => c.recursos).find((x) => x.nombre === nombre);

  it('clasifica YouTube, Vimeo, Drive, enlaces, LTI y los videos escritos en una descripcion', async () => {
    const r = await T('moodle_recursos_externos').ejecutar(admin(), { estado: 'todos', texto: 'm' });
    const c11 = r.cursos.find((c) => c.curso_id === 11);
    expect(c11.por_tipo).toEqual({ youtube: 2, vimeo: 1, drive: 1, lti: 1, enlace: 1 });
    expect(c11.total_recursos_externos).toBe(6);
    expect(recursoDe(r, 'Video de presentación')).toMatchObject({ tipo: 'youtube', url: 'https://youtu.be/AAA111', origen: 'modulo_url', seccion: 'Bienvenida', visible: true });
    expect(recursoDe(r, 'Charla en Vimeo').tipo).toBe('vimeo');
    expect(recursoDe(r, 'Carpeta del curso').tipo).toBe('drive');
    expect(recursoDe(r, 'Bibliografía')).toMatchObject({ tipo: 'enlace', visible: false });
    expect(recursoDe(r, 'Aula virtual')).toMatchObject({ tipo: 'lti', url: null });
    expect(recursoDe(r, 'Texto')).toMatchObject({ tipo: 'youtube', origen: 'descripcion', url: 'https://www.youtube.com/embed/ZZZ999' });
    // Ni los archivos internos, ni lo que apunta al propio Moodle, ni el mailto.
    expect(JSON.stringify(r)).not.toMatch(/pluginfile|guia\.pdf|mailto/);
    expect(c11.modulos_url_sin_direccion).toBe(1);
  });

  it('dice que cursos NO tienen recursos externos (leidos bien) en el resumen', async () => {
    const r = await T('moodle_recursos_externos').ejecutar(admin(), { estado: 'todos', texto: 'm' });
    expect(r.cursos.find((c) => c.curso_id === 12)).toMatchObject({ total_recursos_externos: 0, recursos: [] });
    expect(r.resumen).toMatchObject({ cursos_con_recursos_externos: 1, cursos_sin_recursos_externos: 1, cursos_con_error: 0 });
    expect(r.resumen.por_tipo.youtube).toBe(2);
    expect(r.resumen.enlaces_comprobados).toBeUndefined();
  });

  it('sin comprobar_enlaces no se sale a la red: solo se habla con Moodle', async () => {
    await T('moodle_recursos_externos').ejecutar(admin(), { texto: 'máster' });
    expect(externas()).toEqual([]);
    expect(funcionesLlamadas().filter((f) => f === 'mod_url_get_urls_by_courses')).toHaveLength(1); // una por campus
  });

  it('un curso cuyo contenido no se pudo leer sale con error, NO como «sin recursos»', async () => {
    moodle(ISEIE, {
      core_course_get_courses_by_field: listaCursos(),
      core_course_get_contents: ({ courseid }) => (courseid === 12 ? { exception: 'moodle_exception', errorcode: 'x', message: 'roto' } : contenidos[courseid]),
      mod_url_get_urls_by_courses: () => ({ urls: URLS }),
    });
    const r = await T('moodle_recursos_externos').ejecutar(admin(), { estado: 'todos', texto: 'm' });
    const c12 = r.cursos.find((c) => c.curso_id === 12);
    expect(c12.error).toMatch(/ISEIE: Moodle devolvió un error \(x\)/);
    expect(c12.total_recursos_externos).toBeUndefined();
    expect(r.resumen).toMatchObject({ cursos_sin_recursos_externos: 0, cursos_con_error: 1 });
  });

  it('si mod_url no esta permitido para el token, se usa la direccion de los contenidos', async () => {
    moodle(ISEIE, {
      core_course_get_courses_by_field: listaCursos(),
      core_course_get_contents: () => [{ id: 1, name: 'S', modules: [
        { id: 101, name: 'Enlace', modname: 'url', visible: 1, contents: [{ type: 'url', fileurl: 'https://vimeo.com/777' }] },
      ] }],
      // mod_url_get_urls_by_courses no esta en el servicio: accessexception.
    });
    const r = await T('moodle_recursos_externos').ejecutar(admin(), { curso_id: 11 });
    expect(r.cursos[0].recursos).toEqual([expect.objectContaining({ tipo: 'vimeo', url: 'https://vimeo.com/777' })]);
  });

  it('el filtro por tipo recorta la lista, no los recuentos', async () => {
    const r = await T('moodle_recursos_externos').ejecutar(admin(), { curso_id: 11, tipo: 'lti' });
    expect(r.cursos[0].recursos.map((x) => x.nombre)).toEqual(['Aula virtual']);
    expect(r.cursos[0].total_recursos_externos).toBe(6);
  });

  it('tope de cursos por peticion con aviso', async () => {
    const r = await T('moodle_recursos_externos').ejecutar(admin(), { estado: 'todos', limite_cursos: 1 });
    expect(r.cursos_consultados).toBe(1);
    expect(r.cursos_sin_consultar).toBe(3);
    expect(r.avisos.join(' ')).toMatch(/3 cursos más/);
  });

  describe('comprobar si los enlaces responden', () => {
    const comprobar = (extra = {}) => T('moodle_recursos_externos').ejecutar(admin(), { curso_id: 11, comprobar_enlaces: true, ...extra });
    const estados = (r) => Object.fromEntries(r.cursos[0].recursos.filter((x) => x.url).map((x) => [x.nombre, x.estado]));

    it('ok, roto, restringido, sin respuesta y error del servidor', async () => {
      externo = async (url) => {
        if (url.includes('youtu.be') || url.includes('youtube.com/oembed')) return new Response('{}', { status: 200 });
        if (url.includes('vimeo.com')) return new Response('', { status: 404 });
        if (url.includes('drive.google.com')) return new Response('', { status: 403 });
        if (url.includes('biblioteca.test')) throw new DOMException('timeout', 'TimeoutError');
        return new Response('', { status: 500 });
      };
      const r = await comprobar();
      const e = estados(r);
      expect(e['Video de presentación']).toBe('ok');
      expect(e['Charla en Vimeo']).toBe('roto');
      expect(e['Carpeta del curso']).toBe('restringido');
      expect(e['Bibliografía']).toBe('no_responde');
      expect(e.Texto).toBe('ok');
      expect(r.resumen).toMatchObject({ enlaces_comprobados: 5, enlaces_rotos: 2 }); // 5 direcciones distintas; rotos: roto + no_responde
      expect(r.cursos[0].enlaces_rotos).toBe(2);
      expect(r.cursos[0].recursos.find((x) => x.nombre === 'Charla en Vimeo')).toMatchObject({ estado: 'roto', http: 404 });
      // Los LTI no tienen direccion: no llevan estado.
      expect(r.cursos[0].recursos.find((x) => x.tipo === 'lti').estado).toBeUndefined();
    });

    it('solo_rotos deja los que no responden', async () => {
      externo = async (url) => (url.includes('vimeo') ? new Response('', { status: 404 }) : new Response('', { status: 200 }));
      const r = await comprobar({ solo_rotos: true });
      expect(r.cursos[0].recursos.map((x) => x.nombre)).toEqual(['Charla en Vimeo']);
    });

    it('YouTube y Vimeo se comprueban por oEmbed (la pagina de un video borrado da 200)', async () => {
      const vistas = [];
      externo = async (url) => { vistas.push(url); return new Response('{}', { status: 200 }); };
      await comprobar();
      expect(vistas.some((u) => u.startsWith('https://www.youtube.com/oembed?'))).toBe(true);
      expect(vistas.some((u) => u.startsWith('https://vimeo.com/api/oembed.json?'))).toBe(true);
    });

    it('HEAD primero; si el servidor no lo atiende, GET de un byte; sin cookies', async () => {
      const metodos = [];
      externo = async (url, init) => {
        if (url.includes('biblioteca.test')) {
          metodos.push(init.method);
          return new Response('', { status: init.method === 'HEAD' ? 405 : 200 });
        }
        return new Response('', { status: 200 });
      };
      const r = await comprobar();
      expect(metodos).toEqual(['HEAD', 'GET']);
      expect(estados(r)['Bibliografía']).toBe('ok');
      const get = externas().find((l) => l.init.method === 'GET');
      expect(get.init.headers.Range).toBe('bytes=0-0');
      expect(get.init.credentials).toBe('omit');
      expect(get.init.headers.Cookie).toBeUndefined();
      expect(get.init.headers.Authorization).toBeUndefined();
    });

    it('sigue una redireccion normal, a mano', async () => {
      externo = async (url) => (url.includes('biblioteca.test/lista')
        ? new Response('', { status: 301, headers: { location: 'https://biblioteca.test/nueva' } })
        : new Response('', { status: 200 }));
      const r = await comprobar();
      expect(estados(r)['Bibliografía']).toBe('ok');
      expect(externas().every((l) => l.init.redirect === 'manual')).toBe(true);
    });

    it('una redireccion a una direccion privada NO se sigue', async () => {
      externo = async (url) => (url.includes('biblioteca.test/lista')
        ? new Response('', { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } })
        : new Response('', { status: 200 }));
      const r = await comprobar();
      const b = r.cursos[0].recursos.find((x) => x.nombre === 'Bibliografía');
      expect(b).toMatchObject({ estado: 'bloqueado', detalle: 'dirección privada o local' });
      expect(externas().some((l) => l.url.includes('169.254.169.254'))).toBe(false);
    });

    it('demasiadas redirecciones = enlace roto', async () => {
      externo = async (url) => new Response('', { status: 302, headers: { location: `${url}x` } });
      const r = await comprobar();
      expect(estados(r)['Bibliografía']).toBe('roto');
      expect(r.cursos[0].recursos.find((x) => x.nombre === 'Bibliografía').detalle).toMatch(/redirecciones/);
      expect(externas().filter((l) => l.url.includes('biblioteca.test')).length).toBe(4); // el primero + 3 saltos
    });

    it('un dominio que resuelve a una IP privada no se toca; uno que no existe es un enlace roto', async () => {
      hoisted.dns.set('biblioteca.test', ['10.0.0.8']);
      hoisted.dns.set('vimeo.com', Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
      const r = await comprobar();
      const e = estados(r);
      expect(e['Bibliografía']).toBe('bloqueado');
      expect(e['Charla en Vimeo']).toBe('roto');
      expect(externas().some((l) => l.url.includes('biblioteca.test'))).toBe(false);
    });

    it('el tope de enlaces por peticion: los demas quedan «sin_comprobar» y se avisa', async () => {
      process.env.MCP_MOODLE_MAX_ENLACES = '2';
      const r = await comprobar();
      expect(r.resumen).toMatchObject({ enlaces_comprobados: 2, enlaces_sin_comprobar: 3 });
      const estadosPuestos = r.cursos[0].recursos.filter((x) => x.url).map((x) => x.estado);
      expect(estadosPuestos.filter((s) => s === 'sin_comprobar')).toHaveLength(3);
      expect(r.avisos.join(' ')).toMatch(/Solo se han comprobado 2 enlaces/);
      expect(externas()).toHaveLength(2);
    });

    it('nunca mas de 4 comprobaciones a la vez', async () => {
      process.env.MCP_MOODLE_MAX_ENLACES = '100';
      moodle(ISEIE, {
        core_course_get_courses_by_field: listaCursos(),
        core_course_get_contents: () => [{ id: 1, name: 'S', modules: Array.from({ length: 20 }, (_, i) => (
          { id: 300 + i, name: `Enlace ${i}`, modname: 'url', visible: 1 })) }],
        mod_url_get_urls_by_courses: () => ({ urls: Array.from({ length: 20 }, (_, i) => (
          { coursemodule: 300 + i, course: 11, externalurl: `https://sitio${i}.test/p` })) }),
      });
      let ahora = 0;
      let maximo = 0;
      externo = async () => {
        ahora += 1;
        maximo = Math.max(maximo, ahora);
        await new Promise((res) => setTimeout(res, 5));
        ahora -= 1;
        return new Response('', { status: 200 });
      };
      const r = await comprobar();
      expect(r.resumen.enlaces_comprobados).toBe(20);
      expect(maximo).toBeLessThanOrEqual(4);
      expect(maximo).toBeGreaterThan(1);
    });

    it('un enlace repetido se comprueba una sola vez', async () => {
      moodle(ISEIE, {
        core_course_get_courses_by_field: listaCursos(),
        core_course_get_contents: () => [{ id: 1, name: 'S', modules: [
          { id: 301, name: 'A', modname: 'url', visible: 1 }, { id: 302, name: 'B', modname: 'url', visible: 1 }] }],
        mod_url_get_urls_by_courses: () => ({ urls: [
          { coursemodule: 301, course: 11, externalurl: 'https://mismo.test/x' },
          { coursemodule: 302, course: 11, externalurl: 'https://mismo.test/x' }] }),
      });
      const r = await comprobar();
      expect(externas()).toHaveLength(1);
      expect(r.cursos[0].recursos.map((x) => x.estado)).toEqual(['ok', 'ok']);
    });

    it('una gestora ve los recursos pero no puede mandar al servidor a comprobar enlaces', async () => {
      const gestora = ambitoDe('gestor', [PROYECTOS[0]]);
      const ok = await T('moodle_recursos_externos').ejecutar(gestora, { curso_id: 11 });
      expect(ok.cursos[0].total_recursos_externos).toBe(6);
      const n = deMoodle().length;
      const error = await T('moodle_recursos_externos').ejecutar(gestora, { curso_id: 11, comprobar_enlaces: true }).catch((e) => e);
      expect(error.code).toBe('MCP_SOLO_ADMIN');
      expect(deMoodle()).toHaveLength(n);
      expect(externas()).toEqual([]);
    });
  });

  it('un campus ajeno es un 403', async () => {
    const error = await T('moodle_recursos_externos').ejecutar(admin(), { proyecto_id: 30, texto: 'x' }).catch((e) => e);
    expect(error.statusCode).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});

// ─── 8. SSRF: que direcciones se tocan ────────────────────────────────────

describe('direcciones que nunca se comprueban', () => {
  it('esIpPrivada', () => {
    const privadas = ['127.0.0.1', '127.1.2.3', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
      '0.0.0.0', '100.64.0.1', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1',
      '::ffff:127.0.0.1', '::ffff:10.1.1.1', '::ffff:7f00:1', 'ff02::1', 'no-es-una-ip'];
    const publicas = ['8.8.8.8', '93.184.216.34', '172.15.0.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'];
    for (const ip of privadas) expect(enlaces.esIpPrivada(ip), ip).toBe(true);
    for (const ip of publicas) expect(enlaces.esIpPrivada(ip), ip).toBe(false);
  });

  it('motivoDeBloqueo: esquemas, usuario en la URL, puertos, nombres internos e IPs', async () => {
    const bloqueadas = [
      'file:///etc/passwd', 'ftp://ejemplo.test/x', 'gopher://ejemplo.test', 'javascript:alert(1)',
      'http://usuario:clave@ejemplo.test/', 'http://ejemplo.test:6379/', 'http://ejemplo.test:22/',
      'http://localhost/', 'http://LOCALHOST:80/', 'http://servicio.localhost/', 'http://router.local/', 'http://db.internal/',
      'http://intranet/', 'http://127.0.0.1/', 'http://2130706433/', 'http://0x7f.0.0.1/', 'http://[::1]/',
      'http://[::ffff:127.0.0.1]/', 'http://169.254.169.254/latest/meta-data/', 'http://10.1.2.3/', 'http://192.168.0.1:80/',
    ];
    for (const u of bloqueadas) expect(await enlaces.motivoDeBloqueo(u), u).toBeTruthy();
    expect(await enlaces.motivoDeBloqueo('https://www.ejemplo.test/ruta?a=1')).toBeNull();
    expect(await enlaces.motivoDeBloqueo('http://ejemplo.test:80/')).toBeNull();
    expect(await enlaces.motivoDeBloqueo('https://ejemplo.test:443/')).toBeNull();
  });

  it('comprobarEnlace no llama a fetch para ninguna de las bloqueadas', async () => {
    for (const u of ['http://127.0.0.1:8080/admin', 'http://localhost:5432/', 'http://169.254.169.254/', 'http://[::1]/', 'ftp://x.test/', 'http://10.0.0.5/']) {
      const r = await enlaces.comprobarEnlace(u);
      expect(r.estado, u).toBe('bloqueado');
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('extraerUrls: href y src http(s), sin repetir, sin mailto ni javascript', () => {
    const html = `<a href="https://a.test/x?y=1&amp;z=2">a</a> <a href='http://b.test'>b</a> <iframe src="//c.test/e"></iframe>
      <a href="https://a.test/x?y=1&z=2">dup</a> <a href="mailto:x@y.test">m</a> <a href="javascript:void(0)">j</a> <a href="/relativa">r</a>`;
    expect(enlaces.extraerUrls(html)).toEqual(['https://a.test/x?y=1&z=2', 'http://b.test/', 'https://c.test/e']);
    expect(enlaces.extraerUrls(null)).toEqual([]);
  });

  it('tipoDeEnlace', () => {
    expect(enlaces.tipoDeEnlace('https://www.youtube.com/watch?v=1')).toBe('youtube');
    expect(enlaces.tipoDeEnlace('https://youtu.be/1')).toBe('youtube');
    expect(enlaces.tipoDeEnlace('https://player.vimeo.com/video/1')).toBe('vimeo');
    expect(enlaces.tipoDeEnlace('https://docs.google.com/document/d/1')).toBe('drive');
    expect(enlaces.tipoDeEnlace('https://youtube.com.malo.test/x')).toBe('enlace');
    expect(enlaces.tipoDeEnlace('no es url')).toBe('enlace');
  });
});

// ─── 9. Estructura, tope de tiempo y parametros ───────────────────────────

describe('moodle_estructura', () => {
  it('categorias con su ruta y cuantos cursos tiene cada una', async () => {
    configurar(10, ISEIE);
    moodle(ISEIE, {
      core_course_get_categories: () => [
        { id: 6, name: 'Psicología', parent: 5, depth: 2, coursecount: 3, visible: 1 },
        { id: 5, name: 'Másteres', parent: 0, depth: 1, coursecount: 2, visible: 1 },
      ],
    });
    const r = await T('moodle_estructura').ejecutar(ambitoDe('admin', [PROYECTOS[0]]), {});
    expect(r.campus[0].categorias).toEqual([
      { id: 5, nombre: 'Másteres', ruta: 'Másteres', padre_id: null, profundidad: 1, cursos: 2, visible: true },
      { id: 6, nombre: 'Psicología', ruta: 'Másteres > Psicología', padre_id: 5, profundidad: 2, cursos: 3, visible: true },
    ]);
    await T('moodle_estructura').ejecutar(ambitoDe('admin', [PROYECTOS[0]]), {});
    expect(funcionesLlamadas()).toHaveLength(1); // la segunda, de cache
  });

  it('una respuesta que no es una lista no es «sin categorias»', async () => {
    configurar(10, ISEIE);
    moodle(ISEIE, { core_course_get_categories: () => ({ categorias: [] }) });
    const error = await T('moodle_estructura').ejecutar(ambitoDe('admin', [PROYECTOS[0]]), {}).catch((e) => e);
    expect(error.message).toMatch(/ISEIE: Moodle no devolvió las categorías/);
  });
});

describe('tope de tiempo por herramienta', () => {
  it('si Moodle se cuelga, la herramienta se corta con MCP_LENTO y cancela las peticiones', async () => {
    process.env.MCP_MOODLE_TOPE_MS = '80';
    configurar(10, ISEIE);
    moodle(ISEIE, {}, { colgado: true });
    const t0 = Date.now();
    const error = await T('moodle_cursos').ejecutar(ambitoDe('admin', [PROYECTOS[0]]), {}).catch((e) => e);
    expect(error.code).toBe('MCP_LENTO');
    expect(error.statusCode).toBe(504);
    expect(error.message).toMatch(/moodle_cursos/);
    expect(Date.now() - t0).toBeLessThan(2000);
    const senal = deMoodle()[0].init.signal;
    await new Promise((res) => setTimeout(res, 10));
    expect(senal.aborted).toBe(true);
  });
});

describe('parametros de Moodle', () => {
  it('se aplanan como espera el REST de Moodle', () => {
    const p = cliente.aplanarParametros({
      courseid: 5, courseids: [1, 2], options: [{ name: 'limitfrom', value: 0 }, { name: 'onlyactive', value: true }], nada: undefined,
    });
    expect(p.get('courseid')).toBe('5');
    expect(p.get('courseids[1]')).toBe('2');
    expect(p.get('options[0][name]')).toBe('limitfrom');
    expect(p.get('options[0][value]')).toBe('0');
    expect(p.get('options[1][value]')).toBe('1');
    expect(p.has('nada')).toBe(false);
  });

  it('la URL guardada se normaliza (sin barra final, sin server.php, solo http/https)', () => {
    expect(cliente.normalizarUrlMoodle('https://campus.test/')).toBe('https://campus.test');
    expect(cliente.normalizarUrlMoodle('https://campus.test/moodle/webservice/rest/server.php?x=1')).toBe('https://campus.test/moodle');
    expect(cliente.normalizarUrlMoodle('ftp://campus.test')).toBeNull();
    expect(cliente.normalizarUrlMoodle('no es una url')).toBeNull();
    expect(cliente.normalizarUrlMoodle('https://u:p@campus.test')).toBeNull();
  });

  it('un Moodle en una subcarpeta (FONO) conserva su ruta en la peticion', async () => {
    configurar(20, FONO);
    moodleConCursos(FONO);
    await T('moodle_cursos').ejecutar(ambitoDe('admin', [PROYECTOS[1]]), {});
    expect(deMoodle()[0].url).toBe('https://campus.fono.test/moodle/webservice/rest/server.php');
  });
});

describe('videos incrustados: se comprueban por su direccion de ver', () => {
  // Visto contra el Moodle de Psiko (21/10): el oEmbed de YouTube contesta 404 a
  // `/embed/ID` aunque el video exista, y tres videos vivos salian como «rotos».
  it.each([
    ['youtube', 'https://www.youtube.com/embed/Pt_4LGoEr8E?si=UK5l0IPfk6hKmXCK', 'https://www.youtube.com/watch?v=Pt_4LGoEr8E'],
    ['youtube', 'https://www.youtube-nocookie.com/embed/abc123', 'https://www.youtube.com/watch?v=abc123'],
    ['youtube', 'https://youtu.be/abc123?t=4', 'https://www.youtube.com/watch?v=abc123'],
    ['youtube', 'https://www.youtube.com/shorts/abc123', 'https://www.youtube.com/watch?v=abc123'],
    ['youtube', 'https://www.youtube.com/embed/videoseries?list=PL123', 'https://www.youtube.com/playlist?list=PL123'],
    ['youtube', 'https://www.youtube.com/watch?v=abc123', 'https://www.youtube.com/watch?v=abc123'],
    ['vimeo', 'https://player.vimeo.com/video/12345?h=deadbeef', 'https://vimeo.com/12345/deadbeef'],
    ['vimeo', 'https://player.vimeo.com/video/12345', 'https://vimeo.com/12345'],
    ['vimeo', 'https://vimeo.com/12345', 'https://vimeo.com/12345'],
  ])('%s %s', async (tipo, entrada, esperada) => {
    const { urlCanonica, urlDeComprobacion } = await import('../src/modules/mcp/mcp.moodle.enlaces.js');
    expect(urlCanonica(entrada, tipo)).toBe(esperada);
    expect(urlDeComprobacion(entrada, tipo)).toContain(encodeURIComponent(esperada));
  });

  it('una direccion que no es de video, o que no entiende, se deja como esta', async () => {
    const { urlCanonica } = await import('../src/modules/mcp/mcp.moodle.enlaces.js');
    expect(urlCanonica('https://ejemplo.org/pagina', 'enlace')).toBe('https://ejemplo.org/pagina');
    expect(urlCanonica('no es una url', 'youtube')).toBe('no es una url');
  });
});

// ─── Lo que pedia la issue y faltaba (#335, 21/10) ────────────────────────

describe('moodle_cursos: visible y numero de alumnos', () => {
  const S = [{ shortname: 'student' }];
  const P = [{ shortname: 'editingteacher' }];
  let pedidos;
  const enrolados = ({ courseid, opciones }) => {
    pedidos.push(courseid);
    const lista = { 11: [{ id: 1, roles: S }, { id: 2, roles: S }, { id: 9, roles: P }], 12: [], 13: [{ id: 3, roles: S }] }[courseid];
    if (!lista) return json({ exception: 'moodle_exception', errorcode: 'invalidrecord', message: 'x' });
    const desde = Number(opciones.limitfrom || 0);
    return lista.slice(desde, desde + Number(opciones.limitnumber || lista.length));
  };
  beforeEach(() => {
    pedidos = [];
    configurar(10, ISEIE);
    moodle(ISEIE, { core_course_get_courses_by_field: listaCursos(), core_enrol_get_enrolled_users: enrolados });
  });
  const admin = () => ambitoDe('admin', [PROYECTOS[0]]);

  it('cada curso trae si esta visible y cuantos alumnos tiene (sin contar profesores)', async () => {
    const r = await T('moodle_cursos').ejecutar(admin(), { estado: 'todos' });
    const por = Object.fromEntries(r.cursos.map((c) => [c.curso_id, c]));
    expect(por[11]).toMatchObject({ visible: true, alumnos: 2 });
    expect(por[12]).toMatchObject({ visible: true, alumnos: 0 });
    expect(por[14]).toMatchObject({ visible: false });
  });

  it('un curso cuyos alumnos no se pudieron leer sale con null y el motivo, no con 0', async () => {
    const r = await T('moodle_cursos').ejecutar(admin(), { estado: 'todos' });
    const c14 = r.cursos.find((c) => c.curso_id === 14);
    expect(c14.alumnos).toBeNull();
    expect(c14.alumnos_error).toBeTruthy();
    expect(r.cursos.find((c) => c.curso_id === 11).alumnos_error).toBeUndefined();
  });

  it('con_alumnos: false no pregunta por los alumnos', async () => {
    const r = await T('moodle_cursos').ejecutar(admin(), { estado: 'todos', con_alumnos: false });
    expect(pedidos).toEqual([]);
    expect(r.cursos[0]).not.toHaveProperty('alumnos');
  });

  it('el recuento se guarda unos minutos y refrescar lo pide de nuevo', async () => {
    await T('moodle_cursos').ejecutar(admin(), { texto: 'Psicolog' });
    await T('moodle_cursos').ejecutar(admin(), { texto: 'Psicolog' });
    expect(pedidos.filter((id) => id === 11)).toHaveLength(1);
    await T('moodle_cursos').ejecutar(admin(), { texto: 'Psicolog', refrescar: true });
    expect(pedidos.filter((id) => id === 11)).toHaveLength(2);
  });
});

describe('por categoria, con sus subcategorias', () => {
  const S = [{ shortname: 'student' }];
  beforeEach(() => {
    configurar(10, ISEIE);
    const cursos = [
      curso(11, 'Máster en Psicología Clínica', { categoryid: 7 }),
      curso(12, 'Máster en Gestión', { categoryid: 5 }),
      curso(13, 'Curso suelto', { categoryid: 6 }),
    ];
    moodle(ISEIE, {
      core_course_get_courses_by_field: listaCursos(cursos),
      core_course_get_categories: () => CATEGORIAS,
      core_enrol_get_enrolled_users: () => [{ id: 1, roles: S }],
      core_course_get_contents: () => [],
      mod_url_get_urls_by_courses: () => ({ urls: [] }),
    });
  });
  const admin = () => ambitoDe('admin', [PROYECTOS[0]]);

  it('moodle_cursos: la categoria incluye lo que cuelga de sus subcategorias', async () => {
    const r = await T('moodle_cursos').ejecutar(admin(), { categoria_id: 5, con_alumnos: false });
    expect(r.cursos.map((c) => c.curso_id).sort()).toEqual([11, 12]);
  });

  it('moodle_alumnos y moodle_recursos_externos tambien filtran por categoria', async () => {
    const a = await T('moodle_alumnos').ejecutar(admin(), { categoria_id: 7 });
    expect(a.cursos.map((c) => c.curso_id)).toEqual([11]);
    const r = await T('moodle_recursos_externos').ejecutar(admin(), { categoria_id: 6 });
    expect(r.cursos.map((c) => c.curso_id)).toEqual([13]);
  });

  it('una categoria que no existe es un error claro, no «cero cursos»', async () => {
    await expect(T('moodle_alumnos').ejecutar(admin(), { categoria_id: 99 })).rejects.toThrow(/categoría 99 no existe/);
  });
});

describe('moodle_alumnos: terminados', () => {
  const S = [{ shortname: 'student' }];
  let preguntados;
  let respuesta;
  const alumnos = (n) => Array.from({ length: n }, (_, i) => ({ id: 100 + i, roles: S, lastcourseaccess: AHORA() - DIA, lastaccess: AHORA() - DIA }));
  const montar = (cursoExtra = {}, n = 3) => {
    configurar(10, ISEIE);
    moodle(ISEIE, {
      core_course_get_courses_by_field: listaCursos([curso(11, 'Curso con finalización', cursoExtra)]),
      core_enrol_get_enrolled_users: ({ opciones }) => (Number(opciones.limitfrom || 0) ? [] : alumnos(n)),
      core_completion_get_course_completion_status: (_p, q) => {
        preguntados.push(Number(q.get('userid')));
        return respuesta(Number(q.get('userid')));
      },
    });
  };
  beforeEach(() => {
    preguntados = [];
    respuesta = (id) => ({ completionstatus: { completed: id !== 101, completions: [{ complete: id !== 101 }] }, warnings: [] });
  });
  const admin = () => ambitoDe('admin', [PROYECTOS[0]]);

  it('cuenta los alumnos que Moodle da por terminados', async () => {
    montar();
    const r = await T('moodle_alumnos').ejecutar(admin(), { curso_id: 11 });
    expect(r.cursos[0]).toMatchObject({ matriculados: 3, terminados: 2, criterios_de_finalizacion: true });
    expect(preguntados.sort()).toEqual([100, 101, 102]);
    expect(r.totales_suma_de_matriculas).toMatchObject({ terminados: 2, cursos_sin_dato_de_terminados: 0 });
  });

  it('finalizacion activada pero SIN criterios (visto en Psiko): null con el motivo, y se pregunta una sola vez', async () => {
    montar();
    respuesta = () => json({ exception: 'moodle_exception', errorcode: 'nocriteriaset', message: 'No hay criterios establecidos' });
    const r = await T('moodle_alumnos').ejecutar(admin(), { curso_id: 11 });
    expect(r.cursos[0].terminados).toBeNull();
    expect(r.cursos[0].criterios_de_finalizacion).toBe(false);
    expect(r.cursos[0].avisos.join(' ')).toMatch(/no tiene criterios de finalización/);
    expect(preguntados).toHaveLength(1);
    expect(r.totales_suma_de_matriculas).toMatchObject({ terminados: null, cursos_sin_dato_de_terminados: 1 });
  });

  it('sin finalizacion activada: null y no se pregunta nada', async () => {
    montar({ enablecompletion: 0 });
    const r = await T('moodle_alumnos').ejecutar(admin(), { curso_id: 11 });
    expect(r.cursos[0]).toMatchObject({ terminados: null, criterios_de_finalizacion: false });
    expect(preguntados).toEqual([]);
  });

  it('terminados: false no pregunta', async () => {
    montar();
    const r = await T('moodle_alumnos').ejecutar(admin(), { curso_id: 11, terminados: false });
    expect(r.cursos[0].terminados).toBeNull();
    expect(preguntados).toEqual([]);
  });

  it('demasiados alumnos: no se hace una llamada por cada uno, y se dice', async () => {
    process.env.MCP_MOODLE_MAX_TERMINADOS = '2';
    montar();
    const r = await T('moodle_alumnos').ejecutar(admin(), { curso_id: 11 });
    expect(r.cursos[0].terminados).toBeNull();
    expect(r.cursos[0].avisos.join(' ')).toMatch(/Hay más de 2 alumnos/);
    expect(preguntados).toEqual([]);
  });

  it('el token sin permiso para la finalizacion: null con el motivo, el resto de cifras siguen', async () => {
    montar();
    respuesta = () => json({ exception: 'webservice_access_exception', errorcode: 'accessexception', message: 'Access control exception' });
    const r = await T('moodle_alumnos').ejecutar(admin(), { curso_id: 11 });
    expect(r.cursos[0]).toMatchObject({ matriculados: 3, terminados: null });
    expect(r.cursos[0].avisos.join(' ')).toMatch(/no tiene permiso para ver quién ha terminado/);
  });

  it('un curso sin alumnos: 0 activos y 0 que nunca entraron, no «no se sabe»', async () => {
    montar({}, 0);
    const r = await T('moodle_alumnos').ejecutar(admin(), { curso_id: 11 });
    expect(r.cursos[0]).toMatchObject({ matriculados: 0, activos_ultimos_30_dias: 0, nunca_han_entrado: 0, terminados: 0 });
  });
});

describe('moodle_estructura de un curso', () => {
  beforeEach(() => {
    configurar(10, ISEIE);
    configurar(20, FONO);
    moodle(ISEIE, {
      core_course_get_courses_by_field: listaCursos(),
      core_course_get_contents: ({ courseid }) => (courseid !== 11 ? [] : [
        { id: 1, section: 0, name: '', visible: 1, modules: [{ id: 5, name: 'Bienvenida', modname: 'forum', visible: 1 }] },
        { id: 2, section: 1, name: 'Módulo 1', visible: 1, modules: [
          { id: 6, name: 'Tarea 1', modname: 'assign', visible: 1, contents: [{ fileurl: 'https://campus.iseie.test/pluginfile.php/x?token=SECRETO' }] },
          { id: 7, name: 'Apuntes', modname: 'resource', visible: 0 },
        ] },
        { id: 3, section: 2, name: 'Módulo 2', visible: 0, modules: [] },
      ]),
    });
  });
  const admin = () => ambitoDe('admin', [PROYECTOS[0]]);

  it('con curso_id, las secciones y las actividades de cada una', async () => {
    const r = await T('moodle_estructura').ejecutar(admin(), { curso_id: 11 });
    const c = r.campus[0];
    expect(c.curso).toMatchObject({ curso_id: 11, nombre: 'Máster en Psicología Clínica', visible: true });
    expect(c).toMatchObject({ total_secciones: 3, total_actividades: 3, por_tipo: { forum: 1, assign: 1, resource: 1 } });
    expect(c.secciones[0]).toMatchObject({ numero: 0, nombre: 'General', total_actividades: 1 });
    expect(c.secciones[1].actividades).toEqual([
      { nombre: 'Tarea 1', tipo: 'assign', visible: true },
      { nombre: 'Apuntes', tipo: 'resource', visible: false },
    ]);
    expect(c.secciones[2]).toMatchObject({ nombre: 'Módulo 2', visible: false, total_actividades: 0 });
  });

  it('no sale ni una direccion de fichero ni nada del contenido', async () => {
    const r = await T('moodle_estructura').ejecutar(admin(), { curso_id: 11 });
    expect(JSON.stringify(r)).not.toMatch(/pluginfile|SECRETO|fileurl/);
  });

  it('un curso que no existe es un error por campus; con varios campus pide proyecto_id', async () => {
    await expect(T('moodle_estructura').ejecutar(admin(), { curso_id: 999 })).rejects.toThrow(/curso 999 no existe/);
    await expect(T('moodle_estructura').ejecutar(ambitoDe('admin', [PROYECTOS[0], PROYECTOS[1]]), { curso_id: 11 }))
      .rejects.toMatchObject({ code: 'MCP_FALTA_CAMPUS' });
  });

  it('sin curso_id sigue dando las categorias', async () => {
    moodle(ISEIE, { core_course_get_categories: () => CATEGORIAS });
    const r = await T('moodle_estructura').ejecutar(admin(), {});
    expect(r.campus[0].total_categorias).toBe(3);
  });
});
