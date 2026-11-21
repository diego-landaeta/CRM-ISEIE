import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
  CRM#923 · Plan de cuotas: una cuota mal escrita daba 500 en lugar de 400.

  Visto en /testeo el 19/11: POST /api/conversions/:id/installments/generate con
  una cuota mal escrita respondía 500 («Cuota 1: importe inválido»). El
  controlador no validaba el cuerpo y el modelo lanzaba un Error suelto dentro de
  la transacción. Leyendo el código salieron dos más: `num_cuotas: "abc"` pasaba
  las comprobaciones a mano, borraba las cuotas sin cobrar y no creaba ninguna
  (200 y la venta sin plan), y una fecha que no es fecha daba 500.

  Ahora el cuerpo se valida con Zod ANTES de tocar la base: 400
  VALIDATION_ERROR, con la cuota que falla, y el modelo ni se llama. Sin base.
*/

const db = vi.hoisted(() => ({ consultas: [] }));
vi.mock('../src/shared/config/db.js', () => ({
  query: vi.fn(async () => ({ rows: [] })),
  getClient: vi.fn(async () => ({
    query: vi.fn(async (sql) => {
      db.consultas.push(String(sql).trim().split(/\s+/)[0]);
      return { rows: [{ ultima: 0 }] };
    }),
    release: vi.fn(),
  })),
}));
vi.mock('../src/modules/conversions/installments.model.js', () => ({
  generateInstallments: vi.fn(async () => [{ id: 1, numero: 1 }]),
}));

const ctrl = await import('../src/modules/conversions/conversion.controller.js');
const modelo = await import('../src/modules/conversions/installments.model.js');

async function generar(body) {
  let salida = null;
  let error = null;
  const res = { json: (d) => { salida = d; }, status() { return this; } };
  await ctrl.generateInstallments({ user: { userId: 3, role: 'admin' }, params: { id: '70' }, body, query: {} }, res, (e) => { error = e; });
  return { salida, error };
}

beforeEach(() => {
  modelo.generateInstallments.mockClear();
  db.consultas.length = 0;
});

describe('cuotas a medida mal escritas: 400, no 500, y sin tocar la base', () => {
  it.each([
    ['«importe» en vez de «importe_previsto»', [{ importe: 50, fecha_vencimiento: '2026-12-01' }], /^Cuota 1: falta el importe/],
    ['falta fecha_vencimiento («fecha»)', [{ importe_previsto: 50, fecha: '2026-12-01' }], /^Cuota 1: falta la fecha de vencimiento/],
    ['importe «abc»', [{ importe_previsto: 'abc', fecha_vencimiento: '2026-12-01' }], /^Cuota 1: el importe no es un número/],
    ['importe negativo', [{ importe_previsto: -5, fecha_vencimiento: '2026-12-01' }], /^Cuota 1: el importe tiene que ser mayor que 0/],
    ['la segunda, con una fecha que no existe', [
      { importe_previsto: 50, fecha_vencimiento: '2026-12-01' },
      { importe_previsto: 50, fecha_vencimiento: '2026-02-30' },
    ], /^Cuota 2: esa fecha no existe/],
    ['una fecha que no es fecha', [{ importe_previsto: 50, fecha_vencimiento: 'hola' }], /^Cuota 1: la fecha va como AAAA-MM-DD/],
  ])('%s', async (_caso, installments, mensaje) => {
    const { salida, error } = await generar({ installments });
    expect(salida).toBeNull();
    expect(error?.statusCode).toBe(400);
    expect(error?.code).toBe('VALIDATION_ERROR');
    expect(error?.message).toMatch(mensaje);
    expect(modelo.generateInstallments).not.toHaveBeenCalled();
  });

  it('bien escritas, pasan (también con el importe como texto, como antes)', async () => {
    const { error, salida } = await generar({
      installments: [{ importe_previsto: 50, fecha_vencimiento: '2026-12-01' }, { importe_previsto: '25.5', fecha_vencimiento: '2027-01-01' }],
      concepto: 'Tutoría',
    });
    expect(error).toBeNull();
    expect(salida.success).toBe(true);
    expect(modelo.generateInstallments).toHaveBeenCalledWith(70, null, null, null, [
      { importe_previsto: 50, fecha_vencimiento: '2026-12-01' },
      { importe_previsto: 25.5, fecha_vencimiento: '2027-01-01' },
    ], 'Tutoría');
  });
});

describe('cuotas iguales mal escritas', () => {
  it('num_cuotas «abc» ya no borra el plan: 400 y el modelo ni se llama', async () => {
    const { error, salida } = await generar({ num_cuotas: 'abc', importe_total: 300, fecha_inicio: '2026-12-01' });
    expect(salida).toBeNull();
    expect(error?.statusCode).toBe(400);
    expect(error?.message).toBe('num_cuotas no es un número');
    expect(modelo.generateInstallments).not.toHaveBeenCalled();
  });

  it.each([
    ['sin nada', {}, 'num_cuotas requerido'],
    ['num_cuotas 0', { num_cuotas: 0, importe_total: 300, fecha_inicio: '2026-12-01' }, /entero mayor o igual que 1/],
    ['num_cuotas 2,5', { num_cuotas: 2.5, importe_total: 300, fecha_inicio: '2026-12-01' }, /entero mayor o igual que 1/],
    ['sin importe_total', { num_cuotas: 3, fecha_inicio: '2026-12-01' }, 'importe_total requerido'],
    ['fecha_inicio «xx» (antes, 500 en toISOString)', { num_cuotas: 3, importe_total: 300, fecha_inicio: 'xx' }, /AAAA-MM-DD/],
  ])('%s', async (_caso, body, mensaje) => {
    const { error } = await generar(body);
    expect(error?.statusCode).toBe(400);
    expect(error?.code).toBe('VALIDATION_ERROR');
    expect(error?.message).toMatch(mensaje);
    expect(modelo.generateInstallments).not.toHaveBeenCalled();
  });

  it('bien escritas, pasan con números de verdad', async () => {
    const { error } = await generar({ num_cuotas: '3', importe_total: '300', fecha_inicio: '2026-12-01' });
    expect(error).toBeNull();
    expect(modelo.generateInstallments).toHaveBeenCalledWith(70, 3, 300, '2026-12-01', null, undefined);
  });
});

describe('el modelo, si otro camino lo llama sin validar', () => {
  it('una cuota mal escrita es un 400 y la transacción se deshace', async () => {
    const real = await vi.importActual('../src/modules/conversions/installments.model.js');
    const err = await real.generateInstallments(70, null, null, null, [{ importe: 50, fecha_vencimiento: '2026-12-01' }])
      .then(() => null, (e) => e);
    expect(err?.statusCode).toBe(400);
    expect(err?.code).toBe('VALIDATION_ERROR');
    expect(err?.message).toBe('Cuota 1: importe inválido');
    expect(db.consultas).toContain('ROLLBACK');
    expect(db.consultas).not.toContain('COMMIT');
    expect(db.consultas).not.toContain('INSERT');
  });
});
