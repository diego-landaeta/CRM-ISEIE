import { describe, it, expect } from 'vitest';
import { planificar } from '../src/modules/conversions/saldar-cuotas.js';

/**
 * CRM#888 (gemela CRM-ISEIE#559) · La decisión de qué cuota salda cada cobro,
 * sin base de datos. Los casos con la base van en cuotasSaldadas888.test.js.
 */

const cuota = (id, numero, importe_previsto, fecha_cobro = null) => ({ id, numero, importe_previsto, fecha_cobro });
const cobro = (id, importe, fecha, metodo = 'tarjeta') => ({ id, importe, fecha, metodo });

describe('#888 · planificar', () => {
  it('la venta del 18/11: el pago inicial salda la cuota 1 y el de septiembre la 2', () => {
    const { fuera, acciones } = planificar({
      total: 465,
      cuotas: [cuota(6, 1, 232.5), cuota(7, 2, 232.5)],
      sueltos: [cobro(1121, 232.5, '2026-09-03'), cobro(377, 232.5, '2026-07-17', null)],
    });
    expect(fuera).toEqual([]);
    expect(acciones.map((a) => [a.tipo, a.numero, a.paymentId, a.fecha, a.cobrado])).toEqual([
      ['saldar', 1, 377, '2026-07-17', 232.5],
      ['saldar', 2, 1121, '2026-09-03', 232.5],
    ]);
  });

  it('el plan es «lo que queda»: la matrícula no salda ninguna cuota', () => {
    const { fuera, acciones } = planificar({
      total: 1500,
      cuotas: [cuota(1, 1, 500), cuota(2, 2, 500)],
      sueltos: [cobro(10, 250, '2026-01-10'), cobro(11, 250, '2026-02-10'), cobro(12, 500, '2026-03-10')],
    });
    expect(fuera).toEqual([10, 11]);
    expect(acciones).toHaveLength(1);
    expect(acciones[0]).toMatchObject({ tipo: 'saldar', numero: 1, paymentId: 12 });
  });

  it('unos céntimos de diferencia: salda la cuota con lo que entró de verdad', () => {
    const { acciones } = planificar({
      total: 569.16, cuotas: [cuota(1, 1, 284.58), cuota(2, 2, 284.58)],
      sueltos: [cobro(5, 284.5, '2026-04-20')],
    });
    expect(acciones).toEqual([expect.objectContaining({ tipo: 'saldar', numero: 1, cobrado: 284.5 })]);
  });

  it('un euro o menos de diferencia entre el total y el plan es redondeo, no matrícula', () => {
    const { fuera, acciones } = planificar({
      total: 410, cuotas: [cuota(1, 1, 204), cuota(2, 2, 204)], sueltos: [cobro(9, 205, '2026-09-15')],
    });
    // 410 - 408 = 2 €: más de un euro, pero el cobro (205) no cabe en esos 2 €.
    expect(fuera).toEqual([]);
    expect(acciones[0]).toMatchObject({ tipo: 'saldar', numero: 1, cobrado: 205 });
  });

  it('un cobro que paga dos cuotas salda las dos', () => {
    const { acciones } = planificar({
      total: 616.32, cuotas: [cuota(1, 1, 154.08, '2026-03-07'), cuota(2, 2, 154.08), cuota(3, 3, 154.08), cuota(4, 4, 154.08)],
      sueltos: [cobro(586, 308.16, '2026-05-28')],
    });
    expect(acciones.map((a) => [a.tipo, a.numero, a.paymentId, a.cobrado])).toEqual([
      ['saldar', 2, 586, 154.08],
      ['saldar', 3, 586, 154.08],
    ]);
  });

  it('los céntimos de un cobro que paga dos cuotas se quedan en la segunda, no parten la tercera', () => {
    const { acciones } = planificar({
      total: 714.99, cuotas: [cuota(1, 1, 238.33), cuota(2, 2, 238.33), cuota(3, 3, 238.33)],
      sueltos: [cobro(1134, 478, '2026-09-07')],
    });
    expect(acciones.map((a) => [a.tipo, a.numero, a.cobrado])).toEqual([
      ['saldar', 1, 238.33],
      ['saldar', 2, 239.67],
    ]);
  });

  it('un cobro que no llega salda la cuota EN PARTE y el resto sigue pendiente', () => {
    const { acciones } = planificar({
      total: 600, cuotas: [cuota(1, 1, 200), cuota(2, 2, 200), cuota(3, 3, 200)],
      sueltos: [cobro(1, 100, '2026-01-01'), cobro(2, 300, '2026-02-01')],
    });
    expect(acciones.map((a) => [a.tipo, a.numero, a.paymentId, a.cobrado, a.resto])).toEqual([
      ['partir', 1, 1, 100, 100],
      // El resto es ahora la cuota 2 (sin id aún) y la vieja 2 pasa a 3.
      ['saldar', 2, 2, 100, undefined],
      ['saldar', 3, 2, 200, undefined],
    ]);
    expect(acciones[1].cuotaId).toBeNull();
    expect(acciones[2].cuotaId).toBe(2);
  });

  it('sin cuotas pendientes no hace nada (el sobrante no se inventa una cuota)', () => {
    const { acciones } = planificar({
      total: 300, cuotas: [cuota(1, 1, 300, '2026-01-01')], sueltos: [cobro(3, 50, '2026-02-01')],
    });
    expect(acciones).toEqual([]);
  });
});
