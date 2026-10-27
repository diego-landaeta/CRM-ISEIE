// #223 (gemela de MultiCRM #384) · Ver Diplomas (Certifex) sin ser admin, contra la base de verdad.
//
// Diego: «Adriana, Daniela, Yosbely, Dayana, Mireia y Ana deben de tener para ver
// los de Certifex». Se les da `diplomas.view` (por persona o por rol, desde
// Configuración › Roles) y ven la pantalla Diplomas en solo lectura, SOLO con sus
// campus. Aprobar, emitir, enviar, rechazar, corregir y revocar siguen siendo de
// administración.
//
// Certifex no se toca: `fetch` se sustituye por uno que contesta como su API, con
// tres campus de este CRM. La gestora tiene uno.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

process.env.CERTIFEX_WEBHOOK_SECRETO = 'secreto-de-prueba-solo-lectura';
process.env.CERTIFEX_API_URL = 'https://certifex-lectura.test';
process.env.CERTIFEX_CRM_CLAVE = 'cfx_crm_clave-de-prueba-solo-lectura';

const { default: supertest } = await import('supertest');
const { default: jwt } = await import('jsonwebtoken');
const { default: app } = await import('../src/app.js');
const { default: pool } = await import('../src/shared/config/db.js');

const request = supertest(app);
const sufijo = `${Date.now()}`.slice(-7);
const base = 870000000 + Math.floor(Math.random() * 1000000);
// Códigos que no casan con ningún otro proyecto (ni con los de otras pruebas), y
// ninguno empieza por otro: un campus casa con los proyectos cuyo nombre EMPIEZA por
// su código, y si casa con dos, no lo ve nadie más que el super admin.
const [MIO, OTRO_MIO, AJENO] = ['QLXUNO', 'QLXDOS', 'QLXTRES'];
const NEXP_MIO = 'CTF-2026-000870-AAAA';
const NEXP_AJENO = 'CTF-2026-000871-AAAA';

const fila = (id, centro) => ({
  matriculaId: id, centro, titular: { nombre: `Alumno ${id}`, email: null, dni: '12345678Z' },
  curso: { ref: 1, nombre: 'Curso' }, notaFinal: 8, umbral: 5, completado: true, actividades: { total: 1, calificadas: 1 },
  propuesto: true, nexpediente: null, solicitud: { en: '2026-10-20T10:00:00Z', nombre: `Alumno ${id}` }, decision: null,
});
const diploma = (nexpediente, centro) => ({
  nexpediente, centro, alumno: 'Alumno', titulacion: 'Máster', cursoRef: 1, emitidoEn: '2026-10-20T10:00:00Z',
  emitidaPor: 'x', revocada: false, revocacion: null, verificarUrl: null, diplomaUrl: null, aviso: null,
});
let pedidas = [];
function certifex(p) {
  if (p.ruta === '/yo') return { status: 200, body: { nombre: 'CRM local', centros: [MIO, OTRO_MIO, AJENO] } };
  if (p.ruta === '/centros') return { status: 200, body: [MIO, OTRO_MIO, AJENO].map((codigo) => ({ codigo, nombre: codigo })) };
  if (p.ruta === '/candidatos') {
    const filas = [fila(base + 1, MIO), fila(base + 2, OTRO_MIO), fila(base + 3, AJENO)]
      .filter((c) => !p.query.centro || c.centro === p.query.centro);
    return { status: 200, body: { filas, total: filas.length, pagina: 1, tam: 200 } };
  }
  if (p.ruta === '/diplomas') {
    const filas = [diploma(NEXP_MIO, MIO), diploma(NEXP_AJENO, AJENO)]
      .filter((d) => (!p.query.q || d.nexpediente.includes(p.query.q)) && (!p.query.centro || d.centro === p.query.centro));
    return { status: 200, body: { filas, total: filas.length, pagina: 1, tam: 200 } };
  }
  return { status: 200, body: { resultados: [], ok: true } };
}

