import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';

/**
 * «Revertir» un diploma de «Emitidos, falta enviarlos al alumno» (#351).
 *
 * Diego, 03/11/2026, sobre CEDIA-2026-000011-B5HQ: «que en esta sección se puedan revertir,
 * porque este, por ejemplo, tiene los módulos malos; reviértelo para que lo modifiquen».
 * Certifex lo hace (POST /revertir, su 0045: el número se anula y la matrícula vuelve a
 * «aprobada sin diploma»). Aquí se fija lo del CRM, lo que pide la issue:
 *
 *  · OK a nombre del usuario con sesión (nunca el del cuerpo), y queda apuntado en el CRM
 *    con la matrícula que dice Certifex;
 *  · 403 sin `diplomas.revertir`; 404 a un admin de otro campus;
 *  · 409 si ya se envió, está revocado, ya revertido o no lo emitió el CRM, y en esos casos
 *    no se le pide nada a Certifex;
 *  · motivo obligatorio (400);
 *  · mientras Certifex no tenga la ruta (o el CRM la tabla), 503 sin tocar nada, y la
 *    disponibilidad lo dice para que el botón no se ofrezca;
 *  · «por avisar» trae, en «Aprobados sin diploma», lo revertido.
 *
 * Sin base ni Certifex: la base se dobla con lo justo y `fetch` contesta como /api/crm/v1.
 */

// ── la base: el alcance y el registro de reversiones; lo demás, vacío ────────────
const PROYECTOS = [{ id: 1, nombre: 'Psiko Aprende', slug: 'psiko' }, { id: 2, nombre: 'ISEIE', slug: 'iseie' }];
const campusDe = { 71: [1], 72: [1], 73: [2] };
let registro = [];
let tablaExiste = true;
let fallaApunte = false;
vi.mock('../src/shared/config/db.js', () => {
  const fila = (r) => ({ ...r });
  const query = vi.fn(async (text, params) => {
    if (/FROM user_projects WHERE user_id = \$1/.test(text)) return { rows: (campusDe[params[0]] ?? []).map((id) => ({ project_id: id })) };
    if (/SELECT id, nombre, slug FROM projects/.test(text)) return { rows: PROYECTOS };
    if (/to_regclass\('public\.certifex_reversiones'\)/.test(text)) {
      if (tablaExiste === 'falla') throw new Error('la base no contesta (simulado)');
      return { rows: [{ existe: tablaExiste }] };
    }
    if (/INSERT INTO certifex_reversiones/.test(text)) {
      if (fallaApunte) throw new Error('la base no contesta (simulado)');
      if (registro.some((x) => x.nexpediente === params[0])) return { rows: [] };
      const r = {
        id: registro.length + 1, nexpediente: params[0], matricula_id: params[1], centro: params[2], alumno: params[3], titulacion: params[4],
        motivo: params[5], revertido_por: params[6], revertido_por_email: params[7], revertido_en: params[8] ?? '2026-11-13T10:00:00.000Z',
      };
      registro.push(r);
      return { rows: [fila(r)] };
    }
    if (/SELECT nexpediente, matricula_id FROM certifex_reversiones/.test(text)) {
      const centros = params[0];
      return { rows: registro.filter((x) => x.matricula_id != null && (!centros || centros.includes(String(x.centro).toUpperCase()))).map((x) => ({ nexpediente: x.nexpediente, matricula_id: x.matricula_id })) };
    }
    if (/SELECT nexpediente FROM certifex_reversiones WHERE nexpediente = ANY/.test(text)) {
      return { rows: registro.filter((x) => params[0].includes(x.nexpediente)).map((x) => ({ nexpediente: x.nexpediente })) };
    }
    if (/SELECT \* FROM certifex_reversiones WHERE nexpediente = \$1/.test(text)) {
      return { rows: registro.filter((x) => x.nexpediente === params[0]).map(fila) };
    }
    if (/SELECT DISTINCT ON \(matricula_id\) \* FROM certifex_reversiones/.test(text)) {
      const ultimas = new Map();
      for (const r of [...registro].sort((a, b) => a.revertido_en.localeCompare(b.revertido_en))) {
        if (params[0].includes(Number(r.matricula_id))) ultimas.set(Number(r.matricula_id), r);
      }
      return { rows: [...ultimas.values()].map(fila) };
    }
    return { rows: [] };
  });
  return { query, getClient: vi.fn(), default: { query, end: vi.fn() } };
});
vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
const { registrar } = await import('./helpers/permisosSinBase.js');

process.env.CERTIFEX_API_URL = 'https://certifex.test';
process.env.CERTIFEX_CRM_CLAVE = 'cfx_crm_clave-de-prueba-624-revertir';

const { default: express } = await import('express');
const { default: supertest } = await import('supertest');
const { default: jwt } = await import('jsonwebtoken');
const { default: router } = await import('../src/modules/certifex/certifex.routes.js');
const { olvidarCapacidades } = await import('../src/modules/certifex/certifex.cliente.js');
const { olvidarResueltas } = await import('../src/modules/certifex/certifex.diplomas.js');
const { completarReversiones } = await import('../src/modules/certifex/certifex.revertir.js');

const app = express();
app.use(express.json());
app.use('/api/certifex', router);
app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ success: false, error: err.message, code: err.code }));
const request = supertest(app);

const token = (userId, role) =>
  jwt.sign({ userId, email: `u${userId}@prueba.test`, role, roles_extra: [] }, process.env.JWT_SECRET, { expiresIn: '5m' });
registrar({ userId: 71, role: 'admin' });
// Emite y revoca, pero no revierte: el permiso nuevo es otro.
registrar({ userId: 72, role: 'gestor', excepciones: { 'diplomas.emit': true, 'diplomas.revocar': true } });
registrar({ userId: 79, role: 'gestor', excepciones: { 'diplomas.view': true, 'diplomas.view_emisiones': true } });
const SOLO_VE = jwt.sign({ userId: 79, email: 'u79@prueba.test', role: 'gestor', roles_extra: [] }, process.env.JWT_SECRET, { expiresIn: '5m' });
campusDe[79] = [1];
registrar({ userId: 73, role: 'admin' });
registrar({ userId: 74, role: 'superadmin' });
const ADMIN = token(71, 'admin'); // de Psiko
const SIN_PERMISO = token(72, 'gestor');
const ADMIN_ISEIE = token(73, 'admin'); // de otro campus
const SUPER = token(74, 'superadmin');

