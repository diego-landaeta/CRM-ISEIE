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

import { describe, it, expect } from 'vitest';

/*
  Gemela de CRM#346 · Un filtro de campus guardado en la dirección sobrevivía a
  cambiar la empresa de arriba: lo elegido que ya no era del ámbito seguía
  mandando y el desplegable no lo enseñaba. Con «Todos» o una empresa arriba,
  solo cuenta lo elegido que sea de ese ámbito.

  En MultiCRM la prueba recorre `useLeads` con `?multi=`. En ISEIE Prospectos no
  tiene filtro de varios campus (ni `?multi=`), así que aquí solo se porta la
  regla, que vive en `useAmbito.ts` y es la misma en los dos CRM.
*/

const { soloDelAmbito } = await import('@/shared/hooks/useAmbito');

describe('el filtro de campus guardado sigue al ámbito (#346)', () => {
  it('de lo elegido, se queda solo lo que es del ámbito', () => {
    expect(soloDelAmbito([20, 11, 99], [10, 11])).toEqual([11]);
  });

  it('nada elegido, nada; nada en el ámbito, nada', () => {
    expect(soloDelAmbito([], [10])).toEqual([]);
    expect(soloDelAmbito([10, 11], [])).toEqual([]);
  });

  it('respeta el orden de lo elegido', () => {
    expect(soloDelAmbito([11, 10], [10, 11, 20])).toEqual([11, 10]);
  });
});
