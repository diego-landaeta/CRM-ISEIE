import { describe, it, expect } from 'vitest';
import { celdaCsv, filaCsv, diaDeMadrid, rangoEnNombre } from '@/shared/lib/csv';

/**
 * Los CSV de Reportes y de Feedback (#593). Lo que escribe la gente en la
 * encuesta pública acaba en el CSV: si empieza por «=» era una fórmula al
 * abrirlo en Excel.
 */
describe('una celda de CSV', () => {
  it('neutraliza lo que Excel tomaría por fórmula', () => {
    expect(celdaCsv('=HYPERLINK("http://x","pulsa")')).toBe('"\'=HYPERLINK(""http://x"",""pulsa"")"');
    expect(celdaCsv('+34 600')).toBe('"\'+34 600"');
    expect(celdaCsv('@SUM(A1)')).toBe('"\'@SUM(A1)"');
    expect(celdaCsv('-cmd|calc')).toBe('"\'-cmd|calc"');
    expect(celdaCsv('\tlo que sea')).toBe('"\'\tlo que sea"');
  });

  it('deja los números como están, también los negativos', () => {
    expect(celdaCsv(-12.5)).toBe('"-12.5"');
    expect(celdaCsv('-12.50')).toBe('"-12.50"');
    expect(celdaCsv('-3 %')).toBe('"-3 %"');
    expect(celdaCsv(0)).toBe('"0"');
  });

  it('el texto normal, igual que siempre', () => {
    expect(celdaCsv('El precio')).toBe('"El precio"');
    expect(celdaCsv(null)).toBe('""');
    expect(filaCsv(['a', 1, '=1+1'])).toBe('"a","1","\'=1+1"');
  });
});

describe('las fechas y el nombre del fichero', () => {
  it('el día en hora de Madrid, no en UTC', () => {
    // 23:30 UTC del 1 de noviembre son las 00:30 del 2 en Madrid.
    expect(diaDeMadrid('2026-11-01T23:30:00Z')).toBe('2026-11-02');
    expect(diaDeMadrid(null)).toBe('');
  });

  it('sin fechas, «desde-siempre» y no «_»', () => {
    expect(rangoEnNombre('', '')).toBe('desde-siempre');
    expect(rangoEnNombre('2026-10-01', '2026-10-31')).toBe('2026-10-01_2026-10-31');
  });
});
