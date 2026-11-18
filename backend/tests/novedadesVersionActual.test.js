import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Novedades salía en «Algo se ha roto» en producción (#352, gemela de CRM#625; auditoría del
 * 03/11/2026): la versión actual era la 2.2.0, que no traía `arreglos`, y la
 * pantalla, el PDF, el correo y la campana hacen `v.arreglos.length`.
 *
 * En la 2.6.0 cada versión lleva sus listas en los datos, y la actual es la
 * misma que enseña el menú. La #372 (la CRM#623 de MultiCRM) lo blinda además en el
 * código; esta prueba no depende de ella.
 *
 *   npx vitest run tests/novedadesVersionActual.test.js
 */

const { VERSIONES, ACTUAL } = await import('../src/modules/novedades/versiones.js');
const AQUI = path.dirname(fileURLToPath(import.meta.url));

describe('Novedades: cada versión con sus listas', () => {
  it.each(VERSIONES.map((v) => [v.version, v]))('%s trae grupos con items y arreglos', (_n, v) => {
    expect(Array.isArray(v.grupos)).toBe(true);
    for (const g of v.grupos) expect(Array.isArray(g.items)).toBe(true);
    expect(Array.isArray(v.arreglos)).toBe(true);
  });

  // El menú ya no lleva la versión escrita a mano (11/11): se quedaba atrás
  // («Beta 2.6.0» con producción en la 2.6.2). La pone Vite al compilar, de la
  // etiqueta de Git más alta, que nunca es menor que la de Novedades.
  it('la actual es la 2.6.0, y el menú la saca de la etiqueta, no escrita a mano', async () => {
    expect(ACTUAL.version).toBe('2.6.0');
    const beta = fs.readFileSync(path.resolve(AQUI, '../../frontend/src/shared/config/betaConfig.ts'), 'utf8');
    expect(beta).not.toMatch(/BETA_VERSION\s*=\s*'\d/);
    expect(beta).toMatch(/__APP_VERSION__/);
    const { versionMasAlta } = await import('../../frontend/scripts/versionDeLaApp.js');
    expect(versionMasAlta({ etiquetas: [`v${ACTUAL.version}`] })).toBe(ACTUAL.version);
  });
});
