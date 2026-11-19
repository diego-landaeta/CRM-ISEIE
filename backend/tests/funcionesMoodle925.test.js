import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * CRM#925 · «Probar conexión» y «Comprobar ahora» dicen QUÉ funciones faltan.
 *
 * Antes solo miraban dos funciones (seis con «Leer las consultas»): un campus
 * cuyo servicio no tenía las de «Mi campus» salía en verde y la pantalla de la
 * tutora quedaba vacía. Ahora se miran las 12 que usa el CRM, por grupo (base,
 * Mi campus, Consultas, notas y avisos) y «Puede descargar archivos».
 *
 * Moodle simulado (un `fetch` de pega que contesta como Moodle) y, para la salud
 * de las conexiones, la base simulada como en `saludConexiones533.test.js`.
 *
 *   npx vitest run tests/funcionesMoodle925.test.js
 */

const base = vi.hoisted(() => ({ campus: [], integraciones: [], comprobaciones: [], tarjetas: [], fundidas: [] }));

vi.mock('../src/modules/integrations/salud.model.js', () => ({
  existeTabla: async () => true,
  campus: async (ids) => base.campus.filter((c) => ids.includes(c.id)),
  integraciones: async (ids) => base.integraciones.filter((i) => ids.includes(i.project_id)),
  credenciales: async () => [],
  stripe: async () => [],
  recepciones: async () => [],
  comprobaciones: async (ids) => base.comprobaciones.filter((x) => ids.includes(x.project_id)),
  guardarComprobacion: async (fila) => {
    const ahora = new Date().toISOString();
    base.comprobaciones = [
      ...base.comprobaciones.filter((x) => !(x.project_id === fila.projectId && x.conexion === fila.conexion)),
      { project_id: fila.projectId, conexion: fila.conexion, ok: fila.ok, mensaje: fila.mensaje, comprobado_at: ahora, ultimo_ok_at: fila.ok ? ahora : null },
    ];
  },
  pluginMoodle: async () => [],
  wooCommerce: async () => [],
  credencialesWoo: async () => null,
  meta: async () => [],
  correosDelCrm: async () => ({}),
  admision: async () => [],
  transferencias: async () => [],
}));

vi.mock('../src/modules/integrations/integrations.model.js', () => ({
  recordTestResult: async (fila) => {
    base.tarjetas.push(fila);
    const i = base.integraciones.find((x) => x.project_id === fila.projectId && x.provider === fila.provider);
    if (i) Object.assign(i, { last_test_status: fila.status, last_test_message: fila.message, last_test_at: new Date().toISOString() });
  },
  fundirConfigPublica: async ({ projectId, provider, campos }) => {
    base.fundidas.push({ projectId, provider, campos });
    const i = base.integraciones.find((x) => x.project_id === projectId && x.provider === provider);
    if (i) i.config_public = { ...(i.config_public || {}), ...campos };
  },
}));

const { encrypt } = await import('../src/shared/utils/crypto.js');
const M = await import('../src/shared/services/moodle.client.js');
const { testMoodle } = await import('../src/modules/integrations/integrations.controller.js');
const S = await import('../src/modules/integrations/salud.service.js');

const BASE = ['core_webservice_get_site_info', 'core_user_get_users_by_field'];
const MI_CAMPUS = [
  'core_enrol_get_users_courses', 'core_enrol_get_enrolled_users',
  'mod_assign_get_assignments', 'mod_assign_get_submissions', 'mod_assign_get_grades', 'core_course_get_contents',
];
const CONSULTAS = ['core_message_get_conversations', 'core_message_get_conversation_messages'];
const NOTAS = ['gradereport_user_get_grade_items', 'core_course_get_courses_by_field'];
const LAS_12 = [...BASE, ...MI_CAMPUS, ...CONSULTAS, ...NOTAS];

