import fs from 'node:fs';
import {
  describe, it, expect, vi, beforeAll, afterAll, beforeEach,
} from 'vitest';

/**
 * El aviso de 48 h y el de la carga de trabajo se retiran solos.
 *
 * El caso real (26/11): una tutora recibe en la campana «1 entrega lleva más de 48 h sin
 * corregir» de dos cursos y «Actualiza tu carga de trabajo». Las entregas existían y
 * pasaban de las 48 h por una o dos horas; las corrigió enseguida. Pero el aviso no se
 * retiraba nunca: «estoy al día; actualizo, pero sigue apareciendo».
 *
 *  1. Corregida en Moodle → en la vuelta siguiente el aviso se marca resuelto y no sale.
 *  2. Si queda alguna de sus entregas por corregir, o el curso no se ha podido leer, se queda.
 *  3. Los avisos de antes de este cambio (sin claves) se retiran cuando ya no le queda
 *     ninguna de más de 48 h, y no si queda alguna.
 *  4. Guardar la carga retira «Actualiza tu carga de trabajo»; el de la semana siguiente
 *     sustituye al anterior.
 *  5. Revisión de la PR: si el alumno edita lo enviado antes de la nota (cambia la fecha),
 *     el aviso NO se retira; corregir desde el CRM lo retira al momento; si el aviso nuevo
 *     de carga no se crea, el anterior se queda; y si la guarda mientras se avisa, no queda
 *     ninguno.
 *
 * Contra la base LOCAL y un Moodle de mentira. Gemela de la prueba del CRM 360 (mismo
 * nombre); aquí `unreadCount` devuelve un número.
 */

vi.mock('../src/modules/tutores/tutor.campus.js', async (importOriginal) => ({
  ...(await importOriginal()),
  conexionDelCampus: vi.fn(async () => ({ url: 'https://campus48h.test', token: 'token-48h' })),
}));

const { default: pool } = await import('../src/shared/config/db.js');
const { encrypt } = await import('../src/shared/utils/crypto.js');
const { avisarEntregasSinCorregir, corregidaDesdeElCrm } = await import('../src/modules/tutores/tutor.entregasSinCorregir.js');
const { list, unreadCount } = await import('../src/modules/notifications/notifications.service.js');
const { guardarCarga } = await import('../src/modules/consultas/consultas.carga.js');
const { recordarCargas } = await import('../src/modules/consultas/consultas.plazos.js');

const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const MARCA = `a48${Date.now().toString(36)}`;
const AHORA = new Date('2026-11-24T20:00:00Z');
const H = 3600 * 1000;
const seg = (d) => Math.floor(d.getTime() / 1000);
const hace = (h, desde = AHORA) => seg(new Date(desde.getTime() - h * H));

