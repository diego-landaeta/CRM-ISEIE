import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

// Los permisos salen del catálogo (#423), con el resolver de verdad y sin base.
vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
const { registrar } = await import('./helpers/permisosSinBase.js');

/**
 * Los productos los ven todos, de todos (Diego, 23/11/2026).
 *
 * En producción, 42 rechazos 403 PROJECT_FORBIDDEN en `GET /api/products` en un
 * día: gestoras pidiendo los cursos de un campus que no es suyo (la venta o el
 * link de pago de un alumno de otro campus). Leer el catálogo ya no se recorta
 * por campus para quien tiene `products.view`. Escribir sí: crear, editar o
 * borrar un producto sigue siendo solo en sus campus.
 */

const SUYO = 1;
const AJENO = 2;
const GESTORA = 50;
const GESTORA_QUE_ESCRIBE = 52;

// Doble de la base: la gestora solo tiene el campus SUYO; hay un producto en el AJENO.
const consultas = [];
vi.mock('../src/shared/config/db.js', () => ({
  query: vi.fn(async (sql, params = []) => {
    consultas.push({ sql, params });
    if (/FROM user_projects WHERE user_id = \$1 AND project_id = \$2/.test(sql)) {
      return { rows: [GESTORA, GESTORA_QUE_ESCRIBE].includes(Number(params[0])) && Number(params[1]) === SUYO ? [{ '?column?': 1 }] : [] };
    }
    if (/FROM products/.test(sql) && /WHERE p\.id = \$1|WHERE id = \$1/.test(sql)) {
      return { rows: [{ id: Number(params[0]), project_id: AJENO, nombre: 'Curso del otro campus', image_url: null }] };
    }
    if (/FROM products/.test(sql)) {
      return { rows: [{ id: 9, project_id: AJENO, nombre: 'Curso del otro campus', image_url: null }] };
    }
    return { rows: [] };
  }),
  getClient: async () => ({ query: async () => ({ rows: [] }), release: () => {} }),
}));
vi.mock('../src/modules/status/status.model.js', () => ({ logError: vi.fn(async () => {}) }));

const { default: productsModule } = await import('../src/modules/products/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use(productsModule.prefix, productsModule.router);
app.use(errorHandler);

const como = (persona) => `Bearer ${jwt.sign({ userId: persona.userId, role: persona.role }, process.env.JWT_SECRET)}`;
const gestora = registrar({ userId: GESTORA, role: 'gestor' });
const sinVer = registrar({ userId: 51, role: 'gestor', excepciones: { 'products.view': false } });
const pedir = (persona, metodo, url, body) => {
  const r = supertest(app)[metodo](url).set('Authorization', como(persona));
  return body ? r.send(body) : r;
};

beforeEach(() => { consultas.length = 0; });

describe('productos: leer, de cualquier campus', () => {
  it('una gestora pide los productos de un campus que no es suyo → 200 (antes 403)', async () => {
    const r = await pedir(gestora, 'get', `/api/products?projectId=${AJENO}`);
    expect(r.status).toBe(200);
    expect(r.body.data[0]).toMatchObject({ project_id: AJENO });
    // No se ha mirado si el campus es suyo.
    expect(consultas.some((c) => /FROM user_projects/.test(c.sql))).toBe(false);
  });

  it('y la ficha y el temario de un producto de ese campus', async () => {
    expect((await pedir(gestora, 'get', `/api/products/9?projectId=${AJENO}`)).status).toBe(200);
    expect((await pedir(gestora, 'get', `/api/products/9/image-url?projectId=${AJENO}`)).status).toBe(200);
    expect((await pedir(gestora, 'get', `/api/products/9/modules?projectId=${AJENO}`)).status).toBe(200);
  });

  it('sin campus en la petición, 400 como antes', async () => {
    const r = await pedir(gestora, 'get', '/api/products');
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('MISSING_PROJECT');
  });

  it('un campus que no es un número, 400 sin ir a la base', async () => {
    const r = await pedir(gestora, 'get', '/api/products?projectId=abc');
    expect(r.status).toBe(400);
    expect(consultas).toHaveLength(0);
  });

  it('sin «Ver productos» sigue siendo 403', async () => {
    const r = await pedir(sinVer, 'get', `/api/products?projectId=${SUYO}`);
    expect(r.status).toBe(403);
  });
});

describe('productos: escribir, solo en sus campus', () => {
  // La gestora no trae de serie crear/editar/borrar: se le dan para ver que lo que
  // la para es el campus, no el permiso.
  const conTodo = registrar({ userId: GESTORA_QUE_ESCRIBE, role: 'gestor', excepciones: { 'products.create': true, 'products.edit': true, 'products.delete': true } });

  it('crear un producto en un campus ajeno → 403 PROJECT_FORBIDDEN', async () => {
    const r = await pedir(conTodo, 'post', '/api/products', { projectId: AJENO, nombre: 'Curso nuevo' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('PROJECT_FORBIDDEN');
  });

  it('editar y borrar en un campus ajeno → 403 PROJECT_FORBIDDEN', async () => {
    const editar = await pedir(conTodo, 'patch', `/api/products/9?projectId=${AJENO}`, { nombre: 'Otro' });
    expect(editar.status).toBe(403);
    expect(editar.body.code).toBe('PROJECT_FORBIDDEN');
    const borrar = await pedir(conTodo, 'delete', `/api/products/9?projectId=${AJENO}`);
    expect(borrar.status).toBe(403);
    expect(borrar.body.code).toBe('PROJECT_FORBIDDEN');
  });

  it('sin «Crear productos», 403 aunque sea en su campus', async () => {
    const r = await pedir(sinVer, 'post', '/api/products', { projectId: SUYO, nombre: 'Curso nuevo' });
    expect(r.status).toBe(403);
  });
});
