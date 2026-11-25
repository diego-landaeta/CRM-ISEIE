import {
  describe, it, expect, beforeAll, afterAll, vi,
} from 'vitest';
import crypto from 'node:crypto';
import { query } from '../src/shared/config/db.js';
import { encrypt } from '../src/shared/utils/crypto.js';
import { anotarActualizacion, leerEstado, explicar, TIPO } from '../src/modules/consultas/consultas.actualizacion.js';
import { estado, sincronizarCampus } from '../src/modules/consultas/consultas.plugin.js';
import { recibirAviso, procesarAviso } from '../src/modules/consultas/consultas.avisos.js';

/**
 * Un campus con una actualización pendiente (Campus-Moodle#24), contra la base de verdad.
 *
 * El 25/11/2026 el Moodle de ISEIE se quedó en «Comprobación de plugins» tras recibir una versión
 * del plugin. Desde la 1.12.0 el plugin lo cuenta por el aviso firmado (`plugin_estado`) y por el
 * repaso de cada 15 minutos (`local_crm_mensajes_desde`). Aquí se comprueba que:
 *   · al pasar a pendiente, campana a los super admin UNA vez, y el detalle se guarda;
 *   · repetido (aviso + repaso) no vuelve a avisar ni pierde desde cuándo;
 *   · al volver a estar al día se limpia, y una nueva vez vuelve a avisar;
 *   · un plugin anterior a la 1.12.0 (que no lo dice) no toca nada;
 *   · el panel (`estado`) lo enseña con qué hacer.
 *
 *   npx vitest run tests/moodleActualizacionPendienteCm24.test.js
 */

const marca = `cm24${Date.now()}`;
const ids = { users: [], projects: [] };
const SECRETO = 'secreto-del-plugin-cm24';
let hayBase = true;
let porQueNo = null;

const json = (d) => ({ ok: true, status: 200, json: async () => d });
const paginas = [];
vi.stubGlobal('fetch', vi.fn(async (url, { body } = {}) => {
  const f = new URLSearchParams(body).get('wsfunction');
  if (f === 'local_crm_mensajes_desde') return json(paginas.shift() || { avisos: '[]', hastaid: 0, mas: false, version: '1.12.0' });
  return json({ ok: true });
}));

async function superAdmin() {
  const n = ids.users.length;
  const { rows } = await query(
    `INSERT INTO users (nombre, email, password_hash, role, active) VALUES ($1, $2, 'x', 'superadmin', true) RETURNING id`,
    [`Super ${n} ${marca}`, `super.${n}.${marca}@test.local`]);
  ids.users.push(Number(rows[0].id));
  return Number(rows[0].id);
}

async function campus(nombre) {
  const n = ids.projects.length;
  const { rows } = await query(
    `INSERT INTO projects (nombre, slug, webhook_api_key, active) VALUES ($1, $2, $3, true) RETURNING id`,
    [`${nombre} ${marca}`, `${nombre.toLowerCase()}-${marca}-${n}`, `k-${marca}-${n}`]);
  const id = Number(rows[0].id);
  ids.projects.push(id);
  const enc = encrypt('token-del-campus');
  await query(
    `INSERT INTO project_integrations (project_id, provider, active, encrypted_value, iv, auth_tag, config_public)
     VALUES ($1, 'moodle', true, $2, $3, $4, $5)`,
    [id, enc.encrypted, enc.iv, enc.authTag, JSON.stringify({ url: `https://${marca}-${n}.campus.test`, consultas: true, consultas_desde: '2026-01-01T00:00:00Z' })]);
  const s = encrypt(SECRETO);
  await query(
    `INSERT INTO moodle_plugin_campus (project_id, secreto_cifrado, secreto_iv, secreto_tag, activo) VALUES ($1, $2, $3, $4, true)`,
    [id, s.encrypted, s.iv, s.authTag]);
  return id;
}

