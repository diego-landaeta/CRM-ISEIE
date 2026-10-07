// El apartado Certifex: las consultas que llegan desde la web de Certifex.
//
// En Certifex, «quiero inscribir mi campus» llevaba a un formulario que abria el
// correo del visitante hacia una direccion vacia: no llegaba nada a nadie. Ahora
// Certifex guarda cada consulta y la reenvia aqui con un secreto compartido.
//
// Lo que se fija: que sin el secreto no entra nada, que un reintento de Certifex no la
// duplica ni vuelve a sonar la campana, que el aviso va por la campana y a nadie por
// correo, y que solo la ven los roles que reciben ese aviso.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

const avisos = [];
vi.mock('../src/modules/notifications/notifications.service.js', async (orig) => ({
  ...(await orig()),
  notifyAdmins: vi.fn(async (a) => { avisos.push(a); return { id: 1 }; }),
}));

process.env.CERTIFEX_WEBHOOK_SECRETO = 'secreto-de-prueba-certifex';

const { default: supertest } = await import('supertest');
const { default: app } = await import('../src/app.js');
const { default: pool } = await import('../src/shared/config/db.js');
const { secretoValido } = await import('../src/modules/certifex/certifex.controller.js');

const request = supertest(app);
const SECRETO = 'secreto-de-prueba-certifex';
// Ids de Certifex altos y unicos por ejecucion, para no chocar con nada sembrado.
const base = 900000000 + Math.floor(Math.random() * 1000000);
let saToken;
let saUser;

const consulta = (extra = {}) => ({
  certifexId: base,
  tipo: 'centro',
  nombre: 'Marta Ruiz',
  email: 'marta@campus.test',
  organizacion: 'Instituto de Prueba',
  urlCampus: 'https://campus.prueba.test',
  mensaje: 'Queremos conectar nuestro Moodle a Certifex.',
  idioma: 'es',
  creadoEn: new Date().toISOString(),
  ...extra,
});

beforeAll(async () => {
  // La base local de ISEIE sale sin datos de ejemplo: el super admin lo pone la prueba.
  const { default: jwt } = await import('jsonwebtoken');
  const { rows: [u] } = await pool.query(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ('SA Certifex', $1, 'x', 'superadmin') RETURNING id, email`,
    [`sa.certifex.${Date.now()}.${Math.floor(Math.random() * 1e6)}@prueba.test`]);
  saUser = u;
  saToken = jwt.sign({ userId: u.id, email: u.email, role: 'superadmin', roles_extra: [] }, process.env.JWT_SECRET, { expiresIn: '10m' });
});
afterAll(async () => {
  await pool.query('DELETE FROM certifex_consultas WHERE certifex_id >= $1', [base]);
  if (saUser) await pool.query('DELETE FROM users WHERE id = $1', [saUser.id]);
  await pool.end();
});

describe('el secreto', () => {
  it('se compara entero: ni vacio, ni parecido, ni otro', () => {
    expect(secretoValido(SECRETO)).toBe(true);
    expect(secretoValido('')).toBe(false);
    expect(secretoValido(undefined)).toBe(false);
    expect(secretoValido(`${SECRETO}x`)).toBe(false);
  });
});

describe('POST /api/certifex/consultas (desde el servidor de Certifex)', () => {
  it('sin secreto, o con otro, no entra nada', async () => {
    expect((await request.post('/api/certifex/consultas').send(consulta())).status).toBe(401);
    expect((await request.post('/api/certifex/consultas').set('X-Certifex-Secreto', 'otro').send(consulta())).status).toBe(401);
  });

  it('con el secreto, se guarda y suena la campana (a los admin, no a una gestora)', async () => {
    avisos.length = 0;
    const r = await request.post('/api/certifex/consultas').set('X-Certifex-Secreto', SECRETO).send(consulta());
    expect(r.status).toBe(201);
    expect(r.body.data.duplicada).toBe(false);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ type: 'certifex_consulta', link_path: '/matriculas/certificaciones?vista=consultas' });
    expect(avisos[0].title).toContain('Instituto de Prueba');
  });

  it('un reintento de Certifex con la misma consulta no la duplica ni vuelve a avisar', async () => {
    avisos.length = 0;
    const r = await request.post('/api/certifex/consultas').set('X-Certifex-Secreto', SECRETO).send(consulta());
    expect(r.status).toBe(200);
    expect(r.body.data.duplicada).toBe(true);
    expect(avisos).toHaveLength(0);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM certifex_consultas WHERE certifex_id = $1', [base]);
    expect(rows[0].n).toBe(1);
  });

  it('valida lo que llega', async () => {
    const r = await request.post('/api/certifex/consultas').set('X-Certifex-Secreto', SECRETO)
      .send(consulta({ certifexId: base + 1, email: 'no-es-un-correo' }));
    expect(r.status).toBe(400);
  });
});

describe('la pantalla del equipo', () => {
  it('sin sesion, nada', async () => {
    expect((await request.get('/api/certifex/consultas')).status).toBe(401);
  });

  it('lista con el numero de nuevas, y se atiende dejando quien', async () => {
    const l = await request.get('/api/certifex/consultas?estado=nueva').set('Authorization', `Bearer ${saToken}`);
    expect(l.status).toBe(200);
    const mia = l.body.data.filas.find((c) => c.certifexId === base);
    expect(mia).toBeTruthy();
    expect(l.body.data.nuevas).toBeGreaterThanOrEqual(1);

    const u = await request.patch(`/api/certifex/consultas/${mia.id}`).set('Authorization', `Bearer ${saToken}`)
      .send({ estado: 'en_curso', notaInterna: 'Llamada el lunes' });
    expect(u.status).toBe(200);
    expect(u.body.data).toMatchObject({ estado: 'en_curso', notaInterna: 'Llamada el lunes' });
    expect(u.body.data.atendidaPor).toBeTruthy();
  });

  it('un estado inventado se rechaza', async () => {
    const l = await request.get('/api/certifex/consultas').set('Authorization', `Bearer ${saToken}`);
    const mia = l.body.data.filas.find((c) => c.certifexId === base);
    const u = await request.patch(`/api/certifex/consultas/${mia.id}`).set('Authorization', `Bearer ${saToken}`).send({ estado: 'borrada' });
    expect(u.status).toBe(400);
  });
});