const fetchReal = globalThis.fetch;
const proyectos = [];
const gente = {};
let saToken;
const como = (quien) => (req) => req.set('Authorization', `Bearer ${quien === 'sa' ? saToken : gente[quien].token}`);

async function persona(clave, role, campus) {
  const { rows: [u] } = await pool.query(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, email`,
    [`Lectura ${clave}`, `lectura.${clave}.${sufijo}@prueba.test`, role]);
  for (const pid of campus) await pool.query('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, pid]);
  gente[clave] = { ...u, token: jwt.sign({ userId: u.id, email: u.email, role, roles_extra: [] }, process.env.JWT_SECRET, { expiresIn: '5m' }) };
}

beforeAll(async () => {
  // La base local de ISEIE sale sin datos de ejemplo: el super admin lo pone la prueba.
  await persona('sa', 'superadmin', []);
  saToken = gente.sa.token;
  for (const codigo of [MIO, OTRO_MIO, AJENO]) {
    proyectos.push((await pool.query(
      `INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, 'whk_test') RETURNING id`,
      [`${codigo} campus`, `${codigo.toLowerCase()}-${sufijo}`])).rows[0].id);
  }
  // La gestora a la que se le da el permiso, otra del mismo campus sin él, un project
  // manager (para probarlo por rol sin tocar a todas las gestoras) y un admin de otro campus.
  await persona('conPermiso', 'gestor', [proyectos[0]]);
  await persona('sinPermiso', 'gestor', [proyectos[0]]);
  await persona('pm', 'project_manager', [proyectos[0]]);
  await persona('adminAjeno', 'admin', [proyectos[2]]);
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    if (!String(url).startsWith('https://certifex-lectura.test/')) return fetchReal(url, opts);
    const u = new URL(String(url));
    const p = { ruta: u.pathname.replace('/api/crm/v1', ''), query: Object.fromEntries(u.searchParams), metodo: opts.method };
    pedidas.push(p);
    const r = certifex(p);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  });
});
afterAll(async () => {
  globalThis.fetch = fetchReal;
  const ids = Object.values(gente).map((g) => g.id);
  await pool.query(`DELETE FROM role_permission_overrides WHERE role = 'project_manager' AND resource = 'diplomas'`);
  await pool.query('DELETE FROM user_permission_overrides WHERE user_id = ANY($1::int[])', [ids]);
  await pool.query('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids]);
  await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [ids]);
  await pool.query('DELETE FROM projects WHERE id = ANY($1::int[])', [proyectos]);
  await pool.end();
});
beforeEach(() => { pedidas = []; });

const LECTURAS = ['/diplomas/resumen', '/diplomas/solicitudes', '/diplomas/por-avisar', '/diplomas/terminados', '/diplomas',
  '/emisiones/estado', '/emisiones/centros'];

describe('por persona, desde Configuración › Roles', () => {
  it('sin el permiso, una gestora no ve Diplomas (403) y nada llega a Certifex', async () => {
    for (const ruta of LECTURAS) {
      expect((await como('conPermiso')(request.get(`/api/certifex${ruta}`))).status, ruta).toBe(403);
    }
    expect(pedidas).toHaveLength(0);
  });

  it('el super admin se lo da a UNA persona, sin tocar a las demás', async () => {
    const r = await como('sa')(request.put(`/api/permissions/claves/diplomas.view/personas/${gente.conPermiso.id}`)).send({ permitido: true });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data).toMatchObject({ excepcion: true, puede: true });

    const lista = await como('sa')(request.get('/api/permissions/claves/diplomas.view/personas?roleKey=gestor'));
    expect(lista.status).toBe(200);
    const deAqui = lista.body.data.filter((p) => [gente.conPermiso.id, gente.sinPermiso.id].includes(p.id));
    expect(deAqui).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: gente.conPermiso.id, excepcion: true, puede: true }),
      expect.objectContaining({ id: gente.sinPermiso.id, excepcion: null, puede: false }),
    ]));

    const me = await como('conPermiso')(request.get('/api/auth/me'));
    expect(me.body.data.permissions['diplomas.view']).toBe(true);
  });

  it('con el permiso, ve las lecturas, solo con SU campus', async () => {
    for (const ruta of LECTURAS) {
      expect((await como('conPermiso')(request.get(`/api/certifex${ruta}`))).status, ruta).toBe(200);
    }
    const s = await como('conPermiso')(request.get('/api/certifex/diplomas/solicitudes'));
    expect(s.body.data.filas.map((c) => c.matriculaId)).toEqual([base + 1]);
    const ajeno = await como('conPermiso')(request.get(`/api/certifex/diplomas/solicitudes?centro=${AJENO}`));
    expect(ajeno.body.data).toMatchObject({ filas: [], total: 0 });
    const d = await como('conPermiso')(request.get('/api/certifex/diplomas'));
    expect(d.body.data.filas.map((x) => x.nexpediente)).toEqual([NEXP_MIO]);
    const c = await como('conPermiso')(request.get('/api/certifex/emisiones/centros'));
    expect(c.body.data.map((x) => x.codigo)).toEqual([MIO]);
    const e = await como('conPermiso')(request.get('/api/certifex/emisiones/estado'));
    expect(e.body.data.centros).toEqual([MIO]);
    expect((await como('conPermiso')(request.get(`/api/certifex/emisiones/cursos?centro=${AJENO}`))).status).toBe(404);
    // El PDF de un diploma ajeno, como si no existiera; el A3 de imprenta, de administración.
    expect((await como('conPermiso')(request.get(`/api/certifex/emisiones/diploma/${NEXP_AJENO}`))).status).toBe(404);
    expect((await como('conPermiso')(request.get(`/api/certifex/emisiones/diploma/${NEXP_MIO}?formato=imprenta`))).status).toBe(403);
  });

  it('con el permiso, nada de lo que escribe: 403 y nada llega a Certifex', async () => {
    const acciones = [
      request.post('/api/certifex/diplomas/aprobar-emitir').send({ matriculaIds: [base + 1] }),
      request.post('/api/certifex/diplomas/emitir').send({ matriculaIds: [base + 1] }),
      request.post('/api/certifex/diplomas/rechazar').send({ matriculaIds: [base + 1], motivo: 'No ha pagado' }),
      request.post('/api/certifex/diplomas/avisos').send({ nexpedientes: [NEXP_MIO] }),
      request.post('/api/certifex/diplomas/avisos-rechazo').send({ matriculaIds: [base + 1] }),
      request.post('/api/certifex/diplomas/revocar').send({ nexpediente: NEXP_MIO, motivo: 'Por error' }),
      request.post('/api/certifex/diplomas/corregir').send({ nexpediente: NEXP_MIO, valor: 'Ana Gil', motivo: 'Errata' }),
      request.post('/api/certifex/diplomas/editar').send({ matriculaId: base + 1, emailCrm: 'x@prueba.test' }),
      request.post('/api/certifex/diplomas/nuevo').send({ centro: MIO, leadId: 1, productoId: 1, dni: '12345678Z' }),
      request.get(`/api/certifex/diplomas/formaciones?centro=${MIO}`),
      request.post('/api/certifex/emisiones/decisiones').send({ items: [{ matriculaId: base + 1, decision: 'aprobada' }] }),
      request.post('/api/certifex/emisiones/emitir').send({ matriculaIds: [base + 1] }),
      request.get('/api/certifex/emisiones'),
      request.get('/api/certifex/consultas'),
    ];
    for (const r of await Promise.all(acciones.map((a) => como('conPermiso')(a)))) expect(r.status).toBe(403);
    expect(pedidas).toHaveLength(0);
  });

  it('la otra gestora del mismo campus sigue sin verlo', async () => {
    expect((await como('sinPermiso')(request.get('/api/certifex/diplomas'))).status).toBe(403);
  });

  it('un admin solo se lo da a gente de sus campus (#245), y a un admin no hace falta', async () => {
    const r = await como('adminAjeno')(request.put(`/api/permissions/claves/diplomas.view/personas/${gente.sinPermiso.id}`)).send({ permitido: true });
    expect(r.status).toBe(404);
    const lista = await como('adminAjeno')(request.get('/api/permissions/claves/diplomas.view/personas?roleKey=gestor'));
    expect(lista.body.data.map((p) => p.id)).not.toContain(gente.sinPermiso.id);
    const aUnAdmin = await como('sa')(request.put(`/api/permissions/claves/diplomas.view/personas/${gente.adminAjeno.id}`)).send({ permitido: true });
    expect(aUnAdmin.status).toBe(400);
    // Y una gestora no reparte permisos.
    expect((await como('sinPermiso')(request.put(`/api/permissions/claves/diplomas.view/personas/${gente.sinPermiso.id}`)).send({ permitido: true })).status).toBe(403);
  });

  it('quitárselo (null) la deja como su rol: deja de verlo', async () => {
    const r = await como('sa')(request.put(`/api/permissions/claves/diplomas.view/personas/${gente.conPermiso.id}`)).send({ permitido: null });
    expect(r.body.data).toMatchObject({ excepcion: null, puede: false });
    expect((await como('conPermiso')(request.get('/api/certifex/diplomas'))).status).toBe(403);
  });
});

describe('por rol, desde Configuración › Roles', () => {
  it('el super admin y el admin cambian un rol entero; dárselo hace que lo vea y quitárselo, que no', async () => {
    expect((await como('pm')(request.get('/api/certifex/diplomas'))).status).toBe(403);
    // Diego, 26/10: el admin sigue cambiando lo que trae cada rol (y «Diplomas · Ver» lo tiene).
    const delAdmin = await como('adminAjeno')(request.put('/api/permissions/claves/diplomas.view/rol/project_manager')).send({ permitido: true });
    expect(delAdmin.status, JSON.stringify(delAdmin.body)).toBe(200);
    expect((await como('adminAjeno')(request.put('/api/permissions/claves/diplomas.view/rol/project_manager')).send({ permitido: false })).status).toBe(200);

    const si = await como('sa')(request.put('/api/permissions/claves/diplomas.view/rol/project_manager')).send({ permitido: true });
    expect(si.status, JSON.stringify(si.body)).toBe(200);
    expect(si.body.data).toMatchObject({ roleKey: 'project_manager', permitido: true });
    expect((await como('pm')(request.get('/api/certifex/diplomas'))).status).toBe(200);
    const defaults = await como('sa')(request.get('/api/permissions/system-defaults'));
    expect(defaults.body.data.roles.project_manager['diplomas.view']).toBe(true);

    const no = await como('sa')(request.put('/api/permissions/claves/diplomas.view/rol/project_manager')).send({ permitido: false });
    expect(no.body.data.permitido).toBe(false);
    // Lo que vuelve a ser como el código no deja fila.
    expect((await pool.query(`SELECT 1 FROM role_permission_overrides WHERE role = 'project_manager' AND resource = 'diplomas'`)).rows).toEqual([]);
    expect((await como('pm')(request.get('/api/certifex/diplomas'))).status).toBe(403);
  });

  it('a admin, superadmin, tutor o colaborador no se les cambia (400); otra clave, tampoco', async () => {
    for (const rol of ['admin', 'superadmin', 'tutor', 'colaborador']) {
      expect((await como('sa')(request.put(`/api/permissions/claves/diplomas.view/rol/${rol}`)).send({ permitido: true })).status, rol).toBe(400);
    }
    expect((await como('sa')(request.put('/api/permissions/claves/leads.delete/rol/gestor')).send({ permitido: true })).status).toBe(400);
  });
});
