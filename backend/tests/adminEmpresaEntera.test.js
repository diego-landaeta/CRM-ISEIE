import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

// Los permisos salen del catálogo (#423): sin base, el resolver de verdad con
// las personas que firman token (tests/helpers/permisosSinBase.js).
vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
const { registrar } = await import('./helpers/permisosSinBase.js');

/**
 * Un admin con la empresa entera, también los campus que se creen (#220).
 *
 * Diego, 10/10: «Un admin puede tener los proyectos futuros, pero de SU
 * empresa: mayormente los admin son por empresa». No es un superadmin: no ve
 * otras empresas ni gestiona usuarios.
 *
 * Sin base: `db.js` es una base de mentira en memoria que entiende solo las
 * consultas de este camino. Lo que se fija es el comportamiento, no el SQL:
 *
 *   · un admin solo con empresa se da de alta, y le llegan sus campus;
 *   · una gestora sin campus, no;
 *   · un campus nuevo de la empresa le llega; uno de otra, no;
 *   · quitar la casilla le deja los campus que tenía;
 *   · solo el super admin da empresas: un admin no se las da a sí mismo.
 */

// ── La base de mentira ─────────────────────────────────────────────────────
const db = vi.hoisted(() => {
  const estado = {};
  function reiniciar() {
    estado.issuers = [{ id: 1, nombre: 'CEDIA' }, { id: 2, nombre: 'Lateral Thinking' }];
    estado.projects = [
      { id: 10, nombre: 'ISEIH', sociedad_emisora_id: 1, active: true },
      { id: 11, nombre: 'ICTESS', sociedad_emisora_id: 1, active: true },
      { id: 20, nombre: 'ACADEMIA IA', sociedad_emisora_id: 2, active: true },
    ];
    estado.users = [
      { id: 1, nombre: 'Super', email: 'super@x.com', role: 'superadmin', active: true },
      { id: 2, nombre: 'Admin de siempre', email: 'admin@x.com', role: 'admin', active: true },
    ];
    estado.userProjects = [{ user_id: 2, project_id: 10, active: true, recibe_leads: false }];
    estado.userEmpresas = [];
    estado.hayTabla = true;
    estado.sql = [];
  }
  reiniciar();

  const up = (userId, projectId) => {
    const fila = estado.userProjects.find((f) => f.user_id === userId && f.project_id === projectId);
    if (fila) { fila.active = true; return fila; }
    const nueva = { user_id: userId, project_id: projectId, active: true, recibe_leads: false };
    estado.userProjects.push(nueva);
    return nueva;
  };

  async function query(sql, params = []) {
    estado.sql.push(sql);
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(s)) return { rows: [] };
    if (s.includes("to_regclass('public.user_empresas')")) return { rows: [{ hay: estado.hayTabla }] };
    if (s.includes('FROM information_schema.columns')) return { rows: [] };
    if (s.startsWith('SELECT id FROM invoice_issuers')) {
      return { rows: estado.issuers.filter((i) => params[0].includes(i.id)).map((i) => ({ id: i.id })) };
    }
    if (s.startsWith('SELECT id FROM users WHERE LOWER(email)')) {
      return { rows: estado.users.filter((u) => u.email === String(params[0]).toLowerCase()) };
    }
    if (s.startsWith('INSERT INTO users')) {
      const u = { id: estado.users.length + 1, nombre: params[0], email: params[1], role: params[3], active: true, roles_extra: [] };
      estado.users.push(u);
      return { rows: [u] };
    }
    if (s.startsWith('SELECT u.id, u.nombre, u.email, u.role')) {
      return { rows: estado.users.filter((u) => u.id === Number(params[0])) };
    }
    // Registro de permisos (#423): cómo estaba la persona, y el apunte.
    if (s.startsWith('SELECT u.role::text AS role, COALESCE(u.roles_extra::text[]')) {
      return { rows: estado.users.filter((u) => u.id === Number(params[0])).map((u) => ({
        role: u.role, roles_extra: u.roles_extra || [], factura_manager: false, editar_fechas_factura: false,
        gestor_colaboraciones: false, usa_whatsapp: true })) };
    }
    if (s.startsWith('INSERT INTO permisos_registro')) {
      (estado.registro ||= []).push(params);
      return { rows: [] };
    }
    if (s.startsWith('SELECT role FROM users WHERE id')) {
      return { rows: estado.users.filter((u) => u.id === Number(params[0])).map((u) => ({ role: u.role })) };
    }
    if (s.startsWith('UPDATE users SET')) {
      const id = params[params.length - 1];
      const u = estado.users.find((x) => x.id === Number(id));
      const m = s.match(/role = \$(\d+)/);
      if (u && m) u.role = params[Number(m[1]) - 1];
      return { rows: [], rowCount: u ? 1 : 0 };
    }
    if (s.startsWith('UPDATE user_projects SET active = false WHERE user_id')) {
      estado.userProjects.filter((f) => f.user_id === params[0]).forEach((f) => { f.active = false; });
      return { rows: [] };
    }
    // Un campus marcado a mano (alta o edición).
    if (s.startsWith('INSERT INTO user_projects') && s.includes('VALUES ($1, $2,')) {
      const f = up(params[0], params[1]);
      f.recibe_leads = !!params[2];
      return { rows: [] };
    }
    // Los campus de hoy de las empresas marcadas.
    if (s.startsWith('INSERT INTO user_projects') && s.includes('p.sociedad_emisora_id = ANY($2::int[])')) {
      const ids = estado.projects.filter((p) => params[1].includes(p.sociedad_emisora_id)).map((p) => p.id);
      ids.forEach((pid) => up(params[0], pid));
      return { rows: ids.map((project_id) => ({ project_id })), rowCount: ids.length };
    }
    // Un campus nuevo, a los admins de su empresa.
    if (s.startsWith('INSERT INTO user_projects') && s.includes('JOIN user_empresas ue')) {
      const p = estado.projects.find((x) => x.id === Number(params[0]));
      const admins = estado.userEmpresas
        .filter((e) => p && e.issuer_id === p.sociedad_emisora_id)
        .map((e) => estado.users.find((u) => u.id === e.user_id))
        .filter((u) => u && u.role === 'admin' && u.active);
      admins.forEach((u) => up(u.id, p.id));
      return { rows: admins.map((u) => ({ user_id: u.id })) };
    }
    if (s.startsWith('DELETE FROM user_empresas')) {
      estado.userEmpresas = estado.userEmpresas.filter((e) => e.user_id !== params[0] || params[1].includes(e.issuer_id));
      return { rows: [] };
    }
    if (s.startsWith('INSERT INTO user_empresas')) {
      for (const issuer of params[1]) {
        if (!estado.userEmpresas.some((e) => e.user_id === params[0] && e.issuer_id === issuer)) {
          estado.userEmpresas.push({ user_id: params[0], issuer_id: issuer, creado_por: params[2] });
        }
      }
      return { rows: [] };
    }
    if (s.startsWith('SELECT issuer_id FROM user_empresas')) {
      return { rows: estado.userEmpresas.filter((e) => e.user_id === params[0]).map((e) => ({ issuer_id: e.issuer_id })).sort((a, b) => a.issuer_id - b.issuer_id) };
    }
    if (s.startsWith('SELECT p.id, p.nombre, p.slug, p.emoji, p.type FROM user_projects up')) {
      return {
        rows: estado.userProjects
          .filter((f) => f.user_id === params[0] && f.active)
          .map((f) => estado.projects.find((p) => p.id === f.project_id))
          .filter((p) => p && p.active)
          .map((p) => ({ id: p.id, nombre: p.nombre })),
      };
    }
    if (s.startsWith('INSERT INTO projects')) {
      const p = { id: 100 + estado.projects.length, nombre: params[0], sociedad_emisora_id: params[9], active: true };
      estado.projects.push(p);
      return { rows: [p] };
    }
    if (s.startsWith('INSERT INTO project_queue_state')) return { rows: [] };
    if (s.startsWith('SELECT sociedad_emisora_id FROM projects WHERE id')) {
      return { rows: estado.projects.filter((p) => p.id === Number(params[0])).map((p) => ({ sociedad_emisora_id: p.sociedad_emisora_id })) };
    }
    if (s.startsWith('UPDATE projects SET')) {
      const id = Number(params[params.length - 1]);
      const p = estado.projects.find((x) => x.id === id);
      const m = s.match(/sociedad_emisora_id = \$(\d+)/);
      if (p && m) p.sociedad_emisora_id = params[Number(m[1]) - 1];
      return { rows: p ? [{ ...p }] : [] };
    }
    throw new Error(`Consulta no prevista en la prueba: ${s.slice(0, 120)}`);
  }

  const campusDe = (userId) => estado.userProjects
    .filter((f) => f.user_id === userId && f.active).map((f) => f.project_id).sort((a, b) => a - b);

  return { estado, reiniciar, query, campusDe };
});

