import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * El endpoint de preguntas (#30), contra la base de verdad.
 *
 * Lo que se fija es lo que NO se ve en el servicio: quien puede llamar, que lo
 * que llega a las consultas sea el alcance de la SESION (no el del cuerpo ni el
 * de la URL de otro), y como se traducen los fallos a codigos HTTP.
 *
 * El servicio de preguntas se simula: aqui no se llama a Anthropic.
 */

// El limite por minuto se sube para que las pruebas no se frenen entre si; la
// ultima lo baja a su valor real con una persona propia.
process.env.IA_PREGUNTAS_POR_MINUTO = '1000';

// Los permisos de cada persona (#423: `puede('reports_ia.generar')`) salen del
// resolver de verdad, alimentado con las personas de la prueba: asi no hace falta
// que estén activas en la base (ver más abajo por qué no lo están).
vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
const { registrar } = await import('./helpers/permisosSinBase.js');

const servicio = vi.hoisted(() => ({ preguntar: vi.fn() }));
vi.mock('../src/modules/ia-analisis/preguntar.service.js', () => servicio);

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/ia-analisis/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `IAHTTP${Date.now().toString(36)}`;
const ids = { users: [] };
const U = {};

const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const jwtDe = (u) => jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' });
const preguntar = (u, cuerpo = { pregunta: '¿cuánto se cobró en julio?' }, query = '') =>
  request.post(`/api/ia-analisis/preguntar${query}`).set('Authorization', `Bearer ${jwtDe(u)}`).send(cuerpo);

/**
 * Las personas de la prueba se crean INACTIVAS. Importa: otras pruebas de la suite
 * (Certifex) comparan «los superadmin y admin activos» con quienes recibieron un
 * aviso, y un usuario activo que aparece y desaparece mientras tanto las
 * desajusta —eso rompio el CI de esta rama: «expected [20, 1] to include 25»,
 * donde el 25 era un superadmin de esta prueba—. El alcance (`user_projects`) y
 * el token no necesitan que el usuario este activo.
 */
async function persona(clave, role, campus = []) {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role, active) VALUES ($1, $2, 'x', $3, FALSE) RETURNING id, role`,
    [`${MARCA} ${clave}`, `${clave.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]);
  ids.users.push(u.id);
  registrar({ userId: u.id, role });
  for (const c of campus) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
  U[clave] = u;
}

beforeAll(async () => {
  await persona('ADMIN1', 'admin', [1]);
  await persona('ADMIN12', 'admin', [1, 2]);
  await persona('GESTORA', 'gestor', [1]);
  // Sin fila en la base: un superadmin NO se resuelve por `user_projects` (ve todo) y
  // el token basta. Crearlo activo es justo lo que desajustaba a Certifex.
  U.SUPER = { id: 987654321, role: 'superadmin' };
  registrar({ userId: U.SUPER.id, role: 'superadmin' });
  await persona('LIMITE', 'admin', [1]);
});

afterAll(async () => {
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await pool.end();
});

beforeEach(() => {
  servicio.preguntar.mockReset();
  servicio.preguntar.mockResolvedValue({ ok: true, respuesta: 'Hubo 120 prospectos.', desglose: [], verificada: true });
});

describe('quien puede preguntar', () => {
  it('sin sesion, 401', async () => {
    const r = await request.post('/api/ia-analisis/preguntar').send({ pregunta: 'hola que tal' });
    expect(r.status).toBe(401);
    expect(servicio.preguntar).not.toHaveBeenCalled();
  });

  it('una gestora no: esto es de quien mira las cifras de la empresa', async () => {
    const r = await preguntar(U.GESTORA);
    expect(r.status).toBe(403);
    expect(servicio.preguntar).not.toHaveBeenCalled();
  });

  it('admin y superadmin si', async () => {
    expect((await preguntar(U.ADMIN1)).status).toBe(200);
    expect((await preguntar(U.SUPER)).status).toBe(200);
  });
});

