import { describe, it, expect } from 'vitest';
import { isValidElement } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { Routes, Navigate, createRoutesFromChildren, matchRoutes } from 'react-router-dom';
import App from '@/App';
import RedirigeA from '@/shared/components/RedirigeA';
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
function destino(camino, saltos = 0, sinAntiguas = false) {
  const limpio = camino.split(/[?#]/)[0];
  const m = matchRoutes(RUTAS, limpio);
  if (!m) return null;
  const ultima = m[m.length - 1];
  if (ultima.route.path === '*') return null;
  const el = ultima.route.element;
  if (isValidElement(el) && el.type === Navigate) {
    if (saltos > 3) return null;
    return destino(String(el.props.to), saltos + 1, sinAntiguas);
  }
  if (isValidElement(el) && el.type === RedirigeA) {
    // Las antiguas son para lo que ya está guardado; el código no las usa.
    if (sinAntiguas || saltos > 3) return null;
    const a = String(el.props.a).replace(/:(\w+)/g, (_, k) => ultima.params[k] ?? '');
    return destino(a, saltos + 1);
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
      .filter((e) => destino(e.to, 0, true) === null)
      .map((e) => `${e.fichero}:${e.linea} → ${e.to}`);
    expect(rotos).toEqual([]);
  });

  it.each([
    ['modules/connectors/pages/ConnectorsPage.tsx', '/conexion/webhooks/prospectos'],
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

/*
  Lo que la primera versión de esta prueba no veía (revisión del 16/11):

  - Direcciones armadas con `${…}`: en MultiCRM `navigate(\`/leads/${id}\`)` llevaba a
    «Página no encontrada» porque allí la ficha es /prospectos/:id; aquí es al
    revés. Aquí cada
    `${…}` se cambia por un trozo cualquiera (`X1`) y se mira la ruta igual.
  - `<a href="/…">` escritos a mano: se saltan la base de la compilación
    (`VITE_BASE_PATH`); el de duplicados del alta llevaba `/crm/` copiado de
    MultiCRM y aquí daba 404. Tienen que ir con `rutaApp(…)` o con `<Link>`.
  - Las rutas que manda el servidor (`link_path` de los avisos, `enlace` del
    Registro y de los correos, `route` de los atajos): «prospecto sin tocar»,
    cursos pendientes, Google Ads y los atajos mandaban rutas de MultiCRM.
*/

const conTrozo = (s) => s.replace(/\$\{[^}]*\}/g, 'X1');

const PATRONES_ARMADOS = [
  /\bto=\{\s*`(\/[^`]*)`\s*\}/g,
  /\bto:\s*`(\/[^`]*)`/g,
  /\bnavigate\(\s*`(\/[^`]*)`/g,
  /\brutaApp\(\s*[`'"](\/[^`'"]*)[`'"]/g,
  // Los `href:` de la campana se abren con navigate(). Los del menú que van
  // junto a un `to:` salen a otra compilación y se quedan fuera.
  /\bhref:\s*[`'"](\/[^`'"]*)[`'"]/g,
];

function sacar(base, files, patrones, saltar = () => false) {
  return files.flatMap((f) => {
    const out = [];
    fs.readFileSync(f, 'utf8').split('\n').forEach((linea, i) => {
      if (/^\s*(\/\/|\*)/.test(linea) || saltar(linea)) return;
      for (const rx of patrones) {
        for (const m of linea.matchAll(rx)) {
          const to = m[m.length - 1];
          if (/^\/(api|v\d)\b/.test(to) || to.startsWith('//')) continue;
          out.push({ fichero: path.relative(base, f).split(path.sep).join('/'), linea: i + 1, to });
        }
      }
    });
    return out;
  });
}

const rotosDe = (lista) => lista
  .filter((e) => !/^\/\$\{/.test(e.to)) // el primer trozo depende de una variable: no se puede mirar
  .filter((e) => destino(conTrozo(e.to), 0, true) === null)
  .map((e) => `${e.fichero}:${e.linea} → ${e.to}`);

describe('las direcciones que se arman con `${…}` también llevan a una pantalla (#633)', () => {
  const ARMADOS = sacar(SRC, ficheros(SRC), PATRONES_ARMADOS,
    (linea) => /<Route\b/.test(linea) || (/\bhref:/.test(linea) && /\bto:/.test(linea)));

  it('hay direcciones armadas que mirar', () => {
    expect(ARMADOS.length).toBeGreaterThan(30);
  });

  it('ninguna lleva a «Página no encontrada»', () => {
    expect(rotosDe(ARMADOS)).toEqual([]);
  });
});

describe('ningún `<a href>` a una pantalla del CRM escrito a mano (#633)', () => {
  it('van con rutaApp(…) o con <Link>, que ponen la base de la compilación', () => {
    const aMano = sacar(SRC, ficheros(SRC), [/\bhref=(?:\{\s*)?([`'"])(\/(?!\/)[^`'"]*)\1/g])
      .map((e) => `${e.fichero}:${e.linea} → ${e.to}`);
    expect(aMano).toEqual([]);
  });
});

describe('las rutas que manda el servidor llevan a una pantalla (#633)', () => {
  const BACK = path.resolve(SRC, '../../backend/src');
  function ficherosBack(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') out.push(...ficherosBack(p)); }
      else if (/\.js$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
    }
    return out;
  }
  // `link_path` (avisos), `enlace` (Registro, correos con P.enlace) y `route` (atajos).
  const DEL_SERVIDOR = sacar(BACK, ficherosBack(BACK), [
    /\b(?:link_path|enlace|route)\s*:\s*(?:[^'"`\n]*?\?\s*)?[`'"](\/[^`'"]*)[`'"]/g,
    /\benlace\(\s*[`'"](\/[^`'"]*)[`'"]/g,
  ]);

  it('hay rutas del servidor que mirar', () => {
    expect(DEL_SERVIDOR.length).toBeGreaterThan(20);
  });

  it('ninguna lleva a «Página no encontrada»', () => {
    expect(rotosDe(DEL_SERVIDOR)).toEqual([]);
  });
});

describe('las direcciones de MultiCRM que llegó a mandar el servidor llevan a la de aquí (#633)', () => {
  it.each([
    ['/prospectos', '/leads'],
    ['/prospectos/7', '/leads/7'],
    ['/productos/pendientes', '/products/pending'],
    ['/finanzas/integraciones', '/accounting/integrations'],
    ['/clientes', '/clients'],
    ['/formularios', '/forms'],
  ])('%s → %s', (vieja, nueva) => {
    expect(destino(vieja)).toBe(nueva);
  });
});
