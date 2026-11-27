import {
  describe, it, expect, vi, beforeAll, afterAll,
} from 'vitest';

/**
 * Los avisos de plazo de las consultas se retiran solos (CRM#1197 / CRM-ISEIE#831).
 *
 * «Un alumno espera respuesta» (al tutor) y «Consulta fuera de plazo» (a administración)
 * se quedaban en la campana con la consulta ya respondida o cerrada.
 *
 *  1. Responder desde el CRM retira los dos avisos de esa consulta: la campana de la tutora
 *     queda a 0 de esa consulta; otra consulta suya sigue con su aviso.
 *  2. Responder desde el campus y cerrar, lo mismo.
 *  3. Si la retirada falla, la respuesta se guarda igual.
 *  4. En la vuelta de los plazos: los que ya no aplican por otro camino (respondida sin
 *     pasar por aquí, otra espera, el «cerca» de un tutor al que se le quitó la consulta);
 *     el de administración de una reasignada se queda (sigue sin respuesta).
 *  5. Los antiguos sin `consulta_id`: se retiran cuando ya no queda ninguna pasada de su
 *     umbral, y no si queda alguna.
 *
 * Contra la base LOCAL.
 */

const fallo = vi.hoisted(() => ({ retirar: false }));
vi.mock('../src/modules/notifications/notifications.service.js', async (importOriginal) => {
  const orig = await importOriginal();
  return {
    ...orig,
    resolverAvisos: vi.fn(async (...args) => {
      if (fallo.retirar) throw new Error('la base no contesta');
      return orig.resolverAvisos(...args);
    }),
  };
});

const { query } = await import('../src/shared/config/db.js');
const { list, unreadCount } = await import('../src/modules/notifications/notifications.service.js');
const model = await import('../src/modules/consultas/consultas.model.js');
const { revisarPlazos, PARTE_DEL_PLAZO } = await import('../src/modules/consultas/consultas.plazos.js');

const { PLAZO_HORAS } = model;
const marca = `t1197${Date.now()}`;
const ids = { users: [], projects: [], consultas: [], avisos: [] };
let hayBase = true;
let porQueNo = null;
let n = 0;

const sinCorreo = vi.fn(async () => ({ sent: true }));

async function crearUsuario(role) {
  n += 1;
  const { rows } = await query(
    `INSERT INTO users (nombre, email, password_hash, role, active) VALUES ($1, $2, 'x', $3, true) RETURNING id`,
    [`${role} ${n} ${marca}`, `${role}.${n}.${marca}@test.local`, role]);
  ids.users.push(rows[0].id);
  return Number(rows[0].id);
}

async function crearCampus() {
  n += 1;
  const { rows } = await query(
    `INSERT INTO projects (nombre, slug, webhook_api_key, active) VALUES ($1, $2, $3, true) RETURNING id`,
    [`Campus ${marca} ${n}`, `c1197-${marca}-${n}`, `k-${marca}-${n}`]);
  ids.projects.push(rows[0].id);
  return Number(rows[0].id);
}

async function tutorDe(projectId) {
  const t = await crearUsuario('tutor');
  await query('INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, true)', [t, projectId]);
  await query(`INSERT INTO tutor_campus (tutor_id, project_id, estado, moodle_user_id) VALUES ($1, $2, 'activa', $3)`, [t, projectId, 7000 + n]);
  return t;
}

async function adminDe(projectId) {
  const a = await crearUsuario('admin');
  await query('INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, true)', [a, projectId]);
  return a;
}

/** Una consulta abierta que espera desde hace `horas`, con su conversación de Moodle. */
async function consulta(projectId, tutorId, horas) {
  n += 1;
  const { rows } = await query(
    `INSERT INTO consultas (project_id, alumno_moodle_id, alumno_nombre, tutor_id, estado, conversacion_externa_id,
                            entrada_at, espera_desde)
     VALUES ($1, $2, $3, $4, 'abierta', $5, NOW() - make_interval(secs => $6::float8 * 3600),
             NOW() - make_interval(secs => $6::float8 * 3600))
     RETURNING id, alumno_moodle_id, conversacion_externa_id`,
    [projectId, 9000 + n, `Alumno ${n}`, tutorId, 50000 + n, horas]);
  ids.consultas.push(rows[0].id);
  return { id: Number(rows[0].id), alumno: Number(rows[0].alumno_moodle_id), conversacion: Number(rows[0].conversacion_externa_id) };
}

/** Pasada del plazo: el tutor tiene su «cerca» y administración su «fuera de plazo». */
const pasada = (p, t) => consulta(p, t, PLAZO_HORAS + 2);

/** Los avisos de plazo de una consulta que siguen en la campana (sin retirar). */
const abiertos = async (consultaId) => (await query(
  `SELECT type FROM admin_notifications WHERE (metadata->>'consulta_id')::int = $1 AND NOT (metadata ? 'resuelta_at')
    ORDER BY type`, [consultaId])).rows.map((r) => r.type);
