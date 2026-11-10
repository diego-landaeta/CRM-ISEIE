import {
  describe, it, expect, beforeAll, afterAll, vi,
} from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { query } from '../src/shared/config/db.js';
import { encrypt } from '../src/shared/utils/crypto.js';
import { errorHandler } from '../src/shared/middleware/errorHandler.js';
import * as servicio from '../src/modules/consultas/consultas.service.js';
import * as alumnos from '../src/modules/consultas/consultas.alumnos.js';
import * as carga from '../src/modules/consultas/consultas.carga.js';
import { metricas } from '../src/modules/consultas/consultas.metricas.js';
import { resumenDelTutor, enviarResumenes } from '../src/jobs/consultasResumenScheduler.js';
import consultasModule from '../src/modules/consultas/index.js';

/**
 * Consultas de alumnos, fase 3 (#189), contra la base de verdad.
 *
 *   · matriculados del campus al CRM: solo los cursos que imparte el tutor,
 *     solo alumnos activos, y la baja de quien ya no sale;
 *   · «Alumnos sin mensajes»: los más antiguos arriba, ámbar desde el día 5 y
 *     rojo desde el 7; «Escribir al alumno» lo saca de la lista;
 *   · «Mi carga de trabajo»: historial, «desactualizada» y la carga «completa»
 *     en el reparto;
 *   · el panel de tutores y el aviso de campus sin tutor;
 *   · las métricas: media y mediana, en plazo, y cada tutor solo las suyas;
 *   · el resumen semanal, con el freno de correos a tutores.
 */

const marca = `t189${Date.now()}`;
const ids = { users: [], projects: [] };
let hayBase = true;
let porQueNo = null;
let alumnoN = 5000;

const json = (d) => ({ ok: true, status: 200, json: async () => d });
const error = (code) => json({ exception: 'moodle_exception', errorcode: code, message: code });

/**
 * Un Moodle de mentira con cursos y matriculados.
 *   cursos:  { [moodleUserId]: [{ id, fullname }] }
 *   gente:   { [cursoId]: [{ id, fullname, email, roles: ['student'], lastaccess }] | 'falla' }
 *   conversaciones: { [moodleUserId]: [alumnoMoodleId, …] }
 */
function moodle({ cursos = {}, gente = {}, conversaciones = {} } = {}) {
  return vi.fn(async (_url, { body }) => {
    const p = new URLSearchParams(body);
    if (p.get('wstoken') !== 'campus') return error('invalidtoken');
    const f = p.get('wsfunction');
    if (f === 'core_enrol_get_users_courses') return json(cursos[p.get('userid')] || []);
    if (f === 'core_enrol_get_enrolled_users') {
      const g = gente[p.get('courseid')];
      if (g === 'falla') return error('accessexception');
      return json((g || []).map((u) => ({ ...u, roles: u.roles.map((r) => ({ shortname: r })) })));
    }
    if (f === 'core_message_get_conversations') {
      // Como Moodle: de `limitfrom` en adelante, como mucho `limitnum`.
      const desde = Number(p.get('limitfrom') || 0);
      const cuantas = Number(p.get('limitnum') || 50);
      return json({ conversations: (conversaciones[p.get('userid')] || []).slice(desde, desde + cuantas)
        .map((a, i) => ({ id: 70000 + desde + i, members: [{ id: a, fullname: `A ${a}` }] })) });
    }
    return error('accessexception');
  });
}

async function crearUsuario(role) {
  const { rows } = await query(
    `INSERT INTO users (nombre, email, password_hash, role, active) VALUES ($1, $2, 'x', $3, true) RETURNING id`,
    [`${role} ${ids.users.length} ${marca}`, `${role}.${ids.users.length}.${marca}@test.local`, role]);
  ids.users.push(rows[0].id);
  return Number(rows[0].id);
}