describe('el alcance sale de la sesion', () => {
  it('un admin sin elegir campus mide SOLO los suyos', async () => {
    await preguntar(U.ADMIN12);
    const { alcance } = servicio.preguntar.mock.calls[0][0];
    expect([...alcance.projectIds].sort()).toEqual([1, 2]);
  });

  it('un admin que pide un campus que no es suyo recibe un 403 y no se pregunta nada', async () => {
    const r = await preguntar(U.ADMIN1, undefined, '?projectId=2');
    expect(r.status).toBe(403);
    expect(servicio.preguntar).not.toHaveBeenCalled();
  });

  it('un admin que pide uno suyo, mide ese', async () => {
    await preguntar(U.ADMIN12, undefined, '?projectId=2');
    expect(servicio.preguntar.mock.calls[0][0].alcance).toMatchObject({ projectId: 2 });
  });

  it('el cuerpo no puede colar un proyecto: solo cuenta la sesion', async () => {
    await preguntar(U.ADMIN1, { pregunta: 'ventas del proyecto 2', projectId: 2, projectIds: [2, 3] });
    const { alcance } = servicio.preguntar.mock.calls[0][0];
    expect(alcance.projectIds).toEqual([1]);
    expect(JSON.stringify(alcance)).not.toContain('3');
  });

  it('el superadmin sin elegir nada no tiene recorte', async () => {
    await preguntar(U.SUPER);
    const { alcance } = servicio.preguntar.mock.calls[0][0];
    expect(alcance.projectIds ?? null).toBeNull();
    expect(alcance.projectId ?? null).toBeNull();
  });

  it('el servicio sabe de quien es la pregunta, para apuntar el gasto', async () => {
    await preguntar(U.ADMIN1);
    expect(servicio.preguntar.mock.calls[0][0].userId).toBe(U.ADMIN1.id);
  });
});

describe('la pregunta', () => {
  it.each([
    ['vacia', { pregunta: '' }],
    ['demasiado corta', { pregunta: 'a' }],
    ['solo espacios', { pregunta: '      ' }],
    ['ausente', {}],
    ['demasiado larga', { pregunta: 'x'.repeat(501) }],
  ])('%s, 400', async (_n, cuerpo) => {
    const r = await preguntar(U.ADMIN1, cuerpo);
    expect(r.status).toBe(400);
    expect(servicio.preguntar).not.toHaveBeenCalled();
  });
});

describe('como se cuentan los fallos', () => {
  it.each([
    ['SIN_CLAVE', 503],
    ['TOPE', 429],
    ['IA_NO_RESPONDE', 502],
    ['SIN_RESPUESTA', 422],
  ])('%s → %d, con el mensaje para quien pregunta', async (codigo, estado) => {
    servicio.preguntar.mockResolvedValue({ ok: false, codigo, mensaje: `mensaje de ${codigo}` });
    const r = await preguntar(U.ADMIN1);
    expect(r.status).toBe(estado);
    expect(r.body).toMatchObject({ success: false, code: codigo, error: `mensaje de ${codigo}` });
  });

  it('un error inesperado va al manejador comun: 500 con referencia', async () => {
    // El manejador comun del CRM les dice QUE ha fallado a admin y superadmin,
    // a proposito (ver errorHandler.js); aqui solo se fija que no se pierde ni
    // se contesta como si hubiera ido bien.
    servicio.preguntar.mockRejectedValue(new Error('fallo inesperado'));
    const r = await preguntar(U.ADMIN1);
    expect(r.status).toBe(500);
    expect(r.body.success).toBe(false);
    expect(r.body.ref).toBeTruthy();
  });
});

describe('el limite de preguntas', () => {
  it('la novena seguida en un minuto se frena, y es por persona', async () => {
    process.env.IA_PREGUNTAS_POR_MINUTO = '8';
    try {
      const resultados = [];
      for (let i = 0; i < 9; i += 1) resultados.push((await preguntar(U.LIMITE)).status);
      expect(resultados.slice(0, 8)).toEqual(Array(8).fill(200));
      expect(resultados[8]).toBe(429);

      // Otra persona de la misma oficina (misma IP) no se ve afectada.
      expect((await preguntar(U.ADMIN12)).status).toBe(200);
    } finally {
      process.env.IA_PREGUNTAS_POR_MINUTO = '1000';
    }
  });
});
