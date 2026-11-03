import { describe, it, expect } from 'vitest';

/**
 * Novedades salía en «Algo se ha roto» (03/11, en `staging` y en producción):
 * la 2.2.0 —la actual, la que se abre por defecto y la que se manda sola al
 * arrancar— no traía `arreglos`, y la pantalla, el PDF, el correo y la campana
 * hacían `v.arreglos.length`. `versiones.js` ya da cada versión con sus listas.
 *
 *   npx vitest run tests/novedadesSinArreglos.test.js
 */

const { VERSIONES, ACTUAL, versionDe } = await import('../src/modules/novedades/versiones.js');
const { correoDe } = await import('../src/modules/novedades/novedades.service.js');
const { pdfDeVersion } = await import('../src/modules/novedades/novedades.pdf.js');
const { CRM } = await import('../src/modules/novedades/versiones.js');

describe('cada versión trae sus listas', () => {
  it.each(VERSIONES.map((v) => [v.version, v]))('%s: grupos con items y arreglos, aunque sean vacíos', (_n, v) => {
    expect(Array.isArray(v.grupos)).toBe(true);
    for (const g of v.grupos) expect(Array.isArray(g.items)).toBe(true);
    expect(Array.isArray(v.arreglos)).toBe(true);
  });

  it('la 2.2.0 no tiene arreglos: lista vacía, no un fallo', () => {
    expect(versionDe('2.2.0').arreglos).toEqual([]);
  });

  // Producción iba por la 2.5.19 y Novedades seguía anunciando la 2.2.0 (CRM#625).
  // Una versión nueva se añade arriba; nunca puede quedar detrás de la 2.5.19.
  it('la actual no es más vieja que la 2.5.19 (CRM#625)', () => {
    expect(ACTUAL.version.localeCompare('2.5.19', undefined, { numeric: true })).toBeGreaterThanOrEqual(0);
  });

  it('de la más nueva a la más vieja, sin repetir', () => {
    const nums = VERSIONES.map((v) => v.version);
    expect(new Set(nums).size).toBe(nums.length);
    const orden = [...nums].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    expect(nums).toEqual(orden);
  });

  it.each(VERSIONES.map((v) => [v.version, v]))('%s: cada novedad con título y texto, y botón solo con pantalla', (_n, v) => {
    for (const g of v.grupos) {
      expect(g.items.length).toBeGreaterThan(0);
      for (const it of g.items) {
        expect(it.titulo).toBeTruthy();
        expect(it.texto).toBeTruthy();
        if (!it.ruta) expect(it.boton ?? null).toBeNull();
      }
    }
  });
});

describe('el correo y el PDF no revientan, con arreglos y sin ellos', () => {
  it.each(['2.5.19', '2.2.0'])('el correo de la %s', (n) => {
    expect(() => correoDe(versionDe(n), 'Ana')).not.toThrow();
  });

  it.each(['2.5.19', '2.2.0'])('el PDF de la %s', async (n) => {
    const pdf = await pdfDeVersion(versionDe(n), { crm: CRM, baseUrl: 'https://crm.test' });
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