const motivo = async (consultaId, type) => (await query(
  `SELECT metadata->>'resuelta' AS m FROM admin_notifications WHERE (metadata->>'consulta_id')::int = $1 AND type = $2`,
  [consultaId, type])).rows.map((r) => r.m);
/** En la campana de esa persona, los avisos de plazo de esa consulta. */
const enLaCampana = async (userId, role, consultaId) => (await list({ userId, role }))
  .filter((a) => Number(a.metadata?.consulta_id) === consultaId && a.type.startsWith('consulta_'));
// En ISEIE `unreadCount` devuelve un número (en el 360, { accion, aviso }).
const accionDe = (userId, role) => unreadCount(userId, role);

const LOS_DOS = ['consulta_cerca_del_plazo', 'consulta_fuera_de_plazo'];

beforeAll(async () => {
  try {
    const t = await query(`SELECT COUNT(*)::int AS b FROM information_schema.columns
      WHERE table_name = 'consultas' AND column_name = 'aviso_fuera_plazo_at'`);
    if (t.rows[0].b !== 1) throw new Error('Faltan las migraciones de consultas.');
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
  }
});

afterAll(async () => {
  for (const [sql, p] of [
    [`DELETE FROM admin_notifications WHERE (metadata->>'consulta_id')::int = ANY($1::int[])`, [ids.consultas]],
    ['DELETE FROM admin_notifications WHERE id = ANY($1::int[])', [ids.avisos]],
    ['DELETE FROM consulta_eventos WHERE consulta_id = ANY($1::int[])', [ids.consultas]],
    ['DELETE FROM consulta_mensajes WHERE consulta_id = ANY($1::int[])', [ids.consultas]],
    ['DELETE FROM consultas WHERE project_id = ANY($1::int[])', [ids.projects]],
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

describe('#1197 · al responder o cerrar, los avisos de esa consulta se van', () => {
  it('responder desde el CRM: la campana de la tutora queda a 0; otra consulta sigue con su aviso', async () => {
    if (!hayBase) return;
    const p = await crearCampus();
    const t = await tutorDe(p);
    const a = await adminDe(p);
    const una = await pasada(p, t);
    const otra = await pasada(p, t);
    const r = await revisarPlazos({ projectIds: [p], enviar: sinCorreo });
    expect(r).toMatchObject({ recordatorios: 2, fueraDePlazo: 2 });
    expect(await abiertos(una.id)).toEqual(LOS_DOS);
    expect(await accionDe(t, 'tutor')).toBe(2);

    await model.guardarRespuestaDelCrm(una.id, t, 'Hola, ya está resuelto.');

    expect(await abiertos(una.id)).toEqual([]);
    expect(await motivo(una.id, 'consulta_cerca_del_plazo')).toEqual(['respondida']);
    expect(await enLaCampana(t, 'tutor', una.id)).toHaveLength(0);
    expect(await enLaCampana(a, 'admin', una.id)).toHaveLength(0);
    // La otra consulta sigue pidiendo respuesta.
    expect(await abiertos(otra.id)).toEqual(LOS_DOS);
    expect(await enLaCampana(t, 'tutor', otra.id)).toHaveLength(1);
    expect(await accionDe(t, 'tutor')).toBe(1);

    await model.guardarRespuestaDelCrm(otra.id, t, 'Y esta también.');
    expect(await accionDe(t, 'tutor')).toBe(0);
    expect(await abiertos(otra.id)).toEqual([]);
  });

  it('responder desde el campus y cerrar, lo mismo', async () => {
    if (!hayBase) return;
    const p = await crearCampus();
    const t = await tutorDe(p);
    await adminDe(p);
    const desdeMoodle = await pasada(p, t);
    const cerrada = await pasada(p, t);
    await revisarPlazos({ projectIds: [p], enviar: sinCorreo });
    expect(await abiertos(desdeMoodle.id)).toEqual(LOS_DOS);

    await model.guardarRespuestaDesdeElCampus({
      projectId: p, conversacionId: desdeMoodle.conversacion, alumnoMoodleId: desdeMoodle.alumno, tutorId: t,
      texto: 'Contestado en el campus', externoId: 880000 + n, escritoAt: new Date(),
    });
    expect(await abiertos(desdeMoodle.id)).toEqual([]);
    expect(await abiertos(cerrada.id)).toEqual(LOS_DOS);

    await model.cerrar(cerrada.id, t);
    expect(await abiertos(cerrada.id)).toEqual([]);
    expect(await motivo(cerrada.id, 'consulta_fuera_de_plazo')).toEqual(['cerrada']);
    expect(await accionDe(t, 'tutor')).toBe(0);
  });

  it('si la retirada falla, la respuesta se guarda igual (el aviso es accesorio)', async () => {
    if (!hayBase) return;
    const p = await crearCampus();
    const t = await tutorDe(p);
    const c = await pasada(p, t);
    await revisarPlazos({ projectIds: [p], enviar: sinCorreo });
    const antes = await abiertos(c.id);
    expect(antes).toContain('consulta_cerca_del_plazo');
    fallo.retirar = true;
    try {
      const r = await model.guardarRespuestaDelCrm(c.id, t, 'Respuesta');
      expect(r?.mensaje?.id).toBeTruthy();
      expect(await model.cerrar(c.id, t)).toBe(true);
    } finally {
      fallo.retirar = false;
    }
    const { rows } = await query('SELECT estado FROM consultas WHERE id = $1', [c.id]);
    expect(rows[0].estado).toBe('cerrada');
    // Se queda hasta la vuelta siguiente, que lo retira.
    expect(await abiertos(c.id)).toEqual(antes);
    const r = await revisarPlazos({ projectIds: [p], enviar: sinCorreo });
    expect(r.retirados).toBe(antes.length);
    expect(await abiertos(c.id)).toEqual([]);
  });
});

describe('#1197 · en la vuelta de los plazos', () => {
  it('retira lo que ya no aplica por otro camino; el de administración de una reasignada se queda', async () => {
    if (!hayBase) return;
    const p = await crearCampus();
    const t = await tutorDe(p);
    const otroTutor = await tutorDe(p);
    await adminDe(p);
    const porOtroLado = await pasada(p, t);
    const otraEspera = await pasada(p, t);
    const reasignada = await pasada(p, t);
    const sigue = await pasada(p, t);
    await revisarPlazos({ projectIds: [p], enviar: sinCorreo });

    // Respondida sin pasar por el modelo (p. ej. una versión anterior del lector).
    await query(`UPDATE consultas SET estado = 'respondida', espera_desde = NULL WHERE id = $1`, [porOtroLado.id]);
    // El alumno volvió a escribir después del aviso: es otra espera.
    await query('UPDATE consultas SET espera_desde = NOW() + INTERVAL \'1 second\' WHERE id = $1', [otraEspera.id]);
    await model.reasignar(reasignada.id, otroTutor, null);

    const r = await revisarPlazos({ projectIds: [p], enviar: sinCorreo });
    expect(r.retirados).toBe(5);
    expect(await abiertos(porOtroLado.id)).toEqual([]);
    expect(await motivo(porOtroLado.id, 'consulta_cerca_del_plazo')).toEqual(['respondida']);
    expect(await abiertos(otraEspera.id)).toEqual([]);
    expect(await motivo(otraEspera.id, 'consulta_cerca_del_plazo')).toEqual(['otra_espera']);
    // Reasignada: el «cerca» del tutor de antes sobra; administración sigue avisada.
    expect(await abiertos(reasignada.id)).toEqual(['consulta_fuera_de_plazo']);
    expect(await motivo(reasignada.id, 'consulta_cerca_del_plazo')).toEqual(['reasignada']);
    expect(await abiertos(sigue.id)).toEqual(LOS_DOS);

    expect((await revisarPlazos({ projectIds: [p], enviar: sinCorreo })).retirados).toBe(0);
  });

  it('los antiguos sin consulta_id: se van cuando ya no queda ninguna pasada, y no antes', async () => {
    if (!hayBase) return;
    const p = await crearCampus();
    const t = await tutorDe(p);
    const a = await adminDe(p);
    const c = await consulta(p, t, PLAZO_HORAS * PARTE_DEL_PLAZO + 1);
    // Ya se le recordó y se avisó en esta espera: la vuelta no crea avisos nuevos.
    await query('UPDATE consultas SET recordatorio_plazo_at = NOW(), aviso_fuera_plazo_at = NOW() WHERE id = $1', [c.id]);
    const viejo = async (type, target, metadata) => {
      const { rows } = await query(
        `INSERT INTO admin_notifications (type, title, target_user_ids, metadata) VALUES ($1, 'Aviso de antes', $2, $3)
         RETURNING id`, [type, [target], metadata]);
      ids.avisos.push(rows[0].id);
      return Number(rows[0].id);
    };
    const cerca = await viejo('consulta_cerca_del_plazo', t, { project_id: p });
    const fuera = await viejo('consulta_fuera_de_plazo', a, { project_id: p, tutor_id: t });
    const sigue = async (id) => (await query(`SELECT NOT (metadata ? 'resuelta_at') AS s FROM admin_notifications WHERE id = $1`, [id])).rows[0].s;

    // La consulta pasa del recordatorio pero no del plazo de administración.
    await revisarPlazos({ projectIds: [p], enviar: sinCorreo });
    expect(await sigue(cerca)).toBe(true);
    expect(await sigue(fuera)).toBe(false);

    await model.guardarRespuestaDelCrm(c.id, t, 'Respuesta');
    await revisarPlazos({ projectIds: [p], enviar: sinCorreo });
    expect(await sigue(cerca)).toBe(false);
    expect(await accionDe(t, 'tutor')).toBe(0);
  });
});
