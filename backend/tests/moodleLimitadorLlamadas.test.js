import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/*
  El CRM no puede saturar el hosting de los campus (27/11).

  Hostinger admite 20 conexiones nuevas a MySQL por segundo para TODA la cuenta de CEDIA
  (nueve Moodle y sesenta webs) y rechaza las de más: el Moodle contesta
  «Database connection failed» también a quien está dentro del campus. En la vuelta de las
  15:00 el CRM llamó a siete campus a la vez a 15-19 llamadas por segundo, porque cada tarea
  se frenaba a sí misma pero nadie frenaba a todas juntas, y las tareas de 5, 15, 60 y 120
  minutos caían en el mismo segundo.

  Aquí, un Moodle simulado que apunta cuándo empieza cada llamada:
    · tres tareas a la vez contra siete campus no pasan de MOODLE_LLAMADAS_POR_SEGUNDO ni de
      MOODLE_LLAMADAS_A_LA_VEZ, sumando las dos puertas a Moodle (moodle.client y el MCP);
    · con las dos a 0, como antes: todo sale de golpe;
    · lo que pide una persona pasa delante de lo que piden las tareas;
    · los reintentos esperan 1,5-2 s × intento, y un 5xx o la red solo se repiten si la
      función lee;
    · las tareas de Moodle ya no caen en el mismo segundo.
*/

vi.mock('../src/shared/config/db.js', () => ({ query: vi.fn(async () => ({ rows: [] })), getClient: vi.fn() }));

const LATENCIA_MS = 120;
const CAMPUS = ['iseih', 'psiko', 'fono', 'ictess', 'isaeg', 'isslogg', 'isecd'].map((c) => `https://${c}.test/campus`);

/** Un Moodle de mentira: cuenta cuándo empieza cada llamada y cuántas hay en curso. */
function moodleSimulado() {
  const salidas = [];
  let enCurso = 0;
  let maxEnCurso = 0;
  const responder = async (url, { body } = {}) => {
    salidas.push({ t: Date.now(), funcion: new URLSearchParams(body).get('wsfunction') });
    enCurso += 1; maxEnCurso = Math.max(maxEnCurso, enCurso);
    await new Promise((r) => { setTimeout(r, LATENCIA_MS); });
    enCurso -= 1;
    const datos = { courses: [], sitename: 'campus' };
    return { ok: true, status: 200, json: async () => datos, text: async () => JSON.stringify(datos) };
  };
  return { responder, salidas, get maxEnCurso() { return maxEnCurso; } };
}

/** Lo más que empieza en cualquier ventana de un segundo. */
function maxPorSegundo(salidas) {
  const ts = salidas.map((s) => s.t).sort((a, b) => a - b);
  let max = 0;
  for (let i = 0, j = 0; i < ts.length; i++) {
    while (ts[i] - ts[j] >= 1000) j++;
    max = Math.max(max, i - j + 1);
  }
  return max;
}

async function cargar() {
  vi.resetModules();
  const cliente = await import('../src/shared/services/moodle.client.js');
  const mcp = await import('../src/modules/mcp/mcp.moodle.cliente.js');
  return { llamar: cliente.llamar, llamarMoodle: mcp.llamarMoodle };
}

/** Tres tareas a la vez; cada una pasa por los siete campus, con sus dos llamadas a la vez. */
async function tresTareasContraSieteCampus({ llamar, llamarMoodle }, fetchImpl) {
  const tarea = () => Promise.all(CAMPUS.map(async (url) => {
    await llamar({ url, token: 't' }, 'core_webservice_get_site_info', {}, { fetchImpl });
    await llamarMoodle({ url, token: 't' }, 'core_course_get_courses_by_field', {});
  }));
  const todo = Promise.all([tarea(), tarea(), tarea()]);
  await vi.advanceTimersByTimeAsync(60_000);
  await todo;
}

