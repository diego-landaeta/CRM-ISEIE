import { describe, it, expect } from 'vitest';
import { paginasVisibles } from './Paginacion';

/** Las páginas que enseña la paginación: la primera, la última y las de al lado de la actual. */
describe('paginasVisibles', () => {
  it('con siete páginas o menos, todas', () => {
    expect(paginasVisibles(1, 1)).toEqual([1]);
    expect(paginasVisibles(3, 6)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(paginasVisibles(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('al principio: las primeras, puntos y la última', () => {
    expect(paginasVisibles(1, 14)).toEqual([1, 2, 3, 4, '…', 14]);
    expect(paginasVisibles(3, 14)).toEqual([1, 2, 3, 4, '…', 14]);
  });

  it('en medio: la primera, puntos, la de antes, la actual, la de después, puntos y la última', () => {
    expect(paginasVisibles(7, 14)).toEqual([1, '…', 6, 7, 8, '…', 14]);
  });

  it('al final: la primera, puntos y las últimas', () => {
    expect(paginasVisibles(14, 14)).toEqual([1, '…', 11, 12, 13, 14]);
    expect(paginasVisibles(12, 14)).toEqual([1, '…', 11, 12, 13, 14]);
  });

  it('no pone puntos entre dos páginas seguidas', () => {
    const p = paginasVisibles(5, 9);
    expect(p).toEqual([1, '…', 4, 5, 6, '…', 9]);
    expect(paginasVisibles(4, 9)).toEqual([1, 2, 3, 4, 5, '…', 9]);
  });
});
