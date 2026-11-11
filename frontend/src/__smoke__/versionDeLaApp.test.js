import { describe, it, expect } from 'vitest';

/*
  11/11 · La versión del menú estaba escrita a mano en `betaConfig.ts` y se
  quedaba atrás (2.6.0 con la v2.6.1 en producción; en el 360, «BETA 2.2.0»
  con la 2.5.24). Ahora sale de la etiqueta de Git al compilar.
*/

const { versionMasAlta } = await import('../../scripts/versionDeLaApp.js');

describe('la versión que enseña el CRM', () => {
  it('la etiqueta más alta, no la primera ni la de orden alfabético', () => {
    expect(versionMasAlta({ etiquetas: ['v2.2.0', 'v2.6.0', 'v2.6.1', 'v2.10.0-rc', ''] })).toBe('2.6.1');
  });

  it('la fusión de la versión, antes de etiquetarla', () => {
    expect(versionMasAlta({ etiquetas: ['v2.6.1'], asunto: 'v2.6.2 · rol «Tutor redactor» (#434)' })).toBe('2.6.2');
    expect(versionMasAlta({ etiquetas: ['v2.6.1'], asunto: 'fix: algo de la v9.9.9' })).toBe('2.6.1');
  });

  it('sin etiquetas ni versión en el título, nada', () => {
    expect(versionMasAlta({})).toBeNull();
  });
});
