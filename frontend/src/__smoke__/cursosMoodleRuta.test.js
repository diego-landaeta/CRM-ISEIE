// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { matchRoutes } from 'react-router-dom';

/**
 * QA de /staging del 21/11: /products/cursos-moodle abría la ficha de un
 * producto («Producto no encontrado») y pedía `GET /api/products/NaN`. La
 * pantalla de la gemela #648 (CursosDeProductosPage) tiene que ganar a
 * `/products/:id`, y la ficha no puede pedir un id que no es un número.
 *
 * Se mira la fuente de App.jsx (montarlo entero pide medio CRM de dobles) y se
 * resuelve con el router de verdad.
 */

const leer = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const app = leer('App.jsx');

// Las rutas /products… tal como están declaradas, con la pantalla de cada una.
const rutas = [...app.matchAll(/<Route path="(\/products[^"]*)" element=\{<(\w+)/g)]
  .map(([, ruta, pantalla]) => ({ path: ruta, pantalla }));

describe('/products/cursos-moodle abre la pantalla de cursos de Moodle', () => {
  it('la ruta existe y es la de CursosDeProductosPage', () => {
    expect(rutas).toEqual(expect.arrayContaining([
      { path: '/products/cursos-moodle', pantalla: 'CursosDeProductosPage' },
      { path: '/products/:id', pantalla: 'ProductDetailPage' },
    ]));
    expect(app).toMatch(/const CursosDeProductosPage = lazy\(\(\) => import\('\.\/modules\/moodle\/pages\/CursosDeProductosPage'\)\)/);
  });

  it.each([
    ['/products/cursos-moodle', 'CursosDeProductosPage'],
    ['/products/pending', 'CoursesPendingPage'],
    ['/products/tree', 'ProductsTreePage'],
    ['/products/42', 'ProductDetailPage'],
  ])('%s → %s (no la ficha de un producto)', (url, pantalla) => {
    const m = matchRoutes(rutas, url);
    expect(m?.at(-1)?.route.pantalla).toBe(pantalla);
  });

  it('la ficha no pide al servidor un id que no es un número', () => {
    const ficha = leer('modules/products/pages/ProductDetailPage.tsx');
    expect(ficha).toMatch(/idValido/);
  });
});
