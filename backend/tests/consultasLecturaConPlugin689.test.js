import {
  describe, it, expect, beforeAll, afterAll, vi,
} from 'vitest';
import { query } from '../src/shared/config/db.js';
import { encrypt } from '../src/shared/utils/crypto.js';
import * as servicio from '../src/modules/consultas/consultas.service.js';
import {
  sincronizarCampus, campusConPluginAlDia, minutosPluginAlDia,
} from '../src/modules/consultas/consultas.plugin.js';
import { procesarAviso } from '../src/modules/consultas/consultas.avisos.js';

/**
 * 8b de la revisión de la #689: la lectura de cada 5 minutos se salta los campus que el
 * plugin del CRM tiene al día. Antes, cada campus con plugin se leía tres veces: el aviso al
 * momento, el repaso de cada 15 minutos y, además, esta lectura.
 *
 *   · plugin activo y repaso bueno reciente → la lectura de 5 min no lo toca (ni llama a su Moodle);
 *   · sin plugin → se lee como antes;
 *   · plugin desconectado, repaso con error, repaso viejo o nunca hecho → vuelve a leerse;
 *   · plugin apagado en este CRM o repaso apagado → se leen todos;
 *   · y lo que se salta no se pierde: lo recoge el repaso.
 *
 * Contra la base de verdad y con un Moodle de mentira por campus.
 *
 *   npx vitest run tests/consultasLecturaConPlugin689.test.js
 */

const marca = `t689l${Date.now()}`;
const ids = { users: [], projects: [] };
let hayBase = true;
let porQueNo = null;
let mensajeN = 9700000;

// ─── El Moodle de mentira: uno por dirección, y quién ha llamado a cuál ─────────

const moodles = new Map();
const llamadas = [];

const json = (d) => ({ ok: true, status: 200, json: async () => d });

const fetchImpl = vi.fn(async (url, { body } = {}) => {
  const base = String(url).replace(/\/webservice\/rest\/server\.php$/, '');
  const p = new URLSearchParams(body);
  const f = p.get('wsfunction');
  llamadas.push({ base, f });
  const m = moodles.get(base);
  if (!m) return json([]);
  if (f === 'core_message_get_conversations') {
    const uid = Number(p.get('userid'));
    return json({ conversations: uid === m.tutora ? [{ id: m.conversacion, members: [{ id: m.alumno, fullname: `Alumno ${m.alumno}` }] }] : [] });
  }
  if (f === 'core_message_get_conversation_messages') {
    const desde = Number(p.get('timefrom') || 0);
    return json({ messages: m.mensajes.filter((x) => x.timecreated >= desde) });
  }
  if (f === 'core_user_get_users_by_field') return json([{ id: m.alumno, fullname: `Alumno ${m.alumno}`, email: null }]);
  if (f === 'local_crm_mensajes_desde') return json(m.paginas.shift() || { avisos: '[]', hastaid: 0, mas: false, version: '1.10.2' });
  if (f === 'local_crm_disponibilidad') return json({ ok: true });
  return json([]);
});

const llamoA = (campus) => llamadas.some((l) => l.base === campus.url);

// ─── Datos ───────────────────────────────────────────────────────────────────

async function crearUsuario(role) {
  const { rows } = await query(
    `INSERT INTO users (nombre, email, password_hash, role, active) VALUES ($1, $2, 'x', $3, true) RETURNING id`,
    [`${role} ${ids.users.length} ${marca}`, `${role}.${ids.users.length}.${marca}@test.local`, role]);
  ids.users.push(rows[0].id);
  return Number(rows[0].id);
}

/**
 * Un campus con «Leer las consultas» encendido, una tutora vinculada y un mensaje del alumno
 * en su Moodle de mentira. `plugin`: null (sin plugin) o las columnas de moodle_plugin_campus.
 */
