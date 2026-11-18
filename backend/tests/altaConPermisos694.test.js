import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

/**
 * #694 · Los permisos, ya en el alta.
 *
 * Se crea a la persona con sus excepciones en la misma operación: se
 * comprueban antes de crear nada (mismas reglas que su ficha) y, si guardarlas
 * falla, la persona recién creada se borra y no le llega ningún correo.
 *
 * Contra la base real, con los permisos de verdad (sin simular el resolver).
 */

const correos = vi.hoisted(() => []);
vi.mock('../src/shared/services/brevo.service.js', async (original) => ({
  ...(await original()),
  sendWelcomeUserEmail: vi.fn(async (m) => { correos.push(m.email); return { sent: true }; }),
}));
const { default: pool } = await import('../src/shared/config/db.js');
const userController = await import('../src/modules/users/user.controller.js');
const userService = await import('../src/modules/users/user.service.js');
const editar = await import('../src/modules/permissions/permissions.editar.js');
const { explicarPermisos, olvidarPermisos } = await import('../src/modules/permissions/permissions.service.js');
const { ACCIONES, vetada } = await import('../src/modules/permissions/catalogo.js');

const MARCA = `A694${Date.now().toString(36)}`.toLowerCase();
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [] };
let CAMPUS; let OTRO_CAMPUS; let SUPER; let ADMIN;
// Una clave que una gestora no trae de serie, que se le puede dar, y que un admin tampoco tiene.
let DAR; let NO_LA_TIENE_EL_ADMIN; let VETADA;

