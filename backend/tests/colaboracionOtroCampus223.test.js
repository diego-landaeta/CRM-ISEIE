import { describe, it, expect, vi, beforeEach } from 'vitest';

// Los permisos salen del catálogo (#230, gemela de CRM#423): sin base, el
// resolver de verdad con las personas de cada `req` (tests/helpers/permisosSinBase.js).
vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
const { registrar } = await import('./helpers/permisosSinBase.js');

/**
 * #223 (gemela de MultiCRM #384) · Añadir a una tutora una formación de otro campus.
 *
 * Diego: «a Vanessa no le deja agregar formaciones de otro campus a una tutora,
 * porque no la deja, sin razón; si no está en ese campus debe de salir
 * "¿deseas añadirla a este campus?" y así».
 *
 * Lo que se fija, de punta a punta (controlador + modelo, con la base doblada):
 *   - sin `anadirAlCampus`: 409 OTRO_PROYECTO con el campus de la formación en
 *     `data`, y no se crea nada;
 *   - con `anadirAlCampus` y un campus de quien lo pide: la tutora queda en ese
 *     campus (user_projects activo) y con la formación, en una transacción;
 *   - con `anadirAlCampus` y un campus ajeno: 403 y nada creado;
 *   - el super admin, en cualquier campus;
 *   - si la colaboración no se puede crear (solape), tampoco se queda el campus.
 */

// ── Doble de la base ────────────────────────────────────────────────────────
let estado;
let foto = null; // lo que habia al empezar la transaccion, para el ROLLBACK
const sentencias = [];

const copia = (e) => JSON.parse(JSON.stringify(e));

function contestar(sql, params = []) {
  sentencias.push(sql.trim().split(/\s+/)[0]);
  const s = sql.replace(/\s+/g, ' ');
  if (/^BEGIN/.test(s)) { foto = copia(estado); return { rows: [] }; }
  if (/^COMMIT/.test(s)) { foto = null; return { rows: [] }; }
  if (/^ROLLBACK/.test(s)) { if (foto) estado = foto; foto = null; return { rows: [] }; }

  if (/SELECT gestor_colaboraciones FROM users/.test(s)) {
    return { rows: [{ gestor_colaboraciones: estado.usuarios[params[0]]?.gestorColab === true }] };
  }
  if (/SELECT EXISTS \( SELECT 1 FROM products p/.test(s)) {
    const [tutorId, productId] = params;
    const p = estado.productos[productId];
    if (!p) return { rows: [{ ok: false, proyecto: null, project_id: null }] };
    // Como la consulta de verdad: solo cuenta un campus activo.
    expect(s).toMatch(/up\.active/);
    const ok = estado.campus.some((c) => c.user_id === tutorId && c.project_id === p.project_id && c.active);
    return { rows: [{ ok, proyecto: estado.proyectos[p.project_id], project_id: p.project_id }] };
  }
  if (/SELECT 1 FROM user_projects WHERE user_id = \$1 AND project_id = ANY/.test(s)) {
    const [uid, ids] = params;
    return { rows: estado.campus.filter((c) => c.user_id === uid && ids.includes(c.project_id)).slice(0, 1) };
  }
  if (/FROM tutor_collaborations WHERE tutor_id = \$1 AND product_id = \$2/.test(s)) {
    const [tutorId, productId, desde, hasta] = params;
    const fin = hasta || '9999-12-31';
    return {
      rows: estado.colabs.filter((c) => c.tutor_id === tutorId && c.product_id === productId
        && c.vigente_desde <= fin && (c.vigente_hasta || '9999-12-31') >= desde),
    };
  }
  if (/SELECT id FROM users WHERE id = \$1 AND role = 'tutor' FOR UPDATE/.test(s)) {
    const u = estado.usuarios[params[0]];
    return { rows: u?.role === 'tutor' ? [{ id: params[0] }] : [] };
  }
  if (/INSERT INTO user_projects/.test(s)) {
    const [uid, pid] = params;
    const ya = estado.campus.find((c) => c.user_id === uid && c.project_id === pid);
    // Un tutor no entra en el reparto de prospectos: la consulta lo pone a `false`.
    const recibeLeads = /\), false\) ON CONFLICT/.test(s) ? false : params[2];
    if (ya) ya.active = true; else estado.campus.push({ user_id: uid, project_id: pid, active: true, recibe_leads: recibeLeads });
    return { rows: [], rowCount: 1 };
  }
  if (/INSERT INTO tutor_collaborations/.test(s)) {
    const [tutor_id, product_id, pct, vigente_desde, vigente_hasta] = params;
    const c = { id: estado.colabs.length + 100, tutor_id, product_id, pct, vigente_desde, vigente_hasta };
    estado.colabs.push(c);
    return { rows: [c] };
  }
  return { rows: [] };
}

