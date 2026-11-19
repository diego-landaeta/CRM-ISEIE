import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { confirmacionCambioCorreo } from '@/shared/lib/credenciales';

/**
 * #262, «Antes de producción»: «Se cierran sus sesiones» solo revoca los
 * refresh tokens. El JWT de acceso dura 8 h y las URL del MCP siguen vivas, así
 * que ninguna pantalla puede prometer que las sesiones se han cerrado.
 *
 * La #415 arregló dos avisos; quedaban otros cuatro con la misma promesa. Este
 * repaso queda aquí para que el siguiente texto no la vuelva a escribir.
 */

const RAIZ = path.resolve(__dirname, '..');

function ficheros(dir: string): string[] {
  const salida: string[] = [];
  for (const e of fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`.replace(/^\.\//, '');
    if (e.isDirectory()) { if (e.name !== 'test' && e.name !== '__smoke__') salida.push(...ficheros(rel)); }
    else if (/\.(tsx|jsx|ts|js)$/.test(e.name) && !/\.test\./.test(e.name) && !e.name.endsWith('.d.ts')) salida.push(rel);
  }
  return salida;
}

// «Sus sesiones se han cerrado», «se cerrarán sus sesiones», «se cierran sus sesiones»…
const PROMESA = /(se (han )?cerrado|se cerrar[áa]n|se cierran)[^.'"`]{0,25}sesi[oó]n|sesi[oó]n(es)?[^.'"`]{0,25}se (han )?cerrad/i;

describe('ningún texto promete cerrar sesiones que siguen vivas (#262)', () => {
  it('en todo el frontend', () => {
    const culpables = ficheros('.').flatMap((f) => fs.readFileSync(path.join(RAIZ, f), 'utf8')
      .split('\n')
      .map((l, i) => ({ f, linea: i + 1, texto: l.trim() }))
      .filter(({ texto }) => PROMESA.test(texto)));
    expect(culpables).toEqual([]);
  });

  it('la confirmación del cambio de correo dice lo que pasa de verdad', () => {
    const t = confirmacionCambioCorreo('Laura', 'vieja@x.com', 'nueva@x.com', null);
    expect(t).toMatch(/8 horas/);
    expect(t).toMatch(/MCP/);
  });
});