/** Un Moodle de pega: `core_webservice_get_site_info` con esas funciones y ese «Puede descargar archivos». */
function moodle({ funciones = LAS_12, descargas = 1 } = {}) {
  return vi.fn(async (_url, { body }) => {
    const p = new URLSearchParams(body);
    const json = (datos) => ({ ok: true, status: 200, json: async () => datos });
    if (p.get('wsfunction') === 'core_webservice_get_site_info') {
      return json({
        sitename: 'Campus FONO', release: '4.5.3', userid: 2,
        functions: funciones.map((name) => ({ name, version: '2024100700' })),
        ...(descargas === undefined ? {} : { downloadfiles: descargas, uploadfiles: 0 }),
      });
    }
    return json({ exception: 'webservice_access_exception', errorcode: 'accessexception', message: 'Access control exception' });
  });
}

describe('#925 · las 12 funciones, por grupo', () => {
  it('la lista: 12, sin repetir, en cuatro grupos', () => {
    const todas = M.GRUPOS_DE_FUNCIONES.flatMap((g) => g.funciones);
    expect(todas).toHaveLength(12);
    expect(new Set(todas).size).toBe(12);
    expect(todas.sort()).toEqual([...LAS_12].sort());
    expect(M.GRUPOS_DE_FUNCIONES.map((g) => g.clave)).toEqual(['base', 'mi_campus', 'consultas', 'notas']);
  });

  it('infoDelCampus dice qué falta de cada grupo y si puede descargar archivos', async () => {
    const info = await M.infoDelCampus({ url: 'campus.es', token: 't' }, { fetchImpl: moodle({ funciones: BASE, descargas: 0 }) });
    const porClave = Object.fromEntries(info.grupos.map((g) => [g.clave, g]));
    expect(porClave.base.faltan).toEqual([]);
    expect(porClave.mi_campus.faltan).toEqual(MI_CAMPUS);
    expect(porClave.consultas.faltan).toEqual(CONSULTAS);
    expect(porClave.notas.faltan).toEqual(NOTAS);
    expect(info.descargas).toBe(false);
  });

  it('un Moodle que no da la lista de funciones: no se sabe (null), no «faltan todas»', async () => {
    const sinLista = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ sitename: 'X', release: '3.9' }) }));
    const info = await M.infoDelCampus({ url: 'campus.es', token: 't' }, { fetchImpl: sinLista });
    expect(info.grupos).toBeNull();
    expect(info.descargas).toBeNull();
    expect(M.faltasDeFunciones({ grupos: info.grupos, descargas: info.descargas })).toEqual([]);
  });
});

describe('#925 · «Probar conexión»', () => {
  it('el caso de la issue: solo las 2 de base → ya no sale «Conexión OK» a secas; dice qué falta de Mi campus y de notas', async () => {
    const r = await testMoodle('t', 'campus.es', { fetchImpl: moodle({ funciones: BASE }) });
    expect(r.ok).toBe(true); // conecta: el token vale
    expect(r.aviso).toBe(true);
    expect(r.message).not.toMatch(/^Conexión OK/);
    expect(r.message).toMatch(/Mi campus: core_enrol_get_users_courses/);
    expect(r.message).toMatch(/mod_assign_get_submissions/);
    expect(r.message).toMatch(/Notas y avisos/);
    // «Leer las consultas» apagado: las de mensajería no se piden.
    expect(r.message).not.toMatch(/core_message_get_conversations/);
    expect(r.funciones.grupos.find((g) => g.clave === 'mi_campus').faltan).toEqual(MI_CAMPUS);
  });

  it('con las 12 y «Puede descargar archivos»: Conexión OK, sin aviso', async () => {
    const r = await testMoodle('t', 'campus.es', { fetchImpl: moodle() });
    expect(r).toMatchObject({ ok: true, message: 'Conexión OK con Campus FONO · Moodle 4.5.3.' });
    expect(r.aviso).toBeUndefined();
  });

  it('las 12 pero sin «Puede descargar archivos»: aviso', async () => {
    const r = await testMoodle('t', 'campus.es', { fetchImpl: moodle({ descargas: 0 }) });
    expect(r).toMatchObject({ ok: true, aviso: true });
    expect(r.message).toMatch(/«Puede descargar archivos» sin marcar/);
  });

  it('con «Leer las consultas» y sin las de mensajería: falla (como antes) y la lista va con ella', async () => {
    const r = await testMoodle('t', 'campus.es', { fetchImpl: moodle({ funciones: [...BASE, ...MI_CAMPUS, ...NOTAS] }) }, { consultas: true });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/core_message_get_conversations, core_message_get_conversation_messages/);
    expect(r.funciones.grupos.find((g) => g.clave === 'consultas').faltan).toEqual(CONSULTAS);
  });

  it('el texto cabe en un motivo (300) aunque falten 10: el grupo más largo pasa a «N funciones»', () => {
    const faltas = M.faltasDeFunciones({
      grupos: M.GRUPOS_DE_FUNCIONES.map((g) => ({ clave: g.clave, titulo: g.titulo, faltan: g.clave === 'base' ? [] : g.funciones })),
      descargas: false,
    }, { consultas: true });
    const t = M.textoDeFaltas(faltas);
    expect(t.length).toBeLessThanOrEqual(300);
    expect(t).toMatch(/Mi campus: 6 funciones/);
    expect(t).toMatch(/«Puede descargar archivos» sin marcar/);
  });
});

