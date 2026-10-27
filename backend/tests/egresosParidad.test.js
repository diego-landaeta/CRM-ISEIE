import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// Los permisos salen del catálogo (#423): sin base, el resolver de verdad con
// las personas que firman token (tests/helpers/permisosSinBase.js).
vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
const { registrar } = await import('./helpers/permisosSinBase.js');

/*
  Egresos, igual en los dos CRM (#227). Diego, 10/10: «Egresos se empareja: la
  misma pantalla y el mismo funcionamiento en los dos CRM. Se comparan las dos
  versiones, se queda con lo mejor de cada una y se lleva a los dos».

  Esta prueba es la MISMA en MultiCRM y en CRM-ISEIE, como el módulo.

  Lo que se comprueba:
    - el listado sigue la EMPRESA de la cabecera (Finanzas va por empresa) y,
      sin super admin, nunca sale de los campus de la persona (#245);
    - los totales salen del servidor con el MISMO filtro que la tabla, y el
      panel de Finanzas usa la misma regla: las tres cifras cuadran;
    - alta y edición respetan de quién es el gasto (campus, empresa o general);
    - los automáticos no se tocan a mano; el gestor no entra.
*/

const EMPRESAS = { 8: [1, 2, 3], 9: [4] };   // CEDIA (3 campus), ICTESS (1)
const CAMPUS = { 34: [1, 2, 3], 40: [4] };   // Mireia (CEDIA), Antonio (ICTESS)
const GASTOS = {
  10: { id: 10, project_id: 2, issuer_id: null, concepto: 'Software campus 2', importe: '50.00', categoria: 'software' },
  11: { id: 11, project_id: 4, issuer_id: null, concepto: 'Publicidad ICTESS', importe: '80.00', categoria: 'publicidad' },
  12: { id: 12, project_id: null, issuer_id: 8, concepto: 'Alquiler CEDIA', importe: '900.00', categoria: 'alquiler', comprobante_key: null },
  13: { id: 13, project_id: null, issuer_id: null, concepto: 'Dominio general', importe: '12.00', categoria: 'software' },
  14: { id: 14, project_id: 1, issuer_id: null, concepto: 'Pago proveedor', importe: '300.00', categoria: 'proveedores', source_payable_id: 7 },
};

const consultas = [];

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql, params = []) => {
    consultas.push({ sql, params });
    if (sql.includes('FROM projects WHERE sociedad_emisora_id = $1 ORDER BY id')) {
      return { rows: (EMPRESAS[params[0]] || []).map((id) => ({ id })) };
    }
    if (sql.includes('FROM user_projects WHERE user_id = $1 AND active = true')) {
      return { rows: (CAMPUS[params[0]] || []).map((project_id) => ({ project_id })) };
    }
    if (sql.includes('FROM projects WHERE sociedad_emisora_id = $1 AND id = ANY($2::int[])')) {
      return { rows: (EMPRESAS[params[0]] || []).some((p) => params[1].includes(p)) ? [{ '?column?': 1 }] : [] };
    }
    if (sql.includes('WHERE e.id = $1')) return { rows: GASTOS[params[0]] ? [GASTOS[params[0]]] : [] };
    if (sql.startsWith('SELECT COUNT(*) FROM expenses e')) return { rows: [{ count: '3' }] };
    if (sql.includes('num_sin_campus')) {
      return { rows: [{ num: 3, total: '1250.00', num_sin_campus: 1, total_sin_campus: '900.00' }] };
    }
    if (sql.includes('GROUP BY e.categoria')) {
      return { rows: [{ categoria: 'alquiler', num: 1, total: '900.00' }, { categoria: 'proveedores', num: 1, total: '300.00' }, { categoria: 'software', num: 1, total: '50.00' }] };
    }
    if (sql.includes('INSERT INTO expenses')) return { rows: [{ id: 99, project_id: params[0], issuer_id: params[1], importe: params[3], categoria: params[5] }] };
    if (sql.includes('UPDATE expenses SET')) return { rows: [{ id: params[params.length - 1] }] };
    if (sql.includes('LIMIT $')) return { rows: [GASTOS[12], GASTOS[10], GASTOS[14]] };
    // El resto (las cifras del panel de Finanzas): una fila vacía basta, aquí
    // se mira QUÉ se pregunta, no lo que contesta.
    return { rows: [{}] };
  }),
}));

