import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';

// Brevo simulado: aquí no sale ningún correo de verdad, y se ve qué se habría
// mandado y a quién.
const sendEmail = vi.fn(async () => ({ sent: true }));
vi.mock('../src/shared/services/brevo.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendEmail,
}));

const supertest = (await import('supertest')).default;
const jwt = (await import('jsonwebtoken')).default;
const app = (await import('../src/app.js')).default;
const pool = (await import('../src/shared/config/db.js')).default;
const { runTasksDailySummary, horaLocal } = await import('../src/jobs/tasksDailySummaryJob.js');

/**
 * Correos del tablero (Diego, 07/10, parte C): asignada, devuelta, aprobada,
 * comentario nuevo y el de cada mañana. Se configuran, no se envían: con
 * TAREAS_CORREOS_ACTIVOS apagado se arman y se registran sin llamar a Brevo.
 */

const request = supertest(app);
const MARCA = `TASKSMAIL_${Date.now().toString(36)}`;
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const one = async (sql, params) => (await q(sql, params))[0];

const U = {};
const T = {};

async function persona(clave, role) {
  const u = await one(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, email, role`,
    [`${MARCA} ${clave}`, `${clave}_${MARCA.toLowerCase()}@test.local`, role]
  );
  U[clave] = u;
  T[clave] = jwt.sign({ userId: u.id, email: u.email, role, roles_extra: [], customRoleId: null },
    process.env.JWT_SECRET, { expiresIn: '1h' });
}
const como = (clave) => ({ Authorization: `Bearer ${T[clave]}` });

/** Los correos que se habrían mandado a esta persona. */
const correosA = (clave) => sendEmail.mock.calls
  .map(([arg]) => arg)
  .filter((c) => c.to?.[0]?.email === U[clave].email);

async function tareaEnRevision(titulo) {
  // 26/10/2026: aprobar y devolver es del supervisor (o del superadmin).
  const t = (await request.post('/api/tasks').set(como('admin'))
    .send({ title: titulo, assigned_to: U.colaborador.id, supervisor_id: U.admin.id })).body.data;
  await request.patch(`/api/tasks/${t.id}/move`).set(como('colaborador')).send({ status: 'en_revision' });
  return t;
}

let campus;

beforeAll(async () => {
  await persona('admin', 'admin');
  await persona('colaborador', 'colaborador');
  await persona('silencioso', 'colaborador');
  // Todos en un campus: un admin solo asigna a gente de sus campus (09/10).
  campus = await one(
    'INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
    [`${MARCA} Campus`, `${MARCA.toLowerCase()}-campus`, `${MARCA}-campus`]
  );
  for (const u of Object.values(U)) {
    await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, campus.id]);
  }
  // «silencioso» apagó en Mis preferencias todos los correos de tareas.
  for (const aviso of ['tarea_asignada', 'tarea_devuelta', 'tarea_cerrada', 'tarea_comentario', 'tareas_del_dia']) {
    await q('INSERT INTO avisos_apagados (user_id, aviso) VALUES ($1, $2)', [U.silencioso.id, aviso]);
  }
});

afterAll(async () => {
  const ids = Object.values(U).map((u) => u.id);
  await q('DELETE FROM tasks WHERE created_by = ANY($1::int[]) OR assigned_to = ANY($1::int[])', [ids]);
  await q('DELETE FROM admin_notifications WHERE target_user_ids && $1::int[]', [ids]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids]);
  await q('DELETE FROM projects WHERE id = $1', [campus.id]);
  await pool.end();
});

beforeEach(() => sendEmail.mockClear());
afterEach(() => { delete process.env.TAREAS_CORREOS_ACTIVOS; });

describe('con TAREAS_CORREOS_ACTIVOS apagado (por defecto)', () => {
  it('ninguna acción llama a Brevo', async () => {
    delete process.env.TAREAS_CORREOS_ACTIVOS;
    const t = await tareaEnRevision('Apagado: devolver');
    await request.patch(`/api/tasks/${t.id}/return`).set(como('admin')).send({ comment: 'Falta el SEO' });
    await request.post(`/api/tasks/${t.id}/comments`).set(como('admin')).send({ content: 'Mira esto' });
    await request.patch(`/api/tasks/${t.id}/move`).set(como('colaborador')).send({ status: 'en_revision' });
    await request.patch(`/api/tasks/${t.id}/approve`).set(como('admin'));
    await q("UPDATE tasks SET due_date = NOW() - INTERVAL '1 day' WHERE id = $1", [t.id]);
    await runTasksDailySummary({ forzar: true });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('«false» escrito en el .env también es apagado', async () => {
    process.env.TAREAS_CORREOS_ACTIVOS = 'false';
    await request.post('/api/tasks').set(como('admin')).send({ title: 'x', assigned_to: U.colaborador.id });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('con TAREAS_CORREOS_ACTIVOS encendido', () => {
  beforeEach(() => { process.env.TAREAS_CORREOS_ACTIVOS = 'true'; });

  it('asignada: a la persona asignada, con el título', async () => {
    await request.post('/api/tasks').set(como('admin')).send({ title: 'Correo: asignada', assigned_to: U.colaborador.id });
    const [c] = correosA('colaborador');
    expect(c.subject).toBe('Tarea asignada: Correo: asignada');
    expect(c.htmlContent).toContain('Correo: asignada');
    expect(correosA('admin')).toHaveLength(0);
  });

  it('devuelta: a la persona, con el comentario', async () => {
    const t = await tareaEnRevision('Correo: devuelta');
    sendEmail.mockClear();
    await request.patch(`/api/tasks/${t.id}/return`).set(como('admin')).send({ comment: 'Faltan las metas' });
    const [c] = correosA('colaborador');
    expect(c.subject).toBe('Tarea devuelta: Correo: devuelta');
    expect(c.htmlContent).toContain('Faltan las metas');
  });

  it('aprobada: a la persona', async () => {
    const t = await tareaEnRevision('Correo: aprobada');
    sendEmail.mockClear();
    await request.patch(`/api/tasks/${t.id}/approve`).set(como('admin'));
    const [c] = correosA('colaborador');
    expect(c.subject).toBe('Tarea completada: Correo: aprobada');
  });

  it('comentario nuevo en su tarea: a la persona de la tarea, con el texto', async () => {
    const t = (await request.post('/api/tasks').set(como('admin'))
      .send({ title: 'Correo: comentario', assigned_to: U.colaborador.id, supervisor_id: U.admin.id })).body.data;
    sendEmail.mockClear();
    await request.post(`/api/tasks/${t.id}/comments`).set(como('admin')).send({ content: 'Revisa el H1' });
    const [c] = correosA('colaborador');
    expect(c.subject).toBe('Comentario en: Correo: comentario');
    expect(c.htmlContent).toContain('Revisa el H1');
  });

  it('el de cada mañana: lo que vence hoy y lo vencido', async () => {
    const t = (await request.post('/api/tasks').set(como('admin'))
      .send({ title: 'Correo: vencida', assigned_to: U.colaborador.id })).body.data;
    await q("UPDATE tasks SET due_date = NOW() - INTERVAL '2 days' WHERE id = $1", [t.id]);
    sendEmail.mockClear();
    await runTasksDailySummary({ forzar: true });
    const [c] = correosA('colaborador');
    expect(c.subject).toMatch(/^Tus tareas de hoy/);
    expect(c.htmlContent).toContain('Correo: vencida');
  });

  it('quien apagó un aviso en Mis preferencias no lo recibe', async () => {
    const t = (await request.post('/api/tasks').set(como('admin'))
      .send({ title: 'Silencio', assigned_to: U.silencioso.id, due_date: '2020-01-01' })).body.data;
    await request.post(`/api/tasks/${t.id}/comments`).set(como('admin')).send({ content: 'hola' });
    await request.patch(`/api/tasks/${t.id}/move`).set(como('silencioso')).send({ status: 'en_revision' });
    await request.patch(`/api/tasks/${t.id}/return`).set(como('admin')).send({ comment: 'otra vez' });
    await request.patch(`/api/tasks/${t.id}/move`).set(como('silencioso')).send({ status: 'en_revision' });
    await request.patch(`/api/tasks/${t.id}/approve`).set(como('admin'));
    await runTasksDailySummary({ forzar: true });
    expect(correosA('silencioso')).toHaveLength(0);
    // Y la campana le sigue sonando: apagar el correo no apaga el aviso.
    const avisos = await one('SELECT COUNT(*)::int n FROM admin_notifications WHERE $1 = ANY(target_user_ids)', [U.silencioso.id]);
    expect(avisos.n).toBeGreaterThan(0);
  });
});

describe('la hora del correo de cada mañana es la de Madrid', () => {
  it('las 06:00 UTC de octubre son las 8 en Madrid; las 08:00 UTC, las 10', () => {
    expect(horaLocal(new Date('2026-10-07T06:00:00Z'))).toBe(8);
    expect(horaLocal(new Date('2026-10-07T08:00:00Z'))).toBe(10);
  });

  it('fuera de hora no hace nada', async () => {
    process.env.TAREAS_CORREOS_ACTIVOS = 'true';
    const r = await runTasksDailySummary({ ahora: new Date('2026-10-07T08:00:00Z') });
    expect(r).toEqual({ omitido: 'fuera de hora' });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
