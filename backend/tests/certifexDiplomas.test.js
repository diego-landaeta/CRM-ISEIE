// Certifex · Diplomas (#272): el alumno pide su diploma desde Moodle, el CRM lo aprueba
// y emite, y una persona aprueba aparte el correo con el diploma.
//
// Aqui no se habla con ningun Certifex de verdad: `fetch` se sustituye por uno que
// apunta lo que se le pide y contesta como la API /api/crm/v1. Ningun correo sale.
//
// Lo que se fija:
//  · la entrada de solicitudes: secreto, idempotente por matricula, actualiza si el
//    alumno lo vuelve a pedir, enlaza con la ficha por correo y avisa SOLO a
//    administracion por la campana;
//  · que quien aprueba, emite, avisa, revoca o corrige es el usuario con sesion;
//  · que «aprobar y emitir» NO avisa: el aviso es otra llamada;
//  · que solo administracion puede, y que soporte no llega a Certifex.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

const avisos = [];
vi.mock('../src/modules/notifications/notifications.service.js', async (orig) => ({
  ...(await orig()),
  notifyUsers: vi.fn(async (a) => { avisos.push(a); return { id: 1 }; }),
  notifyAdmins: vi.fn(async (a) => { avisos.push({ ...a, broadcast: true }); return { id: 1 }; }),
}));

// Para simular que la base del CRM no contesta en una consulta concreta: si el SQL
// casa con `fallaConsulta`, la consulta falla. Todo lo demas va a la base de verdad.
let fallaConsulta = null;
vi.mock('../src/shared/config/db.js', async (orig) => {
  const m = await orig();
  return {
    ...m,
    query: (text, params) => (fallaConsulta && fallaConsulta.test(text)
      ? Promise.reject(new Error('la base no contesta (simulado)'))
      : m.query(text, params)),
  };
});

const SECRETO = 'secreto-de-prueba-diplomas';
const CLAVE = 'cfx_crm_clave-de-prueba-diplomas';
process.env.CERTIFEX_WEBHOOK_SECRETO = SECRETO;
process.env.CERTIFEX_API_URL = 'https://certifex.test';
process.env.CERTIFEX_CRM_CLAVE = CLAVE;

const { default: supertest } = await import('supertest');
const { default: app } = await import('../src/app.js');
const { default: pool } = await import('../src/shared/config/db.js');
const { diaDe } = await import('../src/modules/certifex/certifex.diplomas.js');
const { horasDeTexto, encaja, modalidadDe, programaValido } = await import('../src/modules/certifex/certifex.programa.js');

const request = supertest(app);
// Ids de matricula altos y unicos por ejecucion, para no chocar con nada sembrado.
const base = 800000000 + Math.floor(Math.random() * 1000000);
let saToken;
let saUser;
let proyectoBase;
let proyectoCreado = false;
let soporteToken;
let pedidas = [];
let responder = () => ({ status: 200, body: {} });

const fetchReal = globalThis.fetch;
beforeAll(async () => {
  // La base local de ISEIE sale sin datos de ejemplo: el super admin lo pone la prueba.
  const { default: jwt } = await import('jsonwebtoken');
  const { rows: [u] } = await pool.query(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ('SA Certifex', $1, 'x', 'superadmin') RETURNING id, email`,
    [`sa.certifex.${Date.now()}.${Math.floor(Math.random() * 1e6)}@prueba.test`]);
  saUser = u;
  saToken = jwt.sign({ userId: u.id, email: u.email, role: 'superadmin', roles_extra: [] }, process.env.JWT_SECRET, { expiresIn: '10m' });
  // Y un proyecto, si no hay ninguno: las fichas de prueba cuelgan de uno.
  proyectoBase = (await pool.query('SELECT id FROM projects WHERE NOT COALESCE(es_prueba, false) ORDER BY id LIMIT 1')).rows[0]?.id;
  if (!proyectoBase) {
    proyectoBase = (await pool.query(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ('Prueba Certifex', $1, $1) RETURNING id`,
      [`prueba-certifex-${Date.now()}`])).rows[0].id;
    proyectoCreado = true;
  }
  soporteToken = jwt.sign({ userId: 999999, email: 'soporte@prueba.test', role: 'soporte', roles_extra: [] },
    process.env.JWT_SECRET, { expiresIn: '5m' });
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    if (!String(url).startsWith('https://certifex.test/')) return fetchReal(url, opts);
    const u = new URL(String(url));
    const p = { url: String(url), ruta: u.pathname.replace('/api/crm/v1', ''), query: Object.fromEntries(u.searchParams), metodo: opts.method, cabeceras: opts.headers, cuerpo: opts.body ? JSON.parse(opts.body) : null };
    pedidas.push(p);
    const r = responder(p);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  });
});
afterAll(async () => {
  globalThis.fetch = fetchReal;
  if (saUser) await pool.query('DELETE FROM users WHERE id = $1', [saUser.id]);
  await pool.query('DELETE FROM certifex_solicitudes WHERE matricula_id >= $1 AND matricula_id < $2', [base, base + 1000]);
  if (proyectoCreado) await pool.query('DELETE FROM projects WHERE id = $1', [proyectoBase]);
  await pool.end();
});
beforeEach(() => {
  pedidas = [];
  avisos.length = 0;
  fallaConsulta = null;
  responder = () => ({ status: 200, body: {} });
});

const sa = (req) => req.set('Authorization', `Bearer ${saToken}`);
const soporte = (req) => req.set('Authorization', `Bearer ${soporteToken}`);

const solicitud = (extra = {}) => ({
  matriculaId: base,
  centro: 'iseie',
  curso: { ref: 12, nombre: 'Máster en Prueba' },
  alumno: { nombreDiploma: 'María José Pérez Ruiz', nombreMoodle: 'maria perez', email: 'alumna.diploma@prueba.test' },
  solicitadaEn: '2026-10-08T10:00:00.000Z',
  ...extra,
});
const entregar = (cuerpo, secreto = SECRETO) => request.post('/api/certifex/solicitudes').set('X-Certifex-Secreto', secreto).send(cuerpo);

// ───────────────────────────────────────────────────────────── entrada

describe('POST /api/certifex/solicitudes (desde el servidor de Certifex)', () => {
  it('sin el secreto configurado la entrada no existe (404); con otro, 401', async () => {
    delete process.env.CERTIFEX_WEBHOOK_SECRETO;
    try {
      expect((await entregar(solicitud())).status).toBe(404);
    } finally {
      process.env.CERTIFEX_WEBHOOK_SECRETO = SECRETO;
    }
    expect((await request.post('/api/certifex/solicitudes').send(solicitud())).status).toBe(401);
    expect((await entregar(solicitud(), 'otro')).status).toBe(401);
    expect(avisos).toHaveLength(0);
  });

  it('se guarda, se enlaza con la ficha por correo y suena la campana de administracion', async () => {
    const { rows: [lead] } = await pool.query(
      `INSERT INTO leads (project_id, nombre, email) VALUES ($1, 'Alumna Diploma', 'ALUMNA.DIPLOMA@prueba.test') RETURNING id`, [proyectoBase]);
    try {
      const r = await entregar(solicitud());
      expect(r.status).toBe(201);
      expect(r.body.data).toMatchObject({ estado: 'nueva', duplicada: false, enCrm: true });

      const { rows: [s] } = await pool.query('SELECT * FROM certifex_solicitudes WHERE matricula_id = $1', [base]);
      expect(s).toMatchObject({ centro: 'ISEIE', nombre_diploma: 'María José Pérez Ruiz', nombre_moodle: 'maria perez', lead_id: lead.id, veces: 1 });

      await vi.waitFor(() => expect(avisos).toHaveLength(1));
      const a = avisos[0];
      expect(a.type).toBe('certifex_solicitud');
      expect(a.link_path).toBe('/matriculas/diplomas');
      expect(a.title).toContain('María José Pérez Ruiz');
      expect(a.message).toContain('en Moodle: maria perez');
      expect(a.metadata).toMatchObject({ matriculaId: base, leadId: lead.id });
      // Dirigida: super admin y los admin del proyecto de ese campus (ISEIE), no el
      // reparto general (que ve soporte) ni los admin de otros campus.
      const { rows: sas } = await pool.query(
        `SELECT id FROM users WHERE active AND (role = 'superadmin' OR roles_extra && ARRAY['superadmin']::user_role[])`);
      const { rows: delCampus } = await pool.query(
        `SELECT DISTINCT u.id FROM users u JOIN user_projects up ON up.user_id = u.id AND up.active
           JOIN projects p ON p.id = up.project_id AND NOT COALESCE(p.es_prueba, false)
          WHERE u.active AND (u.role = 'admin' OR u.roles_extra && ARRAY['admin']::user_role[])
            AND (regexp_replace(lower(p.nombre), '[^a-z0-9]', '', 'g') LIKE 'iseie%' OR regexp_replace(lower(p.slug), '[^a-z0-9]', '', 'g') LIKE 'iseie%')`);
      expect([...a.targetUserIds].sort()).toEqual([...new Set([...sas, ...delCampus].map((x) => x.id))].sort());
      expect(a.broadcast).toBeUndefined();
    } finally {
      await pool.query('UPDATE certifex_solicitudes SET lead_id = NULL WHERE lead_id = $1', [lead.id]);
      await pool.query('DELETE FROM leads WHERE id = $1', [lead.id]);
    }
  });

  it('un reintento identico de Certifex no duplica ni vuelve a avisar', async () => {
    const r = await entregar(solicitud());
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ estado: 'repetida', duplicada: true });
    await new Promise((ok) => setTimeout(ok, 50));
    expect(avisos).toHaveLength(0);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM certifex_solicitudes WHERE matricula_id = $1', [base]);
    expect(rows[0].n).toBe(1);
  });

  it('si el alumno lo vuelve a pedir, se actualiza la que hay y avisa otra vez', async () => {
    await pool.query(`UPDATE certifex_solicitudes SET aviso_rechazo_en = NOW(), aviso_rechazo_por = 'x' WHERE matricula_id = $1`, [base]);
    const r = await entregar(solicitud({
      solicitadaEn: '2026-10-09T09:00:00.000Z',
      alumno: { nombreDiploma: 'María José Pérez Ruiz de la Vega', nombreMoodle: 'maria perez', email: 'alumna.diploma@prueba.test' },
    }));
    expect(r.status).toBe(200);
    expect(r.body.data.estado).toBe('actualizada');
    const { rows: [s] } = await pool.query('SELECT * FROM certifex_solicitudes WHERE matricula_id = $1', [base]);
    expect(s.nombre_diploma).toBe('María José Pérez Ruiz de la Vega');
    expect(s.veces).toBe(2);
    // El aviso de rechazo era de la solicitud anterior.
    expect(s.aviso_rechazo_en).toBeNull();
    await vi.waitFor(() => expect(avisos).toHaveLength(1));
    expect(avisos[0].title).toMatch(/vuelve a pedir/);
  });

  it('sin DNI: si llega uno, no se guarda; sin matricula o sin fecha, no entra', async () => {
    const r = await entregar(solicitud({ matriculaId: base + 1, alumno: { nombreDiploma: 'Ana Gil', email: null, dni: '12345678Z' } }));
    expect(r.status).toBe(201);
    expect(r.body.data.enCrm).toBe(false);
    const { rows: [s] } = await pool.query('SELECT * FROM certifex_solicitudes WHERE matricula_id = $1', [base + 1]);
    expect(JSON.stringify(s)).not.toContain('12345678Z');
    expect((await entregar(solicitud({ matriculaId: base + 3, solicitadaEn: 'ayer' }))).status).toBe(400);
    expect((await entregar(solicitud({ matriculaId: 'x' }))).status).toBe(400);
  });

  it('lo legitimo no se rechaza entero: correo vacio o mal escrito, curso largo, sin nombre', async () => {
    const r = await entregar(solicitud({
      matriculaId: base + 2,
      curso: { ref: 12, nombre: `  ${'Curso muy largo '.repeat(30)}  ` },
      alumno: { nombreDiploma: '', nombreMoodle: 'Ana Moodle', email: '' },
    }));
    expect(r.status).toBe(201);
    const { rows: [s] } = await pool.query('SELECT * FROM certifex_solicitudes WHERE matricula_id = $1', [base + 2]);
    expect(s.nombre_diploma).toBeNull();
    expect(s.email).toBeNull();
    expect(s.curso_nombre).toHaveLength(300);
    // Sin nombre para el diploma, la campana lo dice con el de Moodle.
    await vi.waitFor(() => expect(avisos).toHaveLength(1));
    expect(avisos[0].title).toContain('Ana Moodle');

    avisos.length = 0;
    const otro = await entregar(solicitud({ matriculaId: base + 4, alumno: { nombreDiploma: null, email: 'no-es-un-correo' } }));
    expect(otro.status).toBe(201);
    const { rows: [t] } = await pool.query('SELECT nombre_diploma, email FROM certifex_solicitudes WHERE matricula_id = $1', [base + 4]);
    expect(t).toEqual({ nombre_diploma: null, email: null });
    await vi.waitFor(() => expect(avisos).toHaveLength(1));
    expect(avisos[0].message).toMatch(/Sin nombre para el diploma/);
  });
});

