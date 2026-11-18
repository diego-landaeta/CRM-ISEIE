import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * #221: el filtro por país de entrada llega a la consulta en Prospectos, Ventas
 * e Informes, siempre como `= $n` con su parámetro, y el guion de reparación
 * solo escribe con `aplicar`.
 * (ISEIE no tiene el módulo de audiencias de Meta: esa parte es solo de MultiCRM.)
 * Sin base: se mira el SQL y los parámetros. De punta a punta, en
 * paisAlEntrar221.test.js.
 */

vi.mock('../src/shared/config/db.js', () => {
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  return { query, getClient: vi.fn(), default: { query } };
});

const { query } = await import('../src/shared/config/db.js');
const leadModel = await import('../src/modules/leads/lead.model.js');
const reportModel = await import('../src/modules/reports/report.model.js');
const sales = await import('../src/modules/sales/sales.service.js');
const { rellenarPaisOrigen } = await import('../src/modules/leads/pais.relleno.js');

const llamadas = () => query.mock.calls.map(([sql, params]) => ({ sql, params: params || [] }));
const conPais = (codigo) => llamadas().filter((c) => c.params.includes(codigo));

beforeEach(() => {
  query.mockReset();
  query.mockImplementation(async (sql) => {
    if (/COUNT\(\*\)/.test(sql)) return { rows: [{ count: '0', total: 0, ventas: 0, importe: 0, cobrado: 0 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
});

describe('Prospectos', () => {
  it('el listado filtra por el país del prospecto', async () => {
    await leadModel.findAll({ projectId: 1, paisEntrada: 'CL', page: 1, limit: 20 });
    const c = conPais('CL');
    expect(c.length).toBe(2);   // el total y la página
    for (const { sql } of c) expect(sql).toContain("COALESCE(l.pais_origen, 'sin_pais') = $");
    expect(llamadas()[1].sql).toContain('l.pais_origen');   // y lo devuelve en cada fila
  });

  it('«sin país» es el mismo filtro con otro valor', async () => {
    await leadModel.findAll({ projectId: 1, paisEntrada: 'sin_pais', page: 1, limit: 20 });
    expect(conPais('sin_pais').length).toBe(2);
  });

  it('los totales de la cabecera, con el mismo filtro', async () => {
    query.mockResolvedValue({ rows: [{}] });
    await leadModel.getStats(1, { paisEntrada: 'MX' });
    expect(conPais('MX')[0].sql).toContain("COALESCE(pais_origen, 'sin_pais') = $");
  });

  it('sin filtro, la consulta no cambia', async () => {
    await leadModel.findAll({ projectId: 1, page: 1, limit: 20 });
    expect(llamadas()[0].sql).not.toContain("'sin_pais'");
  });
});

describe('Ventas', () => {
  it('el resumen filtra por el país del prospecto de cada venta', async () => {
    query.mockResolvedValue({ rows: [{ ventas: 0, cuotas: 0 }] });
    await sales.getResumenVentas({ projectId: 1, paisEntrada: 'CL' });
    const c = conPais('CL');
    expect(c.length).toBeGreaterThanOrEqual(2);
    for (const { sql } of c) expect(sql).toContain('lpais.id = cv.lead_id');
  });

  it('la serie, el desglose y los cursos vendidos también', async () => {
    await sales.getSerieVentas({ projectId: 1, from: '2026-11-01', to: '2026-11-15', paisEntrada: 'MX' });
    // ventas, cobros y prospectos, en los tres tramos (actual, anterior, historial)
    expect(conPais('MX').length).toBe(9);
    query.mockClear();
    await sales.getDesglose({ projectId: 1, paisEntrada: 'MX' });
    expect(conPais('MX').length).toBe(2);
    query.mockClear();
    query.mockResolvedValue({ rows: [{}] });
    await sales.getTopProducts({ projectId: 1, paisEntrada: 'MX' }).catch(() => {});
    expect(conPais('MX').length).toBeGreaterThan(0);
  });
});

describe('Informes', () => {
  it('las descargas de prospectos y ventas filtran y llevan la columna del país de entrada', async () => {
    await reportModel.prospectosReport({ projectId: 1, from: '2026-11-01', to: '2026-11-15', paisEntrada: 'CL' });
    const [p] = conPais('CL');
    expect(p.sql).toContain("COALESCE(l.pais_origen, 'sin_pais') = $");
    expect(p.sql).toContain('l.pais_origen AS pais_entrada');

    query.mockClear();
    await reportModel.ventasReport({ projectId: 1, from: '2026-11-01', to: '2026-11-15', paisEntrada: 'CL' });
    expect(conPais('CL')[0].sql).toContain('lpais.id = c.lead_id');
  });

  it('el informe por campus y país junta prospectos y ventas, con «sin país» aparte', async () => {
    await reportModel.paisesDeEntrada({ projectId: 1, from: '2026-11-01', to: '2026-11-15' });
    const { sql, params } = llamadas()[0];
    expect(sql).toContain('lds.pais IS NOT DISTINCT FROM ventas.pais');
    expect(params).toEqual([[1], '2026-11-01', '2026-11-15', [1], '2026-11-01', '2026-11-15']);
  });

  it('`pais` sigue siendo el del teléfono: el de entrada va aparte', async () => {
    await reportModel.paisesMasVendidos({ projectId: 1, from: '2026-11-01', to: '2026-11-15', pais: 'CL' });
    expect(conPais('CL').length).toBe(0);
  });
});

describe('el guion de reparación', () => {
  /** Una base de mentira con un campus con tabla y tres prospectos sin país. */
  function baseFalsa() {
    const escritas = [];
    const db = {
      query: vi.fn(async (sql, params = []) => {
        if (/FROM projects/.test(sql)) return { rows: [{ id: 7, nombre: 'Fono Aprende', mapa: { cl: 'CL', mx: 'MX' } }] };
        if (/FROM leads l/.test(sql)) {
          return {
            rows: [
              { lead_id: 1, project_id: 7, pais_origen: null, url_ficha: 'https://cl.fonoaprende.com/a', url_origen: null },
              { lead_id: 2, project_id: 7, pais_origen: null, url_ficha: 'https://fonoaprende.com/b', url_origen: null },
              { lead_id: 3, project_id: 7, pais_origen: null, url_ficha: null, url_origen: null },
            ],
          };
        }
        if (/to_regclass/.test(sql)) return { rows: [{ hay: params[0] === 'make_webhook_deliveries' }] };
        if (/FROM make_webhook_deliveries/.test(sql)) {
          return { rows: [{ lead_id: 3, payload: { email: 'x@example.com', page_url: 'https://mx.fonoaprende.com/c' } }] };
        }
        if (/^UPDATE leads/.test(sql) || /^INSERT INTO leads_pais/.test(sql) || /^CREATE TABLE/.test(sql.trim())) {
          escritas.push(sql);
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    return { db, escritas };
  }

  it('en simulación cuenta lo que haría y NO escribe nada', async () => {
    const { db, escritas } = baseFalsa();
    const r = await rellenarPaisOrigen(db, { aplicar: false });
    expect(r.aplicado).toBe(false);
    expect(r.cambios.map((c) => [c.lead_id, c.pais, c.fuente])).toEqual([[1, 'CL', 'ficha'], [3, 'MX', 'make']]);
    expect(r).toMatchObject({ revisados: 3, sinPais: 1, porPais: { CL: 1, MX: 1 }, porFuente: { ficha: 1, make: 1 } });
    expect(escritas).toEqual([]);
    expect(db.query.mock.calls.some(([sql]) => /BEGIN|COMMIT/.test(sql))).toBe(false);
  });

  it('con aplicar, en una transacción y solo sobre los que siguen sin país', async () => {
    const { db } = baseFalsa();
    const r = await rellenarPaisOrigen(db, { aplicar: true });
    expect(r.aplicado).toBe(true);
    const sqls = db.query.mock.calls.map(([sql]) => sql.trim());
    expect(sqls).toContain('BEGIN');
    expect(sqls).toContain('COMMIT');
    const updates = db.query.mock.calls.filter(([sql]) => /^UPDATE leads/.test(sql));
    expect(updates.map(([, p]) => p)).toEqual([[1, 'CL'], [3, 'MX']]);
    for (const [sql] of updates) expect(sql).toContain('pais_origen IS NULL');
  });

  it('sin ningún campus con tabla, no mira ni un prospecto', async () => {
    const db = { query: vi.fn(async () => ({ rows: [] })) };
    const r = await rellenarPaisOrigen(db, { aplicar: true });
    expect(r).toMatchObject({ revisados: 0, cambios: [], aplicado: false });
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});
