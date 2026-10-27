import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * «Actividad» (`/activity`) daba 500 en producción (QA 15/10, F9; ref HBC85X):
 * «userModel.listActivityLog is not a function». El commit 02af73a (10/06)
 * copió el modelo de usuarios de ISEIH, que no tiene esa función, y la ruta,
 * el controlador y la pantalla se quedaron colgando.
 *
 * Sin base: `db.js` es una base de mentira en memoria que entiende solo las
 * consultas de este camino. Lo que se fija:
 *
 *   · el modelo exporta la función y la ruta contesta 200 con lo que pinta la
 *     pantalla (`data` como lista, y en cada fila usuario, acción, detalle, IP
 *     y fecha);
 *   · super admin y soporte ven todo; un admin, lo suyo y lo de su campus, y
 *     nada de otro campus ni de un campus que ya dejó; una gestora, 403;
 *   · el ámbito va con EXISTS, sin JOIN a user_projects que multiplique filas.
 */

const db = vi.hoisted(() => {
  const estado = {};
  function reiniciar() {
    estado.users = [
      { id: 1, nombre: 'Super', email: 'super@x.com', role: 'superadmin' },
      { id: 2, nombre: 'Admin ISEIE', email: 'admin@x.com', role: 'admin' },
      { id: 3, nombre: 'Gestora ISEIE', email: 'g10@x.com', role: 'gestor' },
      { id: 4, nombre: 'Gestora ICTESS', email: 'g20@x.com', role: 'gestor' },
      { id: 5, nombre: 'Gestora que dejó ISEIE', email: 'gex@x.com', role: 'gestor' },
      { id: 6, nombre: 'Admin sin campus', email: 'admin2@x.com', role: 'admin' },
      { id: 7, nombre: 'Soporte', email: 'soporte@x.com', role: 'soporte' },
    ];
    // Admin 2 en dos campus: con un JOIN, cada fila de la gestora 3 saldría dos veces.
    estado.userProjects = [
      { user_id: 2, project_id: 10, active: true },
      { user_id: 2, project_id: 11, active: true },
      { user_id: 3, project_id: 10, active: true },
      { user_id: 3, project_id: 11, active: true },
      { user_id: 4, project_id: 20, active: true },
      { user_id: 5, project_id: 10, active: false },
    ];
    const t = (min) => new Date(Date.UTC(2026, 9, 14, 10, min)).toISOString();
    estado.log = [
      { id: 1, user_id: 1, action: 'login', details: null, ip_address: '10.0.0.1', created_at: t(1) },
      { id: 2, user_id: 2, action: 'login', details: null, ip_address: '10.0.0.2', created_at: t(2) },
      { id: 3, user_id: 3, action: 'lead.update', details: { lead_id: 9 }, ip_address: null, created_at: t(3) },
      { id: 4, user_id: 4, action: 'lead.create', details: { lead_id: 8 }, ip_address: null, created_at: t(4) },
      { id: 5, user_id: 5, action: 'login', details: null, ip_address: null, created_at: t(5) },
      { id: 6, user_id: 6, action: 'usuario.cambiar_contrasena', details: { usuario_id: 3 }, ip_address: null, created_at: t(6) },
    ];
    estado.sql = [];
  }
  reiniciar();

  // Aplica a las filas del registro lo que diga el WHERE de la consulta. Si el
  // modelo dejara de acotar, el filtro de ámbito no casaría y el admin vería
  // todo: la prueba falla, no pasa en falso.
  function filtrar(s, params) {
    let filas = estado.log.map((a) => {
      const u = estado.users.find((x) => x.id === a.user_id) || {};
      return { ...a, user_nombre: u.nombre ?? null, user_email: u.email ?? null, user_role: u.role ?? null };
    });
    const ambito = s.match(/a\.user_id = \$(\d+) OR EXISTS/);
    const campus = s.match(/up\.project_id = ANY\(\$(\d+)::int\[\]\)/);
    if (ambito || campus) {
      const yo = params[Number(ambito[1]) - 1];
      const mios = params[Number(campus[1]) - 1];
      filas = filas.filter((f) => f.user_id === yo || estado.userProjects.some(
        (up) => up.user_id === f.user_id && up.active && mios.includes(up.project_id)));
    }
    for (const m of s.matchAll(/a\.user_id = \$(\d+)(?!\d| OR EXISTS)/g)) {
      filas = filas.filter((f) => f.user_id === params[Number(m[1]) - 1]);
    }
    const busca = s.match(/u\.nombre ILIKE \$(\d+)/);
    if (busca) {
      const txt = String(params[Number(busca[1]) - 1]).replace(/%/g, '').toLowerCase();
      filas = filas.filter((f) => [f.user_nombre, f.user_email, f.action]
        .some((v) => String(v || '').toLowerCase().includes(txt)));
    }
    return filas;
  }

  async function query(sql, params = []) {
    estado.sql.push({ sql, params });
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT project_id FROM user_projects WHERE user_id = $1 AND active = true')) {
      return {
        rows: estado.userProjects.filter((f) => f.user_id === params[0] && f.active)
          .map((f) => ({ project_id: f.project_id })).sort((a, b) => a.project_id - b.project_id),
      };
    }
    if (s.startsWith('SELECT COUNT(*)::int AS total FROM user_activity_log')) {
      return { rows: [{ total: filtrar(s, params).length }] };
    }
    if (s.includes('FROM user_activity_log a')) {
      const lim = s.match(/LIMIT \$(\d+) OFFSET \$(\d+)/);
      const limit = params[Number(lim[1]) - 1];
      const offset = params[Number(lim[2]) - 1];
      const filas = filtrar(s, params).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
      return { rows: filas.slice(offset, offset + limit) };
    }
    // El errorHandler apunta los 5xx en status_errors: se deja pasar.
    if (s.startsWith('INSERT INTO status_errors') || s.startsWith('DELETE FROM status_errors')) return { rows: [] };
    throw new Error(`Consulta no prevista en la prueba: ${s.slice(0, 120)}`);
  }

  return { estado, reiniciar, query };
});