describe('#925 · «Comprobar ahora» (salud de las conexiones)', () => {
  const TOKEN = ['tok', 'en', 'moodle', '925'].join('');
  const fila = (extra = {}) => {
    const e = encrypt(TOKEN);
    return { project_id: 2, provider: 'moodle', active: true, encrypted_value: e.encrypted, iv: e.iv, auth_tag: e.authTag, config_public: { url: 'https://fono.example/campus' }, ...extra };
  };

  beforeEach(() => {
    S._internos.reiniciar();
    Object.assign(base, { campus: [{ id: 2, nombre: 'Fono', type: 'crm' }], integraciones: [], comprobaciones: [], tarjetas: [], fundidas: [] });
  });

  it('con «Mi campus» sin funciones: ámbar (no verde) y el motivo dice cuáles; la tarjeta guarda la lista', async () => {
    base.integraciones = [fila()];
    const fetchImpl = moodle({ funciones: [...BASE, ...NOTAS] });
    const probar = { moodle: (clave, config) => testMoodle(clave, config.url, { fetchImpl }, { consultas: config.consultas === true }) };

    await S.comprobarAhora([2], { probar });
    expect(base.tarjetas).toEqual([expect.objectContaining({ projectId: 2, provider: 'moodle', status: 'success' })]);
    expect(base.fundidas[0].campos.funciones.grupos.find((g) => g.clave === 'mi_campus').faltan).toEqual(MI_CAMPUS);

    const r = await S.saludDeLosCampus([2]);
    const c = r.campus[0].casillas.moodle;
    expect(c.estado).toBe('atencion');
    expect(c.resumen).toBe('Conecta, pero faltan funciones (Mi campus)');
    expect(c.motivo).toMatch(/Mi campus: core_enrol_get_users_courses, core_enrol_get_enrolled_users, mod_assign_get_assignments/);
  });

  it('con las 12 y descargas: verde', async () => {
    base.integraciones = [fila()];
    const fetchImpl = moodle();
    await S.comprobarAhora([2], { probar: { moodle: (clave, config) => testMoodle(clave, config.url, { fetchImpl }) } });
    const r = await S.saludDeLosCampus([2]);
    expect(r.campus[0].casillas.moodle.estado).toBe('bien');
  });

  it('una prueba buena anterior al cambio (sin lista guardada) sigue en verde: no se inventa lo que no se sabe', () => {
    const integ = fila({ last_test_status: 'success', last_test_message: 'Conexión OK con FONO.', last_test_at: new Date().toISOString() });
    expect(S.evaluarMoodle({ integ, descifrable: true }).estado).toBe('bien');
  });

  it('las de Consultas solo cuentan con «Leer las consultas» encendido', () => {
    const funciones = { grupos: [{ clave: 'consultas', titulo: 'Consultas', faltan: CONSULTAS }], descargas: true };
    const integ = (consultas) => fila({ config_public: { url: 'x', consultas, funciones }, last_test_status: 'success', last_test_at: new Date().toISOString() });
    expect(S.evaluarMoodle({ integ: integ(false), descifrable: true }).estado).toBe('bien');
    expect(S.evaluarMoodle({ integ: integ(true), descifrable: true }).estado).toBe('atencion');
  });
});
