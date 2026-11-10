// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * El contraste de los tokens de estado, medido (traída de MultiCRM, #32 y el
 * índigo de «Datos validados» de la #199, 2.6.0).
 *
 * Se calcula con la fórmula de WCAG a partir de index.css, en claro y en oscuro.
 * El mínimo es 4,5:1, el de texto normal.
 *
 * Adaptada a ISEIE: aquí se miden las parejas de estado (las que ISEIE comparte
 * con MultiCRM) y el índigo nuevo. NO se miden `primary` ni `destructive` en
 * sólido: son la marca de ISEIE (navy y el rojo de siempre) y no entran en este
 * port; en oscuro dan 3,6:1 y 4,4:1, y cambiarlas es una decisión de marca.
 */

const RAIZ = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(RAIZ, 'index.css'), 'utf8');

function bloque(selector) {
  const i = css.search(selector);
  const ini = css.indexOf('{', i);
  return css.slice(ini, css.indexOf('}', ini));
}
function variables(texto) {
  const v = {};
  for (const m of texto.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) v[m[1]] = m[2].trim();
  return v;
}
const claro = variables(bloque(/:root\s*\{/));
const oscuro = { ...claro, ...variables(bloque(/\.dark\s*\{/)) };

function hsl(vars, nombre) {
  const v = vars[nombre];
  if (!v) throw new Error(`falta --${nombre} en index.css`);
  const [h, s, l] = v.match(/[\d.]+/g).map(Number);
  return [h, s / 100, l / 100];
}
function luminancia([h, s, l]) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const [r, g, b] = [f(0), f(8), f(4)].map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contraste = (vars, a, b) => {
  const x = luminancia(hsl(vars, a)), y = luminancia(hsl(vars, b));
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const PAREJAS = [
  ['success-foreground', 'success'], ['info-foreground', 'info'], ['warning-foreground', 'warning'],
  ['success-soft-foreground', 'success-soft'], ['info-soft-foreground', 'info-soft'],
  ['warning-soft-foreground', 'warning-soft'], ['destructive-soft-foreground', 'destructive-soft'],
  // El índigo de «Datos validados» (#199).
  ['indigo-foreground', 'indigo'], ['indigo-soft-foreground', 'indigo-soft'],
];

describe('contraste de los tokens de estado', () => {
  for (const [tema, vars] of [['claro', claro], ['oscuro', oscuro]]) {
    it(`cada fondo de estado con su letra se lee, en ${tema}`, () => {
      const malos = PAREJAS.map(([l, f]) => [l, f, contraste(vars, l, f)]).filter(([, , c]) => c < 4.5)
        .map(([l, f, c]) => `${l} sobre ${f}: ${c.toFixed(2)}:1`);
      expect(malos.join('\n'), 'por debajo de 4,5:1').toBe('');
    });
  }

  it('el índigo está en tailwind.config.js, como los demás estados', () => {
    const conf = fs.readFileSync(path.resolve(RAIZ, '..', 'tailwind.config.js'), 'utf8');
    expect(conf).toMatch(/indigo:\s*\{\s*DEFAULT:\s*'hsl\(var\(--indigo\)\)'/);
    expect(conf).toMatch(/'soft-foreground':\s*'hsl\(var\(--indigo-soft-foreground\)\)'/);
  });
});