async function crearCampus(nombre) {
  const n = ids.projects.length;
  const { rows } = await query(
    `INSERT INTO projects (nombre, slug, webhook_api_key, active) VALUES ($1, $2, $3, true) RETURNING id`,
    [`${nombre} ${marca}`, `${nombre.toLowerCase()}-${marca}-${n}`, `k-${marca}-${n}`]);
  ids.projects.push(rows[0].id);
  return Number(rows[0].id);
}

async function tutorMatriculado(projectId, moodleId, { disponible = true } = {}) {
  const t = await crearUsuario('tutor');
  await query('INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, true)', [t, projectId]);
  await query(
    `INSERT INTO tutor_campus (tutor_id, project_id, estado, moodle_user_id) VALUES ($1, $2, 'activa', $3)`,
    [t, projectId, moodleId]);
  if (!disponible) await query('UPDATE users SET consultas_disponible = false WHERE id = $1', [t]);
  return t;
}

async function conectar(projectId, { consultas = true } = {}) {
  const enc = encrypt('campus');
  await query(
    `INSERT INTO project_integrations (project_id, provider, active, encrypted_value, iv, auth_tag, config_public)
     VALUES ($1, 'moodle', true, $2, $3, $4, $5)`,
    [projectId, enc.encrypted, enc.iv, enc.authTag,
     JSON.stringify({ url: 'https://campus.prueba.local', consultas, consultas_desde: '2026-01-01T00:00:00Z' })]);
}

/** Un alumno de ese tutor, matriculado hace `dias` días. */
async function alumnoDe(projectId, tutorId, dias, extra = {}) {
  alumnoN += 1;
  const { rows } = await query(
    `INSERT INTO tutor_alumnos (project_id, tutor_id, alumno_moodle_id, curso_moodle_id, curso_nombre,
                                alumno_nombre, alumno_email, matriculado_desde, activo, visto_at, con_conversacion)
     VALUES ($1, $2, $3, 1, 'Psicología', $4, $5, NOW() - ($6 || ' days')::interval, true, NOW(), $7) RETURNING *`,
    [projectId, tutorId, alumnoN, `Alumno ${alumnoN}`, `alumno${alumnoN}@test.local`, String(dias), extra.conConversacion || false]);
  return rows[0];
}

/** Una consulta con sus tiempos ya puestos (para las métricas). */
async function consultaHecha(projectId, tutorId, { horasRespuesta = null, horasCierre = null, origen = 'moodle', haceHoras = 48 } = {}) {
  alumnoN += 1;
  const { rows } = await query(
    `INSERT INTO consultas (project_id, alumno_moodle_id, alumno_nombre, tutor_id, estado, origen, entrada_at,
                            primera_respuesta_at, cerrada_at, espera_desde)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() - ($7 || ' hours')::interval,
             CASE WHEN $8::numeric IS NULL THEN NULL ELSE NOW() - ($7 || ' hours')::interval + ($8 || ' hours')::interval END,
             CASE WHEN $9::numeric IS NULL THEN NULL ELSE NOW() - ($7 || ' hours')::interval + ($9 || ' hours')::interval END,
             CASE WHEN $8::numeric IS NULL THEN NOW() - ($7 || ' hours')::interval ELSE NULL END)
     RETURNING id`,
    [projectId, alumnoN, `Alumno ${alumnoN}`, tutorId,
     horasCierre != null ? 'cerrada' : horasRespuesta != null ? 'respondida' : 'abierta', origen, String(haceHoras),
     horasRespuesta == null ? null : String(horasRespuesta), horasCierre == null ? null : String(horasCierre)]);
  return Number(rows[0].id);
}

const app = express();
app.use(express.json());
app.use(consultasModule.prefix, consultasModule.router);
app.use(errorHandler);
const como = (user) => {
  const token = jwt.sign(user, process.env.JWT_SECRET);
  return {
    get: (u) => supertest(app).get(u).set('Authorization', `Bearer ${token}`),
    post: (u, b) => supertest(app).post(u).send(b).set('Authorization', `Bearer ${token}`),
  };
};