const cliente = { query: vi.fn(async (sql, params) => contestar(sql, params)), release: vi.fn() };
vi.mock('../src/shared/config/db.js', () => ({
  query: vi.fn(async (sql, params) => contestar(sql, params)),
  getClient: async () => cliente,
}));
vi.mock('bcrypt', () => ({ default: { hash: async () => 'x', compare: async () => true } }));
vi.mock('../src/modules/users/user.service.js', () => ({}));
vi.mock('../src/modules/dossiers/dossier.service.js', () => ({}));
// El ámbito, como en el resto del CRM: super admin y soporte, todo; los demás, sus campus.
vi.mock('../src/shared/utils/ambito.js', () => ({
  proyectosDelAmbito: vi.fn(),
  veTodoElCrm: (u) => ['superadmin', 'soporte'].includes(u?.role),
  campusDeLaPersona: vi.fn(async (uid) => estado.campus
    .filter((c) => c.user_id === uid && c.active).map((c) => c.project_id)),
}));

const ctrl = await import('../src/modules/tutores/tutor.controller.js');

// Campus: 1 ISEIH y 2 Psiko (de Vanessa), 3 ICTESS (de nadie de aqui).
// La tutora 21 esta solo en ISEIH. Formaciones: 10 de ISEIH, 20 de Psiko, 30 de ICTESS.
const VANESSA = { userId: 9, role: 'gestor' };
const SUPER = { userId: 1, role: 'superadmin' };
beforeEach(() => {
  estado = {
    usuarios: { 1: { role: 'superadmin' }, 9: { role: 'gestor', gestorColab: true }, 21: { role: 'tutor' }, 40: { role: 'gestor' } },
    proyectos: { 1: 'ISEIH', 2: 'Psiko Aprende', 3: 'ICTESS' },
    productos: { 10: { project_id: 1 }, 20: { project_id: 2 }, 30: { project_id: 3 } },
    campus: [
      { user_id: 9, project_id: 1, active: true }, { user_id: 9, project_id: 2, active: true },
      { user_id: 21, project_id: 1, active: true },
      { user_id: 40, project_id: 1, active: true },
    ],
    colabs: [],
  };
  foto = null;
  sentencias.length = 0;
  cliente.query.mockClear();
  cliente.release.mockClear();
});

async function crear(user, body) {
  let error = null; let cuerpo = null; let codigo = 200;
  const res = { status(c) { codigo = c; return this; }, json(b) { cuerpo = b; } };
  // Vanessa gestiona colaboraciones: desde #230 es el permiso «Gestionar
  // colaboraciones» (una excepción suya), no la casilla.
  const conPermisos = registrar(estado.usuarios[user.userId]?.gestorColab
    ? { ...user, excepciones: { 'tutores.gestionar': true } } : user);
  await ctrl.crearColaboracion({ user: conPermisos, body: { tutorId: 21, pct: 10, desde: '2026-10-01', ...body } }, res, (e) => { error = e; });
  return { error, cuerpo, codigo };
}
const enCampus = (uid, pid) => estado.campus.some((c) => c.user_id === uid && c.project_id === pid && c.active);

describe('sin «añadir al campus»: se pregunta, no se bloquea en silencio', () => {
  it('409 OTRO_PROYECTO con el campus de la formación en data, y nada creado', async () => {
    const { error } = await crear(VANESSA, { productId: 20 });
    expect(error?.statusCode).toBe(409);
    expect(error?.code).toBe('OTRO_PROYECTO');
    expect(error?.data).toEqual({ projectId: 2, proyecto: 'Psiko Aprende' });
    expect(error?.message).toMatch(/Psiko Aprende/);
    expect(estado.colabs).toHaveLength(0);
    expect(enCampus(21, 2)).toBe(false);
  });

  it('una formación de su campus se asigna como siempre, sin transacción ni campus nuevo', async () => {
    const { error, codigo, cuerpo } = await crear(VANESSA, { productId: 10 });
    expect(error).toBeNull();
    expect(codigo).toBe(201);
    expect(cuerpo.data).toMatchObject({ tutor_id: 21, product_id: 10 });
    expect(cuerpo.data.campusAnadido).toBeUndefined();
    expect(sentencias).not.toContain('BEGIN');
  });

  it('una formación que no existe es un 404, no «es de otro proyecto»', async () => {
    const { error } = await crear(VANESSA, { productId: 999 });
    expect(error?.statusCode).toBe(404);
  });
});

