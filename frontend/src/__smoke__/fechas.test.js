import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { soloFecha, diasHasta, cuandoVence } from '@/shared/lib/fechas';

/*
  Traída de MultiCRM (test/fechas.test.js), con solo lo que hay en el
  `shared/lib/fechas.ts` de ISEIE: `formatFecha` y `formatRelative` aquí viven
  en leadFormat y no se prueban en este fichero.

  El servidor manda las columnas DATE en crudo —«2026-12-01», sin hora—.
  `new Date('2026-12-01')` es UTC, y al oeste de Greenwich cae en el día
  anterior.
*/

describe('fechas sin hora', () => {
  it('lee el día que dice el texto, no el de UTC', () => {
    const d = soloFecha('2026-12-01');
    expect(d.getDate()).toBe(1);
    expect(d.getMonth()).toBe(11);
    expect(d.getFullYear()).toBe(2026);
  });

  it('sin fecha no inventa nada', () => {
    expect(soloFecha(null)).toBeNull();
    expect(soloFecha('')).toBeNull();
    expect(diasHasta(undefined)).toBeNull();
  });

  it('una fecha imposible no revienta', () => {
    expect(soloFecha('no es una fecha')).toBeNull();
    expect(diasHasta('no es una fecha')).toBeNull();
  });
});

describe('cuánto falta o cuánto hace', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Un miércoles cualquiera, a media tarde.
    vi.setSystemTime(new Date(2026, 8, 16, 17, 30));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('cuenta días enteros, no franjas de 24 horas', () => {
    expect(diasHasta('2026-09-16')).toBe(0);
    expect(diasHasta('2026-09-17')).toBe(1);
    expect(diasHasta('2026-09-15')).toBe(-1);
  });

  it('lo de hoy es «hoy» aunque falten horas para medianoche', () => {
    expect(cuandoVence('2026-09-16')).toEqual({ texto: 'hoy', urgente: true });
  });

  it('lo vencido se marca como urgente y dice cuánto lleva', () => {
    expect(cuandoVence('2026-09-13')).toEqual({ texto: 'vencido hace 3d', urgente: true });
  });

  it('lo que viene no es urgente', () => {
    expect(cuandoVence('2026-09-17')).toEqual({ texto: 'mañana', urgente: false });
    expect(cuandoVence('2026-09-20')).toEqual({ texto: 'en 4d', urgente: false });
  });

  it('sin fecha lo dice, en vez de colarse como vencido', () => {
    expect(cuandoVence(null)).toEqual({ texto: 'sin fecha', urgente: false });
  });
});
