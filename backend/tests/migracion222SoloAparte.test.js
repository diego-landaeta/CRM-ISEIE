import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * #423, QA de Diego (22/10) · punto 9: «tus pruebas pasan la 239 sobre toda la
 * tabla users: que usen datos propios». La 239 solo se pasa en las pruebas con
 * `helpers/migracion222Aparte.js` (copias temporales de las tablas). Ninguna
 * otra prueba la lee para ejecutarla; `clavesEnUso423` la lee como texto.
 */

const aqui = path.dirname(fileURLToPath(import.meta.url));
const SOLO_LA_LEE = ['clavesEnUso423.test.js'];

describe('la 239 en las pruebas, siempre aparte (#423, punto 9)', () => {
  it('ninguna prueba la pasa contra la base compartida', () => {
    const fuera = fs.readdirSync(aqui)
      .filter((f) => f.endsWith('.test.js') && !SOLO_LA_LEE.includes(f) && f !== path.basename(fileURLToPath(import.meta.url)))
      .filter((f) => fs.readFileSync(path.join(aqui, f), 'utf8').includes('239_permisos_casillas_a_excepciones'));
    expect(fuera).toEqual([]);
  });
});
