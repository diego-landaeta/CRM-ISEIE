// @vitest-environment jsdom
// Traída de MultiCRM (2.6.0). ISEIE no tiene un setup común de pruebas: el entorno,
// los matchers de jest-dom y la limpieza entre pruebas se ponen aquí.
import '@testing-library/jest-dom/vitest';
import { afterEach as despuesDeCada } from 'vitest';
import { cleanup as limpiar } from '@testing-library/react';

despuesDeCada(limpiar);
if (typeof window !== 'undefined') {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia ??= () => ({ matches: false, media: '', onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
}

import { describe, it, expect, vi, afterAll } from 'vitest';

/*
  Consultas de alumnos (#187–#190) entra en la 2.6.0. Con el modo BETA del build
  de producción, una ruta que no está en BETA_ROUTES sale como «Próximamente»:
  sin `/consultas` en la lista, el tutor y el panel verían el menú apagado.
*/

vi.stubEnv('VITE_BETA_MODE', 'true');
const { isBetaAllowed, BETA_MODE } = await import('@/shared/config/betaConfig');
afterAll(() => vi.unstubAllEnvs());

describe('Consultas de alumnos con el modo BETA', () => {
  it('el modo BETA está puesto en esta prueba', () => {
    expect(BETA_MODE).toBe(true);
  });

  it('la bandeja y sus pantallas no salen como «Próximamente»', () => {
    for (const ruta of ['/consultas', '/consultas/alumnos', '/consultas/carga', '/consultas/tutores']) {
      expect(isBetaAllowed(ruta)).toBe(true);
    }
  });

  it('lo que no está en la lista sigue apagado', () => {
    expect(isBetaAllowed('/consultasx')).toBe(false);
  });
});
