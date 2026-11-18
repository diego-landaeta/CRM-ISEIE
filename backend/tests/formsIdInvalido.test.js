import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

// Los permisos salen del catálogo (#423), con el resolver de verdad y sin base.
vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
const { registrar } = await import('./helpers/permisosSinBase.js');

/**
 * Un id de formulario que no es un entero positivo: 400, nunca 500.
 *
 * El 16/11 producción dio un 500 con `GET /crm/api/forms//events`. nginx junta
 * las barras, llega `GET /api/forms/events`, que casa con `GET /:id` (id =
 * «events»); el guardia del campus lo dejaba pasar «para el controlador», y
 * `getById` mandaba `parseInt('events')` = NaN a Postgres: «invalid input syntax
 * for type integer: "NaN"». Ahora el guardia corta antes de ir a la base.
 */

// Doble de la base: el formulario 50 es del campus 1. Cada consulta queda
// anotada para comprobar que un id malo no llega a Postgres.
const consultas = [];
vi.mock('../src/shared/config/db.js', () => ({
  query: vi.fn(async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ');
    consultas.push({ s, params });
    if (params.some((p) => typeof p === 'number' && Number.isNaN(p))) {
      throw new Error('invalid input syntax for type integer: "NaN"');
    }
    if (/SELECT project_id FROM form_templates WHERE id = \$1/.test(s)) {
      return { rows: params[0] === 50 ? [{ project_id: 1 }] : [] };
    }
    if (/SELECT \* FROM form_templates WHERE id = \$1/.test(s)) {
      return { rows: params[0] === 50 ? [{ id: 50, project_id: 1, nombre: 'Contacto' }] : [] };
    }
    if (/FROM form_events|form_event/i.test(s)) return { rows: [] };
    return { rows: [] };
  }),
  getClient: async () => ({ query: async () => ({ rows: [] }), release: () => {} }),
}));
vi.mock('../src/modules/status/status.model.js', () => ({ logError: vi.fn(async () => {}) }));

const { default: formsModule } = await import('../src/modules/forms/index.js');
const { idDeFormulario } = await import('../src/modules/forms/form.acceso.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const SUPER = registrar({ userId: 1, role: 'superadmin' });

const app = express();
app.use(express.json());
app.use(formsModule.prefix, formsModule.router);
app.use(errorHandler);

const token = jwt.sign(SUPER, process.env.JWT_SECRET || 'test-secret');
const pedir = (metodo, url) => supertest(app)[metodo](url).set('Authorization', `Bearer ${token}`);

beforeEach(() => { consultas.length = 0; });

describe('forms: un id que no es un entero positivo da 400, no 500', () => {
  it('el módulo cuelga de /api/forms', () => {
    expect(formsModule.prefix).toBe('/api/forms');
  });

  it.each([
    ['/api/forms/abc/events'],
    ['/api/forms/%20/events'],
    ['/api/forms/events'],          // lo que llega de `/forms//events` tras nginx
    ['/api/forms/abc'],
    ['/api/forms/abc/status'],
    ['/api/forms/0'],
    ['/api/forms/-3'],
    ['/api/forms/1e2'],
    ['/api/forms/0x10/status'],
    ['/api/forms/99999999999'],      // no cabe en un integer de Postgres
  ])('GET %s → 400 INVALID_ID sin tocar la base', async (url) => {
    const r = await pedir('get', url);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ success: false, code: 'INVALID_ID' });
    expect(consultas.filter((c) => /form_templates/.test(c.s))).toEqual([]);
  });

  it.each([
    ['patch', '/api/forms/abc'],
    ['delete', '/api/forms/abc'],
    ['post', '/api/forms/abc/listen'],
    ['post', '/api/forms/abc/listen/stop'],
  ])('%s %s → 400', async (metodo, url) => {
    const r = await pedir(metodo, url);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('INVALID_ID');
  });

  it('con un id válido sigue igual: 200 si existe, 404 si no', async () => {
    const bien = await pedir('get', '/api/forms/50');
    expect(bien.status).toBe(200);
    expect(bien.body.data).toMatchObject({ id: 50 });
    expect((await pedir('get', '/api/forms/51')).status).toBe(404);
    expect((await pedir('get', '/api/forms/50/events')).status).toBe(200);
  });

  it('idDeFormulario: solo cifras, sin cero delante y dentro de un integer', () => {
    expect(idDeFormulario('50')).toBe(50);
    expect(idDeFormulario('2147483647')).toBe(2147483647);
    for (const malo of [undefined, null, '', ' ', 'events', '0', '07', '-1', '1.5', '1e2', '0x10', ' 5', '2147483648']) {
      expect(idDeFormulario(malo), String(malo)).toBeNull();
    }
  });
});