const avisosDe = async (projectId) => (await query(
  `SELECT title, message, link_path, target_user_ids FROM admin_notifications
    WHERE type = $1 AND (metadata->>'campus_id')::int = $2 ORDER BY id`, [TIPO, projectId])).rows;

const guardado = async (projectId) => (await query(
  'SELECT actualizacion_pendiente FROM moodle_plugin_campus WHERE project_id = $1', [projectId])).rows[0]?.actualizacion_pendiente;

/** Firma como el plugin (classes/aviso.php): t=<unix>,v1=HMAC-SHA256(secreto, "<t>.<cuerpo>"). */
function firmar(cuerpo) {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${crypto.createHmac('sha256', SECRETO).update(`${t}.${cuerpo}`).digest('hex')}`;
}

const PENDIENTE = { pendiente: true, version_disco: '1.12.3 (2026112530)', version_bd: '2026112529', pendientes: 'local_crm' };

beforeAll(async () => {
  try {
    const { rows: [r] } = await query(
      `SELECT COUNT(*)::int AS n FROM information_schema.columns
        WHERE table_name = 'moodle_plugin_campus' AND column_name = 'actualizacion_pendiente'`);
    if (r.n !== 1) throw new Error('Falta la migración 346 (moodle_plugin_campus.actualizacion_pendiente).');
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
  }
});

afterAll(async () => {
  for (const [sql, p] of [
    ['DELETE FROM admin_notifications WHERE type = $1 AND (metadata->>\'campus_id\')::int = ANY($2::int[])', [TIPO, ids.projects]],
    ['DELETE FROM moodle_plugin_campus WHERE project_id = ANY($1::int[])', [ids.projects]],
    ['DELETE FROM project_integrations WHERE project_id = ANY($1::int[])', [ids.projects]],
    ['DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]],
  ]) {
    try { await query(sql, p); } catch { /* sigue limpiando */ }
  }
  vi.unstubAllGlobals();
});

describe('hay base', () => {
  it('con la migración 346', () => { expect(hayBase, porQueNo || '').toBe(true); });
});

describe('Campus-Moodle#24 · lo que dice el plugin', () => {
  it('lee el aviso y el repaso igual, y un plugin viejo no dice nada', () => {
    expect(leerEstado({ pendiente: true, version_disco: '1.12.0 (2026112500)' })).toMatchObject({ pendiente: true, version_disco: '1.12.0 (2026112500)' });
    expect(leerEstado({ actualizacion_pendiente: false })).toMatchObject({ pendiente: false });
    expect(leerEstado({ version: '1.11.4', avisos: '[]' }).pendiente).toBeNull();
    expect(leerEstado({ pendiente: 'sí' }).pendiente).toBeNull();
  });
  it('explica qué hacer y nombra lo ajeno pendiente', () => {
    const t = explicar({ version_disco: '1.12.0 (2026112500)', version_bd: '2026112402', pendientes: 'local_crm, theme_fordson' });
    expect(t).toContain('1.12.0 (2026112500)');
    expect(t).toContain('Actualizar base de datos Moodle ahora');
    expect(t).toContain('theme_fordson');
  });
});

describe('Campus-Moodle#24 · campana a los super admin', () => {
  it('avisa una vez al quedar pendiente, guarda el detalle y no repite', async () => {
    if (!hayBase) return;
    const yo = await superAdmin();
    const id = await campus('Pendiente');
    const r1 = await anotarActualizacion(id, leerEstado(PENDIENTE), { destinatarios: [yo] });
    expect(r1).toMatchObject({ pendiente: true, avisado: true });
    const a = await avisosDe(id);
    expect(a).toHaveLength(1);
    expect(a[0].title).toContain('actualización pendiente');
    expect(a[0].link_path).toContain(`campus=${id}`);
    expect(a[0].target_user_ids.map(Number)).toEqual([yo]);
    const g1 = await guardado(id);
    expect(g1).toMatchObject({ version_disco: '1.12.3 (2026112530)', version_bd: '2026112529' });

    // El repaso dice lo mismo un rato después: ni otra campana ni otro «desde».
    const r2 = await anotarActualizacion(id, leerEstado({ actualizacion_pendiente: true, version_disco: '1.12.3 (2026112530)', version_bd: '2026112529' }), { destinatarios: [yo] });
    expect(r2).toMatchObject({ pendiente: true, avisado: false });
    expect(await avisosDe(id)).toHaveLength(1);
    expect((await guardado(id)).desde).toBe(g1.desde);
  });

  it('al día lo limpia, y si vuelve a quedar pendiente vuelve a avisar', async () => {
    if (!hayBase) return;
    const yo = await superAdmin();
    const id = await campus('Vuelve');
    await anotarActualizacion(id, leerEstado(PENDIENTE), { destinatarios: [yo] });
    expect(await anotarActualizacion(id, leerEstado({ pendiente: false }))).toMatchObject({ pendiente: false, resuelta: true });
    expect(await guardado(id)).toBeNull();
    expect(await anotarActualizacion(id, leerEstado(PENDIENTE), { destinatarios: [yo] })).toMatchObject({ avisado: true });
    expect(await avisosDe(id)).toHaveLength(2);
  });

  it('un plugin anterior a la 1.12.0 no toca nada', async () => {
    if (!hayBase) return;
    const id = await campus('Viejo');
    expect(await anotarActualizacion(id, leerEstado({ version: '1.11.4' }))).toEqual({ pendiente: null });
    expect(await guardado(id)).toBeNull();
    expect(await avisosDe(id)).toHaveLength(0);
  });
});

describe('Campus-Moodle#24 · por dónde llega', () => {
  it('el aviso firmado `plugin_estado` lo anota; sin firma buena, nada', async () => {
    if (!hayBase) return;
    const id = await campus('Aviso');
    const cuerpo = JSON.stringify({ evento: 'plugin_estado', estado: 'pendiente', mensaje: 'a medias', ...PENDIENTE });
    await expect(recibirAviso(id, Buffer.from(cuerpo), 't=1,v1=00')).rejects.toMatchObject({ statusCode: 401 });
    expect(await guardado(id)).toBeNull();
    const r = await recibirAviso(id, Buffer.from(cuerpo), firmar(cuerpo));
    expect(r).toMatchObject({ pendiente: true });
    expect(await guardado(id)).toMatchObject({ version_bd: '2026112529', mensaje: 'a medias' });
    // Y el panel lo enseña, con qué hacer.
    const e = await estado(id);
    expect(e.actualizacion_pendiente).toMatchObject({ version_disco: '1.12.3 (2026112530)' });
    expect(e.actualizacion_pendiente.explicacion).toContain('Administración del sitio › Notificaciones');
  });

  it('el repaso de cada 15 minutos lo anota y lo limpia', async () => {
    if (!hayBase) return;
    const id = await campus('Repaso');
    paginas.push({ avisos: '[]', hastaid: 0, mas: false, version: '1.12.0', actualizacion_pendiente: true, version_disco: '1.12.0 (2026112500)', version_bd: '2026112402', pendientes: 'local_crm' });
    const r = await sincronizarCampus(id, { procesar: procesarAviso, desdeFecha: '2026-01-01T00:00:00Z' });
    expect(r.error).toBeUndefined();
    expect(await guardado(id)).toMatchObject({ version_bd: '2026112402' });
    paginas.push({ avisos: '[]', hastaid: 0, mas: false, version: '1.12.0', actualizacion_pendiente: false, version_disco: '1.12.0 (2026112500)', version_bd: '2026112500', pendientes: '' });
    await sincronizarCampus(id, { procesar: procesarAviso });
    expect(await guardado(id)).toBeNull();
    expect((await estado(id)).actualizacion_pendiente).toBeNull();
  });
});
