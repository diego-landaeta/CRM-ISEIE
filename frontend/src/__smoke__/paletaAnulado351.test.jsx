import { describe, it, expect, vi } from 'vitest';

/**
 * #351 · El buscador (Ctrl K) y un número revertido: no está en Emitidos (está anulado). Lleva
 * al número que vale hoy para esa matrícula, en Emitidos; si no hay, a Revertidos, donde está el
 * anulado (ahí dice si ya se volvió a emitir).
 *
 *   npx vitest run src/__smoke__/paletaAnulado351.test.jsx
 */
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, permissions: null }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({}) }));
vi.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({}), useOptionalTheme: () => 'dark' }));
vi.mock('@/shared/api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

const { destinoDeDiploma, rotuloAnulado } = await import('@/shared/components/ui/CommandPalette');

describe('#351 · el buscador con un número revertido', () => {
  it('sin número que valga hoy, lleva a Revertidos con el número anulado (ahí está seguro)', () => {
    expect(destinoDeDiploma({ alumno: 'Ana Gómez', nexpediente: 'E-1', anulada: true, revocada: false, anulacion: { sustituidaPor: null, vigente: null } }))
      .toBe('/matriculas/diplomas?pestana=revertidos&buscar=E-1');
  });

  it('si hoy vale otro número, lleva a ese en Emitidos', () => {
    expect(destinoDeDiploma({ alumno: 'Ana', nexpediente: 'E-1', anulada: true, anulacion: { sustituidaPor: 'E-2', vigente: 'E-2' } }))
      .toBe('/matriculas/diplomas?pestana=enviados&buscar=E-2');
  });

  it('revertido dos veces: no al segundo (también anulado), sino al que vale; sin él, a Revertidos', () => {
    expect(destinoDeDiploma({ alumno: 'Ana', nexpediente: 'E-1', anulada: true, anulacion: { sustituidaPor: 'E-2', vigente: 'E-3' } }))
      .toBe('/matriculas/diplomas?pestana=enviados&buscar=E-3');
    expect(destinoDeDiploma({ alumno: 'Ana', nexpediente: 'E-1', anulada: true, anulacion: { sustituidaPor: 'E-2', vigente: null } }))
      .toBe('/matriculas/diplomas?pestana=revertidos&buscar=E-1');
  });

  it('con un Certifex que aún no manda `vigente`, vale `sustituidaPor`', () => {
    expect(destinoDeDiploma({ alumno: 'Ana', nexpediente: 'E-1', anulada: true, anulacion: { sustituidaPor: 'E-2' } }))
      .toBe('/matriculas/diplomas?pestana=enviados&buscar=E-2');
  });

  it('se volvió a emitir y se revocó: dice «curso cerrado», no «también revertido» (13.ª auditoría)', () => {
    expect(rotuloAnulado({ anulada: true, anulacion: { sustituidaPor: 'E-2', vigente: null, cursoCerrado: true } })).toMatch(/se revocó un diploma de ese curso: curso cerrado/);
    expect(rotuloAnulado({ anulada: true, anulacion: { sustituidaPor: 'E-2', vigente: 'E-3', cursoCerrado: false } })).toBe('Anulado (revertido) · hoy vale E-3');
    expect(rotuloAnulado({ anulada: true, anulacion: { sustituidaPor: null, vigente: null, cursoCerrado: false } })).toBe('Anulado (revertido)');
  });

  it('lo vigente y lo revocado, como siempre', () => {
    expect(destinoDeDiploma({ alumno: 'Ana', revocada: false })).toContain('pestana=enviados');
    expect(destinoDeDiploma({ alumno: 'Ana', revocada: true })).toContain('pestana=revocados');
  });
});