vi.mock('../src/shared/services/localStorage.service.js', () => ({
  saveLocal: vi.fn(async (k) => k),
  getLocal: vi.fn(async () => ({ buffer: Buffer.from('%PDF'), size: 4 })),
  deleteLocal: vi.fn(async () => {}),
}));

const { default: expensesModule } = await import('../src/modules/expenses/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const model = await import('../src/modules/expenses/expense.model.js');
const accounting = await import('../src/modules/accounting/accounting.model.js');

const app = express();
app.use(express.json());
app.use(expensesModule.prefix, expensesModule.router);
app.use(expensesModule.alias, expensesModule.router);
app.use(errorHandler);

const firmar = (user) => `Bearer ${jwt.sign(registrar(user), process.env.JWT_SECRET)}`;
const MIREIA = firmar({ userId: 34, role: 'admin' });
const ANTONIO = firmar({ userId: 40, role: 'admin' });
const MANUEL = firmar({ userId: 2, role: 'superadmin' });
const GESTORA = firmar({ userId: 50, role: 'gestor' });

const ALTA = { concepto: 'Alquiler octubre', importe: 900, fecha: '2026-10-01', categoria: 'alquiler' };

beforeEach(() => { consultas.length = 0; vi.clearAllMocks(); });

describe('el módulo es el mismo en los dos CRM', () => {
  it('responde en /api/expenses y, como alias, en /api/accounting/expenses', () => {
    expect(expensesModule.prefix).toBe('/api/expenses');
    expect(expensesModule.alias).toBe('/api/accounting/expenses');
  });

  it('la dirección vieja de MultiCRM sigue listando', async () => {
    const r = await request(app).get('/api/accounting/expenses').set('Authorization', MANUEL);
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
  });
});

describe('listado por empresa y por campus', () => {
  it('con una empresa en la cabecera, sus campus y su gasto de empresa', async () => {
    const r = await request(app).get('/api/expenses?issuerId=8&page=1&limit=50').set('Authorization', MANUEL);
    expect(r.status).toBe(200);
    expect(r.body.pagination).toEqual({ total: 3, page: 1, limit: 50, totalPages: 1 });
    const count = consultas.find((c) => c.sql.startsWith('SELECT COUNT(*) FROM expenses e'));
    expect(count.params[0]).toEqual([1, 2, 3]);
    // los de la empresa sin campus entran por su issuer_id
    expect(count.sql).toContain('issuer_id IN (SELECT p_amb.sociedad_emisora_id');
  });

  it('un campus: solo ese campus (más lo de su empresa y lo general)', async () => {
    await request(app).get('/api/expenses?projectId=2').set('Authorization', MANUEL);
    expect(consultas.find((c) => c.sql.startsWith('SELECT COUNT(*)')).params[0]).toEqual([2]);
  });

  it('Mireia sin nada en la cabecera: sus campus, no todo el CRM (#245)', async () => {
    await request(app).get('/api/expenses').set('Authorization', MIREIA);
    expect(consultas.find((c) => c.sql.startsWith('SELECT COUNT(*)')).params[0]).toEqual([1, 2, 3]);
  });

  it('Antonio pidiendo CEDIA se queda sin nada, no con CEDIA', async () => {
    await request(app).get('/api/expenses?issuerId=8').set('Authorization', ANTONIO);
    expect(consultas.find((c) => c.sql.startsWith('SELECT COUNT(*)')).params[0]).toEqual([-1]);
  });

  it('un campus ajeno es un 403', async () => {
    const r = await request(app).get('/api/expenses?projectId=4').set('Authorization', MIREIA);
    expect(r.status).toBe(403);
  });

  it('filtros de fecha, búsqueda, categoría y origen llegan a la consulta', async () => {
    await request(app)
      .get('/api/expenses?from=2026-10-01&to=2026-10-31&q=alquiler&categoria=alquiler&origen=manual')
      .set('Authorization', MANUEL);
    const count = consultas.find((c) => c.sql.startsWith('SELECT COUNT(*)'));
    expect(count.params).toEqual(['alquiler', '2026-10-01', '2026-10-31', '%alquiler%']);
    expect(count.sql).toContain('source_payable_id IS NULL AND e.source_stripe_payout_id IS NULL');
  });

  it('una fecha mal escrita es un 400, no un 500', async () => {
    const r = await request(app).get('/api/expenses?from=01/10/2026').set('Authorization', MANUEL);
    expect(r.status).toBe(400);
  });
});

describe('los totales cuadran', () => {
  it('el resumen viene del servidor, sobre todo el filtro y en números', async () => {
    const r = await request(app).get('/api/expenses/resumen?issuerId=8').set('Authorization', MANUEL);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({
      num: 3,
      total: 1250,
      sin_campus: { num: 1, total: 900 },
      por_categoria: [
        { categoria: 'alquiler', num: 1, total: 900 },
        { categoria: 'proveedores', num: 1, total: 300 },
        { categoria: 'software', num: 1, total: 50 },
      ],
    });
    // y lo que suman las categorías es el total
    expect(r.body.data.por_categoria.reduce((s, c) => s + c.total, 0)).toBe(r.body.data.total);
  });

  it('tabla y resumen usan el MISMO filtro (mismo WHERE, mismos parámetros)', async () => {
    await request(app).get('/api/expenses?issuerId=8&from=2026-01-01&q=x').set('Authorization', MANUEL);
    await request(app).get('/api/expenses/resumen?issuerId=8&from=2026-01-01&q=x').set('Authorization', MANUEL);
    // las dos acaban en su filtro: lo que va detrás de «FROM expenses e» es el WHERE entero
    const where = (sql) => sql.slice(sql.lastIndexOf('FROM expenses e')).trim();
    const count = consultas.find((c) => c.sql.startsWith('SELECT COUNT(*) FROM expenses e'));
    const tot = consultas.find((c) => c.sql.includes('num_sin_campus'));
    expect(where(tot.sql)).toBe(where(count.sql));
    expect(tot.params).toEqual(count.params);
  });

  it('el panel de Finanzas cuenta los egresos con la misma regla que el listado', async () => {
    await accounting.getDashboardStats({ projectIds: [1, 2, 3], from: '2026-01-01', to: '2026-12-31' });
    const egresos = consultas.find((c) => c.sql.includes('AS total_egresos'));
    expect(egresos.sql).toContain(model.condicionDeAmbito('e', 1));
    const tendencia = consultas.find((c) => c.sql.includes("date_trunc('month', e.fecha)"));
    expect(tendencia.sql).toContain(model.condicionDeAmbito('e', 1));
  });
});

describe('alta', () => {
  it('Mireia apunta en un campus suyo', async () => {
    const r = await request(app).post('/api/expenses').set('Authorization', MIREIA).send({ ...ALTA, project_id: 2 });
    expect(r.status).toBe(201);
    expect(r.body.data.project_id).toBe(2);
  });

  it('Mireia apunta el alquiler de TODA su empresa, sin campus', async () => {
    const r = await request(app).post('/api/expenses').set('Authorization', MIREIA).send({ ...ALTA, issuer_id: 8 });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ project_id: null, issuer_id: 8 });
  });

  it('Mireia no apunta en un campus de ICTESS ni en la empresa ICTESS', async () => {
    expect((await request(app).post('/api/expenses').set('Authorization', MIREIA).send({ ...ALTA, project_id: 4 })).status).toBe(403);
    expect((await request(app).post('/api/expenses').set('Authorization', MIREIA).send({ ...ALTA, issuer_id: 9 })).status).toBe(403);
  });

  it('un gasto general de todo el CRM solo lo apunta un super admin', async () => {
    expect((await request(app).post('/api/expenses').set('Authorization', MIREIA).send(ALTA)).status).toBe(403);
    expect((await request(app).post('/api/expenses').set('Authorization', MANUEL).send(ALTA)).status).toBe(201);
  });

  it('campus y empresa a la vez no: un 400 que lo dice', async () => {
    const r = await request(app).post('/api/expenses').set('Authorization', MANUEL).send({ ...ALTA, project_id: 2, issuer_id: 8 });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/campus o de una empresa/);
  });

  it('el -1 del «todos» del navegador ya no se puede colar como campus', async () => {
    const r = await request(app).post('/api/expenses').set('Authorization', MANUEL).send({ ...ALTA, project_id: -1 });
    expect(r.status).toBe(400);
  });

  it('importe 0 o sin concepto: 400', async () => {
    expect((await request(app).post('/api/expenses').set('Authorization', MANUEL).send({ ...ALTA, importe: 0 })).status).toBe(400);
    expect((await request(app).post('/api/expenses').set('Authorization', MANUEL).send({ ...ALTA, concepto: '  ' })).status).toBe(400);
  });
});