// performance también: el freno mide el ritmo con performance.now().
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'Date', 'performance'] }); });
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('un freno común para todas las llamadas a Moodle', () => {
  it('tres tareas contra siete campus no pasan de 4 por segundo ni de 2 a la vez', async () => {
    vi.stubEnv('MOODLE_LLAMADAS_POR_SEGUNDO', '4');
    vi.stubEnv('MOODLE_LLAMADAS_A_LA_VEZ', '2');
    const m = moodleSimulado();
    vi.stubGlobal('fetch', vi.fn(m.responder));
    await tresTareasContraSieteCampus(await cargar(), m.responder);

    expect(m.salidas).toHaveLength(3 * 7 * 2);
    expect(maxPorSegundo(m.salidas)).toBeLessThanOrEqual(4);
    expect(m.maxEnCurso).toBeLessThanOrEqual(2);
  });

  it('el ritmo se lee del .env: con 10 por segundo y 3 a la vez, eso', async () => {
    vi.stubEnv('MOODLE_LLAMADAS_POR_SEGUNDO', '10');
    vi.stubEnv('MOODLE_LLAMADAS_A_LA_VEZ', '3');
    const m = moodleSimulado();
    vi.stubGlobal('fetch', vi.fn(m.responder));
    await tresTareasContraSieteCampus(await cargar(), m.responder);

    expect(maxPorSegundo(m.salidas)).toBeLessThanOrEqual(10);
    expect(m.maxEnCurso).toBeLessThanOrEqual(3);
    expect(m.maxEnCurso).toBeGreaterThan(1);
  });

  it('con las dos a 0, como antes: las 21 primeras salen de golpe', async () => {
    vi.stubEnv('MOODLE_LLAMADAS_POR_SEGUNDO', '0');
    vi.stubEnv('MOODLE_LLAMADAS_A_LA_VEZ', '0');
    const m = moodleSimulado();
    vi.stubGlobal('fetch', vi.fn(m.responder));
    const inicio = Date.now();
    await tresTareasContraSieteCampus(await cargar(), m.responder);

    expect(m.salidas).toHaveLength(42);
    expect(m.maxEnCurso).toBe(21);
    expect(m.salidas.filter((s) => s.t === inicio)).toHaveLength(21);
  });

  it('lo que pide una persona pasa delante de lo que piden las tareas', async () => {
    vi.stubEnv('MOODLE_LLAMADAS_POR_SEGUNDO', '4');
    vi.stubEnv('MOODLE_LLAMADAS_A_LA_VEZ', '2');
    const m = moodleSimulado();
    const { llamar } = await cargar();
    const { enSegundoPlano } = await import('../src/shared/services/moodle.limitador.js');
    const conexion = { url: CAMPUS[0], token: 't' };

    // Una tarea programada con 20 llamadas en cola…
    const fondo = enSegundoPlano(() => Promise.all(Array.from({ length: 20 }, () => llamar(conexion, 'core_enrol_get_enrolled_users', {}, { fetchImpl: m.responder }))));
    await vi.advanceTimersByTimeAsync(10);
    // …y una tutora que pulsa «Actualizar» en Mi campus.
    const persona = llamar(conexion, 'core_webservice_get_site_info', {}, { fetchImpl: m.responder });
    await vi.advanceTimersByTimeAsync(20_000);
    await Promise.all([fondo, persona]);

    const turno = m.salidas.findIndex((s) => s.funcion === 'core_webservice_get_site_info');
    expect(turno).toBeGreaterThanOrEqual(0);
    expect(turno).toBeLessThanOrEqual(2); // detrás solo de lo que ya había salido
  });

  it('quien se cansa de esperar (el tope del MCP) sale de la cola sin llamar', async () => {
    vi.stubEnv('MOODLE_LLAMADAS_POR_SEGUNDO', '1');
    vi.stubEnv('MOODLE_LLAMADAS_A_LA_VEZ', '1');
    const m = moodleSimulado();
    vi.stubGlobal('fetch', vi.fn(m.responder));
    const { llamarMoodle } = await cargar();
    const conexion = { url: CAMPUS[0], token: 't' };
    const primera = llamarMoodle(conexion, 'core_course_get_categories', {});
    const control = new AbortController();
    const segunda = llamarMoodle(conexion, 'core_course_get_categories', {}, { signal: control.signal }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(50);
    control.abort(new Error('tope'));
    await vi.advanceTimersByTimeAsync(5_000);
    await primera;
    expect((await segunda).message).toBe('tope');
    expect(m.salidas).toHaveLength(1);
  });
});

describe('los reintentos esperan lo bastante para que el hosting respire', () => {
  const BD_LLENA = { exception: 'dml_connection_exception', errorcode: 'dbconnectionfailed', message: 'Database connection failed' };
  const respuesta = (datos, status = 200) => ({ ok: status < 400, status, json: async () => datos });
  const conexion = { url: CAMPUS[1], token: 't' };

  async function esperasCon(azar, fetchImpl, funcion = 'core_enrol_get_enrolled_users') {
    vi.stubEnv('MOODLE_LLAMADAS_POR_SEGUNDO', '0');
    vi.stubEnv('MOODLE_LLAMADAS_A_LA_VEZ', '0');
    delete process.env.MOODLE_REINTENTO_MS; // el valor de serie
    vi.spyOn(Math, 'random').mockReturnValue(azar);
    const { llamar } = await cargar();
    const esperas = [];
    const err = await llamar(conexion, funcion, {}, { fetchImpl, esperarImpl: async (ms) => { esperas.push(ms); } }).catch((e) => e);
    return { esperas, err };
  }

  for (const [caso, fetchImpl] of [
    ['«Database connection failed»', async () => respuesta(BD_LLENA)],
    ['un 503 del hosting', async () => respuesta('<html>', 503)],
    ['la conexión cortada', async () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }); }],
  ]) {
    it(`${caso}: 1,5-2 s × intento, con azar`, async () => {
      const bajo = await esperasCon(0, fetchImpl);
      expect(bajo.esperas).toEqual([1500, 3000, 4500]);
      const alto = await esperasCon(0.999, fetchImpl);
      expect(alto.esperas).toHaveLength(3);
      alto.esperas.forEach((ms, i) => {
        expect(ms).toBeGreaterThan(1500 * (i + 1));
        expect(ms).toBeLessThanOrEqual(2000 * (i + 1));
      });
    });
  }

  it('un 503 en una función que escribe no se repite: puede haber escrito', async () => {
    let n = 0;
    const { esperas, err } = await esperasCon(0, async () => { n += 1; return respuesta('<html>', 503); }, 'local_crm_matricular');
    expect(err.codigo).toBe('HTTP');
    expect(n).toBe(1);
    expect(esperas).toEqual([]);
  });

  it('una dirección que no existe no se repite: daría lo mismo', async () => {
    let n = 0;
    const { esperas, err } = await esperasCon(0, async () => { n += 1; throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }); });
    expect(err.codigo).toBe('SIN_RED');
    expect(n).toBe(1);
    expect(esperas).toEqual([]);
  });

  it('«Database connection failed» se repite también al escribir: Moodle no llegó a hacer nada', async () => {
    let n = 0;
    const { esperas } = await esperasCon(0, async () => { n += 1; return respuesta(n < 2 ? BD_LLENA : { ok: 1 }); }, 'local_crm_matricular');
    expect(n).toBe(2);
    expect(esperas).toEqual([1500]);
  });
});

