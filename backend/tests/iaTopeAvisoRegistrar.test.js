import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';

/**
 * El aviso del tope esta enchufado a `registrar` (#30, #22).
 *
 * `iaTopeAviso.test.js` prueba el aviso contra la base; esto prueba el cable:
 * cada llamada apuntada pregunta cuanto llevamos y se lo dice al aviso, y un
 * fallo del aviso NO tumba la respuesta ni cuenta como «no se pudo apuntar».
 * La base y el aviso se simulan.
 */

let filas = [];
let tablaExiste = true;
let fallaElInsert = false;

vi.mock('../src/shared/config/db.js', () => ({
  query: vi.fn(async (sql, params) => {
    if (sql.includes('information_schema')) return { rows: tablaExiste ? [{ '?column?': 1 }] : [] };
    if (sql.includes('INSERT INTO ia_gasto')) {
      if (fallaElInsert) throw new Error('relation "ia_gasto" does not exist');
      filas.push(params);
      return { rows: [] };
    }
    if (sql.includes('SUM(coste_usd)')) {
      const gastado = filas.reduce((a, p) => a + Number(p[8]), 0);
      return { rows: [{ gastado, llamadas: filas.length, inciertas: 0 }] };
    }
    return { rows: [] };
  }),
}));
vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const avisaSiCruzaUmbral = vi.fn(async () => ({ avisado: true }));
vi.mock('../src/shared/services/gastoIAAviso.service.js', () => ({
  avisaSiCruzaUmbral: (...a) => avisaSiCruzaUmbral(...a),
}));

const gasto = await import('../src/shared/services/gastoIA.service.js');

const TOPE_ORIGINAL = process.env.IA_TOPE_MENSUAL_USD;

beforeEach(() => {
  filas = [];
  tablaExiste = true;
  fallaElInsert = false;
  avisaSiCruzaUmbral.mockClear();
  avisaSiCruzaUmbral.mockImplementation(async () => ({ avisado: true }));
  gasto._olvidar();
  process.env.IA_TOPE_MENSUAL_USD = '10';
});

afterEach(() => {
  if (TOPE_ORIGINAL === undefined) delete process.env.IA_TOPE_MENSUAL_USD;
  else process.env.IA_TOPE_MENSUAL_USD = TOPE_ORIGINAL;
});

describe('registrar avisa del tope', () => {
  it('tras apuntar una llamada, le dice al aviso cuanto llevamos y cual es el tope', async () => {
    // Sonnet: 1M de entrada = 3 USD, 333333 de salida ≈ 5 USD → 8 USD de 10.
    await gasto.registrar({ origen: 'ia-analisis', modelo: 'claude-sonnet-4-5', entrada: 1e6, salida: 333333 });
    expect(avisaSiCruzaUmbral).toHaveBeenCalledTimes(1);
    const { gastado, tope } = avisaSiCruzaUmbral.mock.calls[0][0];
    expect(tope).toBe(10);
    expect(gastado).toBeCloseTo(8, 1);
  });

  it('sin tope (0) ni se pregunta', async () => {
    process.env.IA_TOPE_MENSUAL_USD = '0';
    await gasto.registrar({ origen: 'ia-analisis', modelo: 'claude-sonnet-4-5', entrada: 1e6 });
    expect(avisaSiCruzaUmbral).not.toHaveBeenCalled();
  });

  it('si no se pudo apuntar, no hay nada que avisar', async () => {
    fallaElInsert = true;
    await gasto.registrar({ origen: 'ia-analisis', modelo: 'claude-sonnet-4-5', entrada: 1e6 });
    expect(avisaSiCruzaUmbral).not.toHaveBeenCalled();
  });

  it('si el aviso revienta, la llamada sigue apuntada y NO cuenta como fallo del contador', async () => {
    avisaSiCruzaUmbral.mockRejectedValue(new Error('notificaciones caidas'));
    const r = await gasto.registrar({ origen: 'ia-analisis', modelo: 'claude-sonnet-4-5', entrada: 1e6 });
    expect(r.apuntado).toBe(true);
    expect((await gasto.estado()).fallosAlApuntar).toBe(0);
  });
});