// ── Certifex de mentira ──────────────────────────────────────────────────────
const EXP = 'PSIKO-2026-000101-AAAA';
const EXP_ENVIADO = 'PSIKO-2026-000102-BBBB';
const EXP_REVOCADO = 'PSIKO-2026-000103-CCCC';
const EXP_FUERA = 'PSIKO-2026-000104-DDDD';
const EXP_ANULADO = 'PSIKO-2026-000105-EEEE';
const diploma = (nexpediente, extra = {}) => ({
  nexpediente, centro: 'PSIKO', alumno: 'Marta López Gil', titulacion: 'Curso en Nutrición', cursoRef: 34,
  emitidoEn: '2026-11-03T10:00:00.000Z', emitidaPor: 'diego@prueba.test (CRM 360)', revocada: false, revocacion: null,
  anulada: false, anulacion: null, aviso: null, ...extra,
});
let DIPLOMAS;
const candidato = (matriculaId, nexpediente) => ({
  matriculaId, centro: 'PSIKO',
  titular: { nombre: 'Marta López Gil', email: 'marta@prueba.test', dni: '12345678Z' },
  curso: { ref: 34, nombre: 'Curso en Nutrición Terapéutica y Funcional' }, notaFinal: 8, umbral: 5, completado: true,
  actividades: { total: 4, calificadas: 4 }, entregas: null, terminado: true, propuesto: true, nexpediente,
  solicitud: { en: '2026-11-02T09:00:00.000Z', nombre: 'Marta López Gil', nombreAlumno: null, revisado: null },
  programa: null, decision: { decision: 'aprobada', motivo: null, decididoPor: 'x', decididoEn: '2026-11-03T10:00:00.000Z', refExterna: null },
});
let CANDIDATOS;

let pedidas = [];
let conRuta = true;
let yoFalla = false;
// Como Certifex: la matrícula de esa persona y ese curso (la de EXP es la 101).
const MATRICULA_DE = { [EXP]: 101 };
let alRevertir = (p) => ({ status: 200, body: { ok: true, nexpediente: p.cuerpo.nexpediente, anulada: { en: '2026-11-13T09:30:00.000Z', por: `${p.cuerpo.revertidoPor} (CRM 360)`, motivo: p.cuerpo.motivo }, matriculaId: MATRICULA_DE[p.cuerpo.nexpediente] ?? null } });
const fetchReal = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    if (!String(url).startsWith('https://certifex.test/')) return fetchReal(url, opts);
    const u = new URL(String(url));
    const p = { ruta: u.pathname.replace('/api/crm/v1', ''), query: Object.fromEntries(u.searchParams), metodo: opts.method, cuerpo: opts.body ? JSON.parse(opts.body) : null };
    pedidas.push(p);
    const responder = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    // Como el Certifex de verdad: dice en `capacidades` lo que sabe hacer (sin la 0045, no «revertir»).
    if (p.ruta === '/yo') {
      if (yoFalla) return responder({ error: 'Error interno' }, 500);
      return responder({ nombre: 'CRM 360', centros: ['PSIKO', 'ISEIE'], ...(conRuta ? { capacidades: ['revertir'] } : {}) });
    }
    if (p.ruta === '/diplomas') {
      const est = p.query.estado ?? 'vigentes';
      const f = DIPLOMAS.filter((d) => (!p.query.q || d.nexpediente === p.query.q) && (!p.query.centro || d.centro === p.query.centro)
        && (est === 'todos' || (est === 'revocados' ? d.revocada : est === 'anulados' ? d.anulada : !d.revocada && !d.anulada)));
      // Por páginas, como Certifex (sin `pagina`, la primera de 50).
      const pag = Number(p.query.pagina || 1);
      const tam = Number(p.query.tam || 50);
      return responder({ filas: f.slice((pag - 1) * tam, pag * tam), total: f.length });
    }
    if (p.ruta === '/candidatos') {
      // Como Certifex: `solicitadas=1`, solo lo que pidió el alumno; `curso`, solo ese curso.
      const f = p.query.estado === 'aprobada' ? CANDIDATOS.filter((c) => (!p.query.centro || c.centro === p.query.centro)
        && (p.query.solicitadas !== '1' || c.solicitud) && (!p.query.curso || String(c.curso.ref) === String(p.query.curso))) : [];
      const pagC = Number(p.query.pagina || 1);
      const tamC = Number(p.query.tam || 50);
      return responder({ filas: f.slice((pagC - 1) * tamC, pagC * tamC), total: f.length });
    }
    if (p.ruta === '/revertir') {
      // Como el Certifex de verdad: sin la ruta, su 404 genérico; con ella, valida
      // `revertidoPor` antes de buscar nada (400 con un cuerpo vacío).
      if (!conRuta) return responder({ error: 'No encontrado.' }, 404);
      if (!p.cuerpo?.revertidoPor) return responder({ error: 'Falta revertidoPor: el usuario del CRM que revierte.' }, 400);
      const r = await alRevertir(p);
      return responder(r.body, r.status);
    }
    return responder({ error: 'No encontrado.' }, 404);
  });
});
afterAll(() => { globalThis.fetch = fetchReal; });
beforeEach(() => {
  pedidas = [];
  registro = [];
  tablaExiste = true;
  fallaApunte = false;
  conRuta = true;
  yoFalla = false;
  alRevertir = (p) => ({ status: 200, body: { ok: true, nexpediente: p.cuerpo.nexpediente, anulada: { en: '2026-11-13T09:30:00.000Z', por: `${p.cuerpo.revertidoPor} (CRM 360)`, motivo: p.cuerpo.motivo }, matriculaId: MATRICULA_DE[p.cuerpo.nexpediente] ?? null } });
  DIPLOMAS = [
    diploma(EXP),
    diploma(EXP_ENVIADO, { aviso: { resultado: 'enviado', en: '2026-11-04T10:00:00.000Z', por: 'x (CRM 360)' } }),
    diploma(EXP_REVOCADO, { revocada: true, revocacion: { en: '2026-11-04T10:00:00.000Z', motivo: 'error', por: 'x' } }),
    diploma(EXP_FUERA, { emitidaPor: 'admin@certifex.tech' }),
    diploma(EXP_ANULADO, { anulada: true, anulacion: { en: '2026-11-05T10:00:00.000Z', motivo: 'temario de Moodle', por: 'pepe@prueba.test (CRM 360)', sustituidaPor: null, matriculaId: 105 } }),
  ];
  CANDIDATOS = [candidato(101, EXP), candidato(102, EXP_ENVIADO)];
  olvidarCapacidades();
  olvidarResueltas();
});

const MOTIVO = 'Se emitió con las actividades de Moodle; se reemite con el temario oficial';
const revertir = (tk, cuerpo = {}) => request.post('/api/certifex/diplomas/revertir').set('Authorization', `Bearer ${tk}`)
  .send({ nexpediente: EXP, motivo: MOTIVO, ...cuerpo });
const llegoARevertir = () => pedidas.filter((p) => p.ruta === '/revertir' && p.cuerpo?.nexpediente);

