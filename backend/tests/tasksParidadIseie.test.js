import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * El tablero de tareas (#210) en ISEIE, por paridad con MultiCRM (Diego, 15/10:
 * «tienen que estar en ambos CRM todas las cosas»).
 *
 * Las pruebas grandes del tablero (`tasks*.test.js`) van contra la base de
 * verdad, como en MultiCRM. Esta va SIN base —`db.js` es de mentira— y fija
 * las reglas de quién ve y quién edita, que son las que no pueden cambiar al
 * pasar de un CRM a otro:
 *
 *   · el tablero es del equipo de desarrollo: superadmin, admin y colaborador;
 *     una gestora o soporte reciben 403 (Diego, 09/10);
 *   · el colaborador que no tiene otro rol solo llega a Tareas, avisos y lo
 *     suyo: el resto del CRM le responde 403 en `verifyToken`;
 *   · los permisos de Tareas por rol (Configuración › Roles, migración 211):
 *     solo «Aprobar y cerrar» y «Configurar», solo de admin, colaborador y roles
 *     a medida, y los cambian el superadmin y el admin;
 *   · `/api/tasks` no se monta en producción salvo en /staging o aprobado.
 */

const db = vi.hoisted(() => {
  const estado = { overrides: [], userProjects: [], sql: [] };
  function reiniciar() {
    estado.overrides = [];
    estado.userProjects = [
      { user_id: 2, project_id: 10 }, // admin de ISEIE
      { user_id: 5, project_id: 10 }, // colaboradora con campus
    ];
    estado.sql = [];
  }
  reiniciar();

  async function query(sql, params = []) {
    estado.sql.push(sql);
    if (/FROM role_permission_overrides/.test(sql)) {
      const roles = params[0] || [];
      return { rows: estado.overrides.filter((o) => roles.includes(o.role)) };
    }
    if (/SELECT project_id FROM user_projects WHERE user_id = \$1/.test(sql)) {
      return { rows: estado.userProjects.filter((u) => u.user_id === params[0]).map((u) => ({ project_id: u.project_id })) };
    }
    return { rows: [] };
  }

  const client = {
    async query(sql, params = []) {
      if (/DELETE FROM role_permission_overrides/.test(sql)) {
        estado.overrides = estado.overrides.filter((o) => !(o.role === params[0] && o.resource === params[1]));
      } else if (/INSERT INTO role_permission_overrides/.test(sql)) {
        estado.overrides.push({ role: params[0], resource: params[1], action: params[2], allowed: params[3] });
      }
      return { rows: [] };
    },
    release() {},
  };

  return { estado, reiniciar, query, getClient: async () => client };
});

vi.mock('../src/shared/config/db.js', () => ({
  query: db.query,
  getClient: db.getClient,
  default: { query: db.query },
}));