// ─── El Moodle de mentira: la tutora (Moodle 10) da los cursos 7 y 8 ──────────────
// Como en el campus: un alumno por curso; la tarea 21 (curso 7) y la 47 (curso 8)
// llevan algo más de 48 h sin nota.
const profe = { id: 10, fullname: 'Tutora', roles: [{ shortname: 'editingteacher' }] };
const alumno = (id) => ({ id, fullname: `Alumno ${id}`, roles: [{ shortname: 'student' }] });
let ENTREGAS;
let NOTAS;
let cursoQueFalla;
function deSerie() {
  cursoQueFalla = null;
  ENTREGAS = {
    21: [{ userid: 11, status: 'submitted', timemodified: hace(49.4) }],
    22: [{ userid: 11, status: 'submitted', timemodified: hace(47.5) }],
    47: [{ userid: 12, status: 'submitted', timemodified: hace(49.9) }],
  };
  // La 22 la corrigió antes de las 48 h.
  NOTAS = { 21: [], 22: [{ userid: 11, grade: '97.00000', timemodified: hace(1) }], 47: [] };
}
const TAREAS = {
  7: [{ id: 21, cmid: 82, name: 'Tarea 1', grade: 100 }, { id: 22, cmid: 83, name: 'Tarea 2', grade: 100 }],
  8: [{ id: 47, cmid: 117, name: 'Tarea 3', grade: 100 }],
};
const lista = (params, prefijo) => Object.entries(params).filter(([k]) => k.startsWith(prefijo)).map(([, v]) => Number(v));
vi.stubGlobal('fetch', vi.fn(async (url, { body } = {}) => {
  const params = Object.fromEntries(new URLSearchParams(body));
  const f = params.wsfunction;
  let r = {};
  if (f === 'core_enrol_get_users_courses') {
    r = [{ id: 7, fullname: 'Análisis forense de dispositivos móviles y mensajería' }, { id: 8, fullname: 'Análisis forense de dispositivos móviles' }];
  }
  if (f === 'core_enrol_get_enrolled_users') {
    const c = Number(params.courseid);
    r = cursoQueFalla === c
      ? { exception: 'dml_exception', errorcode: 'dbconnectionfailed', message: 'Database connection failed' }
      : [profe, alumno(c === 7 ? 11 : 12)];
  }
  if (f === 'mod_assign_get_assignments') {
    r = { courses: lista(params, 'courseids').map((id) => ({ id, assignments: TAREAS[id] || [] })) };
  }
  if (f === 'mod_assign_get_submissions') {
    r = { assignments: lista(params, 'assignmentids').map((id) => ({ assignmentid: id, submissions: ENTREGAS[id] || [] })) };
  }
  if (f === 'mod_assign_get_grades') {
    r = { assignments: lista(params, 'assignmentids').map((id) => ({ assignmentid: id, grades: NOTAS[id] || [] })) };
  }
  return { ok: true, status: 200, json: async () => r };
}));

/** La tutora pone la nota en Moodle (después de la entrega). */
const corregir = (tarea, alumnoId, cuando) => {
  NOTAS[tarea] = [{ userid: alumnoId, grade: '95.00000', timemodified: seg(cuando) }];
};

