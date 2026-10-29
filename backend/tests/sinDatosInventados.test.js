import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// #216 (revisión del 03/10): Campañas y Tráfico orgánico enseñaban en producción
// datos de EJEMPLO porque sus clientes de la API tenían `USE_MOCKS = true`
// (12.480 clics inventados). Ningún fichero del frontal puede quedarse así.

const FRONT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'src');

function ficheros(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === 'node_modules' || n === '__tests__' ? [] : ficheros(p);
    return /\.(t|j)sx?$/.test(n) ? [p] : [];
  });
}

describe('sin datos inventados en el frontal', () => {
  it('ningún cliente de la API tiene USE_MOCKS = true', () => {
    const conMocks = ficheros(FRONT).filter((p) => /const\s+USE_MOCKS\s*=\s*true/.test(readFileSync(p, 'utf8')));
    expect(conMocks).toEqual([]);
  });
});