// ───────────────────────────────────────────────────────────── permisos

describe('quien puede', () => {
  it('sin sesion, nada', async () => {
    expect((await request.get('/api/certifex/diplomas')).status).toBe(401);
    expect((await request.post('/api/certifex/diplomas/aprobar-emitir').send({ matriculaIds: [1] })).status).toBe(401);
    expect(pedidas).toHaveLength(0);
  });

  it('soporte no ve ni toca diplomas: 403 y nada llega a Certifex', async () => {
    const llamadas = [
      soporte(request.get('/api/certifex/diplomas')),
      soporte(request.get('/api/certifex/diplomas/solicitudes')),
      soporte(request.get('/api/certifex/diplomas/resumen')),
      soporte(request.get('/api/certifex/diplomas/por-avisar')),
      soporte(request.post('/api/certifex/diplomas/aprobar-emitir')).send({ matriculaIds: [7] }),
      soporte(request.post('/api/certifex/diplomas/rechazar')).send({ matriculaIds: [7], motivo: 'no pagó' }),
      soporte(request.post('/api/certifex/diplomas/avisos')).send({ nexpedientes: ['CTF-2026-000001-AAAA'] }),
      soporte(request.post('/api/certifex/diplomas/avisos-rechazo')).send({ matriculaIds: [7] }),
      soporte(request.post('/api/certifex/diplomas/revocar')).send({ nexpediente: 'CTF-2026-000001-AAAA', motivo: 'error' }),
      soporte(request.post('/api/certifex/diplomas/corregir')).send({ nexpediente: 'CTF-2026-000001-AAAA', valor: 'Ana', motivo: 'tilde' }),
      soporte(request.post('/api/certifex/diplomas/editar')).send({ matriculaId: 7, emailCrm: 'x@y.es' }),
      soporte(request.get('/api/certifex/diplomas/formaciones?centro=ISEIE')),
    ];
    for (const r of await Promise.all(llamadas)) expect(r.status).toBe(403);
    expect(pedidas).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────── listados

const candidato = (id, en, extra = {}) => ({
  matriculaId: id, centro: 'ISEIE', titular: { nombre: `Alumno ${id}`, email: null, dni: null },
  curso: { ref: 12, nombre: 'Máster' }, notaFinal: 8, umbral: 5, completado: true, actividades: { total: 4, calificadas: 4 },
  propuesto: true, nexpediente: null, solicitud: { en, nombre: `Nombre Diploma ${id}` }, decision: null, ...extra,
});
// Con DNI: es obligatorio para aprobar y emitir (Diego, 20/10/2026). Vive en Certifex, en el
// titular, y el CRM se lo pregunta antes de decidir nada.
const DNI = '12345678Z';
const conDni = (id, en = '2026-10-08T10:00:00Z', extra = {}) => candidato(id, en, {
  ...extra, titular: { nombre: `Alumno ${id}`, email: null, dni: DNI, ...(extra.titular ?? {}) },
});
const diploma = (nexpediente, emitidoEn, extra = {}) => ({
  nexpediente, centro: 'ISEIE', alumno: 'Alumno', titulacion: 'Máster', cursoRef: 12, emitidoEn, emitidaPor: 'manuel@empresa.com (CRM local)',
  revocada: false, revocacion: null, verificarUrl: `https://certifex.test/c/${nexpediente}`, diplomaUrl: 'https://certifex.test/diploma', aviso: null, ...extra,
});

describe('solicitudes', () => {
  it('pide solo lo solicitado desde Moodle, con sus filtros, y cruza con el CRM', async () => {
    responder = () => ({ status: 200, body: { filas: [candidato(7, '2026-10-08T10:00:00Z')], total: 1, pagina: 1, tam: 50 } });
    const r = await sa(request.get('/api/certifex/diplomas/solicitudes?centro=iseie&curso=12&q=ana'));
    expect(r.status).toBe(200);
    expect(pedidas[0].ruta).toBe('/candidatos');
    expect(pedidas[0].query).toEqual({ estado: 'pendiente', solicitadas: '1', centro: 'ISEIE', curso: '12', q: 'ana', pagina: '1', tam: '50' });
    expect(pedidas[0].cabeceras.Authorization).toBe(`Bearer ${CLAVE}`);
    expect(r.body.data.filas[0]).toMatchObject({ matriculaId: 7, crm: null, solicitud: { nombre: 'Nombre Diploma 7' } });
    expect(JSON.stringify(r.body)).not.toContain(CLAVE);
  });

  it('con fechas, recorre las paginas de Certifex y deja de pedir al pasar de `desde`', async () => {
    // 200 por pagina, lo mas reciente primero: la segunda pagina ya cruza el 01/10.
    const pag1 = Array.from({ length: 200 }, (_, i) => candidato(1000 + i, '2026-10-05T10:00:00Z'));
    const pag2 = [candidato(2000, '2026-10-02T10:00:00Z'), candidato(2001, '2026-09-20T10:00:00Z'),
      ...Array.from({ length: 198 }, (_, i) => candidato(3000 + i, '2026-09-10T10:00:00Z'))];
    responder = (p) => ({ status: 200, body: { filas: p.query.pagina === '1' ? pag1 : p.query.pagina === '2' ? pag2 : [], total: 1000, pagina: Number(p.query.pagina), tam: 200 } });
    const r = await sa(request.get('/api/certifex/diplomas/solicitudes?desde=2026-10-01&hasta=2026-10-04&pagina=1&tam=50'));
    expect(r.status).toBe(200);
    expect(r.body.data.total).toBe(1);
    expect(r.body.data.filas.map((f) => f.matriculaId)).toEqual([2000]);
    expect(pedidas.map((p) => p.query.pagina)).toEqual(['1', '2']);
  });

  it('si Certifex no los da ordenados (repositorio en memoria), no para por fecha', async () => {
    // Lo antiguo primero y lo de hoy al final: con parada por la primera fila antigua,
    // «desde hoy» salia vacio contra el Certifex de pruebas.
    responder = () => ({ status: 200, body: { filas: [
      candidato(1, '2024-12-21T10:00:00Z'), candidato(2, '2023-12-05T10:00:00Z'), candidato(3, '2026-10-08T10:00:00Z'),
    ], total: 3, pagina: 1, tam: 200 } });
    const r = await sa(request.get('/api/certifex/diplomas/solicitudes?desde=2026-10-08'));
    expect(r.body.data.filas.map((f) => f.matriculaId)).toEqual([3]);
  });

  it('las rechazadas traen el aviso de rechazo que se aprobo', async () => {
    await pool.query(
      `INSERT INTO certifex_solicitudes (matricula_id, aviso_rechazo_en, aviso_rechazo_por, aviso_rechazo_resultado)
       VALUES ($1, NOW(), 'manuel@empresa.com', 'enviado') ON CONFLICT (matricula_id) DO NOTHING`, [base + 10]);
    responder = () => ({ status: 200, body: { filas: [
      candidato(base + 10, '2026-10-08T10:00:00Z', { decision: { decision: 'rechazada', motivo: 'Sin pagar', decididoPor: 'x', decididoEn: '2026-10-08T11:00:00Z', refExterna: null } }),
      candidato(base + 11, '2026-10-08T10:00:00Z', { decision: { decision: 'rechazada', motivo: 'Baja', decididoPor: 'x', decididoEn: '2026-10-08T11:00:00Z', refExterna: null } }),
    ], total: 2, pagina: 1, tam: 50 } });
    const r = await sa(request.get('/api/certifex/diplomas/solicitudes?estado=rechazada'));
    const [a, b] = r.body.data.filas;
    expect(a.avisoRechazo).toMatchObject({ por: 'manuel@empresa.com', resultado: 'enviado' });
    expect(b.avisoRechazo).toBeNull();
  });

  it('un filtro raro no llega a Certifex', async () => {
    expect((await sa(request.get('/api/certifex/diplomas/solicitudes?estado=emitidas'))).status).toBe(400);
    expect((await sa(request.get('/api/certifex/diplomas/solicitudes?desde=08/10/2026'))).status).toBe(400);
    expect(pedidas).toHaveLength(0);
  });
});

describe('diplomas emitidos', () => {
  it('vigentes o revocados, tal cual, con su paginacion', async () => {
    responder = () => ({ status: 200, body: { filas: [diploma('CTF-2026-000001-AAAA', '2026-10-08T10:00:00Z')], total: 1, pagina: 2, tam: 20 } });
    const r = await sa(request.get('/api/certifex/diplomas?estado=revocados&centro=ISEIE&pagina=2&tam=20'));
    expect(r.status).toBe(200);
    expect(pedidas[0].ruta).toBe('/diplomas');
    expect(pedidas[0].query).toEqual({ estado: 'revocados', centro: 'ISEIE', pagina: '2', tam: '20' });
  });

  it('filtra por estado del aviso y por formacion en el CRM, y la formacion pide campus', async () => {
    responder = () => ({ status: 200, body: { filas: [
      diploma('CTF-2026-000001-AAAA', '2026-10-08T10:00:00Z'),
      diploma('CTF-2026-000002-AAAA', '2026-10-08T10:00:00Z', { aviso: { resultado: 'enviado', en: 'x', por: 'y' } }),
      diploma('CTF-2026-000003-AAAA', '2026-10-08T10:00:00Z', { aviso: { resultado: 'correo_apagado', en: 'x', por: 'y' } }),
      diploma('CTF-2026-000004-AAAA', '2026-10-08T10:00:00Z', { cursoRef: 99 }),
      // Emitido fuera del CRM (los antiguos de Ana): nadie del CRM tiene que avisar.
      diploma('CTF-2024-000005-AAAA', '2024-03-08T10:00:00Z', { emitidaPor: 'ana@iseie.com' }),
    ], total: 5, pagina: 1, tam: 200 } });
    const pend = await sa(request.get('/api/certifex/diplomas?aviso=pendiente&centro=ISEIE&curso=12'));
    expect(pend.body.data.filas.map((d) => d.nexpediente)).toEqual(['CTF-2026-000001-AAAA']);
    const fuera = await sa(request.get('/api/certifex/diplomas?aviso=fuera'));
    expect(fuera.body.data.filas.map((d) => d.nexpediente)).toEqual(['CTF-2024-000005-AAAA']);
    expect(fuera.body.data.filas[0].emitidoEnCrm).toBe(false);
    const no = await sa(request.get('/api/certifex/diplomas?aviso=no_salio'));
    expect(no.body.data.filas.map((d) => d.nexpediente)).toEqual(['CTF-2026-000003-AAAA']);
    const todo = await sa(request.get('/api/certifex/diplomas?todo=1'));
    expect(todo.body.data.filas).toHaveLength(5);
    expect(todo.body.data.filas[0].emitidoEnCrm).toBe(true);
    expect((await sa(request.get('/api/certifex/diplomas?curso=12'))).status).toBe(400);
  });

  it('por avisar: aprobadas con diploma vigente y sin aviso; y las aprobadas sin diploma', async () => {
    responder = (p) => {
      if (p.ruta === '/candidatos') {
        return { status: 200, body: { filas: [
          candidato(1, '2026-10-07T10:00:00Z', { nexpediente: 'CTF-2026-000001-AAAA' }),
          candidato(2, '2026-10-07T10:00:00Z', { nexpediente: 'CTF-2026-000002-AAAA' }),
          candidato(3, '2026-10-07T10:00:00Z'),
        ], total: 3, pagina: 1, tam: 200 } };
      }
      return { status: 200, body: { filas: [
        diploma('CTF-2026-000001-AAAA', '2026-10-08T10:00:00Z'),
        diploma('CTF-2026-000002-AAAA', '2026-10-08T10:00:00Z', { aviso: { resultado: 'enviado', en: 'x', por: 'y' } }),
      ], total: 2, pagina: 1, tam: 200 } };
    };
    const r = await sa(request.get('/api/certifex/diplomas/por-avisar'));
    expect(r.status).toBe(200);
    expect(pedidas[0].query).toMatchObject({ estado: 'aprobada', solicitadas: '1' });
    expect(r.body.data.porAvisar.map((c) => c.matriculaId)).toEqual([1]);
    expect(r.body.data.porAvisar[0].diploma.nexpediente).toBe('CTF-2026-000001-AAAA');
    expect(r.body.data.sinEmitir.map((c) => c.matriculaId)).toEqual([3]);
  });

  it('el resumen cuenta cada pestaña, y «por enviar» es lo mismo que el filtro «Pendiente de aviso»', async () => {
    responder = (p) => {
      if (p.query.tam === '1') {
        const t = p.query.terminados === '1' ? 7 : { pendiente: 4, rechazada: 2, vigentes: 30, revocados: 1 }[p.query.estado];
        return { status: 200, body: { filas: [], total: t, pagina: 1, tam: 1 } };
      }
      if (p.ruta === '/diplomas') {
        return { status: 200, body: { filas: [
          diploma('CTF-2026-000001-AAAA', '2026-10-08T10:00:00Z'),
          diploma('CTF-2026-000002-AAAA', '2026-10-08T10:00:00Z', { aviso: { resultado: 'enviado', en: 'x', por: 'y' } }),
          diploma('CTF-2024-000003-AAAA', '2024-03-08T10:00:00Z', { emitidaPor: 'ana@iseie.com' }),
        ], total: 3, pagina: 1, tam: 200 } };
      }
      return { status: 200, body: { filas: [], total: 0, pagina: 1, tam: 200 } };
    };
    const r = await sa(request.get('/api/certifex/diplomas/resumen?centro=ISEIE'));
    expect(r.body.data).toEqual({ pendientes: 4, rechazadas: 2, vigentes: 30, revocados: 1, terminados: 7, porAvisar: 0, sinEmitir: 0, porEnviar: 1 });
    expect(pedidas.every((p) => p.query.centro === 'ISEIE')).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────── acciones

describe('aprobar y emitir', () => {
  it('aprueba y emite en un paso, a nombre del usuario con sesion, y NO avisa', async () => {
    responder = (p) => p.ruta === '/candidatos'
      ? { status: 200, body: { filas: [conDni(7), conDni(8)], total: 2, pagina: 1, tam: 200 } }
      : p.ruta === '/decisiones'
        ? { status: 200, body: { resultados: [{ matriculaId: 7, ok: true, decision: 'aprobada' }, { matriculaId: 8, ok: false, error: 'Ya está rechazada' }] } }
        : { status: 200, body: { resultados: [{ matriculaId: 7, ok: true, nexpediente: 'CTF-2026-000007-AAAA' }] } };
    const r = await sa(request.post('/api/certifex/diplomas/aprobar-emitir'))
      .send({ matriculaIds: [7, 8], decididoPor: 'otra@persona.test', emitidaPor: 'otra@persona.test' });
    expect(r.status).toBe(200);
    // Primero se busca la matricula (para su programa y su DNI), luego se decide y se emite.
    expect(pedidas.map((p) => p.ruta)).toEqual(['/candidatos', '/decisiones', '/emitir']);
    expect(pedidas[1].cuerpo.decisiones).toEqual([
      { matriculaId: 7, decision: 'aprobada', decididoPor: saUser.email },
      { matriculaId: 8, decision: 'aprobada', decididoPor: saUser.email },
    ]);
    // Solo se emite lo que se aprobo.
    expect(pedidas[2].cuerpo).toEqual({ items: [{ matriculaId: 7 }], emitidaPor: saUser.email });
    expect(r.body.data.resultados).toEqual([
      { matriculaId: 7, ok: true, nexpediente: 'CTF-2026-000007-AAAA', fase: 'emitir', firmaAlumno: false, sinPrograma: 'Sin correo: no se puede buscar su venta en el CRM.' },
      { matriculaId: 8, ok: false, fase: 'aprobar', error: 'Ya está rechazada' },
    ]);
    expect(pedidas.some((p) => p.ruta.startsWith('/avisos'))).toBe(false);
  });

  it('si la emision falla, se dice que quedo aprobada sin diploma', async () => {
    responder = (p) => p.ruta === '/candidatos'
      ? { status: 200, body: { filas: [conDni(7)], total: 1, pagina: 1, tam: 200 } }
      : p.ruta === '/decisiones'
        ? { status: 200, body: { resultados: [{ matriculaId: 7, ok: true }] } }
        : { status: 500, body: { error: 'Moodle no responde' } };
    const r = await sa(request.post('/api/certifex/diplomas/aprobar-emitir')).send({ matriculaIds: [7] });
    expect(r.status).toBe(200);
    expect(r.body.data.resultados[0]).toMatchObject({ matriculaId: 7, ok: false, fase: 'emitir' });
    expect(r.body.data.resultados[0].error).toMatch(/Aprobada, pero sin diploma: Moodle no responde/);
  });

  it('mas de 10 por llamada no sale (se hace en tandas)', async () => {
    const r = await sa(request.post('/api/certifex/diplomas/aprobar-emitir')).send({ matriculaIds: Array.from({ length: 11 }, (_, i) => i + 1) });
    expect(r.status).toBe(400);
    expect(pedidas).toHaveLength(0);
  });
});

describe('rechazar', () => {
  it('el motivo es obligatorio', async () => {
    expect((await sa(request.post('/api/certifex/diplomas/rechazar')).send({ matriculaIds: [7] })).status).toBe(400);
    expect((await sa(request.post('/api/certifex/diplomas/rechazar')).send({ matriculaIds: [7], motivo: '  ' })).status).toBe(400);
    expect(pedidas).toHaveLength(0);
  });

  it('rechaza con motivo a nombre del usuario con sesion, sin avisar', async () => {
    responder = () => ({ status: 200, body: { resultados: [{ matriculaId: 7, ok: true }] } });
    const r = await sa(request.post('/api/certifex/diplomas/rechazar')).send({ matriculaIds: [7], motivo: 'No ha pagado', decididoPor: 'x' });
    expect(r.status).toBe(200);
    expect(pedidas).toHaveLength(1);
    expect(pedidas[0].cuerpo).toEqual({ decisiones: [{ matriculaId: 7, decision: 'rechazada', motivo: 'No ha pagado', decididoPor: saUser.email }] });
  });
});

describe('avisos: el correo al alumno solo sale si alguien lo aprueba', () => {
  it('«Enviar diploma al alumno» aprueba el aviso a nombre del usuario con sesion', async () => {
    responder = () => ({ status: 200, body: { correoActivo: false, resultados: [{ nexpediente: 'CTF-2026-000001-AAAA', ok: false, resultado: 'correo_apagado' }] } });
    const r = await sa(request.post('/api/certifex/diplomas/avisos')).send({ nexpedientes: ['ctf-2026-000001-aaaa'], aprobadoPor: 'otra@persona.test' });
    expect(r.status).toBe(200);
    expect(pedidas[0].ruta).toBe('/avisos');
    expect(pedidas[0].cuerpo).toEqual({ nexpedientes: ['CTF-2026-000001-AAAA'], aprobadoPor: saUser.email });
    // Con el correo apagado en Certifex, la pantalla tiene que poder decirlo.
    expect(r.body.data.correoActivo).toBe(false);
  });

  it('un numero de expediente con otra forma no sale; mas de 50, tampoco', async () => {
    expect((await sa(request.post('/api/certifex/diplomas/avisos')).send({ nexpedientes: ['../../x'] })).status).toBe(400);
    const muchos = Array.from({ length: 51 }, (_, i) => `CTF-2026-${String(i).padStart(6, '0')}-AAAA`);
    expect((await sa(request.post('/api/certifex/diplomas/avisos')).send({ nexpedientes: muchos })).status).toBe(400);
    expect(pedidas).toHaveLength(0);
  });

  it('el aviso de rechazo se aprueba aparte y queda apuntado quien y cuando', async () => {
    responder = () => ({ status: 200, body: { correoActivo: true, resultados: [{ matriculaId: base + 20, ok: true, resultado: 'enviado' }, { matriculaId: base + 21, ok: false, error: 'No está rechazada' }] } });
    const r = await sa(request.post('/api/certifex/diplomas/avisos-rechazo')).send({ matriculaIds: [base + 20, base + 21] });
    expect(r.status).toBe(200);
    expect(pedidas[0].ruta).toBe('/avisos-rechazo');
    expect(pedidas[0].cuerpo).toEqual({ matriculaIds: [base + 20, base + 21], aprobadoPor: saUser.email });
    const { rows } = await pool.query('SELECT matricula_id, aviso_rechazo_por, aviso_rechazo_resultado FROM certifex_solicitudes WHERE matricula_id = ANY($1::bigint[])', [[base + 20, base + 21]]);
    expect(rows).toEqual([{ matricula_id: String(base + 20), aviso_rechazo_por: saUser.email, aviso_rechazo_resultado: 'enviado' }]);
  });
});

describe('revocar y corregir', () => {
  it('revocar pide motivo y va a nombre del usuario con sesion', async () => {
    expect((await sa(request.post('/api/certifex/diplomas/revocar')).send({ nexpediente: 'CTF-2026-000001-AAAA' })).status).toBe(400);
    responder = () => ({ status: 200, body: { ok: true, nexpediente: 'CTF-2026-000001-AAAA' } });
    const r = await sa(request.post('/api/certifex/diplomas/revocar')).send({ nexpediente: 'CTF-2026-000001-AAAA', motivo: 'Emitido por error', revocadaPor: 'x' });
    expect(r.status).toBe(200);
    expect(pedidas[0].cuerpo).toEqual({ nexpediente: 'CTF-2026-000001-AAAA', motivo: 'Emitido por error', revocadaPor: saUser.email });
  });

  it('corregir el nombre: mismo numero, campo alumno_nombre por defecto, auditado a nombre de quien corrige', async () => {
    responder = () => ({ status: 200, body: { ok: true, nexpediente: 'CTF-2026-000001-AAAA' } });
    const r = await sa(request.post('/api/certifex/diplomas/corregir'))
      .send({ nexpediente: 'CTF-2026-000001-AAAA', valor: 'María José Pérez', motivo: 'Faltaba la tilde', corregidoPor: 'x' });
    expect(r.status).toBe(200);
    expect(pedidas[0].ruta).toBe('/corregir');
    expect(pedidas[0].cuerpo).toEqual({ nexpediente: 'CTF-2026-000001-AAAA', campo: 'alumno_nombre', valor: 'María José Pérez', motivo: 'Faltaba la tilde', corregidoPor: saUser.email });
  });

  it('el error de Certifex llega tal cual a la pantalla (tambien «Es el mismo valor…»)', async () => {
    responder = () => ({ status: 400, body: { error: 'Está revocado: no se corrige.' } });
    const r = await sa(request.post('/api/certifex/diplomas/corregir')).send({ nexpediente: 'CTF-2026-000001-AAAA', valor: 'Ana Gil', motivo: 'tilde' });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain('Está revocado: no se corrige.');
    responder = () => ({ status: 400, body: { error: 'Es el mismo valor que ya tiene: no hay nada que corregir.' } });
    const m = await sa(request.post('/api/certifex/diplomas/corregir')).send({ nexpediente: 'CTF-2026-000001-AAAA', valor: 'Ana Gil', motivo: 'tilde' });
    expect(m.status).toBe(400);
    expect(m.body.error).toBe('Es el mismo valor que ya tiene: no hay nada que corregir.');
  });

  it('los mismos limites que Certifex: nombre de verdad, titulacion hasta 300, motivo hasta 500', async () => {
    const corregir = (cuerpo) => sa(request.post('/api/certifex/diplomas/corregir')).send({ nexpediente: 'CTF-2026-000001-AAAA', motivo: 'Errata', ...cuerpo });
    for (const valor of ['Ana', 'Ana 123', 'A'.repeat(80) + ' ' + 'B'.repeat(80), 'Ana <b>Gil</b>']) {
      const r = await corregir({ valor });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/nombre completo/);
    }
    expect((await corregir({ campo: 'titulacion', valor: 'x'.repeat(301) })).status).toBe(400);
    const largo = await corregir({ valor: 'Ana Gil', motivo: 'm'.repeat(501) });
    expect(largo.status).toBe(400);
    // En español, nunca el «String must contain…» de zod.
    expect(largo.body.error).toBe('El motivo no puede pasar de 500 caracteres');
    expect(pedidas).toHaveLength(0);

    // El apostrofo tipografico (O’Neill) vale y llega a Certifex como el recto.
    responder = () => ({ status: 200, body: { ok: true } });
    expect((await corregir({ valor: '  Sean   O’Neill ' })).status).toBe(200);
    expect(pedidas[0].cuerpo.valor).toBe("Sean O'Neill");
    expect((await corregir({ campo: 'titulacion', valor: 'Máster en   Neuropsicología' })).status).toBe(200);
    expect(pedidas[1].cuerpo).toMatchObject({ campo: 'titulacion', valor: 'Máster en Neuropsicología' });
  });
});

describe('sin Certifex configurado', () => {
  it('el panel dice que no esta conectado y nada sale a la red', async () => {
    const url = process.env.CERTIFEX_API_URL;
    delete process.env.CERTIFEX_API_URL;
    try {
      expect((await sa(request.get('/api/certifex/emisiones/estado'))).body.data).toEqual({ conectado: false });
      for (const r of [
        await sa(request.get('/api/certifex/diplomas/resumen')),
        await sa(request.get('/api/certifex/diplomas/solicitudes')),
        await sa(request.post('/api/certifex/diplomas/aprobar-emitir')).send({ matriculaIds: [7] }),
      ]) {
        expect(r.status).toBe(503);
        expect(r.body.error).toMatch(/Certifex no esta conectado/);
      }
      expect(pedidas).toHaveLength(0);
    } finally {
      process.env.CERTIFEX_API_URL = url;
    }
  });
});

describe('fechas', () => {
  it('el dia se cuenta en hora de Madrid', () => {
    expect(diaDe('2026-10-07T22:30:00Z')).toBe('2026-10-08');
    expect(diaDe(null)).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────── programa oficial

describe('el programa oficial de la formacion vendida', () => {
  const sufijo = `${Date.now()}`.slice(-6);
  const correo = `programa.${sufijo}@prueba.test`;
  const otro = `sinventa.${sufijo}@prueba.test`;
  const doble = `doble.${sufijo}@prueba.test`;
  const ids = { conVenta: base + 50, sinVenta: base + 51, doble: base + 52, sinGuardar: base + 53 };
  // Lo que Certifex devuelve de las guardadas en el CRM: de ahí sale solo el DNI (obligatorio).
  const enCertifex = (dni = DNI) => [ids.conVenta, ids.sinVenta, ids.doble, base + 54].map((id) => conDni(id, '2026-10-08T10:00:00Z', {
    centro: 'ZPRUEBA', titular: { dni }, curso: { ref: 1, nombre: 'Programa IA Experto' },
  }));
  const listaCertifex = (filas) => ({ status: 200, body: { filas, total: filas.length, pagina: 1, tam: 200 } });
  let proyecto;
  let productos = [];
  let leads = [];

  beforeAll(async () => {
    // Un campus de Certifex «ZPRUEBA» se casa con el proyecto «Zprueba Academia».
    ({ rows: [proyecto] } = await pool.query(
      `INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ('Zprueba Academia', $1, 'whk_test') RETURNING id`, [`zprueba-academia-${sufijo}`]));
    const prod = async (nombre, horas) => (await pool.query(
      `INSERT INTO products (project_id, nombre, horas, num_modulos) VALUES ($1, $2, $3, 2) RETURNING id`, [proyecto.id, nombre, horas])).rows[0].id;
    const p1 = await prod('Programa IA Experto', '1.500 horas');
    // La modalidad del catálogo va al diploma (Certifex#96).
    await pool.query(`UPDATE products SET modalidad = '  Semipresencial ' WHERE id = $1`, [p1]);
    const p2 = await prod('Programa IA Experto Avanzado', '200 h');
    const p3 = await prod('Programa IA Experto (2ª edición)', '100 h');
    productos = [p1, p2, p3];
    await pool.query(
      `INSERT INTO product_modules (product_id, orden, titulo, horas) VALUES ($1, 2, 'Modelos de lenguaje', 700), ($1, 1, 'Fundamentos de IA', 800)`, [p1]);
    const lead = async (email) => (await pool.query(
      `INSERT INTO leads (project_id, nombre, email) VALUES ($1, 'Alumno programa', $2) RETURNING id`, [proyecto.id, email])).rows[0].id;
    const l1 = await lead(correo.toUpperCase());
    const l2 = await lead(otro);
    const l3 = await lead(doble);
    leads = [l1, l2, l3];
    const venta = (l, p) => pool.query(
      `INSERT INTO conversions (lead_id, project_id, producto_contratado, producto_contratado_id, importe_total) VALUES ($1, $2, 'x', $3, 100)`, [l, proyecto.id, p]);
    await venta(l1, p1);
    // Dos ventas cuyo nombre contiene el del curso: no se adivina cual es.
    await venta(l3, p2);
    await venta(l3, p3);
    // Lo que guardo el CRM al recibir cada solicitud.
    for (const [id, email] of [[ids.conVenta, correo], [ids.sinVenta, otro], [ids.doble, doble]]) {
      await pool.query(
        `INSERT INTO certifex_solicitudes (matricula_id, centro, curso_nombre, nombre_diploma, email, solicitada_en)
         VALUES ($1, 'ZPRUEBA', 'Programa IA Experto', 'Alumno Programa', $2, NOW())`, [id, email]);
    }
  });
  afterAll(async () => {
    await pool.query('DELETE FROM conversions WHERE lead_id = ANY($1::int[])', [leads]);
    await pool.query('DELETE FROM leads WHERE id = ANY($1::int[])', [leads]);
    await pool.query('DELETE FROM product_modules WHERE product_id = ANY($1::int[])', [productos]);
    await pool.query('DELETE FROM products WHERE id = ANY($1::int[])', [productos]);
    await pool.query('DELETE FROM projects WHERE id = $1', [proyecto.id]);
  });

  it('las horas salen del texto del catalogo, sin adivinar', () => {
    // El numero que va delante de h/horas, con separador de miles de cualquier pais.
    // La modalidad que se manda a Certifex (#96): texto corto y limpio, o nada.
    expect(modalidadDe('  Online   en directo ')).toBe('Online en directo');
    expect(modalidadDe('')).toBeNull();
    expect(modalidadDe(null)).toBeNull();
    expect(modalidadDe('x'.repeat(61))).toBeNull();
    expect(programaValido({ horas: 10, modulos: [], modalidad: 'Presencial' })).toEqual({ horas: 10, modulos: [], modalidad: 'Presencial' });
    expect(programaValido({ horas: 10, modulos: [], modalidad: 7 })).toEqual({ horas: 10, modulos: [] });
    expect(horasDeTexto('1.500 horas')).toBe(1500);
    expect(horasDeTexto('1,500 horas')).toBe(1500);
    expect(horasDeTexto('1 500 horas')).toBe(1500);
    expect(horasDeTexto('1 500 horas')).toBe(1500);
    expect(horasDeTexto('1 500 h')).toBe(1500);
    expect(horasDeTexto('120 h')).toBe(120);
    expect(horasDeTexto('120h')).toBe(120);
    expect(horasDeTexto('60 ECTS - 1500 horas')).toBe(1500);
    expect(horasDeTexto('6 meses (600 horas)')).toBe(600);
    expect(horasDeTexto('1500 horas (1.500 h)')).toBe(1500);
    // Solo un numero y nada mas: ese.
    expect(horasDeTexto('1500')).toBe(1500);
    // Ambiguo: un rango, o varios numeros distintos ligados a horas.
    expect(horasDeTexto('De 120 a 150 horas')).toBeNull();
    expect(horasDeTexto('120 - 150 h')).toBeNull();
    expect(horasDeTexto('100 horas teóricas y 50 horas prácticas')).toBeNull();
    // Sin horas no se coge cualquier numero.
    expect(horasDeTexto('60 ECTS')).toBeNull();
    expect(horasDeTexto('6 meses')).toBeNull();
    expect(horasDeTexto('1,5 horas')).toBeNull();
    expect(horasDeTexto('sin datos')).toBeNull();
    expect(horasDeTexto('9000 horas')).toBeNull();
    expect(encaja('Programa IA Experto', 'PROGRAMA IA EXPERTO')).toBe(true);
    expect(encaja('Máster en Neuropsicología', 'Master en neuropsicologia clinica')).toBe(true);
    expect(encaja('IA', 'Programa IA Experto')).toBe(false);
  });

  it('aprobar y emitir manda el programa de la venta; sin venta o con dudas, sin programa y marcado', async () => {
    responder = (p) => {
      if (p.ruta === '/decisiones') return { status: 200, body: { resultados: p.cuerpo.decisiones.map((d) => ({ matriculaId: d.matriculaId, ok: true })) } };
      if (p.ruta === '/emitir') return { status: 200, body: { resultados: p.cuerpo.items.map((i) => ({ matriculaId: i.matriculaId, ok: true, nexpediente: 'CTF-2026-000001-AAAA' })) } };
      return listaCertifex(enCertifex());
    };
    const r = await sa(request.post('/api/certifex/diplomas/aprobar-emitir')).send({ matriculaIds: [ids.conVenta, ids.sinVenta, ids.doble] });
    expect(r.status).toBe(200);
    // Todo estaba guardado en el CRM, pero el DNI vive en Certifex: se le pregunta una vez por
    // todas, y el programa sale de lo guardado.
    expect(pedidas.map((p) => p.ruta)).toEqual(['/candidatos', '/decisiones', '/emitir']);
    const items = pedidas[2].cuerpo.items;
    expect(items[0]).toEqual({ matriculaId: ids.conVenta, programa: { horas: 1500, modulos: [{ titulo: 'Fundamentos de IA', horas: 800 }, { titulo: 'Modelos de lenguaje', horas: 700 }], modalidad: 'Semipresencial' } });
    expect(items[1]).toEqual({ matriculaId: ids.sinVenta });
    expect(items[2]).toEqual({ matriculaId: ids.doble });
    const [a, b, c] = r.body.data.resultados;
    expect(a.programa).toEqual({ horas: 1500, modulos: 2, formacion: 'Programa IA Experto' });
    expect(b.sinPrograma).toMatch(/No tiene ninguna venta en Zprueba Academia/);
    expect(c.sinPrograma).toMatch(/Varias formaciones vendidas encajan/);
  });

  it('si el CRM no la tiene guardada, la busca en Certifex; un campus sin proyecto, sin programa', async () => {
    responder = (p) => {
      if (p.ruta === '/candidatos') {
        return { status: 200, body: { total: 2, pagina: 1, tam: 200, filas: [
          candidato(ids.sinGuardar, '2026-10-08T10:00:00Z', { centro: 'ZPRUEBA', titular: { nombre: 'X', email: correo, dni: DNI }, curso: { ref: 1, nombre: 'Programa IA Experto' } }),
          candidato(ids.sinGuardar + 1, '2026-10-08T10:00:00Z', { centro: 'NOEXISTE', titular: { nombre: 'Y', email: correo, dni: 'X1234567L' } }),
        ] } };
      }
      return { status: 200, body: { resultados: (p.cuerpo.items ?? []).map((i) => ({ matriculaId: i.matriculaId, ok: true })) } };
    };
    const r = await sa(request.post('/api/certifex/diplomas/emitir')).send({ matriculaIds: [ids.sinGuardar, ids.sinGuardar + 1] });
    expect(r.status).toBe(200);
    expect(pedidas[0]).toMatchObject({ ruta: '/candidatos', query: { estado: 'todas' } });
    expect(pedidas[1].cuerpo.items[0].programa.horas).toBe(1500);
    expect(pedidas[1].cuerpo.items[1]).toEqual({ matriculaId: ids.sinGuardar + 1 });
    expect(r.body.data.resultados[1].sinPrograma).toMatch(/Ningún proyecto del CRM corresponde al campus NOEXISTE/);
  });

  it('el listado de pendientes dice que programa se imprimira', async () => {
    responder = () => ({ status: 200, body: { total: 2, pagina: 1, tam: 50, filas: [
      candidato(ids.conVenta, '2026-10-08T10:00:00Z', { centro: 'ZPRUEBA', titular: { nombre: 'X', email: correo, dni: null }, curso: { ref: 1, nombre: 'Programa IA Experto' } }),
      candidato(ids.sinVenta, '2026-10-08T10:00:00Z', { centro: 'ZPRUEBA', titular: { nombre: 'Y', email: otro, dni: null }, curso: { ref: 1, nombre: 'Programa IA Experto' } }),
    ] } });
    const r = await sa(request.get('/api/certifex/diplomas/solicitudes'));
    const [a, b] = r.body.data.filas;
    expect(a.programaCrm).toMatchObject({ programa: { horas: 1500 }, formacion: { nombre: 'Programa IA Experto', numModulos: 2 }, motivo: null });
    expect(b.programaCrm).toMatchObject({ programa: null });
    expect(b.programaCrm.motivo).toMatch(/No tiene ninguna venta/);
  });

  // Lo que responde un Certifex que aprueba y emite todo lo que se le pide.
  const todoBien = (extra = {}) => (p) => {
    if (p.ruta === '/decisiones') return { status: 200, body: { resultados: p.cuerpo.decisiones.map((d) => ({ matriculaId: d.matriculaId, ok: true })) } };
    if (p.ruta === '/emitir') return { status: 200, body: { resultados: p.cuerpo.items.map((i) => ({ matriculaId: i.matriculaId, ok: true, nexpediente: 'CTF-2026-000001-AAAA', ...extra })) } };
    return listaCertifex(enCertifex());
  };

  it('si la base del CRM no contesta, no se aprueba ni se emite nada: error claro antes de decidir nada en Certifex', async () => {
    responder = todoBien();
    // Las solicitudes guardadas.
    fallaConsulta = /FROM certifex_solicitudes/;
    let r = await sa(request.post('/api/certifex/diplomas/aprobar-emitir')).send({ matriculaIds: [ids.conVenta] });
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/no se ha aprobado ni emitido nada/);
    expect(pedidas).toHaveLength(0);
    // La busqueda de ventas y catalogo.
    fallaConsulta = /FROM conversions/;
    r = await sa(request.post('/api/certifex/diplomas/aprobar-emitir')).send({ matriculaIds: [ids.conVenta] });
    expect(r.status).toBe(503);
    expect(r.body.error).toMatch(/programa de la formación/);
    // Solo se ha leído (el DNI, de Certifex): nada decidido ni emitido.
    expect(pedidas.map((p) => p.ruta)).toEqual(['/candidatos']);
    // Lo mismo al reintentar «Emitir» y desde la pestaña antigua de Emisiones.
    r = await sa(request.post('/api/certifex/diplomas/emitir')).send({ matriculaIds: [ids.conVenta] });
    expect(r.status).toBe(503);
    r = await sa(request.post('/api/certifex/emisiones/emitir')).send({ matriculaIds: [ids.conVenta] });
    expect(r.status).toBe(503);
    expect(pedidas.some((p) => p.ruta === '/emitir' || p.ruta === '/decisiones')).toBe(false);
    // El listado (modo laxo) sigue saliendo, sin programa y con el motivo.
    responder = () => ({ status: 200, body: { total: 1, pagina: 1, tam: 50, filas: [
      candidato(ids.conVenta, '2026-10-08T10:00:00Z', { centro: 'ZPRUEBA', titular: { nombre: 'X', email: correo, dni: null }, curso: { ref: 1, nombre: 'Programa IA Experto' } }),
    ] } });
    const l = await sa(request.get('/api/certifex/diplomas/solicitudes'));
    expect(l.status).toBe(200);
    expect(l.body.data.filas[0].programaCrm).toMatchObject({ programa: null, motivo: 'No se pudo consultar el CRM.' });
  });

  it('revisada a mano y sin programa: esa matricula no se aprueba ni se emite (emitir_bloqueado); las demas, si', async () => {
    const bloqueada = base + 54;
    // Un correo del CRM revisado a mano que no tiene ninguna venta.
    await pool.query(
      `INSERT INTO certifex_solicitudes (matricula_id, centro, curso_nombre, email, email_crm, editado_por, editado_en, solicitada_en)
       VALUES ($1, 'ZPRUEBA', 'Programa IA Experto', $2, $3, 'manuel@empresa.com', NOW(), NOW())`, [bloqueada, otro, `nadie.${sufijo}@prueba.test`]);
    try {
      responder = todoBien();
      const r = await sa(request.post('/api/certifex/diplomas/aprobar-emitir')).send({ matriculaIds: [bloqueada, ids.conVenta] });
      expect(r.status).toBe(200);
      const [b, ok] = r.body.data.resultados;
      expect(b).toMatchObject({ matriculaId: bloqueada, ok: false, fase: 'emitir_bloqueado' });
      expect(b.error).toMatch(/revisados a mano/);
      expect(ok).toMatchObject({ matriculaId: ids.conVenta, ok: true, programa: { horas: 1500 } });
      const dec = pedidas.find((p) => p.ruta === '/decisiones');
      expect(dec.cuerpo.decisiones.map((d) => d.matriculaId)).toEqual([ids.conVenta]);
      expect(pedidas.find((p) => p.ruta === '/emitir').cuerpo.items.map((i) => i.matriculaId)).toEqual([ids.conVenta]);

      // Un programa escrito a mano que ya no vale tampoco cae en silencio a lo automatico.
      await pool.query(`UPDATE certifex_solicitudes SET email_crm = NULL, programa_editado = '{"horas": 9000, "modulos": []}' WHERE matricula_id = $1`, [bloqueada]);
      pedidas = [];
      const e = await sa(request.post('/api/certifex/diplomas/emitir')).send({ matriculaIds: [bloqueada] });
      expect(e.body.data.resultados[0]).toMatchObject({ ok: false, fase: 'emitir_bloqueado' });
      expect(e.body.data.resultados[0].error).toMatch(/límites de Certifex/);
      expect(pedidas.some((p) => p.ruta === '/emitir')).toBe(false);
    } finally {
      await pool.query('DELETE FROM certifex_solicitudes WHERE matricula_id = $1', [bloqueada]);
    }
  });

  it('si el CRM solo tiene lo revisado (fila sin campus) y se completa con Certifex, lo revisado no se pierde', async () => {
    const aMedias = base + 55;
    // Solo el correo del CRM revisado (el que tiene la venta); el de Moodle no tiene venta.
    await pool.query(`INSERT INTO certifex_solicitudes (matricula_id, email_crm, editado_por, editado_en) VALUES ($1, $2, 'manuel@empresa.com', NOW())`, [aMedias, correo]);
    try {
      responder = (p) => (p.ruta === '/candidatos'
        ? { status: 200, body: { total: 1, pagina: 1, tam: 200, filas: [
          candidato(aMedias, '2026-10-08T10:00:00Z', { centro: 'ZPRUEBA', titular: { nombre: 'X', email: otro, dni: DNI }, curso: { ref: 1, nombre: 'Programa IA Experto' } }),
        ] } }
        : todoBien()(p));
      const r = await sa(request.post('/api/certifex/diplomas/emitir')).send({ matriculaIds: [aMedias] });
      expect(r.status).toBe(200);
      expect(pedidas.find((p) => p.ruta === '/emitir').cuerpo.items[0]).toMatchObject({ matriculaId: aMedias, programa: { horas: 1500 } });
    } finally {
      await pool.query('DELETE FROM certifex_solicitudes WHERE matricula_id = $1', [aMedias]);
    }
  });

  // ── El DNI es obligatorio (Diego, 20/10/2026) ──────────────────────────────────

  it('sin DNI ni se aprueba ni se emite; con DNI, sí; en un lote mezclado, solo lo que lo tiene', async () => {
    const [conV, sinV, doble] = enCertifex();
    sinV.titular.dni = null;
    doble.titular.dni = '   ';
    responder = (p) => (p.ruta === '/candidatos' ? listaCertifex([conV, sinV, doble]) : todoBien()(p));
    const r = await sa(request.post('/api/certifex/diplomas/aprobar-emitir')).send({ matriculaIds: [ids.conVenta, ids.sinVenta, ids.doble] });
    expect(r.status).toBe(200);
    expect(pedidas.map((p) => p.ruta)).toEqual(['/candidatos', '/decisiones', '/emitir']);
    expect(pedidas[1].cuerpo.decisiones.map((d) => d.matriculaId)).toEqual([ids.conVenta]);
    expect(pedidas[2].cuerpo.items.map((i) => i.matriculaId)).toEqual([ids.conVenta]);
    const [a, b, c] = r.body.data.resultados;
    expect(a).toMatchObject({ matriculaId: ids.conVenta, ok: true, fase: 'emitir' });
    for (const x of [b, c]) {
      expect(x).toMatchObject({ ok: false, fase: 'emitir_bloqueado', codigo: 'FALTA_DNI' });
      expect(x.error).toMatch(/falta el DNI \(o NIE o pasaporte\) del alumno, que es obligatorio en el diploma/);
    }

    // Todas sin DNI: ni una llamada a /decisiones ni a /emitir.
    pedidas = [];
    responder = (p) => (p.ruta === '/candidatos' ? listaCertifex(enCertifex(null)) : todoBien()(p));
    const s = await sa(request.post('/api/certifex/diplomas/aprobar-emitir')).send({ matriculaIds: [ids.conVenta, ids.sinVenta] });
    expect(s.body.data.resultados.every((x) => x.fase === 'emitir_bloqueado' && x.codigo === 'FALTA_DNI')).toBe(true);
    // Y lo mismo al reintentar «Emitir» y desde la pestaña antigua de Emisiones.
    const e = await sa(request.post('/api/certifex/diplomas/emitir')).send({ matriculaIds: [ids.conVenta] });
    expect(e.body.data.resultados[0]).toMatchObject({ ok: false, fase: 'emitir_bloqueado', codigo: 'FALTA_DNI' });
    const v = await sa(request.post('/api/certifex/emisiones/emitir')).send({ matriculaIds: [ids.conVenta] });
    expect(v.body.data.resultados[0]).toMatchObject({ ok: false, fase: 'emitir_bloqueado', codigo: 'FALTA_DNI' });
    expect(pedidas.some((p) => p.ruta === '/decisiones' || p.ruta === '/emitir')).toBe(false);
  });

  it('si Certifex no contesta al pedir el DNI: 503 claro y nada aprobado ni emitido', async () => {
    for (const caido of [
      () => { throw new Error('red caída (simulado)'); },
      () => ({ status: 500, body: { error: 'Certifex se ha caído' } }),
    ]) {
      responder = (p) => (p.ruta === '/candidatos' ? caido() : todoBien()(p));
      pedidas = [];
      for (const ruta of ['/api/certifex/diplomas/aprobar-emitir', '/api/certifex/diplomas/emitir', '/api/certifex/emisiones/emitir']) {
        const r = await sa(request.post(ruta)).send({ matriculaIds: [ids.conVenta] });
        expect(r.status, ruta).toBe(503);
        expect(r.body.code).toBe('CERTIFEX_NO_CONTESTA');
        expect(r.body.error).toMatch(/No se ha podido comprobar en Certifex el DNI .*no se ha aprobado ni emitido nada/);
      }
      expect(pedidas.some((p) => p.ruta === '/decisiones' || p.ruta === '/emitir')).toBe(false);
    }
  });

  it('«Nuevo diploma»: el DNI es obligatorio, y va a Certifex en cuanto existe la matrícula', async () => {
    const nuevo = (cuerpo) => sa(request.post('/api/certifex/diplomas/nuevo')).send({ centro: 'zprueba', leadId: leads[0], productoId: productos[0], ...cuerpo });
    for (const dni of [undefined, '', '   ']) {
      const r = await nuevo(dni === undefined ? {} : { dni });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('Falta el DNI (o NIE o pasaporte) del alumno: es obligatorio en el diploma.');
    }
    expect(pedidas).toHaveLength(0);

    responder = (p) => {
      if (p.ruta === '/matriculas') return { status: 200, body: { matriculaId: base + 60, cursoRef: 900000000 + productos[0], yaExistia: false, vinculadaMoodle: false } };
      if (p.ruta === '/solicitudes/dni') return { status: 200, body: { dni: p.cuerpo.dni } };
      return { status: 200, body: {} };
    };
    const r = await nuevo({ dni: ' 12345678z ', editadoPor: 'otra@persona.test' });
    expect(r.status).toBe(200);
    expect(pedidas.map((p) => p.ruta)).toEqual(['/matriculas', '/solicitudes/dni']);
    expect(pedidas[1].cuerpo).toEqual({ matriculaId: base + 60, dni: '12345678Z', editadoPor: pedidas[0].cuerpo.creadoPor });
    expect(r.body.data).toMatchObject({ matriculaId: base + 60, dni: '12345678Z', avisoDni: null });

    // Si Certifex no lo acepta, la solicitud ya está creada: se dice por qué, sin DNI.
    pedidas = [];
    responder = (p) => {
      if (p.ruta === '/matriculas') return { status: 200, body: { matriculaId: base + 61, cursoRef: 900000000 + productos[0], yaExistia: false, vinculadaMoodle: false } };
      if (p.ruta === '/solicitudes/dni') return { status: 409, body: { error: 'Ese DNI ya figura en otra ficha de alumno de Certifex.' } };
      return { status: 200, body: {} };
    };
    const c = await nuevo({ dni: '12345678Z' });
    expect(c.status).toBe(200);
    expect(c.body.data.dni).toBeNull();
    expect(c.body.data.avisoDni).toMatch(/se ha creado, pero Certifex no ha guardado su DNI: Ese DNI ya figura en otra ficha de alumno de Certifex\. Ponlo con «Sin DNI · Poner»/);
  });

  it('con yaExistia (doble clic) no se dice que se mando un programa', async () => {
    responder = todoBien({ yaExistia: true });
    const r = await sa(request.post('/api/certifex/diplomas/emitir')).send({ matriculaIds: [ids.conVenta] });
    expect(r.body.data.resultados[0]).toMatchObject({ ok: true, yaExistia: true });
    expect(r.body.data.resultados[0].programa).toBeUndefined();
    expect(r.body.data.resultados[0].sinPrograma).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────── revisar antes de aprobar

describe('editar: revisar los datos con los que se trabaja antes de aprobar', () => {
  const sufijo = `${Date.now()}`.slice(-6);
  const moodle = `moodle.${sufijo}@prueba.test`;
  const enCrm = `encrm.${sufijo}@prueba.test`;
  const id = base + 70;
  let proyecto;
  let otroProyecto;
  let productos = [];
  let ajeno;
  let leads = [];

  // Un campus «ZREVISA» que se casa con el proyecto «Zrevisa Academia».
  const fila = (extra = {}) => candidato(id, '2026-10-08T10:00:00Z', {
    centro: 'ZREVISA', titular: { nombre: 'Sofía Prueba Blanco', email: moodle, dni: null },
    curso: { ref: 9201, nombre: 'Formación Vendida A' },
    solicitud: { en: '2026-10-08T10:00:00Z', nombre: 'Sofía Prueba Blanco', nombreAlumno: 'Sofía Prueba Blanco', revisado: null },
    ...extra,
  });
  const conCandidato = (extra = {}, otras = {}) => (p) => {
    if (p.ruta === '/candidatos') return { status: 200, body: { filas: [fila(extra)], total: 1, pagina: 1, tam: 200 } };
    if (otras[p.ruta]) return otras[p.ruta](p);
    return { status: 200, body: {} };
  };
  const editar = (cuerpo) => sa(request.post('/api/certifex/diplomas/editar')).send(cuerpo);
  const filaCrm = async () => (await pool.query('SELECT * FROM certifex_solicitudes WHERE matricula_id = $1', [id])).rows[0];

  beforeAll(async () => {
    ({ rows: [proyecto] } = await pool.query(
      `INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ('Zrevisa Academia', $1, 'whk_test') RETURNING id`, [`zrevisa-academia-${sufijo}`]));
    ({ rows: [otroProyecto] } = await pool.query(
      `INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ('Zotro Campus', $1, 'whk_test') RETURNING id`, [`zotro-campus-${sufijo}`]));
    const prod = async (proj, nombre, horas) => (await pool.query(
      `INSERT INTO products (project_id, nombre, horas, num_modulos) VALUES ($1, $2, $3, 1) RETURNING id`, [proj, nombre, horas])).rows[0].id;
    const pA = await prod(proyecto.id, 'Formación Vendida A', '300 horas');
    const pB = await prod(proyecto.id, 'Otra Formación B', '120 h');
    ajeno = await prod(otroProyecto.id, 'De otro campus', '50 h');
    productos = [pA, pB, ajeno];
    await pool.query(`INSERT INTO product_modules (product_id, orden, titulo, horas) VALUES ($1, 1, 'Módulo A1', 300)`, [pA]);
    await pool.query(`INSERT INTO product_modules (product_id, orden, titulo, horas) VALUES ($1, 1, 'Módulo B1', 120)`, [pB]);
    // El alumno compro con OTRO correo que el de Moodle: solo se le encuentra revisandolo.
    const { rows: [l] } = await pool.query(
      `INSERT INTO leads (project_id, nombre, email) VALUES ($1, 'Alumna revisada', $2) RETURNING id`, [proyecto.id, enCrm]);
    leads = [l.id];
    await pool.query(
      `INSERT INTO conversions (lead_id, project_id, producto_contratado, producto_contratado_id, importe_total, importe_pagado)
       VALUES ($1, $2, 'x', $3, 900, 300)`, [l.id, proyecto.id, pA]);
  });
  afterAll(async () => {
    await pool.query('DELETE FROM certifex_solicitudes WHERE matricula_id = $1', [id]);
    await pool.query('DELETE FROM conversions WHERE lead_id = ANY($1::int[])', [leads]);
    await pool.query('DELETE FROM leads WHERE id = ANY($1::int[])', [leads]);
    await pool.query('DELETE FROM product_modules WHERE product_id = ANY($1::int[])', [productos]);
    await pool.query('DELETE FROM products WHERE id = ANY($1::int[])', [productos]);
    await pool.query('DELETE FROM projects WHERE id = ANY($1::int[])', [[proyecto.id, otroProyecto.id]]);
  });

  it('sin revisar, con el correo de Moodle no hay venta: sin programa', async () => {
    responder = () => ({ status: 200, body: { filas: [fila()], total: 1, pagina: 1, tam: 50 } });
    const r = await sa(request.get('/api/certifex/diplomas/solicitudes'));
    const c = r.body.data.filas[0];
    expect(c.edicion).toBeNull();
    expect(c.crm).toBeNull();
    expect(c.programaCrm).toMatchObject({ programa: null, editado: false });
    expect(c.programaCrm.motivo).toMatch(/No tiene ninguna venta en Zrevisa Academia/);
  });

  it('el correo del CRM revisado: se crea la fila (no habia webhook) y se cruza por ese correo', async () => {
    expect(await filaCrm()).toBeUndefined();
    responder = conCandidato();
    const r = await editar({ matriculaId: id, emailCrm: enCrm.toUpperCase() });
    expect(r.status).toBe(200);
    expect(r.body.data.edicion).toMatchObject({ emailCrm: enCrm, productoId: null, programaEditado: null, por: saUser.email });
    // Pagado/Debe y la formacion vendida salen del correo revisado.
    expect(r.body.data.crm).toMatchObject({ ventas: 1, vendido: 900, cobrado: 300, pendiente: 600 });
    expect(r.body.data.programaCrm).toMatchObject({ programa: { horas: 300, modulos: [{ titulo: 'Módulo A1', horas: 300 }] }, formacion: { nombre: 'Formación Vendida A' }, editado: false, elegida: false });
    // El nombre no se ha tocado: nada a Certifex salvo buscar la matricula.
    expect(pedidas.map((p) => p.ruta)).toEqual(['/candidatos']);
    const s = await filaCrm();
    expect(s).toMatchObject({ centro: 'ZREVISA', curso_nombre: 'Formación Vendida A', email: moodle, email_crm: enCrm, nombre_diploma: 'Sofía Prueba Blanco', editado_por: saUser.email });
    expect(s.editado_en).not.toBeNull();

    // Y el listado lo trae ya fusionado.
    responder = () => ({ status: 200, body: { filas: [fila()], total: 1, pagina: 1, tam: 50 } });
    const l = await sa(request.get('/api/certifex/diplomas/solicitudes'));
    expect(l.body.data.filas[0].edicion.emailCrm).toBe(enCrm);
    expect(l.body.data.filas[0].programaCrm.programa.horas).toBe(300);
  });

  it('la formacion elegida a mano manda aunque no encaje con el curso, y se ve la automatica', async () => {
    responder = conCandidato();
    const r = await editar({ matriculaId: id, productoId: productos[1] });
    expect(r.status).toBe(200);
    const p = r.body.data.programaCrm;
    expect(p).toMatchObject({ programa: { horas: 120, modulos: [{ titulo: 'Módulo B1', horas: 120 }] }, formacion: { id: productos[1], nombre: 'Otra Formación B' }, elegida: true, editado: false });
    expect(p.auto.programa.horas).toBe(300);
    // Lo anterior (el correo) se queda: solo se toca lo que viene.
    expect(r.body.data.edicion).toMatchObject({ emailCrm: enCrm, productoId: productos[1] });
  });

  it('una formacion de otro campus no se puede elegir', async () => {
    responder = conCandidato();
    const r = await editar({ matriculaId: id, productoId: ajeno });
    expect(r.status).toBe(400);
    expect((await filaCrm()).producto_id).toBe(productos[1]);
  });

  it('el programa editado manda sobre todo, y es lo que se manda al aprobar y emitir', async () => {
    const programa = { horas: 1200, modulos: [{ titulo: '  Fundamentos   clínicos ', horas: 400 }, { titulo: 'Práctica', horas: 800 }, { titulo: 'Trabajo final' }] };
    responder = conCandidato();
    const r = await editar({ matriculaId: id, programa });
    expect(r.status).toBe(200);
    const limpio = { horas: 1200, modulos: [{ titulo: 'Fundamentos clínicos', horas: 400 }, { titulo: 'Práctica', horas: 800 }, { titulo: 'Trabajo final' }] };
    expect(r.body.data.programaCrm).toMatchObject({ programa: limpio, editado: true, elegida: true, formacion: { nombre: 'Otra Formación B' } });
    expect((await filaCrm()).programa_editado).toEqual({ horas: 1200, modulos: [{ titulo: 'Fundamentos clínicos', horas: 400 }, { titulo: 'Práctica', horas: 800 }, { titulo: 'Trabajo final' }] });

    responder = (p) => {
      if (p.ruta === '/decisiones') return { status: 200, body: { resultados: p.cuerpo.decisiones.map((d) => ({ matriculaId: d.matriculaId, ok: true })) } };
      if (p.ruta === '/emitir') return { status: 200, body: { resultados: p.cuerpo.items.map((i) => ({ matriculaId: i.matriculaId, ok: true, nexpediente: 'CTF-2026-000070-AAAA' })) } };
      return { status: 200, body: { filas: [fila({ titular: { nombre: 'Sofía Prueba Blanco', email: moodle, dni: DNI } })], total: 1, pagina: 1, tam: 200 } };
    };
    pedidas = [];
    const e = await sa(request.post('/api/certifex/diplomas/aprobar-emitir')).send({ matriculaIds: [id] });
    expect(e.status).toBe(200);
    // La fila del CRM ya existe: de Certifex solo hace falta el DNI; el programa es el editado.
    expect(pedidas.map((p) => p.ruta)).toEqual(['/candidatos', '/decisiones', '/emitir']);
    expect(pedidas[2].cuerpo.items).toEqual([{ matriculaId: id, programa: limpio }]);
    expect(e.body.data.resultados[0].programa).toEqual({ horas: 1200, modulos: 3, formacion: 'Otra Formación B', editado: true });
  });

  it('null quita cada edicion: vuelve a la formacion elegida y luego a la automatica', async () => {
    responder = conCandidato();
    let r = await editar({ matriculaId: id, programa: null });
    expect(r.body.data.programaCrm).toMatchObject({ programa: { horas: 120 }, editado: false, elegida: true });
    r = await editar({ matriculaId: id, productoId: null, emailCrm: '' });
    expect(r.status).toBe(200);
    expect(r.body.data.edicion).toBeNull();
    expect(r.body.data.programaCrm).toMatchObject({ programa: null, elegida: false });
    const s = await filaCrm();
    expect(s).toMatchObject({ email_crm: null, producto_id: null, programa_editado: null });
  });

  it('un programa fuera de los limites de Certifex no se guarda ni llega a Certifex', async () => {
    for (const programa of [
      { horas: 6000, modulos: [] },
      { horas: 10.5, modulos: [] },
      { modulos: [] },
      { horas: 100, modulos: [{ titulo: '', horas: 1 }] },
      { horas: 100, modulos: [{ titulo: 'x', horas: 2001 }] },
      { horas: 100, modulos: Array.from({ length: 101 }, (_, i) => ({ titulo: `M${i}` })) },
    ]) {
      expect((await editar({ matriculaId: id, programa })).status).toBe(400);
    }
    expect((await editar({ matriculaId: id })).status).toBe(400);
    expect((await editar({ matriculaId: id, emailCrm: 'no-es-correo' })).status).toBe(400);
    expect(pedidas).toHaveLength(0);
  });

  it('con el diploma ya emitido: 409 «usa Corregir», y no se toca nada', async () => {
    responder = conCandidato({ nexpediente: 'CTF-2026-000070-AAAA' });
    const r = await editar({ matriculaId: id, nombre: 'Sofía Prueba Blanco Ruiz', programa: { horas: 10, modulos: [] } });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Corregir/);
    expect(pedidas.map((p) => p.ruta)).toEqual(['/candidatos']);
    expect((await filaCrm()).programa_editado).toBeNull();
  });

  it('una matricula que Certifex no tiene: 404', async () => {
    responder = () => ({ status: 200, body: { filas: [], total: 0, pagina: 1, tam: 200 } });
    expect((await editar({ matriculaId: id + 1, emailCrm: enCrm })).status).toBe(404);
  });

  it('el nombre no se guarda en el CRM: se manda a Certifex a nombre del usuario con sesion', async () => {
    const revisado = { por: 'manuel@empresa.com (CRM local)', en: '2026-10-08T12:00:00Z' };
    responder = conCandidato({}, {
      '/solicitudes/nombre': (p) => ({ status: 200, body: { matriculaId: p.cuerpo.matriculaId, nombre: p.cuerpo.nombre, nombreAlumno: 'Sofía Prueba Blanco', revisado } }),
    });
    const antes = await filaCrm();
    const r = await editar({ matriculaId: id, nombre: '  Sofía   Prueba Blanco de la Vega ', editadoPor: 'otra@persona.test' });
    expect(r.status).toBe(200);
    const n = pedidas.find((p) => p.ruta === '/solicitudes/nombre');
    expect(n.metodo).toBe('POST');
    expect(n.cuerpo).toEqual({ matriculaId: id, nombre: 'Sofía Prueba Blanco de la Vega', editadoPor: saUser.email });
    expect(r.body.data.solicitud).toMatchObject({ nombre: 'Sofía Prueba Blanco de la Vega', nombreAlumno: 'Sofía Prueba Blanco', revisado });
    // Solo el nombre: la fila del CRM no cambia.
    expect((await filaCrm()).updated_at).toEqual(antes.updated_at);
  });

  it('un nombre que Certifex no aceptaria no sale del CRM (misma regla), y no se guarda lo demas', async () => {
    responder = conCandidato();
    const r = await editar({ matriculaId: id, nombre: 'Sofía 123', emailCrm: enCrm });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('Escribe el nombre completo (nombre y apellidos), de 3 a 160 caracteres, solo con letras.');
    expect(pedidas).toHaveLength(0);
    expect((await filaCrm()).email_crm).toBeNull();
  });

  it('si Certifex no acepta el nombre (409: el alumno no lo ha pedido), su error llega tal cual', async () => {
    responder = conCandidato({}, {
      '/solicitudes/nombre': () => ({ status: 409, body: { error: 'El alumno no ha pedido el diploma: no hay nombre que revisar.' } }),
    });
    const r = await editar({ matriculaId: id, nombre: 'Sofía Prueba Blanco', emailCrm: enCrm });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('El alumno no ha pedido el diploma: no hay nombre que revisar.');
    expect((await filaCrm()).email_crm).toBeNull();
  });

  it('formaciones: el catalogo del proyecto de ese campus, con horas y modulos', async () => {
    const r = await sa(request.get('/api/certifex/diplomas/formaciones?centro=zrevisa'));
    expect(r.status).toBe(200);
    expect(r.body.data.proyecto).toMatchObject({ id: proyecto.id, nombre: 'Zrevisa Academia' });
    expect(r.body.data.formaciones).toEqual([
      { id: productos[0], nombre: 'Formación Vendida A', activa: true, horas: 300, numModulos: 1, modulos: [{ titulo: 'Módulo A1', horas: 300 }] },
      { id: productos[1], nombre: 'Otra Formación B', activa: true, horas: 120, numModulos: 1, modulos: [{ titulo: 'Módulo B1', horas: 120 }] },
    ]);
    const no = await sa(request.get('/api/certifex/diplomas/formaciones?centro=NOEXISTE'));
    expect(no.body.data).toMatchObject({ proyecto: null, formaciones: [] });
    expect(no.body.data.motivo).toMatch(/Ningún proyecto del CRM corresponde al campus NOEXISTE/);
    expect((await sa(request.get('/api/certifex/diplomas/formaciones?centro=../x'))).status).toBe(400);
    expect(pedidas).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────── campus de cada admin

describe('cada admin, solo sus campus', () => {
  const sufijo = `${Date.now()}`.slice(-6);
  let usuario;
  let adminToken;
  const proyectos = [];
  const mio = base + 90;
  const ajena = base + 91;
  const mioB = base + 92;
  const NEXP_MIO = 'CTF-2026-000090-AAAA';
  const NEXP_AJENO = 'CTF-2026-000091-AAAA';
  const admin = (req) => req.set('Authorization', `Bearer ${adminToken}`);

  // Certifex conoce tres campus de este CRM; la persona tiene los dos primeros.
  const fila = (id, centro) => candidato(id, '2026-10-08T10:00:00Z', { centro, curso: { ref: 1, nombre: 'Curso' } });
  const certifexConTres = (otras = {}) => (p) => {
    if (p.ruta === '/yo') return { status: 200, body: { nombre: 'CRM local', centros: ['ZCAMPUSA', 'ZCAMPUSB', 'ZAJENO'] } };
    if (p.ruta === '/candidatos') {
      const filas = [fila(mio, 'ZCAMPUSA'), fila(mioB, 'ZCAMPUSB'), fila(ajena, 'ZAJENO')]
        .filter((c) => !p.query.centro || c.centro === p.query.centro);
      return { status: 200, body: { filas, total: filas.length, pagina: 1, tam: 200 } };
    }
    if (p.ruta === '/diplomas') {
      const filas = [diploma(NEXP_MIO, '2026-10-08T10:00:00Z', { centro: 'ZCAMPUSA' }), diploma(NEXP_AJENO, '2026-10-08T10:00:00Z', { centro: 'ZAJENO' })]
        .filter((d) => (!p.query.q || d.nexpediente.includes(p.query.q)) && (!p.query.centro || d.centro === p.query.centro));
      return { status: 200, body: { filas, total: filas.length, pagina: 1, tam: 200 } };
    }
    if (otras[p.ruta]) return otras[p.ruta](p);
    return { status: 200, body: { resultados: [], ok: true } };
  };

  beforeAll(async () => {
    for (const [nombre, slug] of [['Zcampusa Uno', `zcampusa-${sufijo}`], ['Zcampusb Dos', `zcampusb-${sufijo}`], ['Zajeno Tres', `zajeno-${sufijo}`]]) {
      proyectos.push((await pool.query(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, 'whk_test') RETURNING id`, [nombre, slug])).rows[0].id);
    }
    ({ rows: [usuario] } = await pool.query(
      `INSERT INTO users (nombre, email, password_hash, role) VALUES ('Admin de campus', $1, 'x', 'admin') RETURNING id, email`, [`admin.campus.${sufijo}@prueba.test`]));
    await pool.query(`INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2), ($1, $3)`, [usuario.id, proyectos[0], proyectos[1]]);
    // Un proyecto que la persona tuvo y ya no: no cuenta.
    await pool.query(`INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, false)`, [usuario.id, proyectos[2]]);
    const { default: jwt } = await import('jsonwebtoken');
    adminToken = jwt.sign({ userId: usuario.id, email: usuario.email, role: 'admin', roles_extra: [] }, process.env.JWT_SECRET, { expiresIn: '5m' });
    for (const [id, centro] of [[mio, 'ZCAMPUSA'], [ajena, 'ZAJENO'], [mioB, 'ZCAMPUSB']]) {
      await pool.query(`INSERT INTO certifex_solicitudes (matricula_id, centro, curso_nombre, solicitada_en) VALUES ($1, $2, 'Curso', NOW())`, [id, centro]);
    }
  });
  afterAll(async () => {
    await pool.query('DELETE FROM certifex_solicitudes WHERE matricula_id = ANY($1::bigint[])', [[mio, ajena, mioB]]);
    await pool.query('DELETE FROM user_projects WHERE user_id = $1', [usuario.id]);
    await pool.query('DELETE FROM users WHERE id = $1', [usuario.id]);
    await pool.query('DELETE FROM projects WHERE id = ANY($1::int[])', [proyectos]);
  });

  it('los listados solo traen sus campus; un campus ajeno sale vacio sin preguntar a Certifex', async () => {
    responder = certifexConTres();
    const r = await admin(request.get('/api/certifex/diplomas/solicitudes'));
    expect(r.status).toBe(200);
    expect(r.body.data.filas.map((c) => c.matriculaId).sort()).toEqual([mio, mioB].sort());
    expect(r.body.data.total).toBe(2);

    pedidas = [];
    const ajeno = await admin(request.get('/api/certifex/diplomas/solicitudes?centro=zajeno'));
    expect(ajeno.status).toBe(200);
    expect(ajeno.body.data).toMatchObject({ filas: [], total: 0 });
    expect(pedidas.some((p) => p.ruta === '/candidatos')).toBe(false);

    const uno = await admin(request.get('/api/certifex/diplomas/solicitudes?centro=ZCAMPUSA'));
    expect(uno.body.data.filas.map((c) => c.matriculaId)).toEqual([mio]);

    const d = await admin(request.get('/api/certifex/diplomas'));
    expect(d.body.data.filas.map((x) => x.nexpediente)).toEqual([NEXP_MIO]);

    const res = await admin(request.get('/api/certifex/diplomas/resumen?centro=ZAJENO'));
    expect(res.body.data).toMatchObject({ pendientes: 0, vigentes: 0, porEnviar: 0 });

    // Emisiones: los campus y el estado tambien vienen recortados.
    responder = certifexConTres({ '/centros': () => ({ status: 200, body: [{ codigo: 'ZCAMPUSA' }, { codigo: 'ZCAMPUSB' }, { codigo: 'ZAJENO' }] }) });
    const c = await admin(request.get('/api/certifex/emisiones/centros'));
    expect(c.body.data.map((x) => x.codigo)).toEqual(['ZCAMPUSA', 'ZCAMPUSB']);
    const e = await admin(request.get('/api/certifex/emisiones/estado'));
    expect(e.body.data.centros).toEqual(['ZCAMPUSA', 'ZCAMPUSB']);
    const l = await admin(request.get('/api/certifex/emisiones'));
    expect(l.body.data.filas.map((x) => x.matriculaId).sort()).toEqual([mio, mioB].sort());
    expect((await admin(request.get('/api/certifex/emisiones/cursos?centro=ZAJENO'))).status).toBe(404);
  });

  it('las acciones sobre lo ajeno: 404 como «no encontrado», y nada llega a Certifex', async () => {
    responder = certifexConTres();
    const acciones = [
      admin(request.post('/api/certifex/diplomas/aprobar-emitir')).send({ matriculaIds: [ajena] }),
      admin(request.post('/api/certifex/diplomas/emitir')).send({ matriculaIds: [mio, ajena] }),
      admin(request.post('/api/certifex/diplomas/rechazar')).send({ matriculaIds: [ajena], motivo: 'No ha pagado' }),
      admin(request.post('/api/certifex/diplomas/avisos-rechazo')).send({ matriculaIds: [ajena] }),
      admin(request.post('/api/certifex/diplomas/avisos')).send({ nexpedientes: [NEXP_AJENO] }),
      admin(request.post('/api/certifex/diplomas/revocar')).send({ nexpediente: NEXP_AJENO, motivo: 'Por error' }),
      admin(request.post('/api/certifex/diplomas/corregir')).send({ nexpediente: NEXP_AJENO, valor: 'Ana Gil', motivo: 'Errata' }),
      admin(request.post('/api/certifex/diplomas/editar')).send({ matriculaId: ajena, emailCrm: 'x@prueba.test' }),
      admin(request.get('/api/certifex/diplomas/formaciones?centro=ZAJENO')),
      admin(request.get(`/api/certifex/emisiones/diploma/${NEXP_AJENO}`)),
      admin(request.post('/api/certifex/emisiones/decisiones')).send({ items: [{ matriculaId: ajena, decision: 'aprobada' }] }),
      admin(request.post('/api/certifex/emisiones/emitir')).send({ matriculaIds: [ajena] }),
    ];
    for (const r of await Promise.all(acciones)) {
      expect(r.status).toBe(404);
      expect(r.body.error).toMatch(/no encontrad|no esta en Certifex/i);
    }
    const prohibidas = ['/decisiones', '/emitir', '/avisos', '/avisos-rechazo', '/revocar', '/corregir', '/solicitudes/nombre'];
    expect(pedidas.some((p) => prohibidas.includes(p.ruta))).toBe(false);
  });

  it('sobre lo suyo, si', async () => {
    responder = certifexConTres({
      '/decisiones': (p) => ({ status: 200, body: { resultados: p.cuerpo.decisiones.map((d) => ({ matriculaId: d.matriculaId, ok: true })) } }),
      '/revocar': () => ({ status: 200, body: { ok: true } }),
    });
    const r = await admin(request.post('/api/certifex/diplomas/rechazar')).send({ matriculaIds: [mio, mioB], motivo: 'No ha pagado' });
    expect(r.status).toBe(200);
    expect(pedidas.find((p) => p.ruta === '/decisiones').cuerpo.decisiones.map((d) => d.decididoPor)).toEqual([usuario.email, usuario.email]);
    expect((await admin(request.post('/api/certifex/diplomas/revocar')).send({ nexpediente: NEXP_MIO, motivo: 'Por error' })).status).toBe(200);
  });

  it('sin ningun campus: todo vacio', async () => {
    await pool.query('UPDATE user_projects SET active = false WHERE user_id = $1', [usuario.id]);
    try {
      responder = certifexConTres();
      const r = await admin(request.get('/api/certifex/diplomas/solicitudes'));
      expect(r.body.data.filas).toEqual([]);
      expect((await admin(request.post('/api/certifex/diplomas/rechazar')).send({ matriculaIds: [mio], motivo: 'No ha pagado' })).status).toBe(404);
    } finally {
      await pool.query('UPDATE user_projects SET active = true WHERE user_id = $1 AND project_id = ANY($2::int[])', [usuario.id, [proyectos[0], proyectos[1]]]);
    }
  });
});

// ───────────────────────────────────────────────────────────── terminaron sin pedir

describe('«ha terminado la formacion»: aviso de Certifex y lista', () => {
  const id = base + 120;
  const completado = (extra = {}) => ({
    matriculaId: id,
    centro: 'iseie',
    curso: { ref: 12, nombre: 'Máster en Prueba' },
    alumno: { nombreMoodle: 'Lucía Terminó', email: 'lucia.termino@prueba.test' },
    notaFinal: 8.8,
    completadoEn: '2026-10-09T08:00:00.000Z',
    ...extra,
  });
  const avisar = (cuerpo, secreto = SECRETO) => request.post('/api/certifex/completados').set('X-Certifex-Secreto', secreto).send(cuerpo);

  it('misma puerta que las solicitudes: 404 sin secreto configurado, 401 con otro', async () => {
    delete process.env.CERTIFEX_WEBHOOK_SECRETO;
    try {
      expect((await avisar(completado())).status).toBe(404);
    } finally {
      process.env.CERTIFEX_WEBHOOK_SECRETO = SECRETO;
    }
    expect((await request.post('/api/certifex/completados').send(completado())).status).toBe(401);
    expect((await avisar(completado(), 'otro')).status).toBe(401);
    expect(avisos).toHaveLength(0);
  });

  it('se guarda una vez por matricula y suena la campana de administracion de ese campus', async () => {
    // Los super admin que hay antes Y después del aviso: los demás ficheros crean y borran
    // los suyos a la vez, y uno creado (o borrado) en medio no puede contar (fallaba a
    // ratos en la CI de MultiCRM, 04/11).
    const superAdmins = async () => (await pool.query(`SELECT id FROM users WHERE active AND role = 'superadmin'`)).rows.map((u) => u.id);
    const antes = await superAdmins();
    const r = await avisar(completado());
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ estado: 'nueva', duplicada: false });
    const { rows: [s] } = await pool.query('SELECT * FROM certifex_solicitudes WHERE matricula_id = $1', [id]);
    expect(s).toMatchObject({ centro: 'ISEIE', curso_nombre: 'Máster en Prueba', nombre_moodle: 'Lucía Terminó', email: 'lucia.termino@prueba.test', solicitada_en: null });
    expect(Number(s.completado_nota)).toBe(8.8);
    expect(s.completado_en.toISOString()).toBe('2026-10-09T08:00:00.000Z');
    expect(s.completado_recibido_en).not.toBeNull();
    await vi.waitFor(() => expect(avisos).toHaveLength(1));
    expect(avisos[0]).toMatchObject({ type: 'certifex_completado', link_path: '/matriculas/diplomas?pestana=terminados' });
    expect(avisos[0].title).toContain('Lucía Terminó');
    const despues = new Set(await superAdmins());
    const sas = antes.filter((u) => despues.has(u)).map((id) => ({ id }));
    for (const u of sas) expect(avisos[0].targetUserIds).toContain(u.id);

    // Un reintento de Certifex: ni duplica ni vuelve a avisar.
    avisos.length = 0;
    const otra = await avisar(completado({ notaFinal: 9 }));
    expect(otra.status).toBe(200);
    expect(otra.body.data).toMatchObject({ estado: 'repetida', duplicada: true });
    await new Promise((ok) => setTimeout(ok, 50));
    expect(avisos).toHaveLength(0);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n, max(completado_nota)::float AS nota FROM certifex_solicitudes WHERE matricula_id = $1', [id]);
    expect(rows[0]).toEqual({ n: 1, nota: 8.8 });
  });

  it('si luego pide el diploma, la solicitud entra sobre la misma fila', async () => {
    const r = await entregar(solicitud({ matriculaId: id, alumno: { nombreDiploma: 'Lucía Terminó Gil', email: 'lucia.termino@prueba.test' } }));
    expect([200, 201]).toContain(r.status);
    const { rows: [s] } = await pool.query('SELECT nombre_diploma, veces, completado_recibido_en FROM certifex_solicitudes WHERE matricula_id = $1', [id]);
    expect(s.nombre_diploma).toBe('Lucía Terminó Gil');
    expect(s.veces).toBe(1);
    expect(s.completado_recibido_en).not.toBeNull();
    await vi.waitFor(() => expect(avisos.some((a) => a.type === 'certifex_solicitud')).toBe(true));
    expect(avisos.find((a) => a.type === 'certifex_solicitud').title).toMatch(/lo pide$/);
  });

  it('validacion tolerante: correo vacio, curso larguisimo y nota rara no lo tumban', async () => {
    const r = await avisar(completado({
      matriculaId: id + 1,
      curso: { ref: 1, nombre: 'x'.repeat(400) },
      alumno: { nombreMoodle: null, email: '' },
      notaFinal: 'no-es-nota',
      completadoEn: 'ayer',
    }));
    expect(r.status).toBe(201);
    const { rows: [s] } = await pool.query('SELECT email, curso_nombre, completado_nota, completado_en FROM certifex_solicitudes WHERE matricula_id = $1', [id + 1]);
    expect(s.email).toBeNull();
    expect(s.curso_nombre).toHaveLength(300);
    expect(s.completado_nota).toBeNull();
    expect(s.completado_en).toBeNull();
    // Sin matricula o con un campus raro, no.
    expect((await avisar(completado({ matriculaId: null }))).status).toBe(400);
    expect((await avisar(completado({ matriculaId: id + 2, centro: '../x' }))).status).toBe(400);
  });

  it('la lista pide a Certifex los terminados sin solicitud y trae la fecha del aviso', async () => {
    responder = () => ({ status: 200, body: { filas: [
      candidato(id + 1, null, { solicitud: null, completado: true }),
      candidato(id + 50, null, { solicitud: null, completado: true }),
    ], total: 2, pagina: 1, tam: 50 } });
    const r = await sa(request.get('/api/certifex/diplomas/terminados?centro=iseie&curso=12&q=ana'));
    expect(r.status).toBe(200);
    expect(pedidas[0].ruta).toBe('/candidatos');
    expect(pedidas[0].query).toEqual({ terminados: '1', estado: 'todas', centro: 'ISEIE', curso: '12', q: 'ana', pagina: '1', tam: '50' });
    const [a, b] = r.body.data.filas;
    expect(a.aviso).toMatchObject({ en: null, nota: null });
    expect(a.aviso.recibidoEn).toBeTruthy();
    expect(b.aviso).toBeNull();
    expect(b.crm).toBeNull();
    // Solo administracion.
    expect((await soporte(request.get('/api/certifex/diplomas/terminados'))).status).toBe(403);
    expect((await request.get('/api/certifex/diplomas/terminados')).status).toBe(401);
  });
});
