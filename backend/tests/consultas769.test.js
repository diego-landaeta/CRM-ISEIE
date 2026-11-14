import {
  describe, it, expect, beforeAll, afterAll, vi,
} from 'vitest';
import { query } from '../src/shared/config/db.js';
import { NO_ESCRIBIR_A_TUTORES } from '../src/shared/config/frenoTutores.js';
import {
  revisarPlazos, umbralesDeAviso, correoAAdministracion, PARTE_DEL_PLAZO,
} from '../src/modules/consultas/consultas.plazos.js';
import { PLAZO_HORAS } from '../src/modules/consultas/consultas.model.js';
import { AVISO_CONSULTA_FUERA_DE_PLAZO } from '../src/modules/consultas/consultas.avisosCorreo.js';

const latido = vi.hoisted(() => ({ vigilar: vi.fn() }));
vi.mock('../src/jobs/latido.js', () => latido);

/**
 * #769 (alertas de tutores): los dos escalones de una consulta sin respuesta con
 * su propio umbral, y el aviso a administración también por correo.
 *
 *   · sin variables, lo de siempre (3/4 del plazo y el plazo): lo cubre consultas190;
 *   · con 24 y 48 h: antes de 24 nada, entre 24 y 48 solo el tutor, desde 48 también administración;
 *   · el aviso a administración nunca va antes que el recordatorio;
 *   · correo a administración solo con CONSULTAS_AVISO_ADMIN_CORREO=1, a los activos con
 *     correo que no lo han apagado, uno por persona y espera.
 */

const marca = `t769${Date.now()}`;
const ids = { users: [], projects: [], consultas: [] };
let hayBase = true;
let porQueNo = null;
let n = 0;

async function crearUsuario(role) {
  n += 1;
  const { rows } = await query(
    `INSERT INTO users (nombre, email, password_hash, role, active) VALUES ($1, $2, 'x', $3, true) RETURNING id`,
    [`${role} ${n} ${marca}`, `${role}.${n}.${marca}@test.local`, role]);
  ids.users.push(rows[0].id);
  return Number(rows[0].id);
}

async function crearCampus(nombre) {
  n += 1;
  const { rows } = await query(
    `INSERT INTO projects (nombre, slug, webhook_api_key, active) VALUES ($1, $2, $3, true) RETURNING id`,
    [`${nombre} ${marca}`, `${nombre.toLowerCase()}-${marca}-${n}`, `k-${marca}-${n}`]);
  ids.projects.push(rows[0].id);
  return Number(rows[0].id);
}

async function tutorMatriculado(projectId) {
  const t = await crearUsuario('tutor');
  await query('INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, true)', [t, projectId]);
  await query(`INSERT INTO tutor_campus (tutor_id, project_id, estado, moodle_user_id) VALUES ($1, $2, 'activa', $3)`, [t, projectId, n]);
  return t;
}

async function adminDe(projectId) {
  const a = await crearUsuario('admin');
  await query('INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, true)', [a, projectId]);
  return a;
}

async function consulta(projectId, tutorId, horas) {
  n += 1;
  const { rows } = await query(
    `INSERT INTO consultas (project_id, alumno_moodle_id, alumno_nombre, tutor_id, estado, entrada_at, espera_desde)
     VALUES ($1, $2, $3, $4, 'abierta', NOW() - make_interval(secs => $5::float8 * 3600), NOW() - make_interval(secs => $5::float8 * 3600))
     RETURNING id`,
    [projectId, 9000 + n, `Alumno ${n}`, tutorId, horas]);
  ids.consultas.push(rows[0].id);
  return Number(rows[0].id);
}

const avisos = async (type, consultaId) => (await query(
  `SELECT target_user_ids FROM admin_notifications WHERE type = $1 AND (metadata->>'consulta_id')::int = $2`, [type, consultaId])).rows;

const ENV_24_48 = { CONSULTAS_RECORDATORIO_HORAS: '24', CONSULTAS_AVISO_ADMIN_HORAS: '48' };