describe('las tareas de Moodle no caen en el mismo segundo', () => {
  // Las que llaman a Moodle, con su intervalo de serie.
  const TAREAS = [
    ['consultas_campus', 5], ['moodle_sincronizacion', 15], ['tutores_campus', 60],
    ['matricula_moodle', 60], ['cursos_pendientes', 60], ['entregas_sin_corregir', 120], ['moodle_avisos', 180],
  ];

  async function programar() {
    vi.resetModules();
    const { vigilar, _internos } = await import('../src/jobs/latido.js');
    _internos?.tareas?.clear?.();
    const vueltas = [];
    const relojes = TAREAS.map(([nombre, min]) => vigilar(nombre, nombre, async () => { vueltas.push({ nombre, t: Date.now() }); }, min * 60_000));
    return { vueltas, relojes };
  }

  it('a las 6 h del arranque, donde coinciden todas, cada una en su segundo', async () => {
    const inicio = Date.now();
    const { vueltas, relojes } = await programar();
    await vi.advanceTimersByTimeAsync(6 * 60 * 60_000 + 11 * 60_000);
    relojes.forEach(clearInterval);

    // La vuelta de cada tarea más cercana a las 6 h justas.
    const seis = inicio + 6 * 60 * 60_000;
    const segundos = TAREAS.map(([nombre]) => {
      const suyas = vueltas.filter((v) => v.nombre === nombre && v.t >= seis);
      return Math.floor((suyas[0].t - inicio) / 1000);
    });
    expect(new Set(segundos).size).toBe(TAREAS.length);
  });

  it('el desfase es fijo (sale del nombre) y no pasa de 10 minutos ni de medio intervalo', async () => {
    const inicioA = Date.now();
    const a = await programar();
    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000 + 11 * 60_000);
    a.relojes.forEach(clearInterval);
    const b = await programar();
    const inicioB = Date.now();
    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000 + 11 * 60_000);
    b.relojes.forEach(clearInterval);

    for (const [nombre, min] of TAREAS) {
      const cada = min * 60_000;
      const primera = b.vueltas.find((v) => v.nombre === nombre).t - inicioB;
      expect(primera).toBeGreaterThanOrEqual(cada);
      expect(primera).toBeLessThan(cada + Math.min(cada / 2, 10 * 60_000));
      const [x, y] = b.vueltas.filter((v) => v.nombre === nombre);
      if (y) expect(y.t - x.t).toBe(cada); // la frecuencia no cambia
    }
    const desfases = (vs, desde) => TAREAS.map(([n, min]) => (vs.find((v) => v.nombre === n).t - desde) - min * 60_000);
    expect(desfases(b.vueltas, inicioB)).toEqual(desfases(a.vueltas, inicioA));
  });
});

