import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * CRM-ISEIE#435 (gemela CRM-ISEIE#435) · el tablero, al día con las issues de GitHub,
 * contra la base de verdad:
 *
 *   A · la firma: mala, ausente o de otro secreto → 401 y no se toca nada;
 *   B · issue abierta → «Por hacer»; sin usuario → del supervisor y «Por definir»;
 *   C · el mismo aviso dos veces (y la misma issue con otro aviso) deja una sola tarea;
 *   D · la correspondencia login → persona, desde el panel (solo superadmin), recoloca;
 *   E · PR a staging → «En revisión»; a main o en borrador, no;
 *   F · cerrada → «Hecha» con closed_at y «La cerró: GitHub»; reabierta → «En curso»;
 *   G · «> Misma tarea que …» no crea tarea; la cabecera «Copiada de» da el enlace a la copia;
 *   H · la importación: simula sin escribir, aplica, y la segunda vez no crea nada.
 *
 *   npm --prefix backend run db:preparar
 *   cd backend && npx vitest run tests/tareasGithub435.test.js
 */

process.env.GITHUB_TABLERO_ACTIVO = 'true';
const { default: app } = await import('../src/app.js');
const { default: pool } = await import('../src/shared/config/db.js');
const gh = await import('../src/modules/tasks/tasks.github.js');
const { importar } = await import('../src/modules/tasks/tasks.github.sync.js');

const request = supertest(app);
const MARCA = `G435_${Date.now().toString(36)}`;
const REPO = `pruebas-${MARCA.toLowerCase()}/crm`;
const SECRETO = `secreto-de-pruebas-${MARCA}`;
const LOGIN_DEV = `dev-${MARCA.toLowerCase()}`.replace(/_/g, '-').slice(0, 39);

const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const one = async (sql, params) => (await q(sql, params))[0];

const U = {};
const T = {};
let issuerId;
let teamId;
let configAntes;
let credAntes;

