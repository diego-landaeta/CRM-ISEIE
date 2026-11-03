import {
  describe, it, expect, beforeAll, afterAll, vi,
} from 'vitest';
import { query } from '../src/shared/config/db.js';
import { NO_ESCRIBIR_A_TUTORES } from '../src/shared/config/frenoTutores.js';
import { revisarPlazos, recordarCargas, PARTE_DEL_PLAZO } from '../src/modules/consultas/consultas.plazos.js';
import { PLAZO_HORAS } from '../src/modules/consultas/consultas.model.js';
import { TIPOS } from '../src/modules/notifications/tipos.js';

const latido = vi.hoisted(() => ({ vigilar: vi.fn() }));
vi.mock('../src/jobs/latido.js', () => latido);

/**
 * Consultas de alumnos, fase 4 (#190), contra la base de verdad.
 *
 *   · cerca del plazo: recordatorio al tutor (campana; el correo respeta el
 *     freno), una vez por espera, y otra vez si el alumno vuelve a escribir;
 *   · fuera de plazo: aviso a administración del campus (super admin y admin
 *     de ese campus, no los de otro), también sin tutor;
 *   · carga desactualizada: recordatorio, como mucho una vez por semana;
 *   · un interruptor en .env para cada trabajo programado.
 */

const marca = `t190${Date.now()}`;
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

/** Una consulta que espera desde hace `horas`. */
async function consulta(projectId, tutorId, horas, estado = 'abierta') {
  n += 1;
  const { rows } = await query(
    `INSERT INTO consultas (project_id, alumno_moodle_id, alumno_nombre, tutor_id, estado, entrada_at, espera_desde)
     VALUES ($1, $2, $3, $4, $5, NOW() - make_interval(secs => $6::float8 * 3600), NOW() - make_interval(secs => $6::float8 * 3600))
     RETURNING id`,
    [projectId, 9000 + n, `Alumno ${n}`, tutorId, estado, horas]);
  ids.consultas.push(rows[0].id);
  return Number(rows[0].id);
}

const avisos = async (type, consultaId) => (await query(
  `SELECT target_user_ids FROM admin_notifications WHERE type = $1 AND (metadata->>'consulta_id')::int = $2`, [type, consultaId])).rows;
const eventos = async (consultaId) => (await query(
  'SELECT tipo FROM consulta_eventos WHERE consulta_id = $1 ORDER BY id', [consultaId])).rows.map((r) => r.tipo);

beforeAll(async () => {
  try {
    const t = await query(`SELECT to_regclass('public.tutor_carga_recordatorios') AS a,
      (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'consultas' AND column_name = 'aviso_fuera_plazo_at') AS b`);
    if (!t.rows[0].a || Number(t.rows[0].b) !== 1) throw new Error('Falta la migración 211.');
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
  }
});