/*
  Tras el QA de código (27/11):
    1. el reloj de 10 s cubre también la lectura del cuerpo: un campus que manda cabeceras y
       deja el cuerpo a medias no se queda con un hueco del freno;
    2. el turno caduca (una persona no espera más de MOODLE_ESPERA_TURNO_MS, 30 s) y una
       petición HTTP que se cierra saca de la cola sus llamadas;
    4. el ritmo se mide con performance.now() (no lo mueve un cambio de hora del reloj);
    5. muchas llamadas con la misma signal no avisan de «MaxListenersExceededWarning»;
    6. la descarga de archivos (pluginfile.php) también pasa por el freno.
*/
describe('tras el QA: nada se queda con un hueco ni espera para siempre', () => {
  /** Un Moodle que manda cabeceras y no termina el cuerpo hasta que le cortan. */
  const cuerpoAMedias = (salidas) => async (url, { signal } = {}) => {
    salidas.push(Date.now());
    return {
      ok: true,
      status: 200,
      json: () => new Promise((_, rechazar) => {
        signal?.addEventListener('abort', () => rechazar(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })));
      }),
    };
  };
  const rapido = (salidas) => async () => { salidas.push(Date.now()); return { ok: true, status: 200, json: async () => ({ sitename: 'x' }) }; };

  it('un campus que deja el cuerpo a medias suelta el hueco a los 10 s (MOODLE_TIMEOUT_MS)', async () => {
    vi.stubEnv('MOODLE_LLAMADAS_POR_SEGUNDO', '0');
    vi.stubEnv('MOODLE_LLAMADAS_A_LA_VEZ', '1');
    const { llamar } = await cargar();
    const salidas = [];
    const inicio = Date.now();
    const colgada = llamar({ url: CAMPUS[0], token: 't' }, 'core_enrol_get_enrolled_users', {}, { fetchImpl: cuerpoAMedias(salidas) }).catch((e) => e);
    const siguiente = llamar({ url: CAMPUS[1], token: 't' }, 'core_webservice_get_site_info', {}, { fetchImpl: rapido(salidas) }).catch((e) => e);
    await vi.advanceTimersByTimeAsync(10_500);
    const err = await colgada;
    expect(err.codigo).toBe('TIEMPO');
    await expect(siguiente).resolves.toEqual({ sitename: 'x' });
    expect(salidas).toHaveLength(2);
    expect(salidas[1] - inicio).toBeGreaterThanOrEqual(10_000);
    expect(salidas[1] - inicio).toBeLessThan(10_500);
  });

  it('una persona no espera turno más de 30 s: «campus ocupado»', async () => {
    vi.stubEnv('MOODLE_LLAMADAS_POR_SEGUNDO', '0');
    vi.stubEnv('MOODLE_LLAMADAS_A_LA_VEZ', '1');
    vi.stubEnv('MOODLE_TIMEOUT_MS', '120000'); // la primera ocupa el hueco 2 minutos
    const { llamar } = await cargar();
    const salidas = [];
    const inicio = Date.now();
    const larga = llamar({ url: CAMPUS[0], token: 't' }, 'core_enrol_get_enrolled_users', {}, { fetchImpl: cuerpoAMedias(salidas) }).catch((e) => e);
    let cuando = null;
    const persona = llamar({ url: CAMPUS[1], token: 't' }, 'core_webservice_get_site_info', {}, { fetchImpl: rapido(salidas) })
      .catch((e) => { cuando = Date.now() - inicio; return e; });
    await vi.advanceTimersByTimeAsync(31_000);
    expect(cuando).not.toBeNull();
    const err = await persona;
    expect(err.codigo).toBe('OCUPADO');
    expect(err.message).toMatch(/ocupado/i);
    expect(cuando).toBeGreaterThanOrEqual(30_000);
    expect(cuando).toBeLessThan(30_500);
    expect(salidas).toHaveLength(1); // no llegó a llamar
    await vi.advanceTimersByTimeAsync(120_000);
    await larga;
  });

  it('una tarea espera más (no hay nadie delante de la pantalla), pero no para siempre', async () => {
    vi.stubEnv('MOODLE_LLAMADAS_POR_SEGUNDO', '0');
    vi.stubEnv('MOODLE_LLAMADAS_A_LA_VEZ', '1');
    vi.stubEnv('MOODLE_TIMEOUT_MS', '900000');
    const { llamar } = await cargar();
    const { enSegundoPlano } = await import('../src/shared/services/moodle.limitador.js');
    const salidas = [];
    const larga = llamar({ url: CAMPUS[0], token: 't' }, 'core_enrol_get_enrolled_users', {}, { fetchImpl: cuerpoAMedias(salidas) }).catch((e) => e);
    let fallo = null;
    const deFondo = enSegundoPlano(() => llamar({ url: CAMPUS[1], token: 't' }, 'core_webservice_get_site_info', {}, { fetchImpl: rapido(salidas) }))
      .catch((e) => { fallo = e; return e; });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fallo).toBeNull();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fallo).not.toBeNull();
    expect((await deFondo).codigo).toBe('OCUPADO');
    await vi.advanceTimersByTimeAsync(900_000);
    await larga;
  });

  it('si la persona cierra la página, sus llamadas salen de la cola sin llegar al campus', async () => {
    vi.stubEnv('MOODLE_LLAMADAS_POR_SEGUNDO', '0');
    vi.stubEnv('MOODLE_LLAMADAS_A_LA_VEZ', '1');
    const { llamar } = await cargar();
    const { senalDeLaPeticion } = await import('../src/shared/services/moodle.limitador.js');
    const { EventEmitter } = await import('node:events');
    const salidas = [];
    const larga = llamar({ url: CAMPUS[0], token: 't' }, 'core_enrol_get_enrolled_users', {}, { fetchImpl: cuerpoAMedias(salidas) }).catch((e) => e);

    const res = Object.assign(new EventEmitter(), { writableFinished: false });
    let enCola;
    senalDeLaPeticion({}, res, () => {
      enCola = Promise.all([1, 2, 3].map(() => llamar({ url: CAMPUS[1], token: 't' }, 'core_webservice_get_site_info', {}, { fetchImpl: rapido(salidas) }).catch((e) => e)));
    });
    await vi.advanceTimersByTimeAsync(1_000);
    res.emit('close'); // la pestaña se cerró antes de contestar
    await vi.advanceTimersByTimeAsync(20_000);
    const errores = await enCola;
    errores.forEach((e) => expect(e.codigo).toBe('CANCELADA'));
    expect(salidas).toHaveLength(1);
    await larga;
  });

  it('una petición que termina bien no cancela nada', async () => {
    const { senalDeLaPeticion, senalActual } = await import('../src/shared/services/moodle.limitador.js');
    const { EventEmitter } = await import('node:events');
    const res = Object.assign(new EventEmitter(), { writableFinished: true });
    let signal;
    senalDeLaPeticion({}, res, () => { signal = senalActual(); });
    res.emit('close');
    expect(signal).toBeDefined();
    expect(signal.aborted).toBe(false);
  });

  it('el ritmo no lo mueve el reloj del sistema (performance.now, no Date.now)', async () => {
    vi.stubEnv('MOODLE_LLAMADAS_POR_SEGUNDO', '4');
    vi.stubEnv('MOODLE_LLAMADAS_A_LA_VEZ', '0');
    const m = moodleSimulado();
    const { llamar } = await cargar();
    const conexion = { url: CAMPUS[0], token: 't' };
    const primera = llamar(conexion, 'core_webservice_get_site_info', {}, { fetchImpl: m.responder });
    await vi.advanceTimersByTimeAsync(200);
    await primera;
    // El reloj de la máquina salta una hora atrás (NTP, un cambio de hora mal hecho).
    vi.setSystemTime(Date.now() - 60 * 60_000);
    const segunda = llamar(conexion, 'core_webservice_get_site_info', {}, { fetchImpl: m.responder });
    await vi.advanceTimersByTimeAsync(1_000);
    await segunda;
    expect(m.salidas).toHaveLength(2);
  });

  it('cien llamadas en cola con la misma signal (la del MCP) le cuelgan UN oyente, no cien', async () => {
    // Node 24 no avisa con AbortSignal, pero otras versiones sí («MaxListenersExceededWarning:
    // 11 abort listeners added to [AbortSignal]»), y cien oyentes son cien cierres vivos.
    vi.stubEnv('MOODLE_LLAMADAS_POR_SEGUNDO', '0');
    vi.stubEnv('MOODLE_LLAMADAS_A_LA_VEZ', '1');
    const { getEventListeners } = await import('node:events');
    const m = moodleSimulado();
    vi.stubGlobal('fetch', vi.fn(m.responder));
    const { llamarMoodle } = await cargar();
    const control = new AbortController();
    const todas = Promise.all(Array.from({ length: 100 }, () => llamarMoodle({ url: CAMPUS[0], token: 't' }, 'core_course_get_categories', {}, { signal: control.signal })));
    await vi.advanceTimersByTimeAsync(10);
    expect(getEventListeners(control.signal, 'abort').length).toBeLessThanOrEqual(1);
    await vi.advanceTimersByTimeAsync(100 * LATENCIA_MS + 1_000);
    await todas;
    expect(getEventListeners(control.signal, 'abort')).toHaveLength(0); // y al acabar, ninguno
    expect(m.salidas).toHaveLength(100);
  });

  it('ningún fichero llama a la API de Moodle (server.php, pluginfile.php) sin pasar por el freno', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const raiz = fileURLToPath(new URL('../src/', import.meta.url));
    const ficheros = [];
    const recorrer = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) recorrer(p);
        else if (e.name.endsWith('.js')) ficheros.push(p);
      }
    };
    recorrer(raiz);
    const sinFreno = ficheros.filter((f) => {
      const src = fs.readFileSync(f, 'utf8');
      const llamaAMoodle = /fetch(Impl)?\(/.test(src) && /(webservice\/rest\/server\.php|webservice\/pluginfile\.php)/.test(src);
      return llamaAMoodle && !/conTurno\(/.test(src);
    }).map((f) => path.relative(raiz, f).split(path.sep).join('/'));
    expect(sinFreno).toEqual([]);
  });
});

