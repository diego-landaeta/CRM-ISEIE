// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { avisoSinTerminar } from '@/modules/certifex/components/piezas';

/**
 * #629 / CRM-ISEIE #356: «Pasar a pendientes» pide confirmación en la página si el
 * avance de calificadas no llega al 100 % o falta la nota. Mismos textos que el 409
 * SIN_TERMINAR del backend (backend/tests/certifexEmitirAlcance.test.js): el diálogo dice
 * lo mismo lo abra la fila o la respuesta del servidor.
 */
const fila = (cambios: Partial<Parameters<typeof avisoSinTerminar>[0]>) => ({
  notaFinal: 8 as number | null,
  actividades: { total: 4, calificadas: 4 },
  entregas: { total: 3, entregadas: 3, en: '2026-11-02T08:00:00.000Z' } as { total: number; entregadas: number; en: string } | null,
  ...cambios,
});

describe('avisoSinTerminar', () => {
  it('con nota y todo calificado: nada que confirmar', () => {
    expect(avisoSinTerminar(fila({}))).toBeNull();
  });

  it('el caso del máster: todas las tareas visibles entregadas, 0 % calificado y sin nota', () => {
    expect(avisoSinTerminar(fila({ notaFinal: null, actividades: { total: 10, calificadas: 0 }, entregas: { total: 2, entregadas: 2, en: '' } })))
      .toBe('Ha entregado 2 de 2 tareas visibles, tiene 0 de 10 actividades calificadas y no tiene nota: ¿seguro?');
  });

  it('solo falta la nota', () => {
    expect(avisoSinTerminar(fila({ notaFinal: null, entregas: { total: 3, entregadas: 1, en: '' } })))
      .toBe('Solo ha entregado 1 de 3 tareas visibles y no tiene nota: ¿seguro?');
  });

  it('con nota, calificadas por debajo del 100 % y sin datos de tareas', () => {
    expect(avisoSinTerminar(fila({ notaFinal: 7, actividades: { total: 4, calificadas: 3 }, entregas: null })))
      .toBe('No hay datos de sus tareas entregadas y tiene 3 de 4 actividades calificadas: ¿seguro?');
  });

  it('un campus sin actividades publicadas: con nota no pide confirmar; sin nota, sí', () => {
    expect(avisoSinTerminar(fila({ actividades: { total: 0, calificadas: 0 } }))).toBeNull();
    expect(avisoSinTerminar(fila({ notaFinal: null, actividades: { total: 0, calificadas: 0 } }))).toBe('Ha entregado 3 de 3 tareas visibles y no tiene nota: ¿seguro?');
  });

  it('una nota de 0 es una nota', () => {
    expect(avisoSinTerminar(fila({ notaFinal: 0 }))).toBeNull();
  });
});