async function persona(clave, role) {
  const u = await one(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, email, role`,
    [`${MARCA} ${clave}`, `${clave.toLowerCase()}_${MARCA.toLowerCase()}@test.local`, role]
  );
  U[clave] = u;
  T[clave] = jwt.sign({ userId: u.id, email: u.email, role, roles_extra: [], customRoleId: null },
    process.env.JWT_SECRET, { expiresIn: '1h' });
}
const como = (clave) => ({ Authorization: `Bearer ${T[clave]}` });

let entregas = 0;
function aviso(evento, payload, { secreto = SECRETO, entrega = null, firma } = {}) {
  const cuerpo = JSON.stringify({ repository: { full_name: REPO }, ...payload });
  entregas += 1;
  return request.post('/api/github/webhook')
    .set('Content-Type', 'application/json')
    .set('X-GitHub-Event', evento)
    .set('X-GitHub-Delivery', entrega || `${MARCA}-${entregas}`)
    .set('X-Hub-Signature-256', firma ?? gh.firmar(secreto, cuerpo))
    .send(cuerpo);
}

const issue = (number, extra = {}) => ({
  number, node_id: `I_${MARCA}_${number}`, title: `Tarea ${number} de ${MARCA}`, body: 'Lo que hay que hacer.',
  state: 'open', assignees: [], created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-01T10:00:00Z', closed_at: null, ...extra,
});
const pr = (number, extra = {}) => ({
  number, body: '', state: 'open', draft: false, merged: false, merged_at: null,
  base: { ref: 'staging' }, head: { ref: `feat/sin-numero-${number}` }, ...extra,
});

const vinculo = (n) => one('SELECT * FROM github_issue_tareas WHERE repo = $1 AND number = $2', [REPO, n]);
const tarea = (id) => one('SELECT * FROM tasks WHERE id = $1', [id]);
const etiquetas = async (id) => (await q('SELECT name FROM task_tags WHERE task_id = $1', [id])).map((r) => r.name);

beforeAll(async () => {
  configAntes = await one('SELECT * FROM github_tablero_config WHERE id = 1');
  credAntes = await q(`SELECT id FROM api_credentials WHERE service = 'github'`);
  const s = await one('INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id', [`${MARCA} Empresa`, `${MARCA}-NIF`]);
  issuerId = s.id;
  teamId = (await one(`INSERT INTO task_teams (issuer_id, name) VALUES ($1, $2) RETURNING id`, [issuerId, `${MARCA} Desarrollo y SEO`])).id;
  await persona('diego', 'superadmin');
  await persona('admin', 'admin');
  await persona('dev', 'colaborador');

  // El panel: repositorio, equipo, supervisor y el secreto (cifrado).
  const res = await request.patch('/api/tasks/github').set(como('diego'))
    .send({ repo: REPO, team_id: teamId, supervisor_id: U.diego.id, copia_repo: '' });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.body.data.falta).toEqual([]);
  const sec = await request.put('/api/tasks/github/secretos').set(como('diego')).send({ webhook_secret: SECRETO });
  expect(sec.status, JSON.stringify(sec.body)).toBe(200);
  expect(sec.body.data).toEqual({ webhook_secret: true, token: false });
}, 60000);

afterAll(async () => {
  const usuarios = Object.values(U).map((u) => u.id);
  await q('DELETE FROM github_entregas WHERE delivery_id LIKE $1 OR repo = $2', [`${MARCA}%`, REPO]);
  await q('DELETE FROM github_issue_tareas WHERE repo = $1', [REPO]);
  await q('DELETE FROM github_usuarios WHERE user_id = ANY($1::int[])', [usuarios]);
  await q('DELETE FROM tasks WHERE created_by = ANY($1::int[]) OR assigned_to = ANY($1::int[])', [usuarios]);
  if (configAntes) {
    await q(`UPDATE github_tablero_config SET repo = $1, team_id = $2, supervisor_id = $3, copia_repo = $4, updated_by = NULL WHERE id = 1`,
      [configAntes.repo, configAntes.team_id, configAntes.supervisor_id, configAntes.copia_repo]);
  }
  await q(`DELETE FROM api_credentials WHERE service = 'github' AND NOT (id = ANY($1::int[]))`, [credAntes.map((c) => c.id)]);
  await q('DELETE FROM task_teams WHERE id = $1', [teamId]);
  await q('DELETE FROM user_activity_log WHERE user_id = ANY($1::int[])', [usuarios]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [usuarios]);
  await q('DELETE FROM invoice_issuers WHERE id = $1', [issuerId]);
  await pool.end();
}, 60000);

describe('las piezas', () => {
  it('el interruptor está apagado de serie', () => {
    expect(gh.githubTableroActivo({})).toBe(false);
    expect(gh.githubTableroActivo({ GITHUB_TABLERO_ACTIVO: 'false' })).toBe(false);
    expect(gh.githubTableroActivo({ GITHUB_TABLERO_ACTIVO: 'true' })).toBe(true);
    expect(gh.githubTableroActivo({ GITHUB_TABLERO_ACTIVO: '1' })).toBe(true);
  });

  it('la firma: la buena sí; otra, sin prefijo, vacía o de otro largo, no', () => {
    const cuerpo = Buffer.from('{"a":1}');
    expect(gh.firmaValida('s3creto', cuerpo, gh.firmar('s3creto', cuerpo))).toBe(true);
    expect(gh.firmaValida('s3creto', cuerpo, gh.firmar('otro', cuerpo))).toBe(false);
    expect(gh.firmaValida('s3creto', Buffer.from('{"a":2}'), gh.firmar('s3creto', cuerpo))).toBe(false);
    expect(gh.firmaValida('s3creto', cuerpo, gh.firmar('s3creto', cuerpo).slice(7))).toBe(false);
    expect(gh.firmaValida('s3creto', cuerpo, 'sha256=abcd')).toBe(false);
    expect(gh.firmaValida('s3creto', cuerpo, undefined)).toBe(false);
    expect(gh.firmaValida(null, cuerpo, gh.firmar('', cuerpo))).toBe(false);
  });

  it('las issues de una PR: Closes/Refs del cuerpo y el número de la rama; las de otro repositorio, no', () => {
    expect(gh.issuesDeLaPr({ body: 'Closes #12\n\nRefs #3, #4', rama: 'feat/707-historial', repo: 'a/b' }).sort((x, y) => x - y))
      .toEqual([3, 4, 12, 707]);
    expect(gh.issuesDeLaPr({ body: 'Cierra a/b#8 y Refs otro/repo#9', rama: 'release/2.6.0', repo: 'a/b' })).toEqual([8]);
    expect(gh.issuesDeLaPr({ body: 'Mejora el #5 sin cerrarlo', rama: 'feat/diana-203b', repo: 'a/b' })).toEqual([]);
  });

  it('las cabeceras del sincronizador de copias', () => {
    expect(gh.esCopiaDeOtra('> Misma tarea que diego-landaeta/CRM#5 · abierta por …')).toBe(true);
    expect(gh.esCopiaDeOtra('> Copiada de empresa/copia#⁠7, abierta por …')).toBe(false);
    expect(gh.copiaDeLaCabecera('> Copiada de empresa/copia#⁠7, abierta por **x** el …')).toEqual({ repo: 'empresa/copia', number: 7 });
    expect(gh.copiaDeLaCabecera('Sin cabecera')).toBeNull();
  });
});

describe('A · la firma se mira antes que nada', () => {
  it('firma de otro secreto, ausente o rota → 401, y no se crea tarea', async () => {
    for (const op of [{ secreto: 'otro-secreto-cualquiera' }, { firma: '' }, { firma: 'sha256=zz' }]) {
      const res = await aviso('issues', { action: 'opened', issue: issue(1) }, op);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_SIGNATURE');
    }
    expect(await vinculo(1)).toBeUndefined();
    expect(await one('SELECT 1 FROM github_entregas WHERE repo = $1', [REPO])).toBeUndefined();
  });

  it('ping contesta, y lo de otro repositorio se ignora', async () => {
    expect((await aviso('ping', { zen: 'hola' })).body.data.resultado).toBe('pong');
    const cuerpo = JSON.stringify({ action: 'opened', repository: { full_name: 'otro/repo' }, issue: issue(99) });
    const res = await request.post('/api/github/webhook').set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'issues').set('X-GitHub-Delivery', `${MARCA}-otro`)
      .set('X-Hub-Signature-256', gh.firmar(SECRETO, cuerpo)).send(cuerpo);
    expect(res.status).toBe(200);
    expect(res.body.data.resultado).toMatch(/otro repositorio/);
  });
});

describe('B y C · issue abierta, sin usuario, y el mismo aviso dos veces', () => {
  let taskId;
  it('abierta → «Por hacer», del supervisor, «Por definir quién lo hará», con equipo y enlace', async () => {
    const res = await aviso('issues', { action: 'opened', issue: issue(10, { assignees: [{ login: LOGIN_DEV }] }) }, { entrega: `${MARCA}-dup` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.resultado).toBe('creada');
    const v = await vinculo(10);
    taskId = v.task_id;
    const t = await tarea(taskId);
    expect(t.status).toBe('por_hacer');
    expect(t.assigned_to).toBe(U.diego.id);
    expect(t.supervisor_id).toBe(U.diego.id);
    expect(t.created_by).toBe(U.diego.id);
    expect(t.team_id).toBe(teamId);
    expect(t.title).toBe(`#10 · Tarea 10 de ${MARCA}`);
    expect(await etiquetas(taskId)).toEqual([gh.ETIQUETA_POR_DEFINIR]);
    expect(v.por_definir).toBe(true);
    expect(v.asignados).toEqual([LOGIN_DEV]);
    const links = await q('SELECT url FROM task_links WHERE task_id = $1', [taskId]);
    expect(links.map((l) => l.url)).toEqual([`https://github.com/${REPO}/issues/10`]);
    const ev = await one(`SELECT user_id, details FROM task_events WHERE task_id = $1 AND event_type = 'created'`, [taskId]);
    expect(ev.user_id).toBeNull();
    expect(ev.details.action).toBe('github');
  });

  it('el mismo aviso otra vez no hace nada, y la misma issue con otro aviso tampoco duplica', async () => {
    const res = await aviso('issues', { action: 'opened', issue: issue(10, { assignees: [{ login: LOGIN_DEV }] }) }, { entrega: `${MARCA}-dup` });
    expect(res.status).toBe(200);
    expect(res.body.data.resultado).toMatch(/repetido/);
    const otro = await aviso('issues', { action: 'opened', issue: issue(10, { assignees: [{ login: LOGIN_DEV }] }) });
    expect(otro.status).toBe(200);
    const { n } = await one('SELECT COUNT(*)::int AS n FROM github_issue_tareas WHERE repo = $1 AND number = 10', [REPO]);
    expect(n).toBe(1);
    const { m } = await one(`SELECT COUNT(*)::int AS m FROM tasks WHERE title = $1`, [`#10 · Tarea 10 de ${MARCA}`]);
    expect(m).toBe(1);
    expect(await etiquetas(taskId)).toEqual([gh.ETIQUETA_POR_DEFINIR]);
  });

  it('D · el panel es solo del superadmin; al poner el login, la tarea pasa a esa persona', async () => {
    const no = await request.put(`/api/tasks/github/usuarios/${LOGIN_DEV}`).set(como('admin')).send({ user_id: U.dev.id });
    expect(no.status).toBe(403);
    expect((await request.get('/api/tasks/github').set(como('admin'))).status).toBe(403);

    const si = await request.put(`/api/tasks/github/usuarios/${LOGIN_DEV.toUpperCase()}`).set(como('diego')).send({ user_id: U.dev.id });
    expect(si.status, JSON.stringify(si.body)).toBe(200);
    expect(si.body.data.recolocadas).toBe(1);
    const t = await tarea(taskId);
    expect(t.assigned_to).toBe(U.dev.id);
    expect(await etiquetas(taskId)).toEqual([]);

    const panel = await request.get('/api/tasks/github').set(como('diego'));
    expect(panel.status).toBe(200);
    expect(panel.body.data.usuarios.find((x) => x.login === LOGIN_DEV)?.user_id).toBe(U.dev.id);
    expect(panel.body.data.secretos).toEqual({ webhook_secret: true, token: false });
    // Nunca sale un secreto por el panel.
    expect(JSON.stringify(panel.body)).not.toContain(SECRETO);
  });

  it('sin asignados en GitHub, vuelve al supervisor y «Por definir»', async () => {
    await aviso('issues', { action: 'unassigned', issue: issue(10, { assignees: [] }) });
    const t = await tarea(taskId);
    expect(t.assigned_to).toBe(U.diego.id);
    expect(await etiquetas(taskId)).toEqual([gh.ETIQUETA_POR_DEFINIR]);
    await aviso('issues', { action: 'assigned', issue: issue(10, { assignees: [{ login: LOGIN_DEV }] }) });
    expect((await tarea(taskId)).assigned_to).toBe(U.dev.id);
    expect(await etiquetas(taskId)).toEqual([]);
  });
});