describe('tras el QA: qué se repite es una lista, no un patrón', () => {
  const respuesta = (datos, status = 200) => ({ ok: status < 400, status, json: async () => datos });
  it('local_crm_cuenta y local_crm_mensajes_desde leen: un 503 se repite; local_crm_disponibilidad escribe: no', async () => {
    vi.stubEnv('MOODLE_LLAMADAS_POR_SEGUNDO', '0');
    vi.stubEnv('MOODLE_LLAMADAS_A_LA_VEZ', '0');
    const { llamar } = await cargar();
    const veces = {};
    for (const f of ['local_crm_cuenta', 'local_crm_mensajes_desde', 'local_crm_disponibilidad']) {
      veces[f] = 0;
      await llamar({ url: CAMPUS[2], token: 't' }, f, {}, {
        fetchImpl: async () => { veces[f] += 1; return respuesta('<html>', 503); },
        esperarImpl: async () => {},
      }).catch(() => {});
    }
    expect(veces).toEqual({ local_crm_cuenta: 4, local_crm_mensajes_desde: 4, local_crm_disponibilidad: 1 });
  });
});

/*
  Tras el repaso del QA (27/11): la señal de la petición no puede llegar a lo que se comparte
  ni convertirse en un fallo que no existe.
    A. «Probar conexión» no guarda nada si la llamada no llegó al campus (CANCELADA, OCUPADO);
    B. (moodleAvisos.test.js) ocupado/cancelada no cuentan como «responde bien»;
    C. una matrícula que no llegó al campus no gasta un intento.
  Las lecturas compartidas (salud de las conexiones, Mi campus de administración) se prueban
  en sus ficheros: saludConexiones533.test.js y miCampusAdministracion.test.js.
*/
describe('tras el repaso del QA: lo que no llegó al campus no es un fallo del campus', () => {
  const peticion = async (fn) => {
    const { senalDeLaPeticion } = await import('../src/shared/services/moodle.limitador.js');
    const { EventEmitter } = await import('node:events');
    const res = Object.assign(new EventEmitter(), { writableFinished: false });
    let p;
    senalDeLaPeticion({}, res, () => { p = fn(); });
    return { res, p };
  };

  it('sinPeticion: lo de dentro no hereda la señal de la petición, y va delante', async () => {
    const { sinPeticion, senalActual } = await import('../src/shared/services/moodle.limitador.js');
    let dentro = 'sin mirar';
    const { p } = await peticion(() => sinPeticion(async () => { dentro = senalActual(); }));
    await p;
    expect(dentro).toBeUndefined();
  });

  it('«Probar conexión» con la pestaña cerrada: sin dato, no «error»', async () => {
    vi.stubEnv('MOODLE_LLAMADAS_POR_SEGUNDO', '0');
    vi.stubEnv('MOODLE_LLAMADAS_A_LA_VEZ', '1');
    vi.resetModules();
    const { conTurno } = await import('../src/shared/services/moodle.limitador.js');
    const { testMoodle } = await import('../src/modules/integrations/integrations.controller.js');
    const m = moodleSimulado();
    vi.stubGlobal('fetch', vi.fn(m.responder));
    let soltar;
    const ocupa = conTurno(() => new Promise((r) => { soltar = r; }));
    const { res, p } = await peticion(() => testMoodle('token', CAMPUS[0]));
    await vi.advanceTimersByTimeAsync(10);
    res.emit('close');
    await vi.advanceTimersByTimeAsync(10);
    const r = await p;
    expect(r).toMatchObject({ ok: false, sinDato: true });
    expect(m.salidas).toHaveLength(0);
    soltar();
    await ocupa;
  });

  it('«Probar conexión» con el campus ocupado: sin dato, no «error»', async () => {
    vi.stubEnv('MOODLE_LLAMADAS_POR_SEGUNDO', '0');
    vi.stubEnv('MOODLE_LLAMADAS_A_LA_VEZ', '1');
    vi.stubEnv('MOODLE_ESPERA_TURNO_MS', '1000');
    vi.resetModules();
    const { conTurno } = await import('../src/shared/services/moodle.limitador.js');
    const { testMoodle } = await import('../src/modules/integrations/integrations.controller.js');
    vi.stubGlobal('fetch', vi.fn(moodleSimulado().responder));
    let soltar;
    const ocupa = conTurno(() => new Promise((r) => { soltar = r; }));
    const p = testMoodle('token', CAMPUS[0]);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(await p).toMatchObject({ ok: false, sinDato: true });
    soltar();
    await ocupa;
  });

  it('una matrícula que no llegó al campus (OCUPADO, CANCELADA) se aplaza: ni «lento» ni intento', async () => {
    const { matricularEnMoodle } = await import('../src/modules/matricula-moodle/matricula-moodle.moodle.js');
    const { MoodleError } = await import('../src/shared/services/moodle.client.js');
    const fila = { project_id: 7, alumno_email: 'a@b.test', alumno_nombre: 'Ana Pérez' };
    const cursos = [{ project_id: 7, curso_moodle_id: 501, nombre: 'Curso' }];
    for (const codigo of ['OCUPADO', 'CANCELADA']) {
      const r = await matricularEnMoodle(fila, cursos, {
        conexionImpl: async () => ({ url: CAMPUS[0], token: 't' }),
        llamarImpl: async () => { throw new MoodleError('El campus está ocupado ahora mismo.', codigo); },
      });
      expect(r, codigo).toMatchObject({ hecha: false, aplazar: true });
      expect(r.lento, codigo).toBeUndefined();
    }
  });
});
