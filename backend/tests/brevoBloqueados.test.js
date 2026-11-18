import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Correos del equipo bloqueados en Brevo (migración 290).
 *
 * Caso real (ISEIE, 17/11/2026): una gestora tres semanas sin avisos del CRM
 * porque Brevo bloqueó su dirección tras un rebote duro. Se fija:
 *
 *   · bloqueada → aviso a superadmins y admins de SU campus, campana y correo,
 *     UNA sola vez por bloqueo (la segunda vuelta no repite);
 *   · la lista de Brevo se lee entera, página a página;
 *   · «Desbloquear en Brevo»: con el permiso llama a Brevo y cierra el
 *     bloqueo; sin él, 403 y Brevo ni se entera;
 *   · interruptor apagado → nada pregunta a Brevo.
 *
 * Sin base y sin red: `db.js` es una base de mentira y `fetch` un Brevo simulado.
 */

vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
const { registrar } = await import('./helpers/permisosSinBase.js');

// ── La base de mentira ─────────────────────────────────────────────────────
const db = vi.hoisted(() => {
  const estado = {};
  function reiniciar() {
    estado.users = [
      { id: 1, nombre: 'Super', email: 'super@prueba.test', role: 'superadmin', active: true },
      { id: 2, nombre: 'Admin del campus', email: 'admin@prueba.test', role: 'admin', active: true },
      { id: 3, nombre: 'Admin de otro campus', email: 'otro@prueba.test', role: 'admin', active: true },
      { id: 4, nombre: 'Gestora Nueva', email: 'Gestora@Prueba.test', role: 'gestor', active: true },
      { id: 5, nombre: 'Gestora de baja', email: 'baja@prueba.test', role: 'gestor', active: false },
    ];
    estado.userProjects = [
      { user_id: 2, project_id: 10, active: true },
      { user_id: 3, project_id: 20, active: true },
      { user_id: 4, project_id: 10, active: true },
      { user_id: 5, project_id: 10, active: true },
    ];
    estado.cuentasDeMarca = [];
    estado.bloqueos = [];
    estado.hayTabla = true;
  }
  reiniciar();

  const campusDe = (id) => estado.userProjects.filter((f) => f.user_id === id && f.active).map((f) => f.project_id);

  async function query(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.includes("to_regclass('public.brevo_bloqueos')")) return { rows: [{ hay: estado.hayTabla }] };
    if (s.startsWith('SELECT DISTINCT project_id FROM api_credentials')) {
      return { rows: estado.cuentasDeMarca.map((project_id) => ({ project_id })) };
    }
    if (s.startsWith('SELECT id, nombre, email FROM users WHERE active = true')) {
      return { rows: estado.users.filter((u) => u.active && u.email) };
    }
    if (s.startsWith('INSERT INTO brevo_bloqueos')) {
      const [userId, email, huella, codigo, motivo, desde, cuentas] = params;
      let b = estado.bloqueos.find((x) => x.user_id === userId && x.huella === huella);
      if (b) Object.assign(b, { codigo, motivo, cuentas, resuelto_at: null });
      else {
        b = { id: estado.bloqueos.length + 1, user_id: userId, email, huella, codigo, motivo,
          bloqueado_desde: desde, cuentas, avisado_at: null, resuelto_at: null, desbloqueado_por: null };
        estado.bloqueos.push(b);
      }
      return { rows: [{ id: b.id, avisado_at: b.avisado_at }] };
    }
    if (s.startsWith('UPDATE brevo_bloqueos SET avisado_at = NOW() WHERE id = $1')) {
      estado.bloqueos.find((b) => b.id === params[0]).avisado_at = new Date();
      return { rows: [], rowCount: 1 };
    }
    if (s.startsWith('UPDATE brevo_bloqueos SET resuelto_at = NOW() WHERE resuelto_at IS NULL AND NOT')) {
      const cerrar = estado.bloqueos.filter((b) => !b.resuelto_at && !params[0].includes(b.id));
      cerrar.forEach((b) => { b.resuelto_at = new Date(); });
      return { rows: [], rowCount: cerrar.length };
    }
    if (s.startsWith('UPDATE brevo_bloqueos SET resuelto_at = NOW(), desbloqueado_por = $2')) {
      estado.bloqueos.filter((b) => b.user_id === params[0] && !b.resuelto_at)
        .forEach((b) => { b.resuelto_at = new Date(); b.desbloqueado_por = params[1]; });
      return { rows: [] };
    }
    const abiertosDe = (userId) => estado.bloqueos.filter((b) => !b.resuelto_at && (userId == null || b.user_id === userId)
      && estado.users.find((u) => u.id === b.user_id)?.email.toLowerCase() === b.email);
    if (s.startsWith('SELECT b.id, b.email, b.cuentas FROM brevo_bloqueos b')) return { rows: abiertosDe(params[0]) };
    if (s.startsWith('SELECT b.id, b.user_id, b.codigo, b.motivo')) {
      const campus = params[0];
      return { rows: abiertosDe(null).filter((b) => !campus || campusDe(b.user_id).some((c) => campus.includes(c))) };
    }
    if (s.startsWith('SELECT DISTINCT u.id, u.nombre, u.email FROM users u')) {
      const suyos = campusDe(params[0]);
      return { rows: estado.users.filter((u) => u.active && u.id !== params[0]
        && (u.role === 'superadmin' || (u.role === 'admin' && campusDe(u.id).some((c) => suyos.includes(c))))) };
    }
    if (s.startsWith('SELECT project_id FROM user_projects WHERE user_id = $1')) {
      return { rows: campusDe(params[0]).map((project_id) => ({ project_id })) };
    }
    throw new Error(`Consulta no prevista en la prueba: ${s.slice(0, 120)}`);
  }
  return { estado, reiniciar, query };
});

