import {
  describe, it, expect, vi, afterEach, beforeEach,
} from 'vitest';
import express from 'express';
import supertest from 'supertest';

/**
 * El plugin del CRM en Moodle, solo en pruebas también en el servidor (revisión de la
 * PR #689, punto 1). Igual que los proyectos IA y las facturas de colaborador: con
 * NODE_ENV=production y sin PLUGIN_MOODLE_EN_PRODUCCION=1,
 *   · las rutas del plugin en /api/consultas no se montan (404);
 *   · nada escribe en un campus: ni el código de conexión, ni la disponibilidad, ni el
 *     repaso, ni la respuesta por el plugin (sale con el token de la tutora, como antes).
 * En /staging, en local y con la variable, todo encendido. La variable de otro no lo enciende.
 *
 * Y el punto 8d: la API pública que va dentro del código de conexión conserva la ruta de
 * CRM_BASE_URL (desde /staging, /staging/api), y /staging nunca da un código que apunte a otra.
 *
 * Sin base: `query` es de mentira y dice qué se habría tocado; el campus, también.
 */

const llamadas = [];
const query = vi.fn(async (sql) => {
  llamadas.push(String(sql));
  if (/FROM moodle_plugin_campus/.test(sql)) return { rows: [{ ok: 1 }], rowCount: 1 };
  if (/SELECT moodle_user_id FROM tutor_campus/.test(sql)) return { rows: [{ moodle_user_id: 701 }], rowCount: 1 };
  if (/token_cifrado/.test(sql)) {
    const { encrypt } = await import('../src/shared/utils/crypto.js');
    const e = encrypt('token-de-la-tutora');
    return { rows: [{ token_cifrado: e.encrypted, token_iv: e.iv, token_tag: e.authTag }], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
});
vi.mock('../src/shared/config/db.js', () => ({
  query,
  getClient: vi.fn(async () => ({ query, release: () => {} })),
}));
vi.mock('../src/modules/tutores/tutor.campus.js', async (importOriginal) => ({
  ...(await importOriginal()),
  conexionDelCampus: vi.fn(async () => ({ url: 'https://campus.test', token: 'token-del-campus' })),
}));
vi.mock('../src/shared/middleware/auth.js', async (importOriginal) => ({
  ...(await importOriginal()),
  verifyToken: (req, _res, next) => { req.user = { userId: 1, role: 'superadmin' }; next(); },
}));
vi.mock('../src/shared/middleware/permissions.js', async (importOriginal) => ({
  ...(await importOriginal()),
  puede: () => (_req, _res, next) => next(),
}));
// Todos los del router de consultas: un 200 dice «montada»; un 404, «no montada».
vi.mock('../src/modules/consultas/consultas.controller.js', () => {
  const ok = (req, res) => res.json({ success: true, ruta: req.path });
  return Object.fromEntries([
    'adjunto', 'adjuntoPublico', 'alumnosSinMensajes', 'campusSinTutor', 'cerrar', 'codigoDeConexion',
    'desactivarPlugin', 'escribirAlAlumno', 'estadoDelPlugin', 'guardarMiCarga', 'guardarToken', 'leerAhora',
    'miCarga', 'mias', 'panel', 'panelDeTutores', 'reasignar', 'reintentar', 'responder',
    'sincronizarAlumnosAhora', 'tokensDelTutor', 'tutoresPosibles', 'ver', 'verMetricas',
    // Notas internas, respuestas guardadas y la ficha del alumno (#679, parte 3).
    'anotar', 'respuestas', 'crearRespuesta', 'cambiarRespuesta', 'borrarRespuesta', 'importarRespuestas', 'contexto',
  ].map((n) => [n, ok]));
});

/** Lo que el CRM ha pedido al campus (wsfunction). */
const alCampus = [];
vi.stubGlobal('fetch', vi.fn(async (_url, { body } = {}) => {
  const f = new URLSearchParams(body).get('wsfunction');
  alCampus.push(f);
  const r = f === 'core_message_send_instant_messages'
    ? [{ msgid: 5, conversationid: 9 }]
    : f === 'local_crm_enviar_mensaje' ? { id: 6, conversacion_id: 9 } : {};
  return { ok: true, status: 200, json: async () => r };
}));

const { pluginMoodleActivo, facturasColaboradorActivas } = await import('../src/shared/config/soloEnPruebas.js');

const PRODUCCION = { NODE_ENV: 'production', CRM_BASE_URL: 'https://crm.iseie.com' };
const TESTEO = { NODE_ENV: 'production', CRM_BASE_URL: 'https://crm.iseie.com/staging' };
const APROBADO = { ...PRODUCCION, PLUGIN_MOODLE_EN_PRODUCCION: '1' };

function entorno(env) {
  for (const k of ['API_PUBLIC_BASE_URL', 'PLUGIN_MOODLE_EN_PRODUCCION']) vi.stubEnv(k, '');
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
}

beforeEach(() => { llamadas.length = 0; alCampus.length = 0; query.mockClear(); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('el interruptor PLUGIN_MOODLE_EN_PRODUCCION', () => {
  it('en producción no, salvo aprobado; en /staging y en local, sí; el de otro no lo enciende', () => {
    expect(pluginMoodleActivo({ NODE_ENV: 'production' })).toBe(false);
    expect(pluginMoodleActivo(PRODUCCION)).toBe(false);
    expect(pluginMoodleActivo(TESTEO)).toBe(true);
    expect(pluginMoodleActivo(APROBADO)).toBe(true);
    expect(pluginMoodleActivo({ NODE_ENV: 'development' })).toBe(true);
    expect(pluginMoodleActivo({ NODE_ENV: 'test' })).toBe(true);
    // Cada interruptor es suyo.
    expect(pluginMoodleActivo({ ...PRODUCCION, FACTURAS_COLABORADOR_EN_PRODUCCION: '1' })).toBe(false);
    expect(pluginMoodleActivo({ ...PRODUCCION, PLUGIN_MOODLE_EN_PRODUCCION: 'true' })).toBe(false);
    expect(facturasColaboradorActivas(APROBADO)).toBe(false);
  });
});

/** El router de consultas cargado con el entorno que se le pase. */
async function apiConsultas(env) {
  vi.resetModules();
  entorno(env);
  const { default: mod } = await import('../src/modules/consultas/index.js');
  const app = express();
  app.use(mod.prefix, mod.router);
  return supertest(app);
}

const DEL_PLUGIN = [
  ['get', '/api/consultas/campus/4/plugin'],
  ['post', '/api/consultas/campus/4/plugin/codigo'],
  ['delete', '/api/consultas/campus/4/plugin'],
];

describe('/api/consultas: las rutas del plugin', () => {
  it('en producción sin la variable no están montadas (404); el resto de consultas, sí', async () => {
    const api = await apiConsultas(PRODUCCION);
    for (const [m, ruta] of DEL_PLUGIN) expect((await api[m](ruta)).status, ruta).toBe(404);
    expect((await api.get('/api/consultas/mias')).status).toBe(200);
  });

  it('con la variable, en /staging y en local, responden', async () => {
    for (const env of [APROBADO, TESTEO, { NODE_ENV: 'development' }]) {
      const api = await apiConsultas(env);
      for (const [m, ruta] of DEL_PLUGIN) expect((await api[m](ruta)).status, `${env.CRM_BASE_URL || env.NODE_ENV} ${ruta}`).toBe(200);
    }
  });
});

describe('apagado, nada escribe en un campus', () => {
  it('el código de conexión no se da (403) y no se toca la base', async () => {
    entorno(PRODUCCION);
    const plugin = await import('../src/modules/consultas/consultas.plugin.js');
    await expect(plugin.crearCodigo(4, 1)).rejects.toMatchObject({ statusCode: 403, code: 'PLUGIN_APAGADO' });
    expect(query).not.toHaveBeenCalled();
  });

  it('la disponibilidad y el repaso no llaman a ningún campus', async () => {
    entorno(PRODUCCION);
    const plugin = await import('../src/modules/consultas/consultas.plugin.js');
    expect(await plugin.avisarDisponibilidad()).toEqual([]);
    const procesar = vi.fn();
    expect(await plugin.sincronizarCampus(4, { procesar })).toMatchObject({ projectId: 4, omitido: expect.stringMatching(/apagado/) });
    expect(query).not.toHaveBeenCalled();
    expect(alCampus).toEqual([]);
    expect(procesar).not.toHaveBeenCalled();
  });

  it('enviarComoTutor se niega sin llamar al campus (APAGADO)', async () => {
    entorno(PRODUCCION);
    const { enviarComoTutor } = await import('../src/shared/services/moodle.client.js');
    await expect(enviarComoTutor({ url: 'https://campus.test', token: 't' }, 701, 900, 'Hola'))
      .rejects.toMatchObject({ codigo: 'APAGADO' });
    expect(alCampus).toEqual([]);
  });

  it('la respuesta de la tutora sale con SU token, como antes, aunque el campus tenga el plugin conectado', async () => {
    entorno(PRODUCCION);
    const { enviarAlCampus } = await import('../src/modules/consultas/consultas.service.js');
    const r = await enviarAlCampus({ id: 1, texto: 'Hola' }, { project_id: 4, tutor_id: 2, alumno_moodle_id: 900, conversacion_grupo_id: 77 });
    expect(r).toMatchObject({ enviado: true, error: null });
    expect(alCampus).toEqual(['core_message_send_instant_messages']);
    // Ni siquiera se ha preguntado si el campus tiene el plugin.
    expect(llamadas.some((s) => /FROM moodle_plugin_campus/.test(s))).toBe(false);
  });

  it('encendido (aprobado), la misma respuesta sale por el plugin, al chat de grupo', async () => {
    entorno(APROBADO);
    const { enviarAlCampus } = await import('../src/modules/consultas/consultas.service.js');
    const r = await enviarAlCampus({ id: 1, texto: 'Hola' }, { project_id: 4, tutor_id: 2, alumno_moodle_id: 900, conversacion_grupo_id: 77 });
    expect(r).toMatchObject({ enviado: true, error: null });
    expect(alCampus).toEqual(['local_crm_enviar_mensaje']);
  });
});

describe('8d · la API pública del código de conexión: /staging nunca apunta a producción', () => {
  it('conserva la ruta de CRM_BASE_URL', async () => {
    const { apiPublica } = await import('../src/modules/consultas/consultas.plugin.js');
    expect(apiPublica({ CRM_BASE_URL: 'https://crm.iseie.com/staging' })).toBe('https://crm.iseie.com/staging/api');
    expect(apiPublica({ CRM_BASE_URL: 'https://crm.iseie.com/staging/' })).toBe('https://crm.iseie.com/staging/api');
    expect(apiPublica({ CRM_BASE_URL: 'https://crm.iseie.com' })).toBe('https://crm.iseie.com/api');
    expect(apiPublica({ CRM_BASE_URL: 'https://crm.iseie.com' })).toBe('https://crm.iseie.com/api');
    // API_PUBLIC_BASE_URL sigue mandando si está.
    expect(apiPublica({ CRM_BASE_URL: 'https://crm.iseie.com/staging', API_PUBLIC_BASE_URL: 'https://otro.test/api/' })).toBe('https://otro.test/api');
    expect(apiPublica({ CRM_BASE_URL: 'https://crm.iseie.com/staging' })).not.toBe('https://crm.iseie.com/api');
  });

  it('desde /staging, el código lleva la API de /staging', async () => {
    entorno(TESTEO);
    const { crearCodigo } = await import('../src/modules/consultas/consultas.plugin.js');
    const { codigo } = await crearCodigo(4, 1);
    const dentro = JSON.parse(Buffer.from(codigo.replace(/^crm1\./, ''), 'base64url').toString('utf8'));
    expect(dentro.crm).toBe('https://crm.iseie.com/staging/api');
  });

  it('desde /staging con una API_PUBLIC_BASE_URL de otro CRM, no hay código (409) y no se guarda nada', async () => {
    entorno({ ...TESTEO, API_PUBLIC_BASE_URL: 'https://crm.iseie.com/api' });
    const { crearCodigo } = await import('../src/modules/consultas/consultas.plugin.js');
    await expect(crearCodigo(4, 1)).rejects.toMatchObject({ statusCode: 409, code: 'API_PUBLICA_NO_VALIDA' });
    expect(query).not.toHaveBeenCalled();
  });
});