describe('E y F · las transiciones', () => {
  let taskId;
  beforeAll(async () => {
    await aviso('issues', { action: 'opened', issue: issue(20, { assignees: [{ login: LOGIN_DEV }] }) });
    taskId = (await vinculo(20)).task_id;
  });

  it('una PR a main o en borrador no la mueve; sin issues enlazadas, tampoco', async () => {
    await aviso('pull_request', { action: 'opened', pull_request: pr(501, { body: 'Closes #20', base: { ref: 'main' } }) });
    await aviso('pull_request', { action: 'opened', pull_request: pr(502, { body: 'Closes #20', draft: true }) });
    await aviso('pull_request', { action: 'opened', pull_request: pr(503, { body: 'Nada' }) });
    expect((await tarea(taskId)).status).toBe('por_hacer');
  });

  it('PR abierta a staging (Closes #N) → «En revisión», apuntada en el vínculo', async () => {
    const res = await aviso('pull_request', { action: 'opened', pull_request: pr(504, { body: 'Closes #20' }) });
    expect(res.body.data.resultado).toMatch(/en revisión/);
    expect((await tarea(taskId)).status).toBe('en_revision');
    expect((await vinculo(20)).prs).toContain(504);
    const ev = await one(`SELECT user_id, details FROM task_events WHERE task_id = $1 AND event_type = 'status_changed' ORDER BY id DESC LIMIT 1`, [taskId]);
    expect(ev.user_id).toBeNull();
    expect(ev.details).toMatchObject({ old_status: 'por_hacer', new_status: 'en_revision', action: 'github', pr: 504 });
  });

  it('PR fusionada en staging, enlazada por la rama → «En revisión»', async () => {
    await aviso('issues', { action: 'opened', issue: issue(21) });
    const otra = (await vinculo(21)).task_id;
    await aviso('pull_request', { action: 'closed', pull_request: pr(505, { state: 'closed', merged: true, merged_at: '2026-11-02T10:00:00Z', head: { ref: 'fix/21-algo' } }) });
    expect((await tarea(otra)).status).toBe('en_revision');
  });

  it('issue cerrada → «Hecha» con closed_at, aunque tenga supervisor; en el historial «La cerró: GitHub»', async () => {
    const cerrada = '2026-11-05T12:34:00Z';
    await aviso('issues', { action: 'closed', issue: issue(20, { state: 'closed', closed_at: cerrada, assignees: [{ login: LOGIN_DEV }] }) });
    const t = await tarea(taskId);
    expect(t.status).toBe('hecha');
    expect(new Date(t.completed_at).toISOString()).toBe(new Date(cerrada).toISOString());
    const ev = await one(`SELECT user_id, details, created_at FROM task_events WHERE task_id = $1 AND event_type = 'status_changed' ORDER BY id DESC LIMIT 1`, [taskId]);
    expect(ev.user_id).toBeNull();
    expect(ev.details).toMatchObject({ old_status: 'en_revision', new_status: 'hecha', action: 'github' });

    const h = await request.get(`/api/tasks/historial?search=${encodeURIComponent(`Tarea 20 de ${MARCA}`)}`).set(como('diego'));
    expect(h.status, JSON.stringify(h.body)).toBe(200);
    const fila = h.body.data.find((f) => f.id === taskId);
    expect(fila.completed_by_name).toBe('GitHub');
    expect(fila.completed_by).toBeNull();
    expect(fila.assigned_to).toBe(U.dev.id);

    const ficha = await request.get(`/api/tasks/${taskId}`).set(como('diego'));
    expect(ficha.status).toBe(200);
    expect(ficha.body.data.completed_by_name).toBe('GitHub');
  });

  it('issue reabierta → «En curso», sin fecha de cierre', async () => {
    await aviso('issues', { action: 'reopened', issue: issue(20, { state: 'open', assignees: [{ login: LOGIN_DEV }] }) });
    const t = await tarea(taskId);
    expect(t.status).toBe('en_curso');
    expect(t.completed_at).toBeNull();
    expect((await vinculo(20)).estado).toBe('open');
  });

  it('un aviso que no cambia el estado de la issue no deshace lo movido en el CRM', async () => {
    await q(`UPDATE tasks SET status = 'en_revision' WHERE id = $1`, [taskId]);
    await aviso('issues', { action: 'edited', issue: issue(20, { title: 'Otro título', assignees: [{ login: LOGIN_DEV }] }) });
    const t = await tarea(taskId);
    expect(t.status).toBe('en_revision');
    expect(t.title).toBe('#20 · Otro título');
  });

  it('los comentarios solo se cuentan', async () => {
    await aviso('issue_comment', { action: 'created', issue: issue(20), comment: { body: 'texto' } });
    await aviso('issue_comment', { action: 'created', issue: issue(20), comment: { body: 'texto' } });
    await aviso('issue_comment', { action: 'deleted', issue: issue(20), comment: { body: 'texto' } });
    expect((await vinculo(20)).comentarios).toBe(1);
    expect(await one('SELECT 1 FROM task_comments WHERE task_id = $1', [taskId])).toBeUndefined();
  });
});

