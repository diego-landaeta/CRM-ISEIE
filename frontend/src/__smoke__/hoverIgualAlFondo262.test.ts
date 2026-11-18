import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * #262, menores: «`hover:bg-warning` y `hover:bg-destructive`, iguales al
 * fondo». Un botón de relleno sólido cuyo hover es el mismo color no responde al
 * pasar el ratón: parece que no se puede pulsar. La #415 arregló los de aviso y
 * peligro; quedaban cuatro verdes igual. Este repaso los mira todos.
 */

const RAIZ = path.resolve(__dirname, '..');
const TOKENS = ['primary', 'secondary', 'success', 'warning', 'destructive', 'info'];

// La página actual de la paginación se queda en su color a propósito: no es un
// botón que invite a pulsar, es «estás aquí».
const A_PROPOSITO = new Set(['shared/components/ui/Paginacion.tsx']);

function ficheros(dir: string): string[] {
  const salida: string[] = [];
  for (const e of fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`.replace(/^\.\//, '');
    if (e.isDirectory()) { if (e.name !== 'test' && e.name !== '__smoke__') salida.push(...ficheros(rel)); }
    else if (/\.(tsx|jsx)$/.test(e.name) && !/\.test\./.test(e.name)) salida.push(rel);
  }
  return salida;
}

describe('ningún botón sólido tiene el hover del mismo color que el fondo (#262)', () => {
  it('bg-X con hover:bg-X en la misma clase', () => {
    const culpables: string[] = [];
    for (const f of ficheros('.')) {
      if (A_PROPOSITO.has(f)) continue;
      fs.readFileSync(path.join(RAIZ, f), 'utf8').split('\n').forEach((l, i) => {
        for (const t of TOKENS) {
          const fondo = new RegExp(`(^|[\\s"'\`])bg-${t}(?=[\\s"'\`])`);
          const hover = new RegExp(`hover:bg-${t}(?=[\\s"'\`])`);
          if (fondo.test(l) && hover.test(l)) culpables.push(`${f}:${i + 1} (${t})`);
        }
      });
    }
    expect(culpables).toEqual([]);
  });
});