vi.mock('../src/shared/config/db.js', () => ({
  query: (...a) => db.query(...a),
  getClient: async () => ({ query: (...a) => db.query(...a), release: () => {} }),
  default: { query: (...a) => db.query(...a) },
}));
// Los permisos salen del catálogo (#230, gemela de CRM#423): sin base, el
// resolver de verdad con la persona que firma el token.
vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
const { registrar } = await import('./helpers/permisosSinBase.js');

const userModel = await import('../src/modules/users/user.model.js');
const { default: usuarios } = await import('../src/modules/users/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use(usuarios.prefix, usuarios.router);
app.use(errorHandler);
const request = supertest(app);

const como = (id, role) => ({ Authorization: `Bearer ${jwt.sign(registrar({ userId: id, role }), process.env.JWT_SECRET, { expiresIn: '5m' })}` });
const ids = (r) => r.body.data.map((f) => f.id);
const consultasDelRegistro = () => db.estado.sql.filter((q) => /FROM user_activity_log/.test(q.sql));

beforeEach(() => db.reiniciar());

describe('el modelo', () => {
  it('exporta listActivityLog', () => {
    expect(typeof userModel.listActivityLog).toBe('function');
  });
});

describe('GET /api/users/activity-log', () => {
  it('super admin: 200, todo el registro, lo último primero, con la forma que pinta la pantalla', async () => {
    const r = await request.get('/api/users/activity-log?limit=200').set(como(1, 'superadmin'));
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(Array.isArray(r.body.data)).toBe(true);
    expect(ids(r)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(r.body.pagination).toEqual({ total: 6, limit: 200, offset: 0 });

    // Lo que lee ActivityPage.jsx de cada fila.
    const fila = r.body.data.find((f) => f.id === 3);
    expect(fila).toMatchObject({
      id: 3,
      action: 'lead.update',
      details: { lead_id: 9 },
      ip_address: null,
      user_nombre: 'Gestora ISEIE',
      user_email: 'g10@x.com',
    });
    expect(typeof fila.created_at).toBe('string');
    expect(r.body.data.find((f) => f.id === 1).ip_address).toBe('10.0.0.1');

    // Sin ámbito: ni se pregunta por sus campus ni se acota.
    expect(consultasDelRegistro().every((q) => !/user_projects/.test(q.sql))).toBe(true);
  });

  it('soporte también ve todo', async () => {
    const r = await request.get('/api/users/activity-log').set(como(7, 'soporte'));
    expect(r.status).toBe(200);
    expect(r.body.pagination.total).toBe(6);
  });

  it('admin: lo suyo y lo de sus campus, sin repetir; nada de otro campus ni de quien lo dejó', async () => {
    const r = await request.get('/api/users/activity-log').set(como(2, 'admin'));
    expect(r.status).toBe(200);
    expect(ids(r)).toEqual([3, 2]);
    expect(r.body.pagination.total).toBe(2);
  });

  it('admin sin campus: solo lo suyo, nunca «todo»', async () => {
    const r = await request.get('/api/users/activity-log').set(como(6, 'admin'));
    expect(r.status).toBe(200);
    expect(ids(r)).toEqual([6]);
  });

  it('admin que filtra por alguien de otro campus: vacío, el filtro no salta el ámbito', async () => {
    const r = await request.get('/api/users/activity-log?userId=4').set(como(2, 'admin'));
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual([]);
    expect(r.body.pagination.total).toBe(0);
  });

  it('el ámbito va con EXISTS, sin JOIN a user_projects', async () => {
    await request.get('/api/users/activity-log').set(como(2, 'admin'));
    const consultas = consultasDelRegistro();
    expect(consultas).toHaveLength(2); // la página y el total
    for (const { sql, params } of consultas) {
      expect(sql).toMatch(/EXISTS\s*\(\s*SELECT 1 FROM user_projects up/);
      expect(sql).not.toMatch(/JOIN\s+user_projects/i);
      expect(params).toContain(2);
      expect(params).toContainEqual([10, 11]);
    }
  });

  it('la búsqueda llega al SQL y acota', async () => {
    const r = await request.get('/api/users/activity-log?search=ictess').set(como(1, 'superadmin'));
    expect(r.status).toBe(200);
    expect(ids(r)).toEqual([4]);
  });

  it('un userId que no es número es 400, no un 500 de Postgres', async () => {
    const r = await request.get('/api/users/activity-log?userId=abc').set(como(1, 'superadmin'));
    expect(r.status).toBe(400);
  });

  it('una gestora no entra: 403', async () => {
    const r = await request.get('/api/users/activity-log').set(como(3, 'gestor'));
    expect(r.status).toBe(403);
  });
});