vi.mock('../src/shared/config/db.js', () => ({
  query: (...a) => db.query(...a),
  getClient: async () => ({ query: (...a) => db.query(...a), release: () => {} }),
  default: { query: (...a) => db.query(...a) },
}));
const correos = vi.hoisted(() => []);
vi.mock('../src/shared/services/brevo.service.js', () => ({
  sendWelcomeUserEmail: vi.fn(async () => ({ sent: true })),
  sendCorreoCambiadoEmail: vi.fn(async () => ({ sent: true })),
  sendEmail: vi.fn(async (m) => { correos.push(m); return { sent: true }; }),
}));
const campana = vi.hoisted(() => []);
vi.mock('../src/modules/notifications/notifications.service.js', () => ({
  notifyUsers: vi.fn(async (n) => { campana.push(n); }),
}));
vi.mock('../src/modules/credentials/credentials.model.js', () => ({
  getDecryptedValue: vi.fn(async (_s, projectId) => (projectId ? `clave-marca-${projectId}` : 'clave-crm')),
}));
vi.mock('../src/modules/auth/auth.model.js', () => ({ revokeAllUserTokens: vi.fn(async () => {}), logActivity: vi.fn(async () => {}) }));
vi.mock('../src/modules/mcp/mcp.model.js', () => ({ revocarTodasDeLaPersona: vi.fn(async () => {}) }));
vi.mock('../src/modules/whatsapp/roles.js', () => ({ puedeTenerWhatsapp: () => false, alPerderAcceso: vi.fn(async () => {}) }));

