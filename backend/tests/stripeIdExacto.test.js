import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * El cargo de Stripe se busca en las notas de los cobros por su id EXACTO.
 *
 * Con `LIKE '%id%'`, «ch_x_r1» coincidía con la nota «Auto-Stripe ch_x_r10» y el
 * cargo se daba por duplicado de otro (auto_dedup): la prueba de los 30 cargos de
 * stripeCobroUnaVez680 fallaba a ratos, según cuál se guardara antes.
 */
const llamadas = [];
vi.mock('../src/shared/config/db.js', () => ({
  query: vi.fn(async (sql, params) => { llamadas.push({ sql, params }); return { rows: [] }; }),
}));

const { findPagoDuplicado } = await import('../src/modules/stripe-payments/stripe-payments.model.js');

beforeEach(() => { llamadas.length = 0; });

/** El patrón que se manda a Postgres para el id, como RegExp de JS (mismo dialecto aquí). */
async function patronDe(id) {
  await findPagoDuplicado(1, 10, '2026-11-16', id);
  const porId = llamadas.find((l) => /notas ~ \$1/.test(l.sql));
  return porId ? new RegExp(porId.params[0]) : null;
}

describe('findPagoDuplicado: el id de Stripe, exacto', () => {
  it('no usa LIKE con comodines', async () => {
    await findPagoDuplicado(1, 10, '2026-11-16', 'ch_x_r1');
    expect(llamadas.some((l) => /notas LIKE/.test(l.sql))).toBe(false);
  });

  it('«ch_x_r1» se reconoce en su nota y no en la de «ch_x_r10»', async () => {
    const re = await patronDe('ch_x_r1');
    expect(re.test('Auto-Stripe ch_x_r1')).toBe(true);
    expect(re.test('Auto-Stripe ch_x_r1 · cuota 2')).toBe(true);
    expect(re.test('Auto-Stripe ch_x_r10')).toBe(false);
    expect(re.test('Auto-Stripe xch_x_r1')).toBe(false);
  });

  it('un id con caracteres raros no se busca por id (sin nada que escapar)', async () => {
    expect(await patronDe("ch_1'; DROP")).toBeNull();
  });
});
