import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';

/**
 * Emitir diplomas sin ser admin (`diplomas.emit`), y SOLO en sus campus.
 *
 * Diego, 22/10/2026: «que Dayana pueda emitir, no la dejan; puede hacerlo» (la misma
 * clave que en MultiCRM). Una gestora de un campus con `diplomas.emit` emite los de ese
 * campus y ninguno de otro.
 * El campus lo mira cada controlador con certifex.alcance.js (sus `user_projects`
 * activos), igual que para un admin; aqui se comprueba en cada paso del recorrido con
 * los controladores DE VERDAD.
 *
 * Sin base ni Certifex: la base se dobla con lo justo (sus campus y los proyectos) y
 * `fetch` contesta como la API /api/crm/v1, apuntando lo que se le pide.
 */

// ── la base: solo lo que mira el alcance; lo demas, vacio ───────────────────
const PROYECTOS = [{ id: 1, nombre: 'ICTESS', slug: 'ictess' }, { id: 2, nombre: 'ISEIE', slug: 'iseie' }];
const campusDe = { 61: [1], 62: [1] }; // las dos gestoras, solo en ICTESS
vi.mock('../src/shared/config/db.js', () => {
  const query = vi.fn(async (text, params) => {
    if (/FROM user_projects WHERE user_id = \$1/.test(text)) return { rows: (campusDe[params[0]] ?? []).map((id) => ({ project_id: id })) };
    if (/SELECT id, nombre, slug FROM projects/.test(text)) return { rows: PROYECTOS };
    return { rows: [] };
  });
  return { query, getClient: vi.fn(), default: { query, end: vi.fn() } };
});
const conPermiso = new Set();
vi.mock('../src/modules/permissions/permissions.service.js', () => ({
  resolvePermission: vi.fn(async (userId, _role, _custom, resource, action) =>
    conPermiso.has(`${userId}:${resource}.${action}`)),
}));

process.env.CERTIFEX_API_URL = 'https://certifex.test';
process.env.CERTIFEX_CRM_CLAVE = 'cfx_crm_clave-de-prueba-emitir-alcance';

const { default: express } = await import('express');
const { default: supertest } = await import('supertest');
const { default: jwt } = await import('jsonwebtoken');
const { default: router } = await import('../src/modules/certifex/certifex.routes.js');

const app = express();
app.use(express.json());
app.use('/api/certifex', router);
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code }));
const request = supertest(app);

const token = (userId, role) =>
  jwt.sign({ userId, email: `u${userId}@prueba.test`, role, roles_extra: [] }, process.env.JWT_SECRET, { expiresIn: '5m' });
const GESTORA_EMITE = token(61, 'gestor'); // con diplomas.emit, campus ICTESS
const SIN_EMITIR = token(62, 'gestor'); // misma gestora de ICTESS, sin el permiso

// ── Certifex de mentira ──────────────────────────────────────────────────────
const candidato = (matriculaId, centro, extra = {}) => ({
  matriculaId, centro,
  titular: { nombre: `Alumna ${matriculaId} Prueba`, email: `alumna${matriculaId}@prueba.test`, dni: '12345678Z' },
  curso: { ref: 12, nombre: 'Diplomado en Prueba' }, notaFinal: 8, umbral: 5, completado: true,
  actividades: { total: 4, calificadas: 4 }, entregas: null, terminado: true, propuesto: true, nexpediente: null,
  solicitud: { en: '2026-10-20T09:00:00.000Z', nombre: `Alumna ${matriculaId} Prueba`, nombreAlumno: null, revisado: null },
  programa: null, decision: null,
  ...extra,
});
const DE_ICTESS = 101;
const DE_ISEIE = 202;
const EXP_ICTESS = 'ICTESS-2026-000101-AAAA';
const EXP_ISEIE = 'ISEIE-2026-000202-BBBB';
const CANDIDATOS = [candidato(DE_ICTESS, 'ICTESS'), candidato(DE_ISEIE, 'ISEIE')];
const DIPLOMAS = [
  { nexpediente: EXP_ICTESS, centro: 'ICTESS', alumno: 'Alumna 101 Prueba', emitidaPor: 'x (CRM ISEIE)', aviso: null },
  { nexpediente: EXP_ISEIE, centro: 'ISEIE', alumno: 'Alumna 202 Prueba', emitidaPor: 'x (CRM ISEIE)', aviso: null },
];