const { default: usuarios } = await import('../src/modules/users/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { revisar, _olvidarTabla } = await import('../src/modules/users/brevo-bloqueos.js');
const { startBrevoBloqueadosScheduler } = await import('../src/jobs/brevoBloqueadosScheduler.js');

const app = express();
app.use(express.json());
app.use(usuarios.prefix, usuarios.router);
app.use(errorHandler);
const request = supertest(app);
const como = (id, role) => ({ Authorization: `Bearer ${jwt.sign(registrar({ userId: id, role }), process.env.JWT_SECRET, { expiresIn: '5m' })}` });

// ── Brevo simulado ─────────────────────────────────────────────────────────
// 130 direcciones de alumnos dadas de baja y, en la SEGUNDA página, la gestora:
// si solo se leyera la primera página, no se la vería.
const brevo = { bloqueados: [], llamadas: [] };
function listaDeBrevo({ conGestora = true, fecha = '2026-10-26T09:15:00Z' } = {}) {
  const alumnos = Array.from({ length: 130 }, (_, i) => ({
    email: `alumno${i}@prueba.test`, senderEmail: 'no-reply@prueba.test',
    reason: { code: 'unsubscribedViaEmail', message: 'Unsubscribed via email' }, blockedAt: '2026-09-01T10:00:00Z',
  }));
  if (conGestora) {
    alumnos.splice(120, 0, { email: 'gestora@prueba.test', senderEmail: 'no-reply@prueba.test',
      reason: { code: 'hardBounce', message: 'Hard bounce' }, blockedAt: fecha });
  }
  return alumnos;
}
const fetchFalso = vi.fn(async (url, opciones = {}) => {
  const u = new URL(url);
  brevo.llamadas.push({ metodo: opciones.method || 'GET', ruta: u.pathname, clave: opciones.headers?.['api-key'] });
  if ((opciones.method || 'GET') === 'GET' && u.pathname === '/v3/smtp/blockedContacts') {
    const limit = Number(u.searchParams.get('limit'));
    const offset = Number(u.searchParams.get('offset'));
    const datos = { contacts: brevo.bloqueados.slice(offset, offset + limit), count: brevo.bloqueados.length };
    return { ok: true, status: 200, json: async () => datos, text: async () => JSON.stringify(datos) };
  }
  if (opciones.method === 'DELETE' && u.pathname.startsWith('/v3/smtp/blockedContacts/')) {
    const email = decodeURIComponent(u.pathname.split('/').pop());
    brevo.bloqueados = brevo.bloqueados.filter((c) => c.email !== email);
    return { ok: true, status: 204, json: async () => ({}), text: async () => '' };
  }
  return { ok: false, status: 404, json: async () => ({}), text: async () => 'no' };
});

beforeEach(() => {
  db.reiniciar();
  _olvidarTabla();
  correos.length = 0;
  campana.length = 0;
  brevo.llamadas = [];
  brevo.bloqueados = listaDeBrevo();
  fetchFalso.mockClear();
  vi.stubGlobal('fetch', fetchFalso);
  process.env.BREVO_BLOQUEADOS_ACTIVO = 'true';
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.BREVO_BLOQUEADOS_ACTIVO;
});

describe('la tarea: bloqueada → aviso, una sola vez', () => {
  it('avisa a superadmin y admin de su campus (no al de otro), con motivo y fecha', async () => {
    const r = await revisar();
    expect(r).toMatchObject({ cuentas: 1, equipo: 1, nuevos: 1 });

    // La lista entera: 131 direcciones = dos páginas de 100.
    expect(brevo.llamadas.filter((l) => l.metodo === 'GET')).toHaveLength(2);

    expect(campana).toHaveLength(1);
    expect(campana[0].type).toBe('brevo_bloqueado');
    expect([...campana[0].targetUserIds].sort()).toEqual([1, 2]);
    expect(campana[0].title).toContain('Gestora Nueva');
    expect(campana[0].message).toMatch(/26 de octubre de 2026/);
    expect(campana[0].message).toMatch(/Rebote duro/);

    expect(correos.map((c) => c.to).sort()).toEqual(['admin@prueba.test', 'super@prueba.test']);
    expect(correos[0].htmlContent).toMatch(/gestora@prueba.test/i);
    expect(correos[0].htmlContent).toMatch(/Rebote duro/);
    expect(correos[0].clave).toMatch(/^brevo-bloqueado-\d+-\d+$/);

    expect(db.estado.bloqueos).toHaveLength(1);
    expect(db.estado.bloqueos[0]).toMatchObject({ user_id: 4, email: 'gestora@prueba.test', codigo: 'hardBounce' });
  });

  it('la segunda vuelta no repite el aviso', async () => {
    await revisar();
    const r = await revisar();
    expect(r.nuevos).toBe(0);
    expect(campana).toHaveLength(1);
    expect(correos).toHaveLength(2);
  });

  it('las bajas del equipo no cuentan', async () => {
    brevo.bloqueados.push({ email: 'baja@prueba.test', reason: { code: 'hardBounce' }, blockedAt: '2026-10-01T00:00:00Z' });
    await revisar();
    expect(db.estado.bloqueos.map((b) => b.user_id)).toEqual([4]);
  });

  it('si Brevo la desbloquea por su cuenta, se cierra; si la vuelve a bloquear otro día, es otro aviso', async () => {
    await revisar();
    brevo.bloqueados = listaDeBrevo({ conGestora: false });
    expect((await revisar()).cerrados).toBe(1);
    expect(db.estado.bloqueos[0].resuelto_at).toBeTruthy();

    brevo.bloqueados = listaDeBrevo({ fecha: '2026-11-17T08:00:00Z' });
    expect((await revisar()).nuevos).toBe(1);
    expect(campana).toHaveLength(2);
  });

  it('con una cuenta de marca que no contesta, no se cierra nada a ciegas', async () => {
    await revisar();
    db.estado.cuentasDeMarca = [10];
    brevo.bloqueados = listaDeBrevo({ conGestora: false });
    fetchFalso.mockImplementationOnce(async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => 'caído' }));
    const r = await revisar();
    expect(r.completas).toBe(false);
    expect(r.cerrados).toBe(0);
    expect(db.estado.bloqueos[0].resuelto_at).toBeNull();
  });
});

