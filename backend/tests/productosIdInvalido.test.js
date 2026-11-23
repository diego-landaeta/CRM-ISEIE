import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

// Los permisos salen del catálogo (#423), con el resolver de verdad y sin base.
vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
const { registrar } = await import('./helpers/permisosSinBase.js');

/**
 * Un id de producto que no es un entero positivo: 400 INVALID_ID, nunca 500.
 *
 * QA de /staging del 21/11: `GET /api/products/NaN` daba 500 (Postgres 22P02,
 * «invalid input syntax for type integer: "NaN"»). El frontal sin la ruta
 * /products/cursos-moodle la leía como la ficha del producto «cursos-moodle» y
 * pedía `Number('cursos-moodle')`. Como en formularios (gemela de CRM#857), el
 * id se comprueba antes de ir a la base.
 */

// Doble de la base: anota cada consulta; un NaN revienta como Postgres.
const consultas = [];
vi.mock('../src/shared/config/db.js', () => ({
  query: vi.fn(async (sql, params = []) => {
    consultas.push({ sql, params });
    if (params.some((p) => typeof p === 'number' && Number.isNaN(p))) {
      throw new Error('invalid input syntax for type integer: "NaN"');
    }
    return { rows: [] };
  }),
  getClient: async () => ({ query: async () => ({ rows: [] }), release: () => {} }),
}));
vi.mock('../src/modules/status/status.model.js', () => ({ logError: vi.fn(async () => {}) }));

const { default: productsModule } = await import('../src/modules/products/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const SUPER = registrar({ userId: 1, role: 'superadmin' });

const app = express();
app.use(express.json());
app.use(productsModule.prefix, productsModule.router);
app.use(errorHandler);

const token = jwt.sign(SUPER, process.env.JWT_SECRET || 'test-secret');
const pedir = (metodo, url) => supertest(app)[metodo](url).set('Authorization', `Bearer ${token}`);

beforeEach(() => { consultas.length = 0; });

describe('productos: un id que no es un entero positivo da 400, no 500', () => {
  it.each([
    ['get', '/api/products/NaN'],
    ['get', '/api/products/cursos-moodle'],
    ['get', '/api/products/0'],
    ['get', '/api/products/-3'],
    ['get', '/api/products/1.5'],
    ['get', '/api/products/99999999999'],
    ['get', '/api/products/NaN/image-url'],
    ['get', '/api/products/NaN/modules'],
    ['patch', '/api/products/NaN'],
    ['delete', '/api/products/NaN'],
    ['patch', '/api/products/7/modules/NaN'],
  ])('%s %s → 400 INVALID_ID, sin ir a la base', async (metodo, url) => {
    const r = await pedir(metodo, `${url}?projectId=1`);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ success: false, code: 'INVALID_ID' });
    expect(consultas.some((c) => c.params.some((p) => Number.isNaN(p)))).toBe(false);
  });

  it('sin sesión sigue siendo 401 (el id no se mira antes que el token)', async () => {
    const r = await supertest(app).get('/api/products/NaN?projectId=1');
    expect(r.status).toBe(401);
  });

  it('las rutas fijas de antes de `/:id` no se tocan', async () => {
    const r = await pedir('get', '/api/products/ambito');
    expect(r.status).not.toBe(400);
  });

  it('un id bueno pasa del guardia (y sin fila, 404)', async () => {
    const r = await pedir('get', '/api/products/7?projectId=1');
    expect(r.status).not.toBe(400);
    expect(r.status).not.toBe(500);
  });
});