beforeAll(async () => {
  try {
    const t = await query(`SELECT to_regclass('public.avisos_apagados') AS a,
      (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'consultas' AND column_name = 'aviso_fuera_plazo_at') AS b`);
    if (!t.rows[0].a || Number(t.rows[0].b) !== 1) throw new Error('Faltan las migraciones 132 o 211.');
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
  }
});

afterAll(async () => {
  for (const [sql, p] of [
    [`DELETE FROM admin_notifications WHERE (metadata->>'consulta_id')::int = ANY($1::int[])`, [ids.consultas]],
    ['DELETE FROM consulta_eventos WHERE consulta_id = ANY($1::int[])', [ids.consultas]],
    ['DELETE FROM consultas WHERE project_id = ANY($1::int[])', [ids.projects]],
    ['DELETE FROM avisos_apagados WHERE user_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM tutor_campus WHERE tutor_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]],
  ]) {
    try { await query(sql, p); } catch { /* sigue limpiando */ }
  }
});

describe('hay base', () => {
  it('contra la que probar', () => { expect(hayBase, porQueNo || '').toBe(true); });
});

describe('#769 · umbrales de cada escalón', () => {
  it('sin variables, lo de siempre: 3/4 del plazo y el plazo', () => {
    expect(umbralesDeAviso({})).toEqual({ recordatorio: PLAZO_HORAS * PARTE_DEL_PLAZO, administracion: PLAZO_HORAS });
  });

  it('con 24 y 48 h, esos; un valor que no es un número positivo se ignora', () => {
    expect(umbralesDeAviso(ENV_24_48)).toEqual({ recordatorio: 24, administracion: 48 });
    expect(umbralesDeAviso({ CONSULTAS_RECORDATORIO_HORAS: 'x', CONSULTAS_AVISO_ADMIN_HORAS: '-3' }))
      .toEqual({ recordatorio: PLAZO_HORAS * PARTE_DEL_PLAZO, administracion: PLAZO_HORAS });
  });

  it('administración nunca antes que el tutor', () => {
    expect(umbralesDeAviso({ CONSULTAS_RECORDATORIO_HORAS: '30', CONSULTAS_AVISO_ADMIN_HORAS: '10' }))
      .toEqual({ recordatorio: 30, administracion: 30 });
  });

  it('el correo a administración solo con =1', () => {
    expect(correoAAdministracion({})).toBe(false);
    expect(correoAAdministracion({ CONSULTAS_AVISO_ADMIN_CORREO: 'true' })).toBe(false);
    expect(correoAAdministracion({ CONSULTAS_AVISO_ADMIN_CORREO: '1' })).toBe(true);
  });
});

describe('#769 · 24 h al tutor y 48 h a administración', () => {
  it('antes de 24 nada; entre 24 y 48 solo el tutor; desde 48 también administración', async () => {
    if (!hayBase) return;
    const p = await crearCampus('Escalones');
    const t = await tutorMatriculado(p);
    await adminDe(p);
    const temprana = await consulta(p, t, 20);
    const media = await consulta(p, t, 30);
    const tarde = await consulta(p, t, 50);

    const r = await revisarPlazos({ projectIds: [p], enviar: vi.fn(async () => ({ sent: true })), env: ENV_24_48 });
    expect(r).toMatchObject({ recordatorios: 2, fueraDePlazo: 1, errores: 0 });
    expect(await avisos('consulta_cerca_del_plazo', temprana)).toHaveLength(0);
    expect(await avisos('consulta_cerca_del_plazo', media)).toHaveLength(1);
    expect(await avisos('consulta_fuera_de_plazo', media)).toHaveLength(0);
    expect(await avisos('consulta_cerca_del_plazo', tarde)).toHaveLength(1);
    expect(await avisos('consulta_fuera_de_plazo', tarde)).toHaveLength(1);

    // El texto del tutor no dice «quedan 0 h» cuando el recordatorio llega con el plazo ya pasado.
    const { rows } = await query(
      `SELECT message FROM admin_notifications WHERE type = 'consulta_cerca_del_plazo' AND (metadata->>'consulta_id')::int = $1`, [tarde]);
    expect(rows[0].message).toContain(`ya pasa del plazo de ${PLAZO_HORAS} h`);
    expect(rows[0].message).not.toContain('quedan 0');

    // Al cruzar las 48 h, la de 30 h avisa a administración, una sola vez.
    await query(`UPDATE consultas SET espera_desde = NOW() - make_interval(hours => 49) WHERE id = $1`, [media]);
    expect((await revisarPlazos({ projectIds: [p], env: ENV_24_48 })).fueraDePlazo).toBe(1);
    expect((await revisarPlazos({ projectIds: [p], env: ENV_24_48 })).fueraDePlazo).toBe(0);
    expect(await avisos('consulta_fuera_de_plazo', media)).toHaveLength(1);
  });
});

describe('#769 · correo a administración', () => {
  it('apagado por defecto: solo la campana', async () => {
    if (!hayBase) return;
    const p = await crearCampus('SinCorreo');
    await adminDe(p);
    const c = await consulta(p, null, 50);
    const enviar = vi.fn(async () => ({ sent: true }));
    await revisarPlazos({ projectIds: [p], enviar, env: ENV_24_48 });
    expect(await avisos('consulta_fuera_de_plazo', c)).toHaveLength(1);
    expect(enviar).not.toHaveBeenCalled();
  });

  it('con =1: a cada admin del campus con el aviso encendido, uno por persona y espera; no al tutor ni a quien lo apagó', async () => {
    if (!hayBase) return;
    const p = await crearCampus('ConCorreo');
    const t = await tutorMatriculado(p);
    const encendido = await adminDe(p);
    const apagado = await adminDe(p);
    await query('INSERT INTO avisos_apagados (user_id, aviso) VALUES ($1, $2)', [apagado, AVISO_CONSULTA_FUERA_DE_PLAZO]);
    const c = await consulta(p, t, 50);
    const enviar = vi.fn(async () => ({ sent: true }));
    const env = { ...ENV_24_48, CONSULTAS_AVISO_ADMIN_CORREO: '1' };

    await revisarPlazos({ projectIds: [p], enviar, env });
    const aAdministracion = enviar.mock.calls.map(([e]) => e).filter((e) => e.tags.includes('administracion'));
    const destinos = aAdministracion.map((e) => e.to);
    expect(destinos.some((to) => to.startsWith(`admin.`) && to.includes(marca))).toBe(true);
    const { rows } = await query('SELECT id, email FROM users WHERE id = ANY($1::int[])', [[encendido, apagado, t]]);
    const correoDe = Object.fromEntries(rows.map((r) => [Number(r.id), r.email]));
    expect(destinos).toContain(correoDe[encendido]);
    expect(destinos).not.toContain(correoDe[apagado]);
    expect(destinos).not.toContain(correoDe[t]);
    // Cada correo, su clave: consulta, espera y persona.
    const claves = aAdministracion.map((e) => e.clave);
    expect(new Set(claves).size).toBe(claves.length);
    expect(claves.every((k) => k.startsWith(`consultas-fuera-plazo-${c}-`))).toBe(true);
    expect(aAdministracion[0].subject).toContain('Consulta fuera de plazo');

    // El tutor recibe su recordatorio por su vía, que respeta el freno.
    const alTutor = enviar.mock.calls.map(([e]) => e).filter((e) => e.to === correoDe[t]);
    expect(alTutor).toHaveLength(NO_ESCRIBIR_A_TUTORES ? 0 : 1);

    // La vuelta siguiente no repite nada.
    enviar.mockClear();
    await revisarPlazos({ projectIds: [p], enviar, env });
    expect(enviar).not.toHaveBeenCalled();
  });

  it('un correo que falla no rompe el aviso de la campana', async () => {
    if (!hayBase) return;
    const p = await crearCampus('CorreoRoto');
    await adminDe(p);
    const c = await consulta(p, null, 50);
    const enviar = vi.fn(async () => { throw new Error('Brevo caído'); });
    const r = await revisarPlazos({ projectIds: [p], enviar, env: { ...ENV_24_48, CONSULTAS_AVISO_ADMIN_CORREO: '1' } });
    expect(r.errores).toBe(0);
    expect(r.fueraDePlazo).toBe(1);
    expect(await avisos('consulta_fuera_de_plazo', c)).toHaveLength(1);
  });
});
