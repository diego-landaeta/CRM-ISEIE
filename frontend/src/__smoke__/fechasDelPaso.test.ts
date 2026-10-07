import { describe, it, expect } from 'vitest';
import { diaLocal, fechaAplazada, fechaCorta } from '@/modules/proceso/lib/fechasDelPaso';

/**
 * Lo rescatado de la PR #150 de Fabián: el paso de hoy salía fechado AYER al
 * oeste de Greenwich, y aplazar tiene que contar desde hoy.
 */
describe('las fechas del paso', () => {
  it('la fecha del servidor es ese día del calendario, venga como venga', () => {
    for (const f of ['2026-09-16', '2026-09-16T00:00:00.000Z']) {
      const d = diaLocal(f);
      expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 9, 16]);
    }
  });

  it('la lista dice el mismo día que la cola', () => {
    expect(fechaCorta('2026-09-16T00:00:00.000Z')).toMatch(/^16/);
  });

  it('aplazar cuenta desde hoy, y cruza el mes sin perderse', () => {
    const hoy = new Date(2026, 8, 29, 23, 30); // 29/09 a las 23:30, hora local
    expect(fechaAplazada(1, hoy)).toBe('2026-09-30');
    expect(fechaAplazada(3, hoy)).toBe('2026-10-02');
    expect(fechaAplazada(7, hoy)).toBe('2026-10-06');
  });
});