beforeAll(async () => {
  try {
    const t = await query("SELECT to_regclass('public.tutor_alumnos') AS a, to_regclass('public.tutor_carga') AS b");
    if (!t.rows[0].a || !t.rows[0].b) throw new Error('Falta la migración 210.');
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
  }
});

afterAll(async () => {
  for (const [sql, p] of [
    ['DELETE FROM consultas WHERE project_id = ANY($1::int[])', [ids.projects]],
    ['DELETE FROM tutor_alumnos WHERE project_id = ANY($1::int[])', [ids.projects]],
    ['DELETE FROM tutor_carga WHERE tutor_id = ANY($1::int[])', [ids.users]],
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
  it('contra la que probar', () => { expect(hayBase, porQueNo || '').toBe(true); });
});

describe('#189 · matriculados, del campus al CRM', () => {
  it('solo los cursos que imparte, solo alumnos, y marca quién ya tiene conversación', async () => {
    if (!hayBase) return;
    const p = await crearCampus('Sync');
    await conectar(p);
    const t = await tutorMatriculado(p, 100);
    const fetchImpl = moodle({
      cursos: { 100: [{ id: 1, fullname: 'Psicología' }, { id: 2, fullname: 'Curso donde es alumno' }] },
      gente: {
        1: [
          { id: 100, fullname: 'Tutor', roles: ['editingteacher'] },
          { id: 201, fullname: 'Ana', email: 'ana@x.es', roles: ['student'], lastaccess: 1760000000 },
          { id: 202, fullname: 'Luis', email: 'luis@x.es', roles: ['student'], lastaccess: 0 },
          { id: 300, fullname: 'Otra profe', roles: ['teacher'] },
        ],
        2: [
          { id: 100, fullname: 'Tutor', roles: ['student'] },
          { id: 400, fullname: 'Compañero', roles: ['student'] },
        ],
      },
      conversaciones: { 100: [201] },
    });
    const r = await alumnos.sincronizarAlumnos(p, { fetchImpl });
    expect(r).toMatchObject({ tutores: 1, alumnos: 2, nuevos: 2, bajas: 0, errores: [] });
    const { rows } = await query(
      'SELECT alumno_moodle_id, con_conversacion, ultimo_acceso, matricula_aproximada FROM tutor_alumnos WHERE project_id = $1 ORDER BY alumno_moodle_id', [p]);
    expect(rows.map((x) => Number(x.alumno_moodle_id))).toEqual([201, 202]);
    expect(rows[0].con_conversacion).toBe(true);
    expect(rows[0].ultimo_acceso).not.toBeNull();
    expect(rows[1].ultimo_acceso).toBeNull();
    expect(rows[0].matricula_aproximada).toBe(true);
    // Sin mensajes: solo Luis.
    expect((await alumnos.sinMensajes({ tutorId: t })).map((a) => a.alumno_nombre)).toEqual(['Luis']);
  });

  it('quien deja de salir matriculado se da de baja; si un curso falla, no se da de baja a nadie', async () => {
    if (!hayBase) return;
    const p = await crearCampus('Bajas');
    await conectar(p);
    const t = await tutorMatriculado(p, 110);
    const profe = { id: 110, fullname: 'Tutor', roles: ['editingteacher'] };
    const a1 = { id: 211, fullname: 'Uno', roles: ['student'] };
    const a2 = { id: 212, fullname: 'Dos', roles: ['student'] };
    const cursos = { 110: [{ id: 5, fullname: 'Curso' }] };
    await alumnos.sincronizarAlumnos(p, { fetchImpl: moodle({ cursos, gente: { 5: [profe, a1, a2] } }) });

    const falla = await alumnos.sincronizarAlumnos(p, { fetchImpl: moodle({ cursos, gente: { 5: 'falla' } }) });
    expect(falla.bajas).toBe(0);
    expect(falla.errores.length).toBe(1);
    expect((await alumnos.sinMensajes({ tutorId: t })).length).toBe(2);

    const r = await alumnos.sincronizarAlumnos(p, { fetchImpl: moodle({ cursos, gente: { 5: [profe, a1] } }) });
    expect(r.bajas).toBe(1);
    expect((await alumnos.sinMensajes({ tutorId: t })).map((a) => a.alumno_nombre)).toEqual(['Uno']);
  });
});

describe('#189 · alumnos sin mensajes', () => {
  it('los más antiguos arriba; ámbar desde el día 5 y rojo desde el 7', async () => {
    if (!hayBase) return;
    const p = await crearCampus('Semaforo');
    const t = await tutorMatriculado(p, 120);
    await alumnoDe(p, t, 2);
    await alumnoDe(p, t, 9);
    await alumnoDe(p, t, 5);
    await alumnoDe(p, t, 7);
    await alumnoDe(p, t, 30, { conConversacion: true });
    const l = await alumnos.sinMensajes({ tutorId: t });
    expect(l.map((a) => a.dias)).toEqual([9, 7, 5, 2]);
    expect(l.map((a) => a.color)).toEqual(['rojo', 'rojo', 'ambar', 'verde']);
  });

  it('la primera consulta del alumno lo saca de la lista', async () => {
    if (!hayBase) return;
    const p = await crearCampus('Entra');
    const t = await tutorMatriculado(p, 130);
    const a = await alumnoDe(p, t, 3);
    await servicio.entraMensajeDelAlumno({
      projectId: p, conversacionId: 1, alumno: { moodleId: Number(a.alumno_moodle_id), nombre: a.alumno_nombre },
      texto: 'Hola', externoId: Number(a.alumno_moodle_id) * 10, escritoAt: new Date(),
    }, { tutorPreferido: t, avisar: false });
    expect(await alumnos.sinMensajes({ tutorId: t })).toEqual([]);
    const { rows } = await query('SELECT primer_contacto_at FROM tutor_alumnos WHERE id = $1', [a.id]);
    expect(rows[0].primer_contacto_at).not.toBeNull();
  });

  it('API: cada tutor ve los suyos; escribir al de otro da «no encontrado»; «Escribir al alumno» lo saca de la lista', async () => {
    if (!hayBase) return;
    const p = await crearCampus('ApiAlumnos');
    await conectar(p);
    const a = await tutorMatriculado(p, 140);
    const b = await tutorMatriculado(p, 141);
    const deA = await alumnoDe(p, a, 6);
    const deB = await alumnoDe(p, b, 6);
    const tutorA = como({ userId: a, role: 'tutor' });

    const mios = await tutorA.get('/api/consultas/alumnos-sin-mensajes');
    expect(mios.status).toBe(200);
    expect(mios.body.data.alumnos.map((x) => x.id)).toEqual([deA.id]);
    expect(mios.body.data).toMatchObject({ diasAmbar: 5, diasRojo: 7 });
    // Ver los de todos es de administración.
    expect((await tutorA.get('/api/consultas/alumnos-sin-mensajes?todas=1')).status).toBe(403);

    expect((await tutorA.post(`/api/consultas/alumnos/${deB.id}/escribir`, { texto: 'Hola' })).status).toBe(404);
    const vacio = await tutorA.post(`/api/consultas/alumnos/${deA.id}/escribir`, { texto: '  ' });
    expect(vacio.status).toBe(400);
    expect(JSON.stringify(vacio.body)).toContain('Mensaje al alumno');

    // Sin token del tutor no llega al campus, pero queda guardado y el alumno sale de la lista.
    const r = await tutorA.post(`/api/consultas/alumnos/${deA.id}/escribir`, { texto: 'Bienvenida al curso' });
    expect(r.status).toBe(200);
    expect(r.body.data.enviado).toBe(false);
    expect(r.body.data.error).toMatch(/token del tutor/);
    expect((await tutorA.get('/api/consultas/alumnos-sin-mensajes')).body.data.alumnos).toEqual([]);
    const { rows } = await query(
      `SELECT c.origen, c.estado, c.tutor_id, (SELECT COUNT(*)::int FROM consulta_mensajes m WHERE m.consulta_id = c.id AND m.autor = 'tutor') AS n,
              (SELECT array_agg(tipo) FROM consulta_eventos e WHERE e.consulta_id = c.id) AS eventos
         FROM consultas c WHERE c.id = $1`, [r.body.data.consultaId]);
    expect(rows[0]).toMatchObject({ origen: 'tutor', estado: 'respondida', tutor_id: a, n: 1 });
    expect(rows[0].eventos).toContain('iniciada_por_tutor');
    // Y queda como una conversación más en su bandeja.
    const bandeja = await tutorA.get('/api/consultas/mias?estado=respondida');
    expect(bandeja.body.data.consultas.map((c) => c.id)).toContain(r.body.data.consultaId);

    // Administración ve los de todos los de su ámbito, con el tutor.
    const sa = como({ userId: await crearUsuario('superadmin'), role: 'superadmin' });
    const todos = await sa.get(`/api/consultas/alumnos-sin-mensajes?todas=1&projectId=${p}`);
    expect(todos.status).toBe(200);
    expect(todos.body.data.alumnos.map((x) => x.id)).toEqual([deB.id]);
  });
});

describe('#189 · mi carga de trabajo', () => {
  it('guarda cada cambio, da los datos reales y marca «desactualizada» pasado el plazo', async () => {
    if (!hayBase) return;
    const p = await crearCampus('Carga');
    const t = await tutorMatriculado(p, 150);
    await alumnoDe(p, t, 1);
    await alumnoDe(p, t, 1, { conConversacion: true });
    await consultaHecha(p, t);
    const yo = como({ userId: t, role: 'tutor' });

    const nada = await yo.get('/api/consultas/carga');
    expect(nada.body.data).toMatchObject({ actual: null, desactualizada: true, diasPlazo: 7 });
    expect(nada.body.data.datosReales).toEqual({ alumnos_activos: 2, consultas_abiertas: 1, alumnos_sin_mensajes: 1 });

    const mal = await yo.post('/api/consultas/carga', { nivel: 'muchísima' });
    expect(mal.status).toBe(400);
    expect(JSON.stringify(mal.body)).toContain('Nivel de carga');

    await yo.post('/api/consultas/carga', { nivel: 'media', texto: 'Corrigiendo el TFM' });
    const r = await yo.post('/api/consultas/carga', { nivel: 'alta', texto: 'Exámenes' });
    expect(r.status).toBe(200);
    expect(r.body.data.actual).toMatchObject({ nivel: 'alta', texto: 'Exámenes' });
    expect(r.body.data.historial.map((h) => h.nivel)).toEqual(['alta', 'media']);
    expect(r.body.data.desactualizada).toBe(false);

    await query("UPDATE tutor_carga SET created_at = NOW() - INTERVAL '8 days' WHERE tutor_id = $1", [t]);
    expect((await carga.cargaDe(t)).desactualizada).toBe(true);

    // La carga es del tutor: administración sin rol de tutor no tiene «la suya».
    const sa = como({ userId: await crearUsuario('superadmin'), role: 'superadmin' });
    expect((await sa.get('/api/consultas/carga')).status).toBe(403);
  });

  it('con la carga «completa» no recibe consultas nuevas si hay otro tutor; si es el único, sí', async () => {
    if (!hayBase) return;
    const p = await crearCampus('Completa');
    const lleno = await tutorMatriculado(p, 160);
    const otro = await tutorMatriculado(p, 161);
    await carga.guardarCarga(lleno, { nivel: 'completa', texto: null }, lleno);
    expect(await servicio.elegirTutor(p, { preferido: lleno })).toBe(otro);
    await query('UPDATE users SET consultas_disponible = false WHERE id = $1', [otro]);
    expect(await servicio.elegirTutor(p)).toBe(lleno);
  });
});

describe('#189 · panel de tutores y campus sin tutor', () => {
  it('administración ve el nivel, el texto, la fecha y los datos reales; el tutor no', async () => {
    if (!hayBase) return;
    const p = await crearCampus('PanelT');
    const t = await tutorMatriculado(p, 170);
    await carga.guardarCarga(t, { nivel: 'baja', texto: 'Tranquilo' }, t);
    await alumnoDe(p, t, 2);
    const sa = como({ userId: await crearUsuario('superadmin'), role: 'superadmin' });
    const r = await sa.get(`/api/consultas/tutores-panel?projectId=${p}`);
    expect(r.status).toBe(200);
    expect(r.body.data.tutores).toHaveLength(1);
    expect(r.body.data.tutores[0]).toMatchObject({
      id: t, desactualizada: false, alumnos_activos: 1, alumnos_sin_mensajes: 1, consultas_abiertas: 0,
      carga: { nivel: 'baja', texto: 'Tranquilo' },
    });
    expect((await como({ userId: t, role: 'tutor' }).get('/api/consultas/tutores-panel')).status).toBe(403);
  });

  it('avisa del campus conectado sin tutor que pueda recibir consultas', async () => {
    if (!hayBase) return;
    const sin = await crearCampus('SinTutor');
    await conectar(sin);
    const ocupado = await crearCampus('Ocupado');
    await conectar(ocupado);
    await tutorMatriculado(ocupado, 180, { disponible: false });
    const con = await crearCampus('ConTutor');
    await conectar(con);
    await tutorMatriculado(con, 181);
    const sa = como({ userId: await crearUsuario('superadmin'), role: 'superadmin' });
    const ids3 = [sin, ocupado, con];
    const r = await Promise.all(ids3.map((p) => sa.get(`/api/consultas/campus-sin-tutor?projectId=${p}`)));
    expect(r.map((x) => x.body.data.map((c) => c.id))).toEqual([[sin], [ocupado], []]);
  });
});

describe('#189 · métricas', () => {
  it('media y mediana, en plazo, pendientes; sin las que empezó el tutor; cada tutor solo las suyas', async () => {
    if (!hayBase) return;
    const p = await crearCampus('Metricas');
    const a = await tutorMatriculado(p, 190);
    const b = await tutorMatriculado(p, 191);
    // A: 1 h, 2 h y 30 h (fuera de plazo) → mediana 2, media 11. Una cerrada a las 10 h.
    await consultaHecha(p, a, { horasRespuesta: 1, horasCierre: 10 });
    await consultaHecha(p, a, { horasRespuesta: 2 });
    await consultaHecha(p, a, { horasRespuesta: 30 });
    await consultaHecha(p, a, { horasRespuesta: 0.1, origen: 'tutor' });
    // B: una pendiente desde hace 48 h.
    await consultaHecha(p, b);

    const deA = await metricas({ tutorId: a });
    expect(deA.consultas).toMatchObject({
      volumen: 3, respondidas: 3, enPlazoPct: 67,
      primeraRespuestaHoras: { media: 11, mediana: 2 },
      resolucionHoras: { media: 10, mediana: 10 },
      pendientes: { total: 0 },
    });
    expect(deA.consultas.fueraDePlazo.map((f) => f.horas)).toEqual([30]);
    expect(deA.ranking).toBeUndefined();

    const api = await como({ userId: b, role: 'tutor' }).get('/api/consultas/metricas');
    expect(api.status).toBe(200);
    expect(api.body.data.consultas).toMatchObject({ volumen: 1, respondidas: 0, pendientes: { total: 1 } });
    expect(api.body.data.ranking).toBeUndefined();
    expect((await como({ userId: b, role: 'tutor' }).get('/api/consultas/metricas?todas=1')).status).toBe(403);

    const sa = como({ userId: await crearUsuario('superadmin'), role: 'superadmin' });
    const todas = await sa.get(`/api/consultas/metricas?todas=1&projectId=${p}`);
    expect(todas.status).toBe(200);
    expect(todas.body.data.consultas.volumen).toBe(4);
    expect(todas.body.data.ranking.tutores.map((t) => t.id)).toEqual([a, b]);
    expect(todas.body.data.ranking.campus).toHaveLength(1);
    const soloB = await sa.get(`/api/consultas/metricas?todas=1&projectId=${p}&tutorId=${b}`);
    expect(soloB.body.data.consultas.volumen).toBe(1);
    expect((await sa.get('/api/consultas/metricas?todas=1&desde=ayer')).status).toBe(400);
  });

  it('alumnos: % contactados y tiempo hasta el primer contacto', async () => {
    if (!hayBase) return;
    const p = await crearCampus('MetAlumnos');
    const t = await tutorMatriculado(p, 195);
    const a1 = await alumnoDe(p, t, 10);
    await alumnoDe(p, t, 4);
    await alumnoDe(p, t, 4);
    await alumnos.marcarContactado(p, t, Number(a1.alumno_moodle_id), new Date(Date.now() - 7 * 86400000));
    const m = await metricas({ tutorId: t });
    expect(m.alumnos).toMatchObject({ total: 3, sinMensajes: 2, contactadosPct: 33, matriculaAproximada: true });
    expect(m.alumnos.primerContactoDias.mediana).toBeCloseTo(3, 0);
  });
});

describe('#189 · resumen semanal al tutor', () => {
  it('cuenta los que faltan y, con el freno puesto, no envía nada', async () => {
    if (!hayBase) return;
    const p = await crearCampus('Resumen');
    const t = await tutorMatriculado(p, 199);
    await alumnoDe(p, t, 8);
    const r = await resumenDelTutor(t);
    expect(r.faltan).toHaveLength(1);
    expect(r.cargaDesactualizada).toBe(true);
    const envio = await enviarResumenes(new Date());
    expect(envio.mandados).toBe(0);
    expect(envio.frenados).toBeGreaterThanOrEqual(1);
  });
});

describe('#189 · lo que salió en la revisión final (18/10)', () => {
  it('un alumno en dos cursos del mismo tutor sale una vez, en la lista y en las métricas', async () => {
    if (!hayBase) return;
    const p = await crearCampus('DosCursos');
    const t = await tutorMatriculado(p, 210);
    alumnoN += 1;
    for (const [curso, dias] of [[1, 9], [2, 3]]) {
      await query(
        `INSERT INTO tutor_alumnos (project_id, tutor_id, alumno_moodle_id, curso_moodle_id, curso_nombre,
                                    alumno_nombre, matriculado_desde, activo, visto_at)
         VALUES ($1, $2, $3, $4, $5, 'Doble', NOW() - ($6 || ' days')::interval, true, NOW())`,
        [p, t, alumnoN, curso, `Curso ${curso}`, String(dias)]);
    }
    const l = await alumnos.sinMensajes({ tutorId: t });
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ dias: 9, color: 'rojo' });
    expect(l[0].curso_nombre).toMatch(/Curso 1/);
    expect(l[0].curso_nombre).toMatch(/Curso 2/);
    expect((await metricas({ tutorId: t })).alumnos).toMatchObject({ total: 1, sinMensajes: 1 });
  });

  it('los alumnos de un tutor que ya no está en el campus se dan de baja al sincronizar', async () => {
    if (!hayBase) return;
    const p = await crearCampus('TutorFuera');
    await conectar(p);
    const sigue = await tutorMatriculado(p, 220);
    const seVa = await tutorMatriculado(p, 221);
    await alumnoDe(p, seVa, 2);
    await query("UPDATE tutor_campus SET estado = 'baja' WHERE tutor_id = $1", [seVa]);
    const r = await alumnos.sincronizarAlumnos(p, { fetchImpl: moodle({ cursos: { 220: [] } }) });
    expect(r.bajas).toBeGreaterThanOrEqual(1);
    expect(await alumnos.sinMensajes({ tutorId: seVa })).toEqual([]);
    expect(sigue).toBeTruthy();
  });

  it('lee todas las conversaciones del tutor, de 500 en 500', async () => {
    if (!hayBase) return;
    const p = await crearCampus('Paginas');
    await conectar(p);
    const t = await tutorMatriculado(p, 230);
    // 501 conversaciones: el alumno 9501 está en la segunda página.
    const conv = Array.from({ length: 501 }, (_, i) => 9001 + i);
    const fetchImpl = moodle({
      cursos: { 230: [{ id: 7, fullname: 'Curso' }] },
      gente: { 7: [{ id: 230, fullname: 'Tutor', roles: ['editingteacher'] }, { id: 9501, fullname: 'Al final', roles: ['student'] }] },
      conversaciones: { 230: conv },
    });
    await alumnos.sincronizarAlumnos(p, { fetchImpl });
    expect(await alumnos.sinMensajes({ tutorId: t })).toEqual([]);
  });

  it('con la carga «completa», una consulta que se reabre sigue con su tutor', async () => {
    if (!hayBase) return;
    const p = await crearCampus('CompletaReabre');
    const lleno = await tutorMatriculado(p, 240);
    await tutorMatriculado(p, 241);
    const m = {
      projectId: p, conversacionId: 88240, alumno: { moodleId: 88240, nombre: 'Alumno' },
      texto: 'Hola', externoId: 882400, escritoAt: new Date(),
    };
    const { consulta } = await servicio.entraMensajeDelAlumno(m, { tutorPreferido: lleno, avisar: false });
    expect(consulta.tutor_id).toBe(lleno);
    await carga.guardarCarga(lleno, { nivel: 'completa', texto: null }, lleno);
    await query("UPDATE consultas SET estado = 'cerrada', cerrada_at = NOW() WHERE id = $1", [consulta.id]);
    const r = await servicio.entraMensajeDelAlumno({ ...m, externoId: 882401, escritoAt: new Date() }, { tutorPreferido: lleno, avisar: false });
    expect(r.reabierta).toBe(true);
    expect(r.consulta.tutor_id).toBe(lleno);
  });

  it('métricas: las fechas en días de Madrid, las cerradas sin respuesta hasta su cierre y las fechas imposibles dan 400', async () => {
    if (!hayBase) return;
    const p = await crearCampus('MetricasMadrid');
    const t = await tutorMatriculado(p, 250);
    // 1 de octubre a las 23:30 UTC = 2 de octubre a la 01:30 en Madrid.
    alumnoN += 1;
    await query(
      `INSERT INTO consultas (project_id, alumno_moodle_id, alumno_nombre, tutor_id, estado, origen, entrada_at, cerrada_at)
       VALUES ($1, $2, 'Madrugada', $3, 'cerrada', 'moodle', '2026-10-01T23:30:00Z', '2026-10-03T23:30:00Z')`, [p, alumnoN, t]);
    const dia2 = await metricas({ tutorId: t, desde: '2026-10-02', hasta: '2026-10-02' });
    expect(dia2.consultas.volumen).toBe(1);
    expect((await metricas({ tutorId: t, desde: '2026-10-01', hasta: '2026-10-01' })).consultas.volumen).toBe(0);
    // Cerrada sin responder a las 48 h: fuera de plazo con 48 h, no con lo que lleve hasta hoy.
    expect(dia2.consultas.fueraDePlazo.map((f) => f.horas)).toEqual([48]);
    const sa = como({ userId: await crearUsuario('superadmin'), role: 'superadmin' });
    expect((await sa.get('/api/consultas/metricas?todas=1&desde=2026-13-45')).status).toBe(400);
  });

  it('el resumen de los lunes mira la hora de Madrid, no la del servidor', async () => {
    const { enMadrid } = await import('../src/jobs/consultasResumenScheduler.js');
    expect(enMadrid(new Date('2026-10-19T07:30:00Z'))).toMatchObject({ diaSemana: 1, hora: 9, dia: '2026-10-19' });
    expect(enMadrid(new Date('2026-10-18T23:30:00Z'))).toMatchObject({ diaSemana: 1, hora: 1, dia: '2026-10-19' });
    expect(enMadrid(new Date('2026-12-21T08:30:00Z'))).toMatchObject({ diaSemana: 1, hora: 9 });
  });
});