const { default: tasksRouter } = await import('../src/modules/tasks/tasks.routes.js');
const { default: permissionsRouter } = await import('../src/modules/permissions/permissions.routes.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { tareasActivas } = await import('../src/shared/config/soloEnPruebas.js');
const { verifyToken } = await import('../src/shared/middleware/auth.js');

const app = express();
app.use(express.json());
app.use('/api/tasks', tasksRouter);
app.use('/api/permissions', permissionsRouter);
// Una ruta cualquiera del CRM que solo pide token, como /api/leads.
app.get('/api/leads', verifyToken, (_req, res) => res.json({ success: true, data: [] }));
app.use(errorHandler);
const request = supertest(app);

const PERSONAS = {
  super: { userId: 1, role: 'superadmin' },
  admin: { userId: 2, role: 'admin' },
  gestora: { userId: 3, role: 'gestor' },
  soporte: { userId: 4, role: 'soporte' },
  colaboradora: { userId: 5, role: 'colaborador' },
  gestoraYColaboradora: { userId: 6, role: 'gestor', roles_extra: ['colaborador'] },
};

const como = (clave) => {
  const p = PERSONAS[clave];
  const token = jwt.sign(
    { userId: p.userId, email: `${clave}@x.com`, role: p.role, roles_extra: p.roles_extra || [], customRoleId: null, activeProjectId: 10 },
    process.env.JWT_SECRET,
    { expiresIn: '1h' },
  );
  return { Authorization: `Bearer ${token}` };
};

beforeEach(() => db.reiniciar());

describe('el tablero es del equipo de desarrollo', () => {
  it('una gestora y soporte no tienen tablero: 403', async () => {
    for (const clave of ['gestora', 'soporte']) {
      const res = await request.get('/api/tasks').set(como(clave));
      expect(res.status, clave).toBe(403);
    }
  });

  it('superadmin, admin y colaboradora entran', async () => {
    for (const clave of ['super', 'admin', 'colaboradora']) {
      const res = await request.get('/api/tasks').set(como(clave));
      expect(res.status, `${clave}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.data).toEqual([]);
    }
  });

  it('el admin ve la gente de sus campus: la consulta va acotada por ámbito', async () => {
    await request.get('/api/tasks').set(como('admin'));
    const consulta = db.estado.sql.find((s) => /FROM tasks t/.test(s));
    expect(consulta).toMatch(/user_projects/);
  });

  it('«Por revisar» (26/10/2026) es de quien supervisa: responde a todos, y a quien no supervisa nada, vacío', async () => {
    expect((await request.get('/api/tasks/review').set(como('colaboradora'))).status).toBe(200);
    expect((await request.get('/api/tasks/review').set(como('admin'))).status).toBe(200);
    expect((await request.get('/api/tasks/review/count').set(como('colaboradora'))).body.data).toEqual({ count: 0 });
  });
});

describe('el colaborador solo llega a Tareas', () => {
  it('solo colaborador: lo demás del CRM, 403 aunque la ruta solo pida token', async () => {
    expect((await request.get('/api/leads').set(como('colaboradora'))).status).toBe(403);
    expect((await request.get('/api/permissions/system-defaults').set(como('colaboradora'))).status).toBe(403);
  });

  it('con otro rol encima no se le recorta nada', async () => {
    expect((await request.get('/api/leads').set(como('gestoraYColaboradora'))).status).toBe(200);
    expect((await request.get('/api/tasks').set(como('gestoraYColaboradora'))).status).toBe(200);
  });

  it('una gestora sigue entrando en el resto del CRM', async () => {
    expect((await request.get('/api/leads').set(como('gestora'))).status).toBe(200);
  });
});

describe('los permisos de Tareas por rol (Configuración › Roles)', () => {
  it('admin y colaborador se editan; gestora, soporte, tutor y superadmin no (400)', async () => {
    const admin = await request.get('/api/permissions/role-permissions/admin').set(como('admin'));
    expect(admin.status).toBe(200);
    expect(admin.body.data.permissions).toEqual({ 'tasks.close': true, 'tasks.manage': true });

    const colab = await request.get('/api/permissions/role-permissions/colaborador').set(como('super'));
    expect(colab.body.data.permissions).toEqual({ 'tasks.close': false, 'tasks.manage': false });

    for (const rol of ['gestor', 'soporte', 'tutor', 'superadmin']) {
      const res = await request.get(`/api/permissions/role-permissions/${rol}`).set(como('super'));
      expect(res.status, rol).toBe(400);
    }
  });

  it('los cambian el superadmin y el admin; soporte y una gestora no', async () => {
    for (const clave of ['soporte', 'gestora']) {
      const res = await request.put('/api/permissions/role-permissions/colaborador')
        .set(como(clave)).send({ permissions: { 'tasks.close': true } });
      expect(res.status, clave).toBe(403);
    }
    const res = await request.put('/api/permissions/role-permissions/colaborador')
      .set(como('admin')).send({ permissions: { 'tasks.close': true } });
    expect(res.status).toBe(200);
    expect(res.body.data.permissions).toEqual({ 'tasks.close': true, 'tasks.manage': false });
    // Solo se apunta lo que se aparta del código: una fila.
    expect(db.estado.overrides).toEqual([{ role: 'colaborador', resource: 'tasks', action: 'close', allowed: true }]);
  });

  it('solo «Aprobar y cerrar» y «Configurar»: otra clave es 400', async () => {
    const res = await request.put('/api/permissions/role-permissions/admin')
      .set(como('super')).send({ permissions: { 'tasks.view_all': false } });
    expect(res.status).toBe(400);
  });

  it('con «Aprobar y cerrar» dado al colaborador, ya revisa', async () => {
    await request.put('/api/permissions/role-permissions/colaborador')
      .set(como('super')).send({ permissions: { 'tasks.close': true } });
    expect((await request.get('/api/tasks/review').set(como('colaboradora'))).status).toBe(200);
  });
});

describe('/api/tasks solo en pruebas', () => {
  it('en producción está apagado, salvo /staging o TAREAS_EN_PRODUCCION=1', () => {
    expect(tareasActivas({ NODE_ENV: 'test' })).toBe(true);
    expect(tareasActivas({ NODE_ENV: 'production', CRM_BASE_URL: 'https://crm.iseie.com' })).toBe(false);
    expect(tareasActivas({ NODE_ENV: 'production' })).toBe(false);
    expect(tareasActivas({ NODE_ENV: 'production', CRM_BASE_URL: 'https://crm.iseie.com/staging' })).toBe(true);
    expect(tareasActivas({ NODE_ENV: 'production', CRM_BASE_URL: 'https://crm.iseie.com/staging/' })).toBe(true);
    expect(tareasActivas({ NODE_ENV: 'production', CRM_BASE_URL: 'https://crm.iseie.com/stagingx' })).toBe(false);
    expect(tareasActivas({ NODE_ENV: 'production', TAREAS_EN_PRODUCCION: '1' })).toBe(true);
  });
});