vi.mock('../src/shared/config/db.js', () => ({
  query: (...a) => db.query(...a),
  getClient: async () => ({ query: (...a) => db.query(...a), release: () => {} }),
  default: { query: (...a) => db.query(...a) },
}));
vi.mock('../src/shared/services/brevo.service.js', () => ({
  sendWelcomeUserEmail: vi.fn(async () => ({ sent: true })),
  sendCorreoCambiadoEmail: vi.fn(async () => ({ sent: true })),
  sendEmail: vi.fn(async () => ({ sent: true })),
}));
vi.mock('../src/modules/auth/auth.model.js', () => ({ revokeAllUserTokens: vi.fn(async () => {}), logActivity: vi.fn(async () => {}) }));
vi.mock('../src/modules/notifications/notifications.service.js', () => ({ notifyUsers: vi.fn(async () => {}) }));
vi.mock('../src/modules/mcp/mcp.model.js', () => ({ revocarTodasDeLaPersona: vi.fn(async () => {}) }));
vi.mock('../src/modules/whatsapp/roles.js', () => ({ puedeTenerWhatsapp: () => false, alPerderAcceso: vi.fn(async () => {}) }));

const { default: usuarios } = await import('../src/modules/users/index.js');
const proyectos = await import('../src/modules/projects/project.service.js');
const empresas = await import('../src/modules/users/user.empresas.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use(usuarios.prefix, usuarios.router);
app.use(errorHandler);
const request = supertest(app);

const como = (id, role) => ({ Authorization: `Bearer ${jwt.sign(registrar({ userId: id, role }), process.env.JWT_SECRET, { expiresIn: '5m' })}` });
const SUPER = como(1, 'superadmin');
const ADMIN = como(2, 'admin');

beforeEach(() => {
  db.reiniciar();
  empresas.olvidarTabla();
});

describe('el alta de un admin', () => {
  it('solo con la empresa: se acepta y le llegan los campus de hoy de esa empresa', async () => {
    const r = await request.post('/api/users').set(SUPER)
      .send({ nombre: 'Mireia', email: 'mireia@x.com', role: 'admin', empresaIds: [1] });
    expect(r.status).toBe(201);
    expect(r.body.data.empresa_ids).toEqual([1]);
    expect(db.campusDe(r.body.data.id)).toEqual([10, 11]);
    // Y nada de la otra empresa.
    expect(db.campusDe(r.body.data.id)).not.toContain(20);
    // Quién se la dio queda guardado.
    expect(db.estado.userEmpresas[0]).toMatchObject({ issuer_id: 1, creado_por: 1 });
  });

  it('sin campus ni empresa, no: no vería nada', async () => {
    const r = await request.post('/api/users').set(SUPER)
      .send({ nombre: 'Nadie', email: 'nadie@x.com', role: 'admin', projectIds: [] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/campus ni empresa/);
  });

  it('una empresa que no existe se rechaza antes de crear nada', async () => {
    const r = await request.post('/api/users').set(SUPER)
      .send({ nombre: 'Rara', email: 'rara@x.com', role: 'admin', empresaIds: [99] });
    expect(r.status).toBe(400);
    expect(db.estado.users.some((u) => u.email === 'rara@x.com')).toBe(false);
  });

  it('sin la migración aplicada, lo dice en vez de romper', async () => {
    db.estado.hayTabla = false;
    const r = await request.post('/api/users').set(SUPER)
      .send({ nombre: 'Pronto', email: 'pronto@x.com', role: 'admin', empresaIds: [1] });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('FALTA_MIGRACION');
  });
});

describe('una gestora', () => {
  it('sin campus se rechaza: sigue siendo obligatorio elegirlos', async () => {
    const r = await request.post('/api/users').set(SUPER)
      .send({ nombre: 'Gestora', email: 'g@x.com', role: 'gestor', projectIds: [] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/gestora sin campus/i);
  });

  it('y con la empresa entera en vez de campus, también: eso es solo de admins', async () => {
    const r = await request.post('/api/users').set(SUPER)
      .send({ nombre: 'Gestora', email: 'g@x.com', role: 'gestor', empresaIds: [1] });
    expect(r.status).toBe(400);
  });
});

describe('un campus nuevo', () => {
  async function adminDeCedia() {
    const r = await request.post('/api/users').set(SUPER)
      .send({ nombre: 'Mireia', email: 'mireia@x.com', role: 'admin', empresaIds: [1] });
    return r.body.data.id;
  }

  it('de su empresa: se le añade sin tocar nada', async () => {
    const id = await adminDeCedia();
    const p = await proyectos.crear({ nombre: 'ISEIE', slug: 'iseie', type: 'crm', sociedad_emisora_id: 1 });
    expect(db.campusDe(id)).toContain(p.id);
    // Y va en la misma transacción que el proyecto.
    const orden = db.estado.sql.map((s) => s.replace(/\s+/g, ' ').trim());
    const desde = orden.lastIndexOf('BEGIN');
    expect(orden.slice(desde).some((s) => s.startsWith('INSERT INTO projects'))).toBe(true);
    expect(orden.slice(desde).some((s) => s.includes('JOIN user_empresas ue'))).toBe(true);
    expect(orden[orden.length - 1]).toBe('COMMIT');
  });

  it('de otra empresa: no', async () => {
    const id = await adminDeCedia();
    const p = await proyectos.crear({ nombre: 'Tarot IA', slug: 'tarot-ia', type: 'ia', sociedad_emisora_id: 2 });
    expect(db.campusDe(id)).not.toContain(p.id);
  });

  it('el admin «de siempre», sin la casilla, no recibe nada nuevo', async () => {
    await adminDeCedia();
    const p = await proyectos.crear({ nombre: 'ISEIE', slug: 'iseie', type: 'crm', sociedad_emisora_id: 1 });
    expect(db.campusDe(2)).not.toContain(p.id);
  });

  it('un campus que PASA a su empresa también le llega; guardarlo sin cambiarla, no', async () => {
    const id = await adminDeCedia();
    await proyectos.actualizar(20, { sociedad_emisora_id: 1 });
    expect(db.campusDe(id)).toContain(20);

    // Se le quita a mano uno de la empresa, y se guarda el proyecto con la
    // misma: no vuelve. Solo vuelve si se guarda al admin con la casilla.
    db.estado.userProjects.find((f) => f.user_id === id && f.project_id === 11).active = false;
    await proyectos.actualizar(11, { sociedad_emisora_id: 1, nombre: 'ICTESS' });
    expect(db.campusDe(id)).not.toContain(11);
  });

  it('un admin desactivado no recibe campus nuevos', async () => {
    const id = await adminDeCedia();
    db.estado.users.find((u) => u.id === id).active = false;
    const p = await proyectos.crear({ nombre: 'ISEIE', slug: 'iseie', type: 'crm', sociedad_emisora_id: 1 });
    expect(db.campusDe(id)).not.toContain(p.id);
  });
});

describe('quitar la casilla', () => {
  it('conserva sus campus: solo deja de llegarle lo nuevo', async () => {
    const alta = await request.post('/api/users').set(SUPER)
      .send({ nombre: 'Mireia', email: 'mireia@x.com', role: 'admin', empresaIds: [1] });
    const id = alta.body.data.id;
    expect(db.campusDe(id)).toEqual([10, 11]);

    const r = await request.patch(`/api/users/${id}`).set(SUPER).send({ empresaIds: [] });
    expect(r.status).toBe(200);
    expect(r.body.data.empresa_ids).toEqual([]);
    expect(db.campusDe(id)).toEqual([10, 11]);

    const p = await proyectos.crear({ nombre: 'ISEIE', slug: 'iseie', type: 'crm', sociedad_emisora_id: 1 });
    expect(db.campusDe(id)).not.toContain(p.id);
  });

  it('marcarla al editar le da los campus de la empresa además de los suyos', async () => {
    const r = await request.patch('/api/users/2').set(SUPER).send({ empresaIds: [2] });
    expect(r.status).toBe(200);
    expect(db.campusDe(2)).toEqual([10, 20]);
  });

  it('no se le puede dar una empresa a quien deja de ser admin en el mismo guardado', async () => {
    const r = await request.patch('/api/users/2').set(SUPER).send({ role: 'gestor', empresaIds: [1] });
    expect(r.status).toBe(400);
    expect(db.estado.userEmpresas).toHaveLength(0);
  });
});

describe('permisos', () => {
  it('un admin no se da empresas a sí mismo', async () => {
    const r = await request.patch('/api/users/2').set(ADMIN).send({ empresaIds: [1, 2] });
    expect(r.status).toBe(403);
    expect(db.estado.userEmpresas).toHaveLength(0);
    expect(db.campusDe(2)).toEqual([10]);
  });

  it('ni se las quita a otro', async () => {
    db.estado.userEmpresas.push({ user_id: 2, issuer_id: 1 });
    const r = await request.patch('/api/users/2').set(como(3, 'admin')).send({ empresaIds: [] });
    expect(r.status).toBe(403);
    expect(db.estado.userEmpresas).toHaveLength(1);
  });

  it('ni da de alta a un admin con empresa entera', async () => {
    const r = await request.post('/api/users').set(ADMIN)
      .send({ nombre: 'Otro', email: 'otro@x.com', role: 'admin', empresaIds: [1] });
    expect(r.status).toBe(403);
    expect(db.estado.users.some((u) => u.email === 'otro@x.com')).toBe(false);
  });

  it('una gestora tampoco llega: Usuarios es de administración', async () => {
    const r = await request.patch('/api/users/2').set(como(5, 'gestor')).send({ empresaIds: [1] });
    expect(r.status).toBe(403);
  });
});