describe('la marca y el botón «Desbloquear en Brevo»', () => {
  it('la lista de Usuarios trae la marca con el motivo y la fecha', async () => {
    await revisar();
    const r = await request.get('/api/users/brevo-bloqueos').set(como(2, 'admin'));
    expect(r.status).toBe(200);
    expect(r.body.data.activo).toBe(true);
    expect(r.body.data.bloqueos).toHaveLength(1);
    expect(r.body.data.bloqueos[0]).toMatchObject({ user_id: 4, codigo: 'hardBounce' });
  });

  it('con el permiso (admin): llama a Brevo y cierra el bloqueo', async () => {
    await revisar();
    const r = await request.delete('/api/users/4/brevo-bloqueo').set(como(2, 'admin'));
    expect(r.status).toBe(200);
    expect(r.body.data.desbloqueado).toBe(true);
    const borrado = brevo.llamadas.find((l) => l.metodo === 'DELETE');
    expect(borrado).toMatchObject({ ruta: '/v3/smtp/blockedContacts/gestora%40prueba.test', clave: 'clave-crm' });
    expect(db.estado.bloqueos[0]).toMatchObject({ desbloqueado_por: 2 });
    expect(db.estado.bloqueos[0].resuelto_at).toBeTruthy();

    const lista = await request.get('/api/users/brevo-bloqueos').set(como(2, 'admin'));
    expect(lista.body.data.bloqueos).toHaveLength(0);
  });

  it('sin el permiso (gestora): 403 y Brevo ni se entera', async () => {
    await revisar();
    const r = await request.delete('/api/users/4/brevo-bloqueo').set(como(4, 'gestor'));
    expect(r.status).toBe(403);
    expect(brevo.llamadas.some((l) => l.metodo === 'DELETE')).toBe(false);
    expect(db.estado.bloqueos[0].resuelto_at).toBeNull();
  });

  it('sin bloqueo abierto, 404', async () => {
    const r = await request.delete('/api/users/4/brevo-bloqueo').set(como(1, 'superadmin'));
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('SIN_BLOQUEO');
  });
});

describe('interruptor apagado (de serie)', () => {
  beforeEach(() => { delete process.env.BREVO_BLOQUEADOS_ACTIVO; });

  it('la tarea no arranca y una vuelta no pregunta nada a Brevo', async () => {
    expect(startBrevoBloqueadosScheduler()).toBe(false);
    expect(await revisar()).toEqual({ apagado: true });
    expect(fetchFalso).not.toHaveBeenCalled();
    expect(campana).toHaveLength(0);
    expect(correos).toHaveLength(0);
  });

  it('la marca no sale y el botón contesta 409 sin llamar a Brevo', async () => {
    const lista = await request.get('/api/users/brevo-bloqueos').set(como(1, 'superadmin'));
    expect(lista.body.data).toEqual({ activo: false, bloqueos: [] });
    const r = await request.delete('/api/users/4/brevo-bloqueo').set(como(1, 'superadmin'));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('BREVO_BLOQUEADOS_APAGADO');
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});
