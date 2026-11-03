import { describe, it, expect } from 'vitest';
import { isValidElement } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { Routes, Navigate, createRoutesFromChildren, matchRoutes } from 'react-router-dom';
import App from '@/App';
// Los botones «Ir a…» de Novedades salen del servidor, de este fichero.
import { VERSIONES } from '../../../backend/src/modules/novedades/versiones.js';

/*
  Ningún enlace del frontal lleva a «Página no encontrada» (CRM#633).

  La auditoría del 03/11 (ISEIE#360) encontró en Conectores dos enlaces a
  `/captacion/webhooks` y `/productos/woocommerce`, y en el aviso de huecos de
  Facturas uno a `/finanzas/facturas/nueva`: rutas del 360, que aquí dan 404.
  La prueba del menú (`menuSinRutasRotas`) solo mira el menú lateral; los
  enlaces de dentro de cada pantalla no los miraba nadie.

  Aquí se leen TODOS los ficheros del frontal y se saca cada dirección escrita
  a mano: `to: '/…'`, `to="/…"` y `navigate('/…')`. Cada una tiene que llevar a
  una pantalla de App.jsx, siguiendo las redirecciones. Las marcadas
  `comingSoon` en la misma línea se admiten: no tienen pantalla a propósito. Y
  las que llevan `href` salen a otra compilación (la maqueta de /testeo2).

  Las rutas salen del propio App.jsx, no de una lista copiada aquí.

  La misma prueba vive en MultiCRM (`src/test/enlacesSinRutasRotas.test.jsx`).
*/

function buscarRoutes(el) {
  if (!el) return null;
  if (Array.isArray(el)) {
    for (const x of el) { const r = buscarRoutes(x); if (r) return r; }
    return null;
  }
  if (!isValidElement(el)) return null;
  if (el.type === Routes) return el;
  return buscarRoutes(el.props?.children);
}

const RUTAS = createRoutesFromChildren(buscarRoutes(App()).props.children);

/** La pantalla a la que lleva una dirección, siguiendo redirecciones; null si es la de error. */
function destino(camino, saltos = 0) {
  const limpio = camino.split(/[?#]/)[0];
  const m = matchRoutes(RUTAS, limpio);
  if (!m) return null;
  const ultima = m[m.length - 1];
  if (ultima.route.path === '*') return null;
  const el = ultima.route.element;
  if (isValidElement(el) && el.type === Navigate) {
    if (saltos > 3) return null;
    return destino(String(el.props.to), saltos + 1);
  }
  return limpio;
}

const SRC = path.resolve(__dirname, '..');

function ficheros(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'test' || e.name === '__smoke__' || e.name === 'node_modules') continue;
      out.push(...ficheros(p));
    } else if (/\.(jsx?|tsx?)$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

// `to: '/x'`, `to="/x"`, `to={'/x'}` y `navigate('/x')`. Solo literales enteros:
// una dirección que se arma con `${…}` o con `+` no se puede comprobar aquí.
const PATRONES = [
  /\bto:\s*(['"])(\/[^'"`$]*)\1(?!\s*\+)/g,
  /\bto=(['"])(\/[^'"`$]*)\1/g,
  /\bto=\{\s*(['"])(\/[^'"`$]*)\1\s*\}/g,
  /\bnavigate\(\s*(['"])(\/[^'"`$]*)\1\s*[,)]/g,
];

const ENLACES = ficheros(SRC).flatMap((f) => {
  const texto = fs.readFileSync(f, 'utf8');
  const lineas = texto.split('\n');
  const out = [];
  lineas.forEach((linea, i) => {
    if (/^\s*(\/\/|\*)/.test(linea)) return; // comentarios
    for (const rx of PATRONES) {
      for (const m of linea.matchAll(rx)) {
        out.push({
          fichero: path.relative(SRC, f).replace(/\\/g, '/'),
          linea: i + 1,
          to: m[2],
          comingSoon: /comingSoon/.test(linea),
          // Con `href` la entrada sale a OTRA compilación (TESTEO2, SUITE DASH).
          fuera: /\bhref:/.test(linea),
        });
      }
    }
  });
  return out;
});

describe('los enlaces del frontal llevan a una pantalla que existe', () => {
  it('hay enlaces que mirar (si esto falla, la prueba no está mirando nada)', () => {
    expect(ENLACES.length).toBeGreaterThan(100);
  });

  it('cada `to` y cada `navigate` tiene su ruta en App.jsx (salvo los «Próximamente»)', () => {
    const rotos = ENLACES
      .filter((e) => !e.comingSoon && !e.fuera)
      .filter((e) => destino(e.to) === null)
      .map((e) => `${e.fichero}:${e.linea} → ${e.to}`);
    expect(rotos).toEqual([]);
  });

  it.each([
    ['modules/connectors/pages/ConnectorsPage.tsx', '/webhooks'],
    ['modules/connectors/pages/ConnectorsPage.tsx', '/woocommerce'],
    ['modules/invoices/components/AvisoHuecosFacturas.tsx', '/accounting/facturas/nueva'],
  ])('%s lleva a %s (#360)', (fichero, to) => {
    expect(ENLACES.some((e) => e.fichero === fichero && e.to === to)).toBe(true);
    expect(destino(to)).not.toBeNull();
  });
});

describe('los botones «Ir a…» de Novedades llevan a una pantalla que existe (#625)', () => {
  const conRuta = VERSIONES.flatMap((v) => v.grupos.flatMap((g) => g.items
    .filter((it) => it.ruta)
    .map((it) => ({ version: v.version, titulo: it.titulo, ruta: it.ruta }))));

  it('hay botones que mirar', () => {
    expect(conRuta.length).toBeGreaterThan(20);
  });

  it('ninguno lleva a «Página no encontrada»', () => {
    const rotos = conRuta.filter((b) => destino(b.ruta) === null).map((b) => `${b.version} · ${b.titulo} → ${b.ruta}`);
    expect(rotos).toEqual([]);
  });
});