let P;
let TUTORA;
beforeAll(async () => {
  const [p] = await q(
    `INSERT INTO projects (nombre, slug, webhook_api_key, active) VALUES ($1, $2, $3, true) RETURNING id`,
    [`Campus ${MARCA}`, `campus-${MARCA}`, `k-${MARCA}`]);
  P = Number(p.id);
  const enc = encrypt('token-48h');
  await q(
    `INSERT INTO project_integrations (project_id, provider, active, encrypted_value, iv, auth_tag, config_public)
     VALUES ($1, 'moodle', true, $2, $3, $4, $5)`,
    [P, enc.encrypted, enc.iv, enc.authTag, JSON.stringify({ url: 'https://campus48h.test', consultas: true })]);
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role, active) VALUES ($1, $2, 'x', 'tutor', true) RETURNING id`,
    [`${MARCA} tutora`, `tutora@${MARCA}.test`]);
  TUTORA = Number(u.id);
  await q(`INSERT INTO tutor_campus (tutor_id, project_id, estado, moodle_user_id) VALUES ($1, $2, 'activa', 10)`, [TUTORA, P]);
}, 60000);

const limpiar = async () => {
  await q('DELETE FROM entregas_sin_corregir_avisos WHERE project_id = $1', [P]);
  await q('DELETE FROM admin_notifications WHERE target_user_ids && $1::int[]', [[TUTORA]]);
  await q('DELETE FROM tutor_carga WHERE tutor_id = $1', [TUTORA]);
  await q('DELETE FROM tutor_carga_recordatorios WHERE tutor_id = $1', [TUTORA]);
};
beforeEach(async () => { deSerie(); await limpiar(); });

afterAll(async () => {
  await limpiar();
  await q('DELETE FROM tutor_campus WHERE tutor_id = $1', [TUTORA]);
  await q('DELETE FROM users WHERE id = $1', [TUTORA]);
  await q('DELETE FROM project_integrations WHERE project_id = $1', [P]);
  await q('DELETE FROM projects WHERE id = $1', [P]);
  await pool.end();
}, 60000);

const enviar = vi.fn(async () => ({ sent: true }));
const vuelta = (ahora) => avisarEntregasSinCorregir({ ahora, enviar, tutorIds: [TUTORA], freno: true, activo: true });
/** Lo que ve la tutora en la campana. */
const campana = async (tipo = 'entregas_sin_corregir') => (await list({ userId: TUTORA, role: 'tutor' }))
  .filter((n) => n.type === tipo);
const enLaBase = (tipo = 'entregas_sin_corregir') => q(
  'SELECT id, metadata, read_by_user_ids FROM admin_notifications WHERE type = $1 AND $2 = ANY(target_user_ids) ORDER BY id',
  [tipo, TUTORA]);

describe('el aviso de 48 h se retira cuando ya está corregido', () => {
  it('el caso real: un aviso por curso, los corrige y al final no queda ninguno en la campana', async () => {
    // La cronología del campus (24/11), con vueltas cada 2 h:
    ENTREGAS[47] = [{ userid: 12, status: 'submitted', timemodified: hace(47.9) }];
    // 1.ª vuelta: la tarea 21 acaba de pasar de las 48 h → aviso del curso 7.
    await vuelta(AHORA);
    expect((await campana()).map((n) => n.message)).toEqual(['Análisis forense de dispositivos móviles y mensajería']);
    // Corrige la 21 (y la 22, que aún no había llegado a las 48 h).
    corregir(21, 11, new Date(AHORA.getTime() + 0.5 * H));
    corregir(22, 11, new Date(AHORA.getTime() + 0.4 * H));
    // 2.ª vuelta: la 47 pasa de las 48 h → aviso del curso 8; el del curso 7 se retira.
    await vuelta(new Date(AHORA.getTime() + 2 * H));
    expect((await campana()).map((n) => n.message)).toEqual(['Análisis forense de dispositivos móviles']);
    expect(await unreadCount(TUTORA, 'tutor')).toBe(1);
    // Corrige la 47. 3.ª vuelta: ya no queda nada. Antes, aquí seguían los dos avisos.
    corregir(47, 12, new Date(AHORA.getTime() + 2.5 * H));
    const r = await vuelta(new Date(AHORA.getTime() + 4 * H));
    expect(r.retirados).toBe(1);
    expect(await campana()).toEqual([]);
    expect(await unreadCount(TUTORA, 'tutor')).toBe(0);
    // No se borra: queda resuelto, leído y con el motivo.
    const filas = await enLaBase();
    expect(filas).toHaveLength(2);
    for (const f of filas) {
      expect(f.metadata.resuelta).toBe('corregidas');
      expect(f.metadata.resuelta_at).toBeTruthy();
      expect(f.read_by_user_ids).toContain(TUTORA);
    }
  });

  it('con una sola vuelta: aviso → corrige → la siguiente lo retira (y no vuelve a avisar)', async () => {
    await vuelta(AHORA);
    expect(await campana()).toHaveLength(1);
    const [n] = await enLaBase();
    expect(n.metadata.claves).toHaveLength(2); // tareas 21 y 47
    expect(n.metadata.cursos.sort()).toEqual([`${P}-7`, `${P}-8`]);

    corregir(21, 11, new Date(AHORA.getTime() + H));
    corregir(47, 12, new Date(AHORA.getTime() + H));
    const r = await vuelta(new Date(AHORA.getTime() + 2 * H));
    expect(r).toMatchObject({ retirados: 1, avisadas: 0 });
    expect(await campana()).toEqual([]);
  });

  it('si queda una de sus entregas por corregir, el aviso se queda', async () => {
    await vuelta(AHORA);
    corregir(21, 11, new Date(AHORA.getTime() + H)); // la 47 sigue sin nota
    const r = await vuelta(new Date(AHORA.getTime() + 2 * H));
    expect(r.retirados).toBe(0);
    expect(await campana()).toHaveLength(1);
  });

  it('si el alumno vuelve a entregar después de la nota, el aviso se queda hasta que se corrija lo nuevo', async () => {
    await vuelta(AHORA);
    corregir(21, 11, new Date(AHORA.getTime() + H));
    corregir(47, 12, new Date(AHORA.getTime() + H));
    ENTREGAS[47] = [{ userid: 12, status: 'submitted', timemodified: seg(new Date(AHORA.getTime() + 1.5 * H)) }];
    expect((await vuelta(new Date(AHORA.getTime() + 2 * H))).retirados).toBe(0);
    expect(await campana()).toHaveLength(1);
    // A las 48 h de la nueva, su propio aviso (es otra entrega).
    await vuelta(new Date(AHORA.getTime() + 52 * H));
    expect(await campana()).toHaveLength(2);
    corregir(47, 12, new Date(AHORA.getTime() + 53 * H));
    expect((await vuelta(new Date(AHORA.getTime() + 54 * H))).retirados).toBe(2);
    expect(await campana()).toEqual([]);
  });

  it('si el alumno edita lo enviado ANTES de la nota (cambia la fecha), el aviso no se retira', async () => {
    await vuelta(AHORA);
    corregir(21, 11, new Date(AHORA.getTime() + H));
    // La 47 sigue sin nota, pero el alumno la edita: Moodle le cambia `timemodified`.
    ENTREGAS[47] = [{ userid: 12, status: 'submitted', timemodified: seg(new Date(AHORA.getTime() + 1.5 * H)) }];
    const r = await vuelta(new Date(AHORA.getTime() + 2 * H));
    expect(r.retirados).toBe(0);
    const [n] = await campana();
    expect(n).toBeTruthy();
    const [f] = await enLaBase();
    expect(f.metadata.resuelta).toBeUndefined();
  });

  it('corregir desde el CRM lo retira al momento, cuando ya están todas las del aviso', async () => {
    await vuelta(AHORA); // un aviso con la 21 y la 47
    expect(await corregidaDesdeElCrm(TUTORA, { projectId: P, tareaId: 21, alumnoId: 11 })).toBe(0);
    expect(await campana()).toHaveLength(1);
    const [f] = await enLaBase();
    expect(f.metadata.corregidas).toEqual([`${P}-21-11`]);
    // Una entrega que no es de ningún aviso no toca nada.
    expect(await corregidaDesdeElCrm(TUTORA, { projectId: P, tareaId: 22, alumnoId: 11 })).toBe(0);
    expect(await corregidaDesdeElCrm(TUTORA, { projectId: P, tareaId: 47, alumnoId: 12 })).toBe(1);
    expect(await campana()).toEqual([]);
    // Y `calificar` la llama tras poner la nota.
    const fuente = fs.readFileSync(new URL('../src/modules/tutores/tutor.correccion.js', import.meta.url), 'utf8');
    expect(fuente).toMatch(/olvidarFichas\(\);\s*\/\/[^\n]*\n\s*await corregidaDesdeElCrm\(tutorId,/);
  });

  it('si un curso del aviso no se ha podido leer, no se sabe: se queda', async () => {
    await vuelta(AHORA);
    corregir(21, 11, new Date(AHORA.getTime() + H));
    corregir(47, 12, new Date(AHORA.getTime() + H));
    cursoQueFalla = 8;
    const r = await vuelta(new Date(AHORA.getTime() + 2 * H));
    expect(r.retirados).toBe(0);
    expect(await campana()).toHaveLength(1);
    cursoQueFalla = null;
    expect((await vuelta(new Date(AHORA.getTime() + 3 * H))).retirados).toBe(1);
  });

  it('los avisos de antes de este cambio (sin claves) se retiran cuando no le queda ninguna de más de 48 h', async () => {
    const viejo = () => q(
      `INSERT INTO admin_notifications (type, title, message, link_path, metadata, target_user_ids)
       VALUES ('entregas_sin_corregir', '1 entrega lleva más de 48 h sin corregir', 'Curso', '/mis-cursos/campus', $1, $2)`,
      [{ tutor_id: TUTORA, entregas: 1 }, [TUTORA]]);
    await viejo();
    // Le quedan dos de más de 48 h: se queda.
    await q('DELETE FROM entregas_sin_corregir_avisos WHERE project_id = $1', [P]);
    expect((await vuelta(AHORA)).retirados).toBe(0);
    await q(`DELETE FROM admin_notifications WHERE type = 'entregas_sin_corregir' AND metadata ? 'claves' AND $1 = ANY(target_user_ids)`, [TUTORA]);
    expect(await campana()).toHaveLength(1);
    // Todo corregido: se retira.
    corregir(21, 11, new Date(AHORA.getTime() + H));
    corregir(47, 12, new Date(AHORA.getTime() + H));
    expect((await vuelta(new Date(AHORA.getTime() + 2 * H))).retirados).toBe(1);
    expect(await campana()).toEqual([]);
  });
});

describe('«Actualiza tu carga de trabajo» se retira al actualizarla', () => {
  it('guardar la carga retira el aviso', async () => {
    await recordarCargas({ ahora: AHORA, enviar, tutorIds: [TUTORA] });
    expect(await campana('carga_desactualizada')).toHaveLength(1);
    await guardarCarga(TUTORA, { nivel: 'media', texto: 'Al día' }, TUTORA);
    expect(await campana('carga_desactualizada')).toEqual([]);
    const [f] = await enLaBase('carga_desactualizada');
    expect(f.metadata.resuelta).toBe('actualizada');
  });

  it('si el aviso nuevo de carga no se puede crear, el de la semana pasada se queda', async () => {
    await recordarCargas({ ahora: AHORA, enviar, tutorIds: [TUTORA] });
    // Que el INSERT del siguiente falle (`notifyUsers` se traga el error). Solo el INSERT:
    // retirar el anterior (un UPDATE) tiene que poder hacerse, para que la prueba distinga.
    await q(`CREATE OR REPLACE FUNCTION prueba_sin_avisos_de_carga() RETURNS trigger AS $f$
             BEGIN RAISE EXCEPTION 'aviso de carga rechazado (prueba)'; END $f$ LANGUAGE plpgsql`);
    await q(`CREATE TRIGGER prueba_sin_avisos_de_carga BEFORE INSERT ON admin_notifications FOR EACH ROW
             WHEN (NEW.type = 'carga_desactualizada') EXECUTE FUNCTION prueba_sin_avisos_de_carga()`);
    try {
      await recordarCargas({ ahora: new Date(AHORA.getTime() + 8 * 24 * H), enviar, tutorIds: [TUTORA] });
    } finally {
      await q('DROP TRIGGER IF EXISTS prueba_sin_avisos_de_carga ON admin_notifications');
      await q('DROP FUNCTION IF EXISTS prueba_sin_avisos_de_carga()');
    }
    expect(await campana('carga_desactualizada')).toHaveLength(1);
  });

  it('si la guarda justo mientras se le avisa, no queda ningún aviso', async () => {
    // Al crearse el aviso, «la tutora» guarda su carga (la carrera, hecha a propósito).
    await q(`CREATE OR REPLACE FUNCTION prueba_guarda_al_avisar() RETURNS trigger AS $f$
             BEGIN
               INSERT INTO tutor_carga (tutor_id, nivel, texto, creado_por) VALUES (NEW.target_user_ids[1], 'media', 'Al día', NEW.target_user_ids[1]);
               RETURN NEW;
             END $f$ LANGUAGE plpgsql`);
    await q(`CREATE TRIGGER prueba_guarda_al_avisar AFTER INSERT ON admin_notifications FOR EACH ROW
             WHEN (NEW.type = 'carga_desactualizada') EXECUTE FUNCTION prueba_guarda_al_avisar()`);
    try {
      await recordarCargas({ ahora: new Date(), enviar, tutorIds: [TUTORA] });
    } finally {
      await q('DROP TRIGGER IF EXISTS prueba_guarda_al_avisar ON admin_notifications');
      await q('DROP FUNCTION IF EXISTS prueba_guarda_al_avisar()');
    }
    expect(await enLaBase('carga_desactualizada')).toHaveLength(1);
    expect(await campana('carga_desactualizada')).toEqual([]);
  });

  it('el recordatorio de la semana siguiente sustituye al anterior: uno solo en la campana', async () => {
    await recordarCargas({ ahora: AHORA, enviar, tutorIds: [TUTORA] });
    await recordarCargas({ ahora: new Date(AHORA.getTime() + 8 * 24 * H), enviar, tutorIds: [TUTORA] });
    expect(await enLaBase('carga_desactualizada')).toHaveLength(2);
    expect(await campana('carga_desactualizada')).toHaveLength(1);
  });
});