let pedidas = [];
const fetchReal = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    if (!String(url).startsWith('https://certifex.test/')) return fetchReal(url, opts);
    const u = new URL(String(url));
    const p = { ruta: u.pathname.replace('/api/crm/v1', ''), query: Object.fromEntries(u.searchParams), metodo: opts.method, cuerpo: opts.body ? JSON.parse(opts.body) : null };
    pedidas.push(p);
    const responder = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const filtrar = (lista) => lista.filter((x) => !p.query.centro || x.centro === p.query.centro.toUpperCase());
    if (p.ruta === '/yo') return responder({ nombre: 'CRM ISEIE', centros: ['ICTESS', 'ISEIE'] });
    if (p.ruta === '/candidatos') { const f = filtrar(CANDIDATOS); return responder({ filas: f, total: f.length }); }
    if (p.ruta === '/diplomas') {
      const f = filtrar(DIPLOMAS).filter((d) => !p.query.q || d.nexpediente === p.query.q);
      return responder({ filas: f, total: f.length });
    }
    if (p.ruta === '/decisiones') return responder({ resultados: p.cuerpo.decisiones.map((d) => ({ matriculaId: d.matriculaId, ok: true, decision: d.decision })) });
    if (p.ruta === '/emitir') return responder({ resultados: p.cuerpo.items.map((i) => ({ matriculaId: i.matriculaId, ok: true, nexpediente: EXP_ICTESS })) });
    if (p.ruta === '/avisos') return responder({ correoActivo: true, resultados: p.cuerpo.nexpedientes.map((n) => ({ nexpediente: n, ok: true, resultado: 'enviado' })) });
    if (p.ruta === '/solicitudes/dni') return responder({ dni: p.cuerpo.dni });
    return responder({ error: `ruta no doblada: ${p.ruta}` }, 404);
  });
});
afterAll(() => { globalThis.fetch = fetchReal; });
beforeEach(() => {
  pedidas = [];
  conPermiso.clear();
  conPermiso.add('61:diplomas.emit');
});

const post = (ruta, cuerpo, t = GESTORA_EMITE) => request.post(`/api/certifex${ruta}`).set('Authorization', `Bearer ${t}`).send(cuerpo);
const get = (ruta, t = GESTORA_EMITE) => request.get(`/api/certifex${ruta}`).set('Authorization', `Bearer ${t}`);
const escrituras = () => pedidas.filter((p) => p.metodo === 'POST').map((p) => p.ruta);