describe('POST /api/certifex/diplomas/revertir', () => {
  it('revierte a nombre del usuario con sesión (no del cuerpo) y lo apunta con la matrícula de Certifex', async () => {
    const r = await revertir(ADMIN, { revertidoPor: 'otra@persona.test', matriculaId: 999 });
    expect(r.status).toBe(200);
    const [p] = llegoARevertir();
    expect(p.cuerpo).toEqual({ nexpediente: EXP, motivo: MOTIVO, revertidoPor: 'u71@prueba.test' });
    expect(r.body.data).toMatchObject({ ok: true, nexpediente: EXP, matriculaId: 101, registrado: true });
    expect(registro).toHaveLength(1);
    expect(registro[0]).toMatchObject({
      nexpediente: EXP, matricula_id: 101, centro: 'PSIKO', alumno: 'Marta López Gil', titulacion: 'Curso en Nutrición',
      motivo: MOTIVO, revertido_por: 71, revertido_por_email: 'u71@prueba.test', revertido_en: '2026-11-13T09:30:00.000Z',
    });
  });

  it('el motivo, como lo guarda Certifex (espacios seguidos, uno)', async () => {
    const r = await revertir(ADMIN, { motivo: '  Temario   de\nMoodle  ' });
    expect(r.status).toBe(200);
    expect(llegoARevertir()[0].cuerpo.motivo).toBe('Temario de Moodle');
    expect(registro[0].motivo).toBe('Temario de Moodle');
  });

  it('un superadmin, en cualquier campus', async () => {
    expect((await revertir(SUPER)).status).toBe(200);
  });

  it('403 sin `diplomas.revertir` (aunque emita y revoque), y no llega a Certifex', async () => {
    const r = await revertir(SIN_PERMISO);
    expect(r.status).toBe(403);
    expect(pedidas.filter((p) => p.ruta === '/revertir')).toHaveLength(0);
    expect((await request.get('/api/certifex/diplomas/revertir').set('Authorization', `Bearer ${SIN_PERMISO}`)).status).toBe(403);
  });

  it('404 a un admin de otro campus, y 404 si no existe; no llega a Certifex', async () => {
    expect((await revertir(ADMIN_ISEIE)).status).toBe(404);
    expect((await revertir(ADMIN, { nexpediente: 'PSIKO-2026-999999-ZZZZ' })).status).toBe(404);
    expect(llegoARevertir()).toHaveLength(0);
    expect(registro).toHaveLength(0);
  });

  it.each([
    ['ya enviado al alumno', EXP_ENVIADO, 'YA_ENVIADO'],
    ['revocado', EXP_REVOCADO, 'REVOCADO'],
    ['emitido fuera del CRM', EXP_FUERA, 'EMITIDO_FUERA'],
  ])('409 si está %s, y no llega a Certifex', async (_caso, nexpediente, code) => {
    const r = await revertir(ADMIN, { nexpediente });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe(code);
    expect(llegoARevertir()).toHaveLength(0);
    expect(registro).toHaveLength(0);
  });

  it('409 si ya está revertido; y si el CRM no lo tenía apuntado, lo apunta con lo que dice Certifex', async () => {
    const r = await revertir(ADMIN, { nexpediente: EXP_ANULADO });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('YA_REVERTIDO');
    expect(llegoARevertir()).toHaveLength(0);
    expect(registro).toHaveLength(1);
    expect(registro[0]).toMatchObject({ nexpediente: EXP_ANULADO, matricula_id: 105, motivo: 'temario de Moodle', revertido_por_email: 'pepe@prueba.test', revertido_por: null, revertido_en: '2026-11-05T10:00:00.000Z' });
    // Otra vez: no lo duplica.
    expect((await revertir(ADMIN, { nexpediente: EXP_ANULADO })).status).toBe(409);
    expect(registro).toHaveLength(1);
  });

  it('entregado desde el panel de Certifex (sin aviso del CRM): 409 que lo dice, sin llamar a Certifex', async () => {
    DIPLOMAS.push(diploma('PSIKO-2026-000107-GGGG', { entregado: true }));
    const r = await revertir(ADMIN, { nexpediente: 'PSIKO-2026-000107-GGGG' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/desde el panel de Certifex/);
    expect(llegoARevertir()).toHaveLength(0);
  });

  it('aviso aprobado pero el correo no salió: 409 que lo dice (no «ya se ha enviado»), sin llamar a Certifex', async () => {
    DIPLOMAS.push(diploma('PSIKO-2026-000106-FFFF', { aviso: { resultado: 'correo_apagado', en: '2026-11-04T10:00:00.000Z', por: 'x (CRM 360)' } }));
    const r = await revertir(ADMIN, { nexpediente: 'PSIKO-2026-000106-FFFF' });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/aprobó el aviso.*correo está apagado.*cuenta como entregado/);
    expect(r.body.error).not.toMatch(/Ya se ha enviado/);
    expect(llegoARevertir()).toHaveLength(0);
  });

  it('si Certifex dice que no (p. ej. lo enviaron entre medias), su error tal cual y no se apunta nada', async () => {
    alRevertir = () => ({ status: 409, body: { error: 'Ya se entregó al alumno, así que no se revierte (se revoca): …' } });
    const r = await revertir(ADMIN);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Ya se entregó/);
    expect(registro).toHaveLength(0);
  });

  it.each([
    ['sin motivo', { motivo: undefined }],
    ['motivo vacío', { motivo: '   ' }],
    ['motivo de 2 letras', { motivo: 'ab' }],
    ['motivo de más de 500', { motivo: 'x'.repeat(501) }],
    ['número mal escrito', { nexpediente: 'no-es-un-numero' }],
  ])('400 con %s, y no llega a Certifex', async (_caso, cuerpo) => {
    const r = await revertir(ADMIN, cuerpo);
    expect(r.status).toBe(400);
    expect(llegoARevertir()).toHaveLength(0);
  });

  it('sin la ruta en Certifex: 503 antes de tocar nada', async () => {
    conRuta = false;
    const r = await revertir(ADMIN);
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('CERTIFEX_SIN_REVERTIR');
    expect(llegoARevertir()).toHaveLength(0);
  });

  it('sin la tabla del CRM (migración 301): 503 antes de llamar a Certifex', async () => {
    tablaExiste = false;
    const r = await revertir(ADMIN);
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('CRM_SIN_MIGRACION');
    expect(pedidas.filter((p) => p.ruta === '/revertir')).toHaveLength(0);
  });

  it('revertido en Certifex pero el CRM no lo pudo apuntar: 200 con el aviso, sin fingir que quedó apuntado', async () => {
    fallaApunte = true;
    const r = await revertir(ADMIN);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ registrado: false });
    expect(r.body.data.aviso).toMatch(/no lo pudo apuntar/);
  });

  it('la matrícula la dice Certifex: no se recorren las aprobadas del campus', async () => {
    expect((await revertir(ADMIN)).status).toBe(200);
    expect(pedidas.filter((p) => p.ruta === '/candidatos')).toHaveLength(0);
  });

  it('si Certifex no da matrícula (o da algo que no es un id), revierte igual y lo apunta sin ella', async () => {
    for (const valor of [null, 'abc', 1.5]) {
      registro = [];
      alRevertir = (p) => ({ status: 200, body: { ok: true, nexpediente: p.cuerpo.nexpediente, anulada: { en: '2026-11-13T09:30:00.000Z', por: 'x', motivo: 'm' }, matriculaId: valor } });
      const r = await revertir(ADMIN);
      expect(r.status).toBe(200);
      expect(r.body.data.matriculaId).toBeNull();
      expect(registro[0].matricula_id).toBeNull();
    }
  });
});