describe('con «añadir al campus»', () => {
  it('campus de quien lo pide: la tutora queda en él y con la formación, en una transacción', async () => {
    const { error, codigo, cuerpo } = await crear(VANESSA, { productId: 20, anadirAlCampus: true });
    expect(error).toBeNull();
    expect(codigo).toBe(201);
    expect(enCampus(21, 2)).toBe(true);
    expect(estado.campus.find((c) => c.user_id === 21 && c.project_id === 2).recibe_leads).toBe(false);
    expect(estado.colabs).toEqual([expect.objectContaining({ tutor_id: 21, product_id: 20, pct: 10, vigente_desde: '2026-10-01' })]);
    expect(cuerpo.data.campusAnadido).toEqual({ projectId: 2, proyecto: 'Psiko Aprende' });
    expect(sentencias.indexOf('BEGIN')).toBeLessThan(sentencias.indexOf('COMMIT'));
    expect(sentencias).not.toContain('ROLLBACK');
    expect(cliente.release).toHaveBeenCalledTimes(1);
  });

  it('si ya tuvo ese campus y se le quitó, se le vuelve a activar', async () => {
    estado.campus.push({ user_id: 21, project_id: 2, active: false });
    const { error } = await crear(VANESSA, { productId: 20, anadirAlCampus: true });
    expect(error).toBeNull();
    expect(estado.campus.filter((c) => c.user_id === 21 && c.project_id === 2)).toEqual([expect.objectContaining({ active: true })]);
  });

  it('campus ajeno: 403 con un motivo claro, y nada creado', async () => {
    const { error } = await crear(VANESSA, { productId: 30, anadirAlCampus: true });
    expect(error?.statusCode).toBe(403);
    expect(error?.message).toMatch(/ICTESS/);
    expect(error?.message).toMatch(/no tienes acceso/);
    expect(error?.data).toEqual({ projectId: 3, proyecto: 'ICTESS' });
    expect(estado.colabs).toHaveLength(0);
    expect(enCampus(21, 3)).toBe(false);
    expect(sentencias).not.toContain('BEGIN');
  });

  it('el super admin, en cualquier campus', async () => {
    const { error, codigo } = await crear(SUPER, { productId: 30, anadirAlCampus: true });
    expect(error).toBeNull();
    expect(codigo).toBe(201);
    expect(enCampus(21, 3)).toBe(true);
    expect(estado.colabs).toHaveLength(1);
  });

  it('si choca con otro tramo suyo de esa formación: 409 SOLAPE y el campus tampoco se queda', async () => {
    estado.colabs.push({ id: 5, tutor_id: 21, product_id: 20, pct: 10, vigente_desde: '2026-01-01', vigente_hasta: null });
    const { error } = await crear(VANESSA, { productId: 20, anadirAlCampus: true });
    expect(error?.statusCode).toBe(409);
    expect(error?.code).toBe('SOLAPE');
    expect(enCampus(21, 2), 'el alta en el campus se deshace').toBe(false);
    expect(estado.colabs).toHaveLength(1);
    expect(sentencias).toContain('ROLLBACK');
    expect(cliente.release).toHaveBeenCalledTimes(1);
  });

  it('solo a un TUTOR: por aquí no se mete a una gestora en otro campus', async () => {
    const { error } = await crear(VANESSA, { tutorId: 40, productId: 20, anadirAlCampus: true });
    expect(error?.statusCode).toBe(404);
    expect(enCampus(40, 2)).toBe(false);
    expect(estado.colabs).toHaveLength(0);
  });

  it('un tutor que no comparte ningún campus con quien lo pide no existe para él (#245)', async () => {
    estado.campus = estado.campus.filter((c) => c.user_id !== 21);
    estado.campus.push({ user_id: 21, project_id: 3, active: true });
    const { error } = await crear(VANESSA, { productId: 20, anadirAlCampus: true });
    expect(error?.statusCode).toBe(404);
    expect(enCampus(21, 2)).toBe(false);
  });

  it('quien no gestiona colaboraciones, ni con el flag: 403', async () => {
    const { error } = await crear({ userId: 40, role: 'gestor' }, { productId: 20, anadirAlCampus: true });
    expect(error?.statusCode).toBe(403);
    expect(estado.colabs).toHaveLength(0);
  });
});
