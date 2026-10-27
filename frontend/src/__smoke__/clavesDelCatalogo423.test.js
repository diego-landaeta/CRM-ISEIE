import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * #423 · Toda clave que use la pantalla existe en el catálogo.
 *
 * Sustituye a `permisosEspejo.test.js`, que comparaba una copia de la tabla
 * del servidor con el servidor. Ya no hay copia: el mapa llega del servidor.
 * Lo que sí puede pasar es preguntar por una clave que no existe —`can()` dice
 * que no a todo el mundo menos al superadmin, sin avisar—, y eso es lo que se
 * mira aquí: `can('…')`, `permiso: '…'` y `oPermiso: '…'` en todo `src/`.
 */

const { CLAVES } = await import('../../../backend/src/modules/permissions/catalogo.js');

const SRC = path.resolve(__dirname, '..');
const PATRON = /\bcan\(\s*['"]([a-z_]+(?:\.[a-z_]+)?)['"]\s*\)|\b(?:o[Pp]ermiso|permiso)\s*:\s*['"]([a-z_.]+)['"]/g;

/**
 * Ninguna pendiente desde la fase 4: `leads.reassign` (que no existió nunca) es
 * `leads.assign`, y «Facturación» ya no pregunta por la casilla `factura_manager`.
 */
const PENDIENTES_FASE_4 = new Set();

function ficheros(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'test' || e.name === '__tests__' ? [] : ficheros(p);
    return /\.(jsx?|tsx?)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

describe('claves del catálogo en la pantalla (#423)', () => {
  const usadas = new Map();
  for (const f of ficheros(SRC)) {
    const texto = fs.readFileSync(f, 'utf8');
    for (const m of texto.matchAll(PATRON)) {
      const clave = m[1] || m[2];
      if (!usadas.has(clave)) usadas.set(clave, path.relative(SRC, f));
    }
  }

  it('encuentra las claves (si no, el patrón está mal)', () => {
    expect(usadas.size).toBeGreaterThan(20);
  });

  it('cada clave que pregunta la pantalla existe en el catálogo', () => {
    const noExisten = [...usadas].filter(([k]) => !CLAVES.has(k) && !PENDIENTES_FASE_4.has(k)).map(([k, f]) => `${k} (${f})`);
    expect(noExisten).toEqual([]);
  });
});