async function crearCampus(nombre, plugin = null) {
  const n = ids.projects.length;
  const { rows } = await query(
    `INSERT INTO projects (nombre, slug, webhook_api_key, active) VALUES ($1, $2, $3, true) RETURNING id`,
    [`${nombre} ${marca}`, `${nombre.toLowerCase()}-${marca}-${n}`, `k-${marca}-${n}`]);
  const id = Number(rows[0].id);
  ids.projects.push(id);
  const url = `https://${marca}-${n}.campus.test`;
  const enc = encrypt('token-del-campus');
  await query(
    `INSERT INTO project_integrations (project_id, provider, active, encrypted_value, iv, auth_tag, config_public)
     VALUES ($1, 'moodle', true, $2, $3, $4, $5)`,
    [id, enc.encrypted, enc.iv, enc.authTag, JSON.stringify({ url, consultas: true, consultas_desde: '2026-01-01T00:00:00Z' })]);
  const tutora = await crearUsuario('tutor');
  await query('INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, true)', [tutora, id]);
  await query(`INSERT INTO tutor_campus (tutor_id, project_id, estado, moodle_user_id) VALUES ($1, $2, 'activa', 701)`, [tutora, id]);
  if (plugin) {
    const s = encrypt('secreto-del-plugin');
    await query(
      `INSERT INTO moodle_plugin_campus (project_id, secreto_cifrado, secreto_iv, secreto_tag, activo, sincronizado_at, sincronizacion_error)
       VALUES ($1, $2, $3, $4, $5, NOW() - make_interval(mins => $6::int), $7)`,
      [id, s.encrypted, s.iv, s.authTag, plugin.activo ?? true, plugin.haceMin ?? 0, plugin.error ?? null]);
    if (plugin.nuncaRepasado) await query('UPDATE moodle_plugin_campus SET sincronizado_at = NULL WHERE project_id = $1', [id]);
  }
  mensajeN += 1;
  const m = {
    tutora: 701, alumno: 7000 + n, conversacion: 770000 + n, paginas: [],
    mensajes: [{ id: mensajeN, useridfrom: 7000 + n, text: '<p>No me abre la tarea</p>', timecreated: Math.floor(Date.now() / 1000) - 60 }],
  };
  moodles.set(url, m);
  return { id, url, moodle: m };
}

const consultasDe = async (projectId) =>
  (await query('SELECT COUNT(*)::int AS n FROM consultas WHERE project_id = $1', [projectId])).rows[0].n;

/** Una vuelta de 5 minutos, solo con lo que es de esta prueba. */
async function vuelta(env = process.env) {
  llamadas.length = 0;
  const r = await servicio.leerTodosLosCampus({ env, fetchImpl, avisar: false });
  return new Map(r.filter((x) => ids.projects.includes(x.projectId)).map((x) => [x.projectId, x]));
}

beforeAll(async () => {
  try {
    const t = await query(`SELECT to_regclass('public.consultas') AS a, to_regclass('public.moodle_plugin_campus') AS b`);
    if (!t.rows[0].a || !t.rows[0].b) throw new Error('Falta la migración 245.');
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
  }
});