describe('una gestora con diplomas.emit, en SU campus', () => {
  it('aprueba y emite, a su nombre', async () => {
    const r = await post('/diplomas/aprobar-emitir', { matriculaIds: [DE_ICTESS] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.resultados[0]).toMatchObject({ matriculaId: DE_ICTESS, ok: true, nexpediente: EXP_ICTESS });
    expect(escrituras()).toEqual(['/decisiones', '/emitir']);
    expect(pedidas.find((p) => p.ruta === '/decisiones').cuerpo.decisiones[0]).toMatchObject({ decision: 'aprobada', decididoPor: 'u61@prueba.test' });
    expect(pedidas.find((p) => p.ruta === '/emitir').cuerpo.emitidaPor).toBe('u61@prueba.test');
  });

  it('reintenta la emisión de lo aprobado', async () => {
    const r = await post('/diplomas/emitir', { matriculaIds: [DE_ICTESS] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(escrituras()).toEqual(['/emitir']);
  });

  it('pone el DNI antes de aprobar (Editar)', async () => {
    const r = await post('/diplomas/editar', { matriculaId: DE_ICTESS, dni: '87654321X' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(pedidas.find((p) => p.ruta === '/solicitudes/dni').cuerpo).toMatchObject({ matriculaId: DE_ICTESS, dni: '87654321X', editadoPor: 'u61@prueba.test' });
  });

  it('envía el diploma al alumno', async () => {
    const r = await post('/diplomas/avisos', { nexpedientes: [EXP_ICTESS] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(pedidas.find((p) => p.ruta === '/avisos').cuerpo).toMatchObject({ nexpedientes: [EXP_ICTESS], aprobadoPor: 'u61@prueba.test' });
  });

  it('ve el catálogo de su campus para «Nuevo diploma»', async () => {
    expect((await get('/diplomas/formaciones?centro=ICTESS')).status).toBe(200);
  });
});

describe('la misma gestora, en un campus que NO es suyo: 404 y nada llega a Certifex', () => {
  it('aprobar y emitir', async () => {
    const r = await post('/diplomas/aprobar-emitir', { matriculaIds: [DE_ISEIE] });
    expect(r.status).toBe(404);
    expect(escrituras()).toEqual([]);
  });

  it('en un lote con una suya y una ajena, no se aprueba ninguna', async () => {
    const r = await post('/diplomas/aprobar-emitir', { matriculaIds: [DE_ICTESS, DE_ISEIE] });
    expect(r.status).toBe(404);
    expect(escrituras()).toEqual([]);
  });

  it('reintentar la emisión', async () => {
    expect((await post('/diplomas/emitir', { matriculaIds: [DE_ISEIE] })).status).toBe(404);
    expect(escrituras()).toEqual([]);
  });

  it('editar (poner el DNI o el nombre)', async () => {
    expect((await post('/diplomas/editar', { matriculaId: DE_ISEIE, dni: '87654321X' })).status).toBe(404);
    expect((await post('/diplomas/editar', { matriculaId: DE_ISEIE, nombre: 'Otra Alumna Distinta' })).status).toBe(404);
    expect(escrituras()).toEqual([]);
  });

  it('enviar el diploma al alumno', async () => {
    expect((await post('/diplomas/avisos', { nexpedientes: [EXP_ISEIE] })).status).toBe(404);
    expect(escrituras()).toEqual([]);
  });

  it('«Nuevo diploma» y su catálogo', async () => {
    const r = await post('/diplomas/nuevo', { centro: 'ISEIE', leadId: 5, productoId: 7, dni: '12345678Z' });
    expect(r.status).toBe(404);
    expect((await get('/diplomas/formaciones?centro=ISEIE')).status).toBe(404);
    expect(escrituras()).toEqual([]);
  });

  it('el PDF de un diploma de otro campus tampoco', async () => {
    expect((await get(`/emisiones/diploma/${EXP_ISEIE}`)).status).toBe(404);
  });
});

describe('lo que no cambia', () => {
  it('sin diplomas.emit, la gestora de ese mismo campus no aprueba ni emite: 403', async () => {
    expect((await post('/diplomas/aprobar-emitir', { matriculaIds: [DE_ICTESS] }, SIN_EMITIR)).status).toBe(403);
    expect((await post('/diplomas/emitir', { matriculaIds: [DE_ICTESS] }, SIN_EMITIR)).status).toBe(403);
    expect(pedidas).toEqual([]);
  });

  it('con diplomas.emit, el A3 de imprenta sigue siendo de administración: 403', async () => {
    expect((await get(`/emisiones/diploma/${EXP_ICTESS}?formato=imprenta`)).status).toBe(403);
  });

  it('con diplomas.emit, rechazar, revocar y corregir siguen siendo de administración: 403', async () => {
    expect((await post('/diplomas/rechazar', { matriculaIds: [DE_ICTESS], motivo: 'no toca' })).status).toBe(403);
    expect((await post('/diplomas/revocar', { nexpediente: EXP_ICTESS, motivo: 'no toca' })).status).toBe(403);
    expect((await post('/diplomas/corregir', { nexpediente: EXP_ICTESS, valor: 'Otra Alumna Distinta', motivo: 'no toca' })).status).toBe(403);
    expect(pedidas).toEqual([]);
  });
});