const llamar = async (fn, req) => {
  let error = null; let cuerpo = null; let estado = 200;
  await fn({ ip: '1.1.1.1', headers: {}, socket: {}, params: {}, ...req },
    { json: (b) => { cuerpo = b; }, status(s) { estado = s; return this; } }, (e) => { error = e; });
  return { error, cuerpo, estado };
};
const persona = async (n, role) => {
  const u = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id`,
    [`${MARCA} ${n}`, `${n}@${MARCA}.test`, role]);
  ids.users.push(u.id);
  await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, CAMPUS]);
  return u.id;
};
const existe = async (email) => Boolean(await one('SELECT 1 AS si FROM users WHERE email = $1', [email]));
const alta = (email, extra = {}) => ({ nombre: `${MARCA} Nueva`, email, role: 'gestor', projectIds: [CAMPUS], ...extra });

beforeAll(async () => {
  CAMPUS = (await one(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} campus`, MARCA, `${MARCA}-k`])).id;
  ids.projects.push(CAMPUS);
  // Un campus que no es del admin de la prueba.
  OTRO_CAMPUS = (await one(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} otro`, `${MARCA}-otro`, `${MARCA}-k2`])).id;
  ids.projects.push(OTRO_CAMPUS);
  SUPER = await persona('super', 'superadmin');
  ADMIN = await persona('admin', 'admin');
  const deAdmin = (await explicarPermisos(ADMIN)).mapa;
  const previa = await editar.vistaPreviaDeAlta({ role: 'gestor' }, { userId: SUPER, role: 'superadmin' });
  const candidatas = ACCIONES.filter((x) => previa.mapa[x.clave] !== true);
  DAR = candidatas.find((x) => !vetada(x, 'gestor', []) && deAdmin[x.clave] === true && !x.propia)?.clave;
  NO_LA_TIENE_EL_ADMIN = candidatas.find((x) => !vetada(x, 'gestor', []) && deAdmin[x.clave] !== true && !x.propia)?.clave;
  // Una gestora no tiene nada vetado; un tutor, sí (WhatsApp, entre otras).
  VETADA = ACCIONES.find((x) => vetada(x, 'tutor', []))?.clave;
}, 60000);

afterAll(async () => {
  const todos = (await q('SELECT id FROM users WHERE email LIKE $1', [`%@${MARCA}.test`])).map((r) => r.id);
  // Antes borraba de `permission_change_log`, que no existe, y el .catch se lo
  // tragaba: los apuntes quedaban huérfanos en el Registro (revisión de la #698).
  await q('DELETE FROM permisos_registro WHERE usuario_id = ANY($1::int[]) OR quien_id = ANY($1::int[])', [todos]);
  await q('DELETE FROM user_permission_overrides WHERE user_id = ANY($1::int[])', [todos]);
  await q('DELETE FROM user_activity_log WHERE user_id = ANY($1::int[])', [todos]).catch(() => {});
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [todos]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [todos]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await pool.end();
});

describe('#694 · la vista previa del alta', () => {
  it('dice lo que traería el rol y de dónde le viene; con una excepción, «excepción suya»', async () => {
    expect(DAR).toBeTruthy();
    const sin = await editar.vistaPreviaDeAlta({ role: 'gestor' }, { userId: SUPER, role: 'superadmin' });
    expect(sin.mapa[DAR]).not.toBe(true);
    const con = await editar.vistaPreviaDeAlta({ role: 'gestor', excepciones: { [DAR]: true } }, { userId: SUPER, role: 'superadmin' });
    expect(con.mapa[DAR]).toBe(true);
    expect(con.origenes[DAR]).toMatchObject({ tipo: 'excepcion' });
    expect(con.puedeEditar).toBe(true);
  });

  it('si la persona nueva es admin, un admin no puede ajustarle nada (y se le dice por qué)', async () => {
    const r = await editar.vistaPreviaDeAlta({ role: 'admin' }, { userId: ADMIN, role: 'admin' });
    expect(r.puedeEditar).toBe(false);
    expect(r.motivo).toMatch(/superadmin/);
    const comoExtra = await editar.vistaPreviaDeAlta({ role: 'gestor', roles_extra: ['admin'] }, { userId: ADMIN, role: 'admin' });
    expect(comoExtra.puedeEditar).toBe(false);
    // El superadmin sí.
    const s = await editar.vistaPreviaDeAlta({ role: 'admin' }, { userId: SUPER, role: 'superadmin' });
    expect(s.puedeEditar).toBe(true);
    expect(s.motivo).toBeNull();
  });

  it('a un admin le dice qué tiene él, para no ofrecerle dar lo que no tiene', async () => {
    const r = await editar.vistaPreviaDeAlta({ role: 'gestor' }, { userId: ADMIN, role: 'admin' });
    expect(r.misPermisos).toContain(DAR);
    expect(r.misPermisos).not.toContain(NO_LA_TIENE_EL_ADMIN);
  });
});

describe('#694 · crear con excepciones', () => {
  it('se crea y ya las tiene al abrir su ficha', async () => {
    const email = `con-excepcion@${MARCA}.test`;
    const { error, estado, cuerpo } = await llamar(userController.create,
      { body: alta(email, { excepciones: { [DAR]: true } }), user: { userId: SUPER, role: 'superadmin' } });
    expect(error?.message).toBeUndefined();
    expect(estado).toBe(201);
    olvidarPermisos(cuerpo.data.id);
    const e = await explicarPermisos(cuerpo.data.id);
    expect(e.mapa[DAR]).toBe(true);
    expect(e.excepciones[DAR]).toBe(true);
    expect(correos).toContain(email);
    // Y deja su apunte en el Registro, marcado como alta (no como edición de la ficha).
    const apuntes = await q('SELECT quien_id, clave, despues, origen FROM permisos_registro WHERE usuario_id = $1', [cuerpo.data.id]);
    expect(apuntes).toEqual([expect.objectContaining({ quien_id: SUPER, clave: DAR, despues: 'sí', origen: 'alta_usuario' })]);
  });

  it('quien da lo que no tiene: 403 y no se crea nadie', async () => {
    expect(NO_LA_TIENE_EL_ADMIN).toBeTruthy();
    const email = `de-mas@${MARCA}.test`;
    const { error } = await llamar(userController.create,
      { body: alta(email, { excepciones: { [NO_LA_TIENE_EL_ADMIN]: true } }), user: { userId: ADMIN, role: 'admin' } });
    expect(error?.statusCode).toBe(403);
    expect(await existe(email)).toBe(false);
    expect(correos).not.toContain(email);
  });

  it('lo que su rol no puede tener: 400 y no se crea nadie', async () => {
    expect(VETADA).toBeTruthy();
    const email = `vetada@${MARCA}.test`;
    const { error } = await llamar(userController.create,
      { body: alta(email, { role: 'tutor', excepciones: { [VETADA]: true } }), user: { userId: SUPER, role: 'superadmin' } });
    expect(error?.code).toBe('NUNCA');
    expect(await existe(email)).toBe(false);
  });

  it('una clave que no existe: 400 y no se crea nadie', async () => {
    const email = `inventada@${MARCA}.test`;
    const { error } = await llamar(userController.create,
      { body: alta(email, { excepciones: { 'nada.inventado': true } }), user: { userId: SUPER, role: 'superadmin' } });
    expect(error?.code).toBe('CLAVE_DESCONOCIDA');
    expect(await existe(email)).toBe(false);
  });

  it('si guardar las excepciones falla después de crearla, la persona se borra y no le llega el correo', async () => {
    const email = `a-medias@${MARCA}.test`;
    await expect(userService.create(alta(email), {
      porUserId: SUPER,
      alCrear: async () => { throw Object.assign(new Error('falla a propósito'), { code: 'PRUEBA' }); },
    })).rejects.toMatchObject({ code: 'PRUEBA' });
    expect(await existe(email)).toBe(false);
    expect(correos).not.toContain(email);
  });

  it('sin excepciones, el alta de siempre', async () => {
    const email = `sin-nada@${MARCA}.test`;
    const { error, estado } = await llamar(userController.create,
      { body: alta(email), user: { userId: ADMIN, role: 'admin' } });
    expect(error?.message).toBeUndefined();
    expect(estado).toBe(201);
    expect(await existe(email)).toBe(true);
  });
});

/*
  Revisión de la #698: las altas con éxito de arriba las hace el superadmin, que se
  salta la comprobación de campus. Un admin solo toca los permisos de gente de sus
  campus (`exigirQuePuedaTocar`), y alguien sin campus —un tutor, un colaborador o
  soporte, a quienes el alta no se lo exige— no es de los suyos: se creaba, sus
  excepciones fallaban con «Usuario no encontrado» y se borraba.
*/
describe('#694 · un admin da de alta con excepciones', () => {
  const comoAdmin = { userId: 0, role: 'admin' };
  beforeAll(() => { comoAdmin.userId = ADMIN; olvidarPermisos(ADMIN); });
  const tutor = (email, extra = {}) => ({ nombre: `${MARCA} Tutor`, email, role: 'tutor', ...extra });

  it('a una gestora de su campus: se crea y ya la tiene', async () => {
    const email = `gestora-del-admin@${MARCA}.test`;
    const { error, estado, cuerpo } = await llamar(userController.create,
      { body: alta(email, { excepciones: { [DAR]: true } }), user: comoAdmin });
    expect(error?.message).toBeUndefined();
    expect(estado).toBe(201);
    olvidarPermisos(cuerpo.data.id);
    expect((await explicarPermisos(cuerpo.data.id)).excepciones[DAR]).toBe(true);
  });

  it('a un tutor sin campus: lo dice claro antes de crear a nadie, y no sale el correo', async () => {
    const email = `tutor-sin-campus@${MARCA}.test`;
    const { error } = await llamar(userController.create,
      { body: tutor(email, { excepciones: { 'tasks.view_own': false } }), user: comoAdmin });
    expect(error?.code).toBe('SIN_CAMPUS_SUYO');
    expect(error?.statusCode).toBe(400);
    expect(error?.message).toMatch(/uno de tus campus/);
    expect(await existe(email)).toBe(false);
    expect(correos).not.toContain(email);
  });

  it('con un campus que no es suyo, igual', async () => {
    const email = `tutor-otro-campus@${MARCA}.test`;
    const { error } = await llamar(userController.create,
      { body: tutor(email, { projectIds: [OTRO_CAMPUS], excepciones: { 'tasks.view_own': false } }), user: comoAdmin });
    expect(error?.code).toBe('SIN_CAMPUS_SUYO');
    expect(await existe(email)).toBe(false);
  });

  it('el tutor de su campus, sí (con `projects`, como lo manda la pantalla)', async () => {
    const email = `tutor-con-campus@${MARCA}.test`;
    const { error, estado, cuerpo } = await llamar(userController.create, {
      body: tutor(email, { projects: [{ projectId: CAMPUS, recibeLeads: false }], excepciones: { 'tasks.view_own': false } }),
      user: comoAdmin });
    expect(error?.message).toBeUndefined();
    expect(estado).toBe(201);
    olvidarPermisos(cuerpo.data.id);
    expect((await explicarPermisos(cuerpo.data.id)).excepciones['tasks.view_own']).toBe(false);
  });

  it('sin excepciones, un tutor sin campus se sigue dando de alta como siempre', async () => {
    const email = `tutor-sin-nada@${MARCA}.test`;
    const { estado } = await llamar(userController.create, { body: tutor(email), user: comoAdmin });
    expect(estado).toBe(201);
  });

  it('la vista previa dice por qué no deja tocarlas hasta elegir uno de sus campus', async () => {
    const sin = await editar.vistaPreviaDeAlta({ role: 'tutor' }, comoAdmin);
    expect(sin.puedeEditar).toBe(false);
    expect(sin.motivo).toMatch(/uno de tus campus/);
    const con = await editar.vistaPreviaDeAlta({ role: 'tutor', projectIds: [CAMPUS] }, comoAdmin);
    expect(con.puedeEditar).toBe(true);
    expect(con.motivo).toBeNull();
    const superadmin = await editar.vistaPreviaDeAlta({ role: 'tutor' }, { userId: SUPER, role: 'superadmin' });
    expect(superadmin.puedeEditar).toBe(true);
  });
});