describe('GET /api/certifex/diplomas/revertir (¿se puede usar?)', () => {
  const disp = (tk = ADMIN) => request.get('/api/certifex/diplomas/revertir').set('Authorization', `Bearer ${tk}`);

  it('sí, con la tabla y «revertir» en las capacidades de Certifex (lo dice /yo: no se llama a /revertir)', async () => {
    const r = await disp();
    expect(r.body.data).toEqual({ disponible: true, motivo: null });
    expect(pedidas.filter((p) => p.ruta === '/yo')).toEqual([expect.objectContaining({ metodo: 'GET' })]);
    expect(pedidas.filter((p) => p.ruta === '/revertir')).toEqual([]);
  });

  it('si no se puede preguntar a Certifex, no disponible y lo dice (no «no lo tiene»)', async () => {
    yoFalla = true;
    const r = await disp();
    expect(r.body.data.disponible).toBe(false);
    expect(r.body.data.motivo).toMatch(/No se pudo comprobar si Certifex permite revertir/);
  });

  it('no, si Certifex no tiene la ruta (falta su 0045)', async () => {
    conRuta = false;
    const r = await disp();
    expect(r.body.data.disponible).toBe(false);
    expect(r.body.data.motivo).toMatch(/0045/);
  });

  it('no, si falta la migración del CRM (y lo dice)', async () => {
    tablaExiste = false;
    const r = await disp();
    expect(r.body.data).toMatchObject({ disponible: false });
    expect(r.body.data.motivo).toMatch(/301/);
  });

  it('no, con el motivo, si la base no contesta', async () => {
    tablaExiste = 'falla';
    const r = await disp();
    expect(r.body.data.disponible).toBe(false);
    expect(r.body.data.motivo).toMatch(/base del CRM/);
  });
});

describe('el repaso de reversiones (tarea programada): lo que Certifex revirtió y el CRM no apuntó, se apunta', () => {
  it('apunta la reversión que faltaba, con su matrícula, una sola vez', async () => {
    expect(await completarReversiones()).toEqual({ apuntadas: 1 });
    expect(registro).toEqual([expect.objectContaining({ nexpediente: EXP_ANULADO, matricula_id: 105, revertido_por: null, revertido_por_email: 'pepe@prueba.test', motivo: 'temario de Moodle' })]);
    expect(await completarReversiones()).toEqual({ apuntadas: 0 });
    expect(registro).toHaveLength(1);
  });

  it('solo apunta lo que revirtió ESTE CRM: lo revertido por otro CRM (un campus compartido) no', async () => {
    DIPLOMAS = [
      ...DIPLOMAS,
      diploma('PSIKO-2026-000106-FFFF', { anulada: true, anulacion: { en: '2026-11-06T10:00:00.000Z', motivo: 'm', por: 'luis@prueba.test (CRM-ISEIE)', sustituidaPor: null, matriculaId: 106 } }),
    ];
    expect(await completarReversiones()).toEqual({ apuntadas: 1 });
    expect(registro.map((x) => x.nexpediente)).toEqual([EXP_ANULADO]);
  });

  it('cargar «Diplomas» (un GET) ya no escribe en el registro ni pregunta por los anulados', async () => {
    const r = await request.get('/api/certifex/diplomas/por-avisar').set('Authorization', `Bearer ${ADMIN}`);
    expect(r.status).toBe(200);
    expect(registro).toHaveLength(0);
    expect(pedidas.some((p) => p.ruta === '/diplomas' && p.query.estado === 'anulados')).toBe(false);
  });

  it('con un Certifex que aún no revierte, o sin la tabla del CRM, no hace nada', async () => {
    conRuta = false;
    expect(await completarReversiones()).toMatchObject({ apuntadas: 0 });
    expect(pedidas.some((p) => p.ruta === '/diplomas')).toBe(false);
    conRuta = true;
    olvidarCapacidades();
    tablaExiste = false;
    expect(await completarReversiones()).toMatchObject({ apuntadas: 0 });
    expect(registro).toHaveLength(0);
  });

  it('si falla, lo dice (la tarea anota el fallo) y la vuelta siguiente lo apunta', async () => {
    fallaApunte = true;
    await expect(completarReversiones()).rejects.toThrow(/no contesta/);
    expect(registro).toHaveLength(0);
    fallaApunte = false;
    expect(await completarReversiones()).toEqual({ apuntadas: 1 });
    expect(registro.map((x) => x.nexpediente)).toEqual([EXP_ANULADO]);
  });
});