afterAll(async () => {
  for (const [sql, p] of [
    [`DELETE FROM admin_notifications WHERE (metadata->>'consulta_id')::int = ANY($1::int[])`, [ids.consultas]],
    [`DELETE FROM admin_notifications WHERE type = 'carga_desactualizada' AND target_user_ids && $1::int[]`, [ids.users]],
    ['DELETE FROM consultas WHERE project_id = ANY($1::int[])', [ids.projects]],
    ['DELETE FROM tutor_carga_recordatorios WHERE tutor_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM tutor_carga WHERE tutor_id = ANY($1::int[])', [ids.users]],
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

describe('#190 · cerca del plazo: recordatorio al tutor', () => {
  it('a las 3/4 partes del plazo, una vez por espera; antes no, y las respondidas tampoco', async () => {
    if (!hayBase) return;
    const p = await crearCampus('Cerca');
    const t = await tutorMatriculado(p);
    const cerca = await consulta(p, t, PLAZO_HORAS * PARTE_DEL_PLAZO + 0.5);
    const pronto = await consulta(p, t, 2);
    const respondida = await consulta(p, t, PLAZO_HORAS * PARTE_DEL_PLAZO + 1, 'respondida');
    const enviar = vi.fn(async () => ({ sent: true }));

    const r = await revisarPlazos({ projectIds: [p], enviar });
    expect(r).toMatchObject({ recordatorios: 1, fueraDePlazo: 0, errores: 0 });
    const a = await avisos('consulta_cerca_del_plazo', cerca);
    expect(a).toHaveLength(1);
    expect(a[0].target_user_ids.map(Number)).toEqual([t]);
    expect(await eventos(cerca)).toContain('recordatorio_plazo');
    expect(await avisos('consulta_cerca_del_plazo', pronto)).toHaveLength(0);
    expect(await avisos('consulta_cerca_del_plazo', respondida)).toHaveLength(0);
    // El correo al tutor respeta el freno (Diego, 15/09).
    expect(enviar).toHaveBeenCalledTimes(NO_ESCRIBIR_A_TUTORES ? 0 : 1);

    // La vuelta siguiente no lo repite.
    expect((await revisarPlazos({ projectIds: [p], enviar })).recordatorios).toBe(0);
    expect(await avisos('consulta_cerca_del_plazo', cerca)).toHaveLength(1);

    // El alumno vuelve a escribir: espera nueva; cuando vuelve a acercarse, otro recordatorio.
    await query(`UPDATE consultas SET espera_desde = NOW() - make_interval(secs => $2::float8 * 3600) WHERE id = $1`,
      [cerca, PLAZO_HORAS * PARTE_DEL_PLAZO + 0.1]);
    await query(`UPDATE consultas SET recordatorio_plazo_at = NOW() - make_interval(days => 3) WHERE id = $1`, [cerca]);
    expect((await revisarPlazos({ projectIds: [p], enviar })).recordatorios).toBe(1);
    expect(await avisos('consulta_cerca_del_plazo', cerca)).toHaveLength(2);
  });
});

describe('#190 · fuera de plazo: aviso a administración', () => {
  it('a los super admin y a los admin de ese campus (no a los de otro); una vez por espera; también sin tutor', async () => {
    if (!hayBase) return;
    const p = await crearCampus('Fuera');
    const otro = await crearCampus('Otro');
    const t = await tutorMatriculado(p);
    const suyo = await adminDe(p);
    const ajeno = await adminDe(otro);
    const conTutor = await consulta(p, t, PLAZO_HORAS + 2);
    const sinTutor = await consulta(p, null, PLAZO_HORAS + 5);

    const r = await revisarPlazos({ projectIds: [p], enviar: vi.fn(async () => ({ sent: true })) });
    expect(r.fueraDePlazo).toBe(2);
    // La que nunca se recordó (p. ej. con el trabajo apagado) se le recuerda al tutor también.
    expect(r.recordatorios).toBe(1);

    for (const id of [conTutor, sinTutor]) {
      const a = await avisos('consulta_fuera_de_plazo', id);
      expect(a).toHaveLength(1);
      const quien = a[0].target_user_ids.map(Number);
      expect(quien).toContain(suyo);
      expect(quien).not.toContain(ajeno);
      expect(quien).not.toContain(t);
      const { rows } = await query("SELECT COUNT(*)::int AS n FROM users WHERE active AND role = 'superadmin'");
      expect(quien.length).toBe(rows[0].n + 1);
      expect(await eventos(id)).toContain('fuera_de_plazo');
    }
    expect(await avisos('consulta_cerca_del_plazo', sinTutor)).toHaveLength(0);

    expect((await revisarPlazos({ projectIds: [p] })).fueraDePlazo).toBe(0);
    expect(await avisos('consulta_fuera_de_plazo', conTutor)).toHaveLength(1);
  });

  it('en la campana, los tipos nuevos piden hacer algo', () => {
    for (const tipo of ['consulta_cerca_del_plazo', 'consulta_fuera_de_plazo', 'carga_desactualizada']) {
      expect(TIPOS[tipo]?.clase).toBe('accion');
    }
  });
});

describe('#190 · recordatorio de carga desactualizada', () => {
  it('sin indicar o de hace más de una semana: recordatorio; como mucho uno por semana; al día, nada', async () => {
    if (!hayBase) return;
    const p = await crearCampus('Carga');
    // Su campus lee consultas; el del último, no: a quien no usa Consultas no se le pide la carga.
    await query(
      `INSERT INTO project_integrations (project_id, provider, active, encrypted_value, iv, auth_tag, config_public)
       VALUES ($1, 'moodle', true, 'x', 'x', 'x', '{"consultas": true}')`, [p]);
    const sinConsultas = await crearCampus('SinConsultas');
    const sinIndicar = await tutorMatriculado(p);
    const vieja = await tutorMatriculado(p);
    const alDia = await tutorMatriculado(p);
    const deOtro = await tutorMatriculado(sinConsultas);
    await query("INSERT INTO tutor_carga (tutor_id, nivel, created_at) VALUES ($1, 'media', NOW() - INTERVAL '10 days')", [vieja]);
    await query("INSERT INTO tutor_carga (tutor_id, nivel) VALUES ($1, 'alta')", [alDia]);
    const enviar = vi.fn(async () => ({ sent: true }));
    const tutorIds = [sinIndicar, vieja, alDia];

    const r = await recordarCargas({ tutorIds: [...tutorIds, deOtro], enviar });
    expect(r.recordatorios).toBe(2);
    expect(enviar).toHaveBeenCalledTimes(NO_ESCRIBIR_A_TUTORES ? 0 : 2);
    const { rows } = await query(
      `SELECT target_user_ids FROM admin_notifications WHERE type = 'carga_desactualizada' AND target_user_ids && $1::int[]`, [tutorIds]);
    expect(rows.map((x) => Number(x.target_user_ids[0])).sort()).toEqual([sinIndicar, vieja].sort());

    // Al día siguiente, no se repite.
    expect((await recordarCargas({ tutorIds, ahora: new Date(Date.now() + 86400000) })).recordatorios).toBe(0);
    // A la semana, sí (si sigue sin actualizarla).
    expect((await recordarCargas({ tutorIds, ahora: new Date(Date.now() + 8 * 86400000) })).recordatorios).toBe(3);
  });
});

describe('#190 · un interruptor en .env para cada trabajo programado', () => {
  it('con *_DISABLED=1 no arrancan; sin él, sí', async () => {
    const { startConsultasPlazoScheduler } = await import('../src/jobs/consultasPlazoScheduler.js');
    const { startConsultasCargaScheduler } = await import('../src/jobs/consultasCargaScheduler.js');
    vi.stubEnv('CONSULTAS_PLAZO_DISABLED', '1');
    vi.stubEnv('CONSULTAS_CARGA_RECORDATORIO_DISABLED', '1');
    latido.vigilar.mockClear();
    startConsultasPlazoScheduler();
    startConsultasCargaScheduler();
    expect(latido.vigilar).not.toHaveBeenCalled();
    vi.stubEnv('CONSULTAS_PLAZO_DISABLED', '');
    vi.stubEnv('CONSULTAS_CARGA_RECORDATORIO_DISABLED', '');
    startConsultasPlazoScheduler();
    startConsultasCargaScheduler();
    expect(latido.vigilar.mock.calls.map((c) => c[0])).toEqual(['consultas_plazo', 'consultas_carga']);
    vi.unstubAllEnvs();
  });

  it('todos los trabajos de Consultas (#187–#190) tienen su interruptor', async () => {
    const fs = await import('node:fs');
    const ficheros = ['tutoresCampusScheduler', 'consultasCampusScheduler', 'consultasAlumnosScheduler',
      'consultasResumenScheduler', 'consultasPlazoScheduler', 'consultasCargaScheduler'];
    const ejemplo = fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
    for (const f of ficheros) {
      const src = fs.readFileSync(new URL(`../src/jobs/${f}.js`, import.meta.url), 'utf8');
      const interruptor = src.match(/process\.env\.([A-Z_]+_DISABLED) === '1'/)?.[1];
      expect(interruptor, f).toBeTruthy();
      expect(ejemplo, `${interruptor} en .env.example`).toContain(interruptor);
    }
  });
});