afterAll(async () => {
  for (const [sql, p] of [
    ['DELETE FROM consultas WHERE project_id = ANY($1::int[])', [ids.projects]],
    ['DELETE FROM moodle_plugin_campus WHERE project_id = ANY($1::int[])', [ids.projects]],
    ['DELETE FROM tutor_campus WHERE tutor_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM project_integrations WHERE project_id = ANY($1::int[])', [ids.projects]],
    ['DELETE FROM activity_log WHERE user_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]],
  ]) {
    try { await query(sql, p); } catch { /* sigue limpiando */ }
  }
});

describe('hay base', () => {
  it('con la migración 245', () => { expect(hayBase, porQueNo || '').toBe(true); });
});

describe('#689 8b · cuánto vale un repaso', () => {
  it('dos repasos y cinco minutos de margen; con un valor raro, el de serie', () => {
    expect(minutosPluginAlDia({})).toBe(35);
    expect(minutosPluginAlDia({ MOODLE_SINCRONIZACION_TICK_MS: '600000' })).toBe(25);
    expect(minutosPluginAlDia({ MOODLE_SINCRONIZACION_TICK_MS: 'cada rato' })).toBe(35);
    expect(minutosPluginAlDia({ MOODLE_SINCRONIZACION_TICK_MS: '-5' })).toBe(35);
  });
});

describe('#689 8b · la lectura de cada 5 minutos se salta los campus con el plugin al día', () => {
  it('con plugin al día no se lee (ni se llama a su Moodle); sin plugin, se lee como antes', async () => {
    if (!hayBase) return;
    const conPlugin = await crearCampus('ConPlugin', { haceMin: 3 });
    const sinPlugin = await crearCampus('SinPlugin');

    const r = await vuelta();
    expect(r.get(conPlugin.id)).toEqual({ projectId: conPlugin.id, omitido: 'plugin' });
    expect(llamoA(conPlugin)).toBe(false);
    expect(await consultasDe(conPlugin.id)).toBe(0);

    expect(r.get(sinPlugin.id)).toMatchObject({ nuevos: 1, consultasNuevas: 1 });
    expect(llamoA(sinPlugin)).toBe(true);
    expect(await consultasDe(sinPlugin.id)).toBe(1);
  });

  it('vuelve a leerse si el plugin está desconectado, el repaso falla, es viejo o no se ha hecho nunca', async () => {
    if (!hayBase) return;
    const casos = {
      desconectado: await crearCampus('Desconectado', { activo: false, haceMin: 1 }),
      conError: await crearCampus('ConError', { haceMin: 1, error: 'No se ha podido repasar el campus: token no válido' }),
      viejo: await crearCampus('Viejo', { haceMin: 120 }),
      nunca: await crearCampus('Nunca', { nuncaRepasado: true }),
    };
    const r = await vuelta();
    for (const [que, c] of Object.entries(casos)) {
      expect(r.get(c.id)?.omitido, que).toBeUndefined();
      expect(r.get(c.id), que).toMatchObject({ nuevos: 1 });
      expect(llamoA(c), que).toBe(true);
    }
  });

  it('justo en el límite: un repaso de hace 34 min aún vale; uno de hace 36, ya no', async () => {
    if (!hayBase) return;
    const vale = await crearCampus('Vale', { haceMin: 34 });
    const yaNo = await crearCampus('YaNo', { haceMin: 36 });
    const alDia = await campusConPluginAlDia();
    expect(alDia.has(vale.id)).toBe(true);
    expect(alDia.has(yaNo.id)).toBe(false);
  });

  it('con el plugin apagado en este CRM, o el repaso apagado, se leen todos', async () => {
    if (!hayBase) return;
    const c = await crearCampus('Interruptores', { haceMin: 2 });
    // Producción sin aprobar el plugin: ni avisos ni repaso, así que la lectura es lo único que hay.
    const produccion = { ...process.env, NODE_ENV: 'production', CRM_BASE_URL: 'https://crm.iseie.com', PLUGIN_MOODLE_EN_PRODUCCION: '0' };
    expect((await campusConPluginAlDia(produccion)).has(c.id)).toBe(false);
    expect((await vuelta(produccion)).get(c.id)).toMatchObject({ nuevos: 1 });
    // Con el repaso apagado, un aviso perdido no lo recogería nadie.
    const sinRepaso = { ...process.env, MOODLE_SINCRONIZACION_DISABLED: '1' };
    expect((await campusConPluginAlDia(sinRepaso)).has(c.id)).toBe(false);
    // Y con los dos encendidos, se salta.
    expect((await campusConPluginAlDia()).has(c.id)).toBe(true);
  });

  it('lo que se salta no se pierde: lo recoge el repaso de cada 15 minutos', async () => {
    if (!hayBase) return;
    const c = await crearCampus('Recoge', { haceMin: 5 });
    expect((await vuelta()).get(c.id)).toEqual({ projectId: c.id, omitido: 'plugin' });
    expect(await consultasDe(c.id)).toBe(0);
    // El aviso de ese mensaje no llegó; el repaso lo trae.
    c.moodle.paginas.push({
      avisos: JSON.stringify([{
        evento: 'mensaje',
        mensaje: { id: (mensajeN += 1), conversacion_id: c.moodle.conversacion, html: '<p>No me abre la tarea</p>', fecha: Math.floor(Date.now() / 1000) - 60, curso_id: null },
        de: { id: c.moodle.alumno, nombre: `Alumno ${c.moodle.alumno}`, personal: false },
        para: [{ id: 701, personal: true }],
      }]),
      hastaid: mensajeN, mas: false, version: '1.10.2',
    });
    const r = await sincronizarCampus(c.id, { procesar: procesarAviso, desdeFecha: '2026-01-01T00:00:00Z', fetchImpl });
    expect(r).toMatchObject({ mensajes: 1, nuevos: 1 });
    expect(r.error).toBeUndefined();
    expect(await consultasDe(c.id)).toBe(1);
    // Y sigue al día: la siguiente vuelta de 5 minutos tampoco lo lee.
    expect((await vuelta()).get(c.id)).toEqual({ projectId: c.id, omitido: 'plugin' });
  });
});

describe('#689 8b · si no se puede saber qué campus tienen el plugin al día', () => {
  it('se leen todos, como antes, en vez de no leer ninguno', async () => {
    if (!hayBase) return;
    const db = await import('../src/shared/config/db.js');
    const espia = vi.spyOn(db.default, 'query').mockImplementationOnce(async () => { throw new Error('relation "moodle_plugin_campus" does not exist'); });
    try {
      expect((await campusConPluginAlDia()).size).toBe(0);
    } finally {
      espia.mockRestore();
    }
  });
});