describe('G · las cabeceras del sincronizador de copias', () => {
  it('«> Misma tarea que …» no crea tarea', async () => {
    const res = await aviso('issues', { action: 'opened', issue: issue(30, { body: '> Misma tarea que diego-landaeta/CRM#5 · abierta por x\n\nTexto' }) });
    expect(res.body.data.resultado).toMatch(/copia de otra/);
    expect(await vinculo(30)).toBeUndefined();
  });

  it('«> Copiada de <copia>#N» crea la tarea con el enlace a la copia', async () => {
    await aviso('issues', { action: 'opened', issue: issue(31, { body: '> Copiada de empresa-x/crm-copia#⁠44, abierta por **alguien** el 01/11/2026 10:00 UTC.\n\nTexto' }) });
    const v = await vinculo(31);
    expect(v).toMatchObject({ copia_repo: 'empresa-x/crm-copia', copia_number: 44 });
    const links = (await q('SELECT url FROM task_links WHERE task_id = $1 ORDER BY id', [v.task_id])).map((l) => l.url);
    expect(links).toEqual([`https://github.com/${REPO}/issues/31`, 'https://github.com/empresa-x/crm-copia/issues/44']);
  });
});

describe('H · la importación', () => {
  const issues = [
    issue(40),
    issue(41, { state: 'closed', closed_at: '2026-10-20T09:00:00Z', assignees: [{ login: LOGIN_DEV }] }),
    issue(42, { assignees: [{ login: 'alguien-sin-usuario' }] }),
    issue(43, { body: '> Misma tarea que diego-landaeta/CRM#1 · …' }),
    { ...issue(44), pull_request: { url: 'x' } },
  ];
  const prs = [pr(600, { body: 'Refs #42' })];
  const copias = new Map([[40, 140], [41, 141]]);

  const importacion = async (aplicar) => {
    const cli = await pool.connect();
    try { return await importar(cli, { issues, prs, copias, copiaRepo: 'empresa-x/crm-copia', aplicar }); } finally { cli.release(); }
  };

  it('simular: cuenta y no escribe nada', async () => {
    const r = await importacion(false);
    expect(r).toMatchObject({ aplicado: false, issues: 4, creadas: 3, abiertas: 1, en_revision: 1, cerradas: 1, omitidas_copia: 1 });
    for (const n of [40, 41, 42]) expect(await vinculo(n)).toBeUndefined();
  });

  it('aplicar: cada una con su estado; la cerrada, «Hecha» con closed_at y sin «Por definir»', async () => {
    const r = await importacion(true);
    expect(r).toMatchObject({ aplicado: true, creadas: 3, en_revision: 1, cerradas: 1 });
    const t40 = await tarea((await vinculo(40)).task_id);
    const t41 = await tarea((await vinculo(41)).task_id);
    const t42 = await tarea((await vinculo(42)).task_id);
    expect(t40.status).toBe('por_hacer');
    expect(await etiquetas(t40.id)).toEqual([gh.ETIQUETA_POR_DEFINIR]);
    expect(t41.status).toBe('hecha');
    expect(new Date(t41.completed_at).toISOString()).toBe('2026-10-20T09:00:00.000Z');
    expect(t41.assigned_to).toBe(U.dev.id);
    expect(await etiquetas(t41.id)).toEqual([]);
    expect(t42.status).toBe('en_revision');
    expect(t42.assigned_to).toBe(U.diego.id);
    expect((await vinculo(40)).copia_number).toBe(140);
    expect(await vinculo(43)).toBeUndefined();
    expect(await vinculo(44)).toBeUndefined();
  });

  it('la segunda vez no crea nada', async () => {
    const r = await importacion(true);
    expect(r.creadas).toBe(0);
    expect(r.sin_cambios).toBe(3);
    const { n } = await one('SELECT COUNT(*)::int AS n FROM github_issue_tareas WHERE repo = $1 AND number BETWEEN 40 AND 44', [REPO]);
    expect(n).toBe(3);
    const { l } = await one(
      `SELECT COUNT(*)::int AS l FROM task_links WHERE task_id = (SELECT task_id FROM github_issue_tareas WHERE repo = $1 AND number = 40)`, [REPO]);
    expect(l).toBe(2);
  });
});