describe('Emisiones trae lo que se imprimiría (punto 3, prevención)', () => {
  it('cada fila sin título trae `programaCrm` y `edicion`, como Diplomas; con título, no se calcula', async () => {
    CANDIDATOS = [candidato(101, null), candidato(102, EXP_ENVIADO)];
    const r = await request.get('/api/certifex/emisiones?estado=aprobada&centro=PSIKO&conPrograma=1').set('Authorization', `Bearer ${ADMIN}`);
    expect(r.status).toBe(200);
    const [sin, con] = [r.body.data.filas.find((c) => c.matriculaId === 101), r.body.data.filas.find((c) => c.matriculaId === 102)];
    // Sin venta en el CRM de mentira: sin programa, con su motivo (es lo que se avisa).
    expect(sin.programaCrm).toMatchObject({ programa: null });
    expect(sin.edicion).toBeNull();
    expect(con.programaCrm).toBeNull();
    // A Certifex no le llega el parámetro: es del CRM.
    expect(pedidas.filter((p) => p.ruta === '/candidatos').every((p) => !('conPrograma' in p.query))).toBe(true);
  });

  it('a quien solo ve Emisiones (no emite) no se le calcula: es para el aviso de antes de emitir', async () => {
    CANDIDATOS = [candidato(101, null)];
    const r = await request.get('/api/certifex/emisiones?estado=aprobada&centro=PSIKO&conPrograma=1').set('Authorization', `Bearer ${SOLO_VE}`);
    expect(r.status).toBe(200);
    expect(r.body.data.filas[0]).not.toHaveProperty('programaCrm');
  });

  it('una matrícula revertida trae su reversión (el número anulado, quién y por qué); las demás, null', async () => {
    expect((await revertir(ADMIN)).status).toBe(200);
    CANDIDATOS = [candidato(101, null), candidato(102, null)];
    const r = await request.get('/api/certifex/emisiones?estado=aprobada&centro=PSIKO&conPrograma=1').set('Authorization', `Bearer ${ADMIN}`);
    expect(r.status).toBe(200);
    const [a, b] = r.body.data.filas;
    expect(a.revertido).toEqual({ nexpediente: EXP, motivo: MOTIVO, por: 'u71@prueba.test', en: '2026-11-13T09:30:00.000Z' });
    expect(b.revertido).toBeNull();
  });

  it('sin `conPrograma`, el listado es el de siempre (sin esos campos)', async () => {
    CANDIDATOS = [candidato(101, null)];
    const r = await request.get('/api/certifex/emisiones?estado=aprobada&centro=PSIKO').set('Authorization', `Bearer ${ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.data.filas[0]).not.toHaveProperty('programaCrm');
    expect(r.body.data.filas[0]).not.toHaveProperty('edicion');
  });
});

describe('«Editar» una matrícula sin solicitud (desde Emisiones)', () => {
  const sinPedir = () => ({ ...candidato(110, null), solicitud: null });
  // Certifex: entre las solicitudes no está; entre las de su campus, sí (o lo que diga `entre`).
  const conCertifex = async (entre, fn) => {
    const fetchAntes = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, opts) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith('/candidatos')) {
        const q = Object.fromEntries(u.searchParams);
        pedidas.push({ ruta: '/candidatos', query: q });
        const r = q.solicitadas === '1' ? { filas: [], total: 0 } : entre(q);
        return new Response(JSON.stringify(r), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return fetchAntes(url, opts);
    });
    try { return await fn(); } finally { globalThis.fetch = fetchAntes; }
  };
  const editar = (cuerpo) => request.post('/api/certifex/diplomas/editar').set('Authorization', `Bearer ${ADMIN}`)
    .send({ matriculaId: 110, programa: { horas: 100, modulos: [{ titulo: 'Bases', horas: 100 }] }, ...cuerpo });
  const busquedas = () => pedidas.filter((p) => p.ruta === '/candidatos').map((p) => p.query);

  it('con su campus y su correo, la encuentra entre las de ese campus (no entre todas) y guarda', async () => {
    await conCertifex((q) => ({ filas: q.centro === 'PSIKO' ? [sinPedir()] : [], total: 1 }), async () => {
      const r = await editar({ centro: 'PSIKO', q: 'marta@prueba.test' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    });
    const [primera, segunda] = busquedas();
    expect(primera).toMatchObject({ solicitadas: '1' });
    expect(segunda).toMatchObject({ estado: 'todas', centro: 'PSIKO', q: 'marta@prueba.test' });
    expect(segunda).not.toHaveProperty('solicitadas');
  });

  it('sin solicitud, solo la formación y su programa: nombre, DNI o correo dan 400 y no se manda nada a Certifex', async () => {
    for (const extra of [{ dni: '12345678Z' }, { emailCrm: 'otra@prueba.test' }, { nombre: 'Marta López Gil' }]) {
      pedidas = [];
      await conCertifex((q) => ({ filas: q.centro === 'PSIKO' ? [sinPedir()] : [], total: 1 }), async () => {
        const r = await editar({ centro: 'PSIKO', q: 'marta@prueba.test', ...extra });
        expect(r.status, JSON.stringify(extra)).toBe(400);
        expect(r.body.error).toMatch(/solo se elige la formación vendida y su programa/);
      });
      expect(pedidas.some((p) => p.ruta.startsWith('/solicitudes/'))).toBe(false);
    }
  });

  it('si por el correo no sale, la busca en su campus sin él', async () => {
    await conCertifex((q) => ({ filas: q.q ? [] : [sinPedir()], total: 1 }), async () => {
      expect((await editar({ centro: 'PSIKO', q: 'otro@correo.test' })).status).toBe(200);
    });
    expect(busquedas().slice(1).map((q) => q.q ?? null)).toEqual(['otro@correo.test', null]);
  });

  it('sin campus, no se busca fuera de las solicitudes: 404, con una sola búsqueda', async () => {
    await conCertifex(() => ({ filas: [sinPedir()], total: 1 }), async () => {
      expect((await editar({})).status).toBe(404);
    });
    expect(busquedas()).toHaveLength(1);
  });

  it('si Certifex corta la lista antes de encontrarla, 503 «no se pudo comprobar», no un falso «no existe»', async () => {
    // Páginas llenas y un total enorme: `recorrer` llega a su tope sin encontrarla.
    const llena = Array.from({ length: 200 }, (_, i) => ({ ...candidato(50_000 + i, null), solicitud: null }));
    await conCertifex(() => ({ filas: llena, total: 1_000_000 }), async () => {
      const r = await editar({ centro: 'PSIKO' });
      expect(r.status).toBe(503);
      expect(r.body.code).toBe('CERTIFEX_LISTA_CORTADA');
    });
  });

  it('fuera de sus campus, aunque el cuerpo diga uno suyo: 404 (el alcance es el de la matrícula)', async () => {
    await conCertifex(() => ({ filas: [{ ...sinPedir(), centro: 'ISEIE' }], total: 1 }), async () => {
      expect((await editar({ centro: 'PSIKO' })).status).toBe(404);
    });
  });
});

describe('Revertidos: las fechas son las de la reversión', () => {
  it('desde/hasta filtra por cuándo se revirtió, no por cuándo se emitió', async () => {
    DIPLOMAS = [
      diploma('PSIKO-2026-000201-AAAA', { emitidoEn: '2026-10-01T10:00:00.000Z', anulada: true, anulacion: { en: '2026-11-10T10:00:00.000Z', motivo: 'm', por: 'x', sustituidaPor: null, matriculaId: null } }),
      diploma('PSIKO-2026-000202-BBBB', { emitidoEn: '2026-11-10T10:00:00.000Z', anulada: true, anulacion: { en: '2026-10-01T10:00:00.000Z', motivo: 'm', por: 'x', sustituidaPor: null, matriculaId: null } }),
    ];
    const r = await request.get('/api/certifex/diplomas?estado=anulados&desde=2026-11-01&hasta=2026-11-30').set('Authorization', `Bearer ${ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.data.filas.map((d) => d.nexpediente)).toEqual(['PSIKO-2026-000201-AAAA']);
  });
});

describe('«por avisar»: lo revertido, en «Aprobados sin diploma»', () => {
  it('cada fila trae la última reversión de su matrícula', async () => {
    // Tras revertir, Certifex ya no da número a esa matrícula: sale entre «sin emitir».
    expect((await revertir(ADMIN)).status).toBe(200);
    CANDIDATOS = [{ ...candidato(101, null) }];
    DIPLOMAS = DIPLOMAS.map((d) => (d.nexpediente === EXP ? { ...d, anulada: true } : d));
    const r = await request.get('/api/certifex/diplomas/por-avisar').set('Authorization', `Bearer ${ADMIN}`);
    expect(r.status).toBe(200);
    const fila = r.body.data.sinEmitir.find((c) => c.matriculaId === 101);
    expect(fila.revertido).toEqual({ nexpediente: EXP, motivo: MOTIVO, por: 'u71@prueba.test', en: '2026-11-13T09:30:00.000Z' });
    expect(r.body.data.porAvisar.map((c) => c.nexpediente)).not.toContain(EXP);
  });
});

describe('lo que encontró la 6.ª auditoría', () => {
  const anulado = (n, extra = {}) => diploma(`PSIKO-2026-${String(300000 + n).padStart(6, '0')}-ZZZZ`, {
    anulada: true, anulacion: { en: '2026-11-05T10:00:00.000Z', motivo: 'm', por: 'pepe@prueba.test (CRM 360)', sustituidaPor: null, matriculaId: 5000 + n }, ...extra,
  });

  it('si otro lo revirtió justo a la vez, Certifex dice «anulada» (code): 409 «ya revertido» y se apunta lo de Certifex', async () => {
    alRevertir = () => {
      DIPLOMAS = DIPLOMAS.map((d) => (d.nexpediente === EXP
        ? { ...d, anulada: true, anulacion: { en: '2026-11-13T09:00:00.000Z', motivo: 'lo hizo otro', por: 'otra@prueba.test (CRM 360)', sustituidaPor: null, matriculaId: 101 } }
        : d));
      return { status: 409, body: { error: 'Ya está revertido: ese número está anulado.', code: 'anulada' } };
    };
    const r = await revertir(ADMIN);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('YA_REVERTIDO');
    expect(registro).toEqual([expect.objectContaining({ nexpediente: EXP, matricula_id: 101, motivo: 'lo hizo otro', revertido_por_email: 'otra@prueba.test' })]);
  });

  it('otro 409 de Certifex (sin code «anulada»): su error tal cual, sin apuntar nada', async () => {
    alRevertir = () => ({ status: 409, body: { error: 'Ahora mismo se está enviando el aviso de este diploma: no se ha revertido.', code: 'ocupada' } });
    const r = await revertir(ADMIN);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/enviando el aviso/);
    expect(registro).toHaveLength(0);
  });

  it('el repaso de reversiones recorre todas las páginas de Certifex, no solo la primera', async () => {
    DIPLOMAS = Array.from({ length: 230 }, (_, i) => anulado(i));
    expect(await completarReversiones()).toEqual({ apuntadas: 230 });
    expect(registro.some((x) => x.nexpediente === anulado(229).nexpediente)).toBe(true);
    expect(pedidas.filter((p) => p.ruta === '/diplomas' && p.query.estado === 'anulados').map((p) => p.query.pagina)).toEqual(['1', '2']);
  });

  it('Revertidos con «desde»: no deja de pedir por fecha (Certifex ordena por la emisión, no por la reversión)', async () => {
    // 200 revertidos hace tiempo, en orden, y en la 2.ª página uno revertido hoy (emitido hace meses).
    DIPLOMAS = [
      ...Array.from({ length: 200 }, (_, i) => anulado(i, {
        emitidoEn: new Date(Date.UTC(2026, 9, 30) - i * 3_600_000).toISOString(),
        anulacion: { en: new Date(Date.UTC(2026, 9, 30) - i * 3_600_000).toISOString(), motivo: 'm', por: 'x', sustituidaPor: null, matriculaId: null },
      })),
      anulado(999, { emitidoEn: '2026-06-01T10:00:00.000Z', anulacion: { en: '2026-11-10T10:00:00.000Z', motivo: 'm', por: 'x', sustituidaPor: null, matriculaId: null } }),
    ];
    const r = await request.get('/api/certifex/diplomas?estado=anulados&desde=2026-11-01').set('Authorization', `Bearer ${ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.data.filas.map((d) => d.nexpediente)).toEqual([anulado(999).nexpediente]);
  });

  it('en Enviados (vigentes) la parada por fecha sigue: con «desde», no pide la página que ya es toda anterior', async () => {
    DIPLOMAS = Array.from({ length: 401 }, (_, i) => diploma(`PSIKO-2026-${String(400000 + i).padStart(6, '0')}-YYYY`, {
      emitidoEn: new Date(Date.UTC(2026, 9, 30) - i * 3_600_000).toISOString(),
    }));
    const r = await request.get('/api/certifex/diplomas?estado=vigentes&desde=2026-11-01').set('Authorization', `Bearer ${ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.data.filas).toEqual([]);
    expect(pedidas.filter((p) => p.ruta === '/diplomas' && p.query.estado === 'vigentes').map((p) => p.query.pagina)).toEqual(['1']);
  });
});

describe('con un Certifex que aún no revierte (9.ª auditoría)', () => {
  it('«Revertidos» no pregunta a Certifex (que daría error): lista vacía con `sinRevertir`', async () => {
    conRuta = false;
    const r = await request.get('/api/certifex/diplomas?estado=anulados').set('Authorization', `Bearer ${ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ filas: [], total: 0, sinRevertir: true });
    expect(pedidas.some((p) => p.ruta === '/diplomas')).toBe(false);
  });

  it('con un Certifex que sí revierte, «Revertidos» sale como siempre (sin `sinRevertir`)', async () => {
    const r = await request.get('/api/certifex/diplomas?estado=anulados').set('Authorization', `Bearer ${ADMIN}`);
    expect(r.status).toBe(200);
    expect(r.body.data.sinRevertir).toBeUndefined();
    expect(r.body.data.filas.map((d) => d.nexpediente)).toEqual([EXP_ANULADO]);
  });

  it('un «no» se recuerda solo 30 s: desplegado Certifex, el botón se activa enseguida; un «sí», 5 min', async () => {
    const ahora = Date.now();
    const reloj = vi.spyOn(Date, 'now');
    try {
      reloj.mockReturnValue(ahora);
      conRuta = false;
      const disp = () => request.get('/api/certifex/diplomas/revertir').set('Authorization', `Bearer ${ADMIN}`);
      expect((await disp()).body.data.disponible).toBe(false);
      conRuta = true; // se despliega Certifex
      reloj.mockReturnValue(ahora + 20_000);
      expect((await disp()).body.data.disponible).toBe(false); // aún lo recordado
      reloj.mockReturnValue(ahora + 31_000);
      expect((await disp()).body.data.disponible).toBe(true);
      // El «sí» dura 5 minutos: sin volver a preguntar.
      const antes = pedidas.filter((p) => p.ruta === '/yo').length;
      reloj.mockReturnValue(ahora + 31_000 + 4 * 60_000);
      expect((await disp()).body.data.disponible).toBe(true);
      expect(pedidas.filter((p) => p.ruta === '/yo').length).toBe(antes);
    } finally {
      reloj.mockRestore();
    }
  });
});

describe('«¿Se puede revertir?» con varias peticiones a la vez (10.ª auditoría)', () => {
  it('una sola pregunta a /yo, aunque lleguen varias con el dato caducado', async () => {
    const { certifexPuede } = await import('../src/modules/certifex/certifex.cliente.js');
    pedidas = [];
    const r = await Promise.all([certifexPuede('revertir'), certifexPuede('revertir'), certifexPuede('revertir')]);
    expect(r).toEqual([true, true, true]);
    expect(pedidas.filter((p) => p.ruta === '/yo')).toHaveLength(1);
  });

  it('si esa pregunta falla, las que esperaban fallan con ella y la siguiente vuelve a preguntar', async () => {
    const { certifexPuede } = await import('../src/modules/certifex/certifex.cliente.js');
    yoFalla = true;
    const r = await Promise.allSettled([certifexPuede('revertir'), certifexPuede('revertir')]);
    expect(r.map((x) => x.status)).toEqual(['rejected', 'rejected']);
    expect(pedidas.filter((p) => p.ruta === '/yo')).toHaveLength(1);
    yoFalla = false;
    expect(await certifexPuede('revertir')).toBe(true);
    expect(pedidas.filter((p) => p.ruta === '/yo')).toHaveLength(2);
  });
});

describe('«¿Se puede revertir?» si se olvida lo sabido a mitad de pregunta (11.ª auditoría)', () => {
  it('no se rompe: contesta con lo que dijo Certifex en esa pregunta', async () => {
    const { certifexPuede } = await import('../src/modules/certifex/certifex.cliente.js');
    const pendiente = certifexPuede('revertir');
    olvidarCapacidades(); // a mitad de la pregunta a /yo
    await expect(pendiente).resolves.toBe(true);
  });
});

describe('lo emitido desde Emisiones, al revertirlo, vuelve a «Aprobados sin diploma» (12.ª auditoría, punto 3)', () => {
  const porAvisar = () => request.get('/api/certifex/diplomas/por-avisar').set('Authorization', `Bearer ${ADMIN}`);
  const sinPedir = (id) => ({ ...candidato(id, null), solicitud: null });
  const anuladoDe = (n, matriculaId, extra = {}) => diploma(`PSIKO-2026-${String(700000 + n).padStart(6, '0')}-RVRT`, {
    anulada: true, anulacion: { en: '2026-11-14T10:00:00.000Z', motivo: 'm', por: 'u71@prueba.test (CRM 360)', sustituidaPor: null, vigente: null, matriculaId }, ...extra,
  });
  const apuntada = (nexpediente, matriculaId) => registro.push({ id: registro.length + 1, nexpediente, matricula_id: matriculaId, centro: 'PSIKO', alumno: 'x', titulacion: 'x', motivo: 'Con lo de Moodle', revertido_por: 71, revertido_por_email: 'u71@prueba.test', revertido_en: '2026-11-14T10:00:00.000Z' });

  it('sale en «Aprobados sin diploma», con su reversión, aunque el alumno no lo pidiera', async () => {
    const a = anuladoDe(1, 120);
    DIPLOMAS = [...DIPLOMAS, a];
    CANDIDATOS = [...CANDIDATOS, sinPedir(120)];
    apuntada(a.nexpediente, 120);
    const r = await porAvisar();
    expect(r.status).toBe(200);
    const fila = r.body.data.sinEmitir.find((c) => c.matriculaId === 120);
    expect(fila).toBeTruthy();
    expect(fila.solicitud).toBeNull();
    expect(fila.revertido).toMatchObject({ nexpediente: a.nexpediente, motivo: 'Con lo de Moodle' });
    // Buscada solo en su curso, no en todo el campus.
    expect(pedidas.some((p) => p.ruta === '/candidatos' && p.query.curso === '34' && p.query.solicitadas === undefined)).toBe(true);
  });

  it('deja de pedir páginas en cuanto la encuentra (no recorre todo el curso)', async () => {
    const a = anuladoDe(3, 130);
    DIPLOMAS = [...DIPLOMAS, a];
    CANDIDATOS = [...CANDIDATOS, sinPedir(130), ...Array.from({ length: 250 }, (_, i) => sinPedir(5000 + i))];
    apuntada(a.nexpediente, 130);
    const r = await porAvisar();
    expect(r.body.data.sinEmitir.map((c) => c.matriculaId)).toContain(130);
    expect(pedidas.filter((p) => p.ruta === '/candidatos' && p.query.curso === '34').map((p) => p.query.pagina)).toEqual(['1']);
  });

  it('si ya se reemitió (tiene un número que vale), no', async () => {
    const a = anuladoDe(2, 121, { anulacion: { en: '2026-11-14T10:00:00.000Z', motivo: 'm', por: 'u71@prueba.test (CRM 360)', sustituidaPor: 'PSIKO-2026-000999-NUEV', vigente: 'PSIKO-2026-000999-NUEV', matriculaId: 121 } });
    DIPLOMAS = [...DIPLOMAS, a];
    CANDIDATOS = [...CANDIDATOS, sinPedir(121)];
    apuntada(a.nexpediente, 121);
    const r = await porAvisar();
    expect(r.body.data.sinEmitir.map((c) => c.matriculaId)).not.toContain(121);
  });

  it('una vez reemitida, esa reversión ya no hace preguntar a Certifex en cada carga (13.ª auditoría, punto 4)', async () => {
    const a = anuladoDe(4, 131, { anulacion: { en: '2026-11-14T10:00:00.000Z', motivo: 'm', por: 'u71@prueba.test (CRM 360)', sustituidaPor: 'PSIKO-2026-000998-REEM', vigente: 'PSIKO-2026-000998-REEM', matriculaId: 131 } });
    DIPLOMAS = [...DIPLOMAS, a];
    apuntada(a.nexpediente, 131);
    await porAvisar();
    expect(pedidas.filter((p) => p.ruta === '/diplomas' && p.query.estado === 'anulados')).toHaveLength(1);
    pedidas = [];
    await porAvisar();
    await porAvisar();
    expect(pedidas.some((p) => p.ruta === '/diplomas' && p.query.estado === 'anulados')).toBe(false);
  });

  it('…y reemitida y después revocada (curso cerrado), tampoco: no vuelve a «Aprobados sin diploma»', async () => {
    const a = anuladoDe(5, 132, { anulacion: { en: '2026-11-14T10:00:00.000Z', motivo: 'm', por: 'u71@prueba.test (CRM 360)', sustituidaPor: 'PSIKO-2026-000997-REVO', vigente: null, cursoCerrado: true, matriculaId: 132 } });
    DIPLOMAS = [...DIPLOMAS, a];
    CANDIDATOS = [...CANDIDATOS, { ...candidato(132, null), solicitud: null }];
    apuntada(a.nexpediente, 132);
    const r = await porAvisar();
    expect(r.body.data.sinEmitir.map((c) => c.matriculaId)).not.toContain(132);
    pedidas = [];
    await porAvisar();
    expect(pedidas.some((p) => p.ruta === '/diplomas' && p.query.estado === 'anulados')).toBe(false);
  });

  it('…y SIN reemitir pero con el curso cerrado (se revocó otro diploma de ese curso), tampoco (15.ª auditoría)', async () => {
    const a = anuladoDe(6, 133, { anulacion: { en: '2026-11-14T10:00:00.000Z', motivo: 'm', por: 'u71@prueba.test (CRM 360)', sustituidaPor: null, vigente: null, cursoCerrado: true, matriculaId: 133 } });
    DIPLOMAS = [...DIPLOMAS, a];
    CANDIDATOS = [...CANDIDATOS, sinPedir(133)];
    apuntada(a.nexpediente, 133);
    const r = await porAvisar();
    expect(r.body.data.sinEmitir.map((c) => c.matriculaId)).not.toContain(133);
    pedidas = [];
    await porAvisar();
    expect(pedidas.some((p) => p.ruta === '/diplomas' && p.query.estado === 'anulados')).toBe(false);
  });

  it('sin ninguna reversión apuntada de esos campus, ni se pregunta a Certifex por los anulados', async () => {
    CANDIDATOS = [...CANDIDATOS, sinPedir(122)];
    const r = await porAvisar();
    expect(r.body.data.sinEmitir.map((c) => c.matriculaId)).not.toContain(122);
    expect(pedidas.some((p) => p.ruta === '/diplomas' && p.query.estado === 'anulados')).toBe(false);
  });
});

describe('al revertir, el diploma se pide una vez y nunca se apunta un campus «UNDEFINED» (12.ª auditoría, punto 5)', () => {
  it('una sola consulta del diploma a Certifex por reversión (el alcance usa ese mismo dato)', async () => {
    expect((await revertir(ADMIN)).status).toBe(200);
    expect(pedidas.filter((p) => p.ruta === '/diplomas' && p.query.q === EXP)).toHaveLength(1);
  });

  it('sigue dando 404 a un admin de otro campus, sin revertir nada', async () => {
    expect((await revertir(ADMIN_ISEIE)).status).toBe(404);
    expect(llegoARevertir()).toHaveLength(0);
  });

  it('si Certifex no dice el campus del diploma: no se revierte nada (502), y no se apunta', async () => {
    DIPLOMAS = DIPLOMAS.map((d) => (d.nexpediente === EXP ? { ...d, centro: null } : d));
    const r = await revertir(SUPER);
    expect(r.status).toBe(502);
    expect(llegoARevertir()).toHaveLength(0);
    expect(registro).toHaveLength(0);
  });

  it('el repaso se salta un revertido sin campus y apunta los demás', async () => {
    DIPLOMAS = [...DIPLOMAS, diploma('PSIKO-2026-000107-GGGG', { centro: '', anulada: true, anulacion: { en: '2026-11-06T10:00:00.000Z', motivo: 'm', por: 'x@prueba.test (CRM 360)', sustituidaPor: null, matriculaId: 107 } })];
    expect(await completarReversiones()).toEqual({ apuntadas: 1 });
    expect(registro.map((x) => x.nexpediente)).toEqual([EXP_ANULADO]);
    expect(registro.some((x) => x.centro === 'UNDEFINED' || !x.centro)).toBe(false);
  });
});


describe('lo que emitió o revirtió OTRO CRM del campus (13.ª auditoría, punto 2)', () => {
  it('Certifex dice `deEsteCrm: false`: 409 «lo emitió otro CRM», sin llamar a /revertir', async () => {
    DIPLOMAS = DIPLOMAS.map((d) => (d.nexpediente === EXP ? { ...d, emitidaPor: 'luis@prueba.test (CRM-ISEIE)', deEsteCrm: false } : d));
    const r = await revertir(ADMIN);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('OTRO_CRM');
    expect(llegoARevertir()).toHaveLength(0);
  });

  it('Certifex dice `deEsteCrm: true` aunque la firma sea antigua: se revierte', async () => {
    DIPLOMAS = DIPLOMAS.map((d) => (d.nexpediente === EXP ? { ...d, emitidaPor: 'diego@prueba.test (CRM CRM 360)', deEsteCrm: true } : d));
    expect((await revertir(ADMIN)).status).toBe(200);
  });

  it('en el listado, lo de otro CRM se puede ENVIAR (sigue «emitido en el CRM») pero no revertir aquí (14.ª auditoría)', async () => {
    DIPLOMAS = DIPLOMAS.map((d) => (d.nexpediente === EXP ? { ...d, deEsteCrm: false } : d));
    const r = await request.get('/api/certifex/diplomas?estado=vigentes').set('Authorization', `Bearer ${ADMIN}`);
    expect(r.body.data.filas.find((d) => d.nexpediente === EXP)).toMatchObject({ emitidoEnCrm: true, revertibleAqui: false });
    // Y sigue contando en «Pendiente de aviso» (lo que hay que enviar).
    const p = await request.get('/api/certifex/diplomas?estado=vigentes&aviso=pendiente').set('Authorization', `Bearer ${ADMIN}`);
    expect(p.body.data.filas.map((d) => d.nexpediente)).toContain(EXP);
  });

  it('lo emitido por este CRM: se envía y se revierte', async () => {
    DIPLOMAS = DIPLOMAS.map((d) => (d.nexpediente === EXP ? { ...d, deEsteCrm: true } : d));
    const r = await request.get('/api/certifex/diplomas?estado=vigentes').set('Authorization', `Bearer ${ADMIN}`);
    expect(r.body.data.filas.find((d) => d.nexpediente === EXP)).toMatchObject({ emitidoEnCrm: true, revertibleAqui: true });
  });

  it('el repaso usa `porEsteCrm` de Certifex cuando viene: lo de otro no, lo suyo aunque la firma sea antigua', async () => {
    DIPLOMAS = [
      ...DIPLOMAS.filter((d) => d.nexpediente !== EXP_ANULADO),
      diploma('PSIKO-2026-000108-HHHH', { anulada: true, anulacion: { en: '2026-11-06T10:00:00.000Z', motivo: 'm', por: 'x@prueba.test (CRM 360)', porEsteCrm: false, sustituidaPor: null, matriculaId: 108 } }),
      diploma('PSIKO-2026-000109-IIII', { anulada: true, anulacion: { en: '2026-11-06T10:00:00.000Z', motivo: 'm', por: 'y@prueba.test (CRM CRM 360)', porEsteCrm: true, sustituidaPor: null, matriculaId: 109 } }),
    ];
    expect(await completarReversiones()).toEqual({ apuntadas: 1 });
    expect(registro.map((x) => x.nexpediente)).toEqual(['PSIKO-2026-000109-IIII']);
  });
});

describe('el alcance de «Revertir» es el de revocar y corregir (`exigirExpedientes`), con una sola consulta (13.ª auditoría, punto 6)', () => {
  it('un superadmin (sin alcance que mirar): también una sola consulta del diploma', async () => {
    expect((await revertir(SUPER)).status).toBe(200);
    expect(pedidas.filter((p) => p.ruta === '/diplomas' && p.query.q === EXP)).toHaveLength(1);
  });

  it('un admin de otro campus recibe 404 aunque el diploma viniera sin campus (el alcance va antes que el 502)', async () => {
    DIPLOMAS = DIPLOMAS.map((d) => (d.nexpediente === EXP ? { ...d, centro: null } : d));
    expect((await revertir(ADMIN_ISEIE)).status).toBe(404);
    expect(llegoARevertir()).toHaveLength(0);
  });
});
