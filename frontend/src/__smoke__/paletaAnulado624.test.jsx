import { describe, it, expect, vi } from 'vitest';

/**
 * #351 · El buscador (Ctrl K) y un número revertido: no está en Emitidos (está anulado) y su
 * matrícula vuelve a Pendientes › «Aprobados sin diploma». El destino lleva ahí, a la pestaña
 * por defecto, y no a «enviados», donde no lo encontraría.
 *
 *   npx vitest run src/__smoke__/paletaAnulado624.test.jsx
 */
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, permissions: null }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({}) }));
vi.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({}), useOptionalTheme: () => 'dark' }));
vi.mock('@/shared/api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

const { destinoDeDiploma } = await import('@/shared/components/ui/CommandPalette');

describe('#351 · el buscador con un número revertido', () => {
  it('lleva a Diplomas › Pendientes (sin pestaña), buscando al alumno', () => {
    expect(destinoDeDiploma({ alumno: 'Ana Gómez', nexpediente: 'E-1', anulada: true, revocada: false }))
      .toBe('/matriculas/diplomas?buscar=Ana%20G%C3%B3mez');
  });

  it('si ya se reemitió, lleva al número NUEVO en Emitidos (no a Pendientes, donde ya no está)', () => {
    expect(destinoDeDiploma({ alumno: 'Ana Gómez', nexpediente: 'E-1', anulada: true, revocada: false, anulacion: { sustituidaPor: 'E-2' } }))
      .toBe('/matriculas/diplomas?pestana=enviados&buscar=E-2');
    expect(destinoDeDiploma({ alumno: 'Ana', nexpediente: 'E-1', anulada: true, anulacion: { sustituidaPor: null } }))
      .toBe('/matriculas/diplomas?buscar=Ana');
  });

  it('lo vigente y lo revocado, como siempre', () => {
    expect(destinoDeDiploma({ alumno: 'Ana', revocada: false })).toContain('pestana=enviados');
    expect(destinoDeDiploma({ alumno: 'Ana', revocada: true })).toContain('pestana=revocados');
  });
});
