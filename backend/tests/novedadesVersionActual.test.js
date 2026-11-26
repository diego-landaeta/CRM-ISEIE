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

  // El menú ya no lleva la versión escrita a mano (11/11). Desde el 25/11 la
  // saca de aquí, de Novedades: la etiqueta de Git no llegaba al build de
  // producción (clona con --depth 1) y salía «Beta 1.0.0».
  it('la actual es la 3.0.0, y el CRM la saca de Novedades, no escrita a mano', async () => {
    expect(ACTUAL.version).toBe('3.0.0');
    const version = fs.readFileSync(path.resolve(AQUI, '../../frontend/src/shared/config/version.ts'), 'utf8');
    expect(version).not.toMatch(/VERSION_APP[^=]*=\s*'\d/);
    expect(version).toMatch(/__APP_VERSION__/);
    const { versionDeLaApp } = await import('../../frontend/scripts/versionDeLaApp.js');
    expect(versionDeLaApp({ cwd: path.resolve(AQUI, '../../frontend') })).toBe(ACTUAL.version);
  });
});
