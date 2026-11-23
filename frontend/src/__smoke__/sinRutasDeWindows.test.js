import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// 2.9.3: Git Bash convirtió «/finanzas/ventas/» en «C:/Program Files/Git/finanzas/ventas/» al aplicar
// un parche, y «Verlos en la venta» llevaba a una página que no existía. Que no vuelva a colarse.
function ficheros(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : ficheros(p);
    return /\.(t|j)sx?$/.test(e.name) ? [p] : [];
  });
}

describe('sin rutas de Windows en el código', () => {
  it('ningún fichero de src lleva «Program Files» ni «C:/» en una ruta', () => {
    const src = path.resolve(__dirname, '..');
    const malos = ficheros(src).filter((f) => !f.endsWith('sinRutasDeWindows.test.js'))
      .filter((f) => /Program Files|[A-Z]:\/(Users|Program)/.test(fs.readFileSync(f, 'utf8')));
    expect(malos).toEqual([]);
  });
});
