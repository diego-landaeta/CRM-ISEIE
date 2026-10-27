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
const { procesarCambiosDeEstado, destinatariosDelCambio } = await import('../src/modules/tasks/tasks.avisos-estado.js');
const { runTareasResumen, tocaResumen, relojLocal, horaDelResumen, resumenActivo } = await import('../src/jobs/tareasResumenJob.js');
const { armarCorreoResumen, armarCorreoCambioEstado } = await import('../src/modules/tasks/tasks.emails.js');

/**
 * Los dos correos nuevos del tablero (Diego, 26/10/2026): «uno para cuando
 * cambian el status, y todos los días de lunes a viernes su resumen de lo que
 * hizo y lo que falta». Y el de asignar, que salga siempre.
 */

const request = supertest(app);
const MARCA = `TCER_${Date.now().toString(36)}`;
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const one = async (sql, params) => (await q(sql, params))[0];

const U = {};
const T = {};
async function persona(clave, role) {
  const u = await one(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, email, role, nombre`,
    [`${MARCA} ${clave}`, `${clave}_${MARCA.toLowerCase()}@qa.invalid`, role]
  );
  U[clave] = u;
  T[clave] = jwt.sign({ userId: u.id, email: u.email, role, roles_extra: [], customRoleId: null },
    process.env.JWT_SECRET, { expiresIn: '1h' });
}
const como = (clave) => ({ Authorization: `Bearer ${T[clave]}` });
const correos = () => sendEmail.mock.calls.map(([arg]) => arg);
const correosA = (clave, etiqueta = null) => correos()
  .filter((c) => c.to?.[0]?.email === U[clave].email && (!etiqueta || c.tags?.includes(etiqueta)));
const ids = () => Object.values(U).map((u) => u.id);

let campus;

beforeAll(async () => {
  await persona('jefe', 'superadmin');       // crea y asigna
  await persona('dev', 'colaborador');       // la lleva
  await persona('sup', 'admin');             // la supervisa
  await persona('quieto', 'colaborador');    // ni hace ni tiene nada
  campus = await one(
    'INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
    [`${MARCA} Campus`, `${MARCA.toLowerCase()}-campus`, `${MARCA}-campus`]
  );
  for (const u of Object.values(U)) {
    await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, campus.id]);
  }
});

afterAll(async () => {
  await q('DELETE FROM tasks WHERE created_by = ANY($1::int[]) OR assigned_to = ANY($1::int[])', [ids()]);
  await q('DELETE FROM admin_notifications WHERE target_user_ids && $1::int[]', [ids()]);
  await q('DELETE FROM email_envios WHERE destinatarios LIKE $1', [`%${MARCA.toLowerCase()}%`]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids()]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids()]);
  await q('DELETE FROM projects WHERE id = $1', [campus.id]);
  await pool.end();
});

beforeEach(() => { sendEmail.mockClear(); process.env.TAREAS_CORREOS_ACTIVOS = 'true'; });
afterEach(() => { delete process.env.TAREAS_CORREOS_ACTIVOS; });

async function nuevaTarea(titulo, extra = {}) {
  const r = await request.post('/api/tasks').set(como('jefe'))
    .send({ title: `${MARCA} ${titulo}`, assigned_to: U.dev.id, supervisor_id: U.sup.id, ...extra });
  expect(r.status).toBe(201);
  return r.body.data;
}
const mover = (t, status, quien = 'dev') => request.patch(`/api/tasks/${t.id}/move`).set(como(quien)).send({ status });

describe('correo al asignar y al poner de supervisor', () => {
  it('sale al asignar y al poner de supervisor, no a quien se la asigna a sí mismo', async () => {
    await nuevaTarea('asignar');
    expect(correosA('dev', 'tarea-asignada')).toHaveLength(1);
    expect(correosA('sup', 'tarea-supervisor')).toHaveLength(1);
    expect(correosA('jefe')).toHaveLength(0);

    sendEmail.mockClear();
    await request.post('/api/tasks').set(como('dev')).send({ title: `${MARCA} mía` });
    expect(correosA('dev', 'tarea-asignada')).toHaveLength(0);
  });

  it('al reasignar y volver a asignar a la misma persona, vuelve a llegar', async () => {
    const t = await nuevaTarea('reasignar');
    sendEmail.mockClear();
    await request.patch(`/api/tasks/${t.id}`).set(como('jefe')).send({ assigned_to: U.quieto.id });
    await request.patch(`/api/tasks/${t.id}`).set(como('jefe')).send({ assigned_to: U.dev.id });
    const [c] = correosA('dev', 'tarea-asignada');
    expect(c).toBeTruthy();
    expect(c.htmlContent).toContain('reasignado');
    // Claves distintas: el registro de correos no lo para como repetido.
    const claves = sendEmail.mock.calls.map(([a]) => a.clave).filter((k) => k?.startsWith('tarea_asignada-'));
    expect(new Set(claves).size).toBe(claves.length);
  });
});

describe('correo al cambiar de estado', () => {
  it('va al responsable, al supervisor y al creador, sin quien lo cambió', () => {
    const tarea = { assigned_to: 1, supervisor_id: 2, created_by: 3 };
    expect(destinatariosDelCambio(tarea, 1)).toEqual([{ id: 2, rol: 'supervisor' }, { id: 3, rol: 'creador' }]);
    expect(destinatariosDelCambio(tarea, 3)).toEqual([{ id: 1, rol: 'responsable' }, { id: 2, rol: 'supervisor' }]);
    // Quien ya tiene su correo propio por ese cambio no recibe también este.
    expect(destinatariosDelCambio(tarea, 2, [1])).toEqual([{ id: 3, rol: 'creador' }]);
    // Si quien la creó también la lleva, una vez.
    expect(destinatariosDelCambio({ assigned_to: 1, created_by: 1 }, 9)).toEqual([{ id: 1, rol: 'responsable' }]);
  });

  it('mover de columna: lo reciben el supervisor y el creador, no quien la movió', async () => {
    const t = await nuevaTarea('mover');
    sendEmail.mockClear();
    expect((await mover(t, 'en_curso')).status).toBe(200);
    // Nada sale antes de que acabe la ventana de agrupado.
    expect(correos().filter((c) => c.tags?.includes('tarea-estado'))).toHaveLength(0);
    await procesarCambiosDeEstado({ todos: true });
    const aSup = correosA('sup', 'tarea-estado');
    const aJefe = correosA('jefe', 'tarea-estado');
    expect(aSup).toHaveLength(1);
    expect(aJefe).toHaveLength(1);
    expect(correosA('dev', 'tarea-estado')).toHaveLength(0);
    expect(aJefe[0].subject).toContain('Por hacer → En curso');
    expect(aJefe[0].htmlContent).toContain(`${MARCA} dev`);       // quién lo cambió
    expect(aJefe[0].htmlContent).toContain(`tareas?id=${t.id}`);  // el enlace
  });

  it('varios cambios seguidos: un solo correo, con el estado de antes y el último', async () => {
    const t = await nuevaTarea('ráfaga');
    await mover(t, 'en_curso');
    await mover(t, 'por_hacer');
    await mover(t, 'en_curso');
    sendEmail.mockClear();
    // Dentro de la ventana no sale nada.
    expect((await procesarCambiosDeEstado({ ahora: new Date() })).cambios).toBe(0);
    await procesarCambiosDeEstado({ ahora: new Date(Date.now() + 10 * 60 * 1000) });
    const aJefe = correosA('jefe', 'tarea-estado');
    expect(aJefe).toHaveLength(1);
    expect(aJefe[0].subject).toContain('Por hacer → En curso');
    expect(aJefe[0].htmlContent).toContain('3 veces');
    // Y no queda nada en la cola.
    expect(await q('SELECT 1 FROM task_status_notices WHERE task_id = $1', [t.id])).toHaveLength(0);
  });

  it('ida y vuelta en la misma ráfaga: no se manda nada', async () => {
    const t = await nuevaTarea('ida y vuelta');
    await mover(t, 'en_curso');
    await mover(t, 'por_hacer');
    sendEmail.mockClear();
    await procesarCambiosDeEstado({ todos: true });
    expect(correos().filter((c) => c.tags?.includes('tarea-estado'))).toHaveLength(0);
  });

  it('al devolver: lleva el comentario, y quien la lleva no recibe dos (ya tiene «Tarea devuelta»)', async () => {
    const t = await nuevaTarea('devolver');
    await mover(t, 'en_revision');
    await procesarCambiosDeEstado({ todos: true });
    sendEmail.mockClear();
    const r = await request.patch(`/api/tasks/${t.id}/return`).set(como('sup')).send({ comment: 'Falta el H1 de la portada' });
    expect(r.status).toBe(200);
    await procesarCambiosDeEstado({ todos: true });
    expect(correosA('dev', 'tarea-devuelta')).toHaveLength(1);
    expect(correosA('dev', 'tarea-estado')).toHaveLength(0);
    expect(correosA('sup', 'tarea-estado')).toHaveLength(0);
    const [c] = correosA('jefe', 'tarea-estado');
    expect(c.subject).toContain('En revisión → En curso');
    expect(c.htmlContent).toContain('Falta el H1 de la portada');
    expect(c.htmlContent).toContain('devuelto');
  });

  it('quien lo apagó en «Mis preferencias» no lo recibe', async () => {
    await q("INSERT INTO avisos_apagados (user_id, aviso) VALUES ($1, 'tarea_estado') ON CONFLICT DO NOTHING", [U.jefe.id]);
    const t = await nuevaTarea('apagado');
    await mover(t, 'en_curso');
    sendEmail.mockClear();
    await procesarCambiosDeEstado({ todos: true });
    expect(correosA('jefe', 'tarea-estado')).toHaveLength(0);
    expect(correosA('sup', 'tarea-estado')).toHaveLength(1);
    await q("DELETE FROM avisos_apagados WHERE user_id = $1 AND aviso = 'tarea_estado'", [U.jefe.id]);
  });

  it('el texto lleva título, equipo, de → a, quién y el comentario', () => {
    const c = armarCorreoCambioEstado({
      persona: { nombre: 'Ana' },
      tarea: { id: 7, title: 'Arreglar el H1', team_name: 'Desarrollo y SEO' },
      de: 'En revisión', a: 'En curso', quien: { nombre: 'Ángel' }, comentario: 'Falta el H1', accion: 'devuelta', rol: 'creador',
    });
    expect(c.asunto).toBe('Cambio de estado · Desarrollo y SEO: Arreglar el H1 (En revisión → En curso)');
    for (const s of ['Arreglar el H1', 'Desarrollo y SEO', 'En revisión', 'En curso', 'Ángel', 'Falta el H1', 'tareas?id=7']) {
      expect(c.htmlContent).toContain(s);
    }
  });
});

describe('resumen de la tarde', () => {
  // Lunes 26/10/2026 a las 18:00 de Caracas = 22:00 UTC.
  const LUNES_18 = new Date('2026-10-26T22:00:00Z');

  it('la hora es la de Venezuela, de lunes a viernes, y se puede cambiar', () => {
    expect(relojLocal(LUNES_18, 'America/Caracas')).toEqual({ dia: '2026-10-26', semana: 1, minuto: 18 * 60 });
    expect(tocaResumen(LUNES_18, {})).toBe(true);
    expect(tocaResumen(new Date('2026-10-26T21:59:00Z'), {})).toBe(false);          // 17:59
    expect(tocaResumen(new Date('2026-10-30T22:30:00Z'), {})).toBe(true);           // viernes
    expect(tocaResumen(new Date('2026-10-31T22:00:00Z'), {})).toBe(false);          // sábado
    expect(tocaResumen(new Date('2026-11-01T22:00:00Z'), {})).toBe(false);          // domingo
    expect(tocaResumen(new Date('2026-10-26T23:30:00Z'), { TAREAS_RESUMEN_HORA: '19:30' })).toBe(true);
    expect(horaDelResumen({ TAREAS_RESUMEN_HORA: '18:30' })).toBe(18 * 60 + 30);
    expect(resumenActivo({})).toBe(true);
    expect(resumenActivo({ TAREAS_RESUMEN_ACTIVO: 'false' })).toBe(false);
  });

  it('no envía en sábado ni domingo', async () => {
    for (const d of ['2026-10-31T22:00:00Z', '2026-11-01T22:30:00Z']) {
      const r = await runTareasResumen({ ahora: new Date(d), soloUserIds: ids() });
      expect(r).toEqual({ omitido: 'fuera de hora' });
    }
    expect(correos().filter((c) => c.tags?.includes('tareas-resumen'))).toHaveLength(0);
  });

  it('con TAREAS_RESUMEN_ACTIVO=false no hace nada', async () => {
    process.env.TAREAS_RESUMEN_ACTIVO = 'false';
    try {
      expect(await runTareasResumen({ ahora: LUNES_18, soloUserIds: ids() })).toEqual({ omitido: 'apagado' });
    } finally { delete process.env.TAREAS_RESUMEN_ACTIVO; }
  });

  it('lleva lo que hizo hoy y lo que falta; a quien no tiene nada no se le manda; y no se repite', async () => {
    const hoy = relojLocal(new Date(), 'America/Caracas').dia;
    await q('DELETE FROM task_daily_summaries WHERE user_id = ANY($1::int[])', [ids()]);
    // Hoy: el dev cierra una (con supervisor aprobando), mueve otra y comenta.
    const vencida = await nuevaTarea('vencida');
    await q("UPDATE tasks SET due_date = NOW() - INTERVAL '3 days' WHERE id = $1", [vencida.id]);
    const manana = await nuevaTarea('mañana');
    await q("UPDATE tasks SET due_date = (($1::date + 1)::timestamp + INTERVAL '12 hours') AT TIME ZONE 'America/Caracas' WHERE id = $2", [hoy, manana.id]);
    const movida = await nuevaTarea('movida');
    await mover(movida, 'en_curso');
    await request.post(`/api/tasks/${movida.id}/comments`).set(como('dev')).send({ content: 'Voy con ello' });
    const revisar = await nuevaTarea('para revisar');
    await mover(revisar, 'en_revision');

    sendEmail.mockClear();
    const r = await runTareasResumen({ forzar: true, soloUserIds: ids() });
    expect(r.dia).toBe(hoy);
    expect(correosA('quieto', 'tareas-resumen')).toHaveLength(0);

    const [aDev] = correosA('dev', 'tareas-resumen');
    expect(aDev).toBeTruthy();
    expect(aDev.clave).toBe(`tareas_resumen-${U.dev.id}-${hoy}`);
    const html = aDev.htmlContent;
    expect(html).toContain('Lo que hiciste hoy');
    expect(html).toContain('Cambiaste de estado');
    expect(html).toContain(`${MARCA} movida`);
    expect(html).toContain('Comentaste en');
    expect(html).toContain('Lo que falta');
    // Vencidas, primero y en rojo.
    expect(html).toMatch(/color:#ef4444">Vencidas \(1\)/);
    expect(html.indexOf('Vencidas (')).toBeLessThan(html.indexOf('Vencen mañana ('));
    expect(html).toContain(`${MARCA} mañana`);
    expect(aDev.subject).toMatch(/Tu resumen de tareas del .*: \d+ abiertas, 1 vencida/);

    // El supervisor: las que esperan su revisión.
    const [aSup] = correosA('sup', 'tareas-resumen');
    expect(aSup.htmlContent).toContain('Esperan tu revisión (1)');
    expect(aSup.htmlContent).toContain(`${MARCA} para revisar`);
    // Quien las creó: «Creaste».
    const [aJefe] = correosA('jefe', 'tareas-resumen');
    expect(aJefe.htmlContent).toContain('Creaste');

    // Registrado: una segunda vuelta (un reinicio a las 18:10) no lo repite.
    const filas = await q('SELECT user_id, estado FROM task_daily_summaries WHERE user_id = ANY($1::int[]) AND dia = $2', [ids(), hoy]);
    expect(filas.map((f) => f.user_id).sort()).toEqual([U.jefe.id, U.dev.id, U.sup.id].sort());
    sendEmail.mockClear();
    const r2 = await runTareasResumen({ forzar: true, soloUserIds: ids() });
    expect(r2.repetidos).toBe(3);
    expect(correos().filter((c) => c.tags?.includes('tareas-resumen'))).toHaveLength(0);
  });

  it('el texto, sin base: hizo y falta, con los nombres de las columnas', () => {
    const c = armarCorreoResumen({
      persona: { nombre: 'Diana' },
      dia: '2026-10-26',
      columnas: { en_curso: 'En curso', por_hacer: 'Por hacer', en_revision: 'Por revisar', hecha: 'Hecha' },
      datos: {
        hizo: {
          cerradas: [{ id: 1, title: 'Landing ISEIH' }],
          movidas: [{ id: 2, title: 'Blog SEO', de: 'por_hacer', a: 'en_revision' }],
          comentarios: [{ id: 2, title: 'Blog SEO', n: 2 }],
          creadas: [],
        },
        falta: {
          vencidas: [{ id: 3, title: 'Sitemap', status: 'en_curso', due_date: '2026-10-20T12:00:00Z' }],
          hoy: [], manana: [], revisar: [],
          porEstado: [{ estado: 'por_hacer', tareas: [{ id: 4, title: 'Meta tags' }] }],
          abiertas: 2,
        },
      },
    });
    expect(c.asunto).toBe('Tu resumen de tareas del 26 de octubre: 2 abiertas, 1 vencida');
    for (const s of ['Cerraste (1)', 'Landing ISEIH', 'Por hacer &rarr; Por revisar', '2 comentarios', 'Vencidas (1)', 'Sitemap', 'Resto en Por hacer (1)']) {
      expect(c.htmlContent).toContain(s);
    }
  });
});