describe('edición y borrado', () => {
  it('Mireia edita el gasto de su campus', async () => {
    const r = await request(app).patch('/api/expenses/10').set('Authorization', MIREIA).send({ importe: 60 });
    expect(r.status).toBe(200);
  });

  it('pasar el gasto de empresa a un campus deja la empresa vacía', async () => {
    await request(app).patch('/api/expenses/12').set('Authorization', MIREIA).send({ project_id: 1 });
    const up = consultas.find((c) => c.sql.includes('UPDATE expenses SET'));
    expect(up.sql).toContain('project_id = $1');
    expect(up.sql).toContain('issuer_id = $2');
    expect(up.params.slice(0, 2)).toEqual([1, null]);
  });

  it('el gasto de otra empresa no existe para ella: 404 al verlo, editarlo o borrarlo', async () => {
    expect((await request(app).get('/api/expenses/11').set('Authorization', MIREIA)).status).toBe(404);
    expect((await request(app).patch('/api/expenses/11').set('Authorization', MIREIA).send({ importe: 1 })).status).toBe(404);
    expect((await request(app).delete('/api/expenses/11').set('Authorization', MIREIA)).status).toBe(404);
  });

  it('el general se ve, pero solo lo toca un super admin', async () => {
    expect((await request(app).get('/api/expenses/13').set('Authorization', MIREIA)).status).toBe(200);
    expect((await request(app).patch('/api/expenses/13').set('Authorization', MIREIA).send({ importe: 1 })).status).toBe(403);
    expect((await request(app).patch('/api/expenses/13').set('Authorization', MANUEL).send({ importe: 1 })).status).toBe(200);
  });

  it('un egreso automático no se edita ni se borra a mano (409)', async () => {
    expect((await request(app).patch('/api/expenses/14').set('Authorization', MANUEL).send({ importe: 1 })).status).toBe(409);
    expect((await request(app).delete('/api/expenses/14').set('Authorization', MANUEL)).status).toBe(409);
  });

  it('borrar el de su empresa', async () => {
    const r = await request(app).delete('/api/expenses/12').set('Authorization', MIREIA);
    expect(r.status).toBe(200);
    expect(consultas.some((c) => c.sql.startsWith('DELETE FROM expenses'))).toBe(true);
  });
});

describe('permisos', () => {
  it('sin token, 401; la gestora, 403', async () => {
    expect((await request(app).get('/api/expenses')).status).toBe(401);
    expect((await request(app).get('/api/expenses').set('Authorization', GESTORA)).status).toBe(403);
    expect((await request(app).post('/api/expenses').set('Authorization', GESTORA).send(ALTA)).status).toBe(403);
  });
});

describe('comprobante', () => {
  it('se descarga con el token y no deja salir de la carpeta', async () => {
    const ok = await request(app).get('/api/expenses/comprobante/123-abc.pdf').set('Authorization', MANUEL);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toContain('application/pdf');
    const malo = await request(app).get('/api/expenses/comprobante/..%2F..%2Fetc%2Fpasswd').set('Authorization', MANUEL);
    expect(malo.status).toBe(400);
  });
});
