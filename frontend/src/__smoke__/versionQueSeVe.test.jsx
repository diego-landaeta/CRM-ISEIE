import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  Diego, 25/11/2026: «el CRM dice 1.0.0, ya no estamos en beta, es otra
  versión». Con la 3.0.0 en producción, el menú decía «BETA 1.0.0» (el build
  clona sin etiquetas de Git y caía al package.json), el login y la página de
  la contraseña «v0.1.0 Beta», el manual «v0.1 · Beta» y Soporte una lista de
  abril con «v0.1.0 · Beta inicial».

  La versión sale de UN sitio: la primera de Novedades (`ACTUAL.version`), que
  Vite pone al compilar. Al añadir otra versión arriba, se enseña sola.
*/

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ login: vi.fn(), isAuthenticated: false, loading: false }),
}));

const { ACTUAL } = await import('../../../backend/src/modules/novedades/versiones.js');
const { versionDeLaApp, versionDeNovedades } = await import('../../scripts/versionDeLaApp.js');
const { VERSION_APP, ETIQUETA_VERSION } = await import('@/shared/config/version');
const { default: LoginPage } = await import('@/shared/pages/LoginPage');
const { default: SoportePage } = await import('@/modules/soporte/pages/SoportePage');

const RAIZ = path.resolve(__dirname, '..', '..');
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');
/** El fichero sin comentarios: lo que dicen los comentarios no se ve. */
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** Todo `src`, sin pruebas ni maquetas (`*-preview`), que no son pantallas del CRM. */
function fuentes(dir = 'src') {
  const abs = path.join(RAIZ, dir);
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return /(^|\/)(test|__smoke__)$|-preview$/.test(rel) ? [] : fuentes(rel);
    return /\.(jsx?|tsx?)$/.test(e.name) && !/\.test\./.test(e.name) ? [rel] : [];
  });
}

describe('la versión que enseña el CRM es la de Novedades', () => {
  it('el build la saca de la primera versión de Novedades', () => {
    expect(versionDeLaApp({ cwd: RAIZ })).toBe(ACTUAL.version);
  });

  it('la que llega a las pantallas es esa misma, con su «v»', () => {
    expect(VERSION_APP).toBe(ACTUAL.version);
    expect(ETIQUETA_VERSION).toBe(`v${ACTUAL.version}`);
  });

  it('al añadir una versión arriba en Novedades, sale la nueva', () => {
    const texto = 'const LISTA = [\n  {\n    "version": "3.1.0",\n    "fecha": "2026-12-01"\n  },\n  {\n    "version": "3.0.0"\n  }\n];';
    expect(versionDeNovedades(texto)).toBe('3.1.0');
    expect(versionDeNovedades("const LISTA = [{ version: '4.0.0' }]")).toBe('4.0.0');
  });

  it('ninguna variable de entorno la pisa', () => {
    const antes = process.env.APP_VERSION;
    process.env.APP_VERSION = '1.0.0';
    try {
      expect(versionDeLaApp({ cwd: RAIZ })).toBe(ACTUAL.version);
    } finally {
      if (antes === undefined) delete process.env.APP_VERSION; else process.env.APP_VERSION = antes;
    }
  });

  it('el login enseña la versión y no dice «beta»', () => {
    const { container } = render(<MemoryRouter><LoginPage /></MemoryRouter>);
    expect(container.textContent).toContain(`v${ACTUAL.version}`);
    expect(container.textContent).not.toMatch(/beta/i);
    expect(container.textContent).not.toMatch(/v0\.1|1\.0\.0/);
  });

  it('Soporte enlaza a las Novedades de la versión, sin la lista vieja de la 0.1.0', () => {
    const { container } = render(<MemoryRouter><SoportePage /></MemoryRouter>);
    expect(container.textContent).toContain(`Novedades de la v${ACTUAL.version}`);
    expect(container.textContent).not.toMatch(/beta|0\.1\.0/i);
  });

  it('el menú, el acceso, la contraseña y el manual la toman de version.ts', () => {
    const pantallas = [
      'src/shared/components/layout/Sidebar.jsx',
      'src/shared/pages/LoginPage.jsx',
      'src/modules/manual/pages/ManualPage.tsx',
      'src/modules/soporte/pages/SoportePage.tsx',
    ];
    if (fs.existsSync(path.join(RAIZ, 'src/shared/pages/SetPasswordPage.jsx'))
      && /copy;/.test(leer('src/shared/pages/SetPasswordPage.jsx'))) {
      pantallas.push('src/shared/pages/SetPasswordPage.jsx');
    }
    for (const f of pantallas) {
      expect(leer(f), f).toMatch(/from '@\/shared\/config\/version'/);
    }
  });

  it('ninguna pantalla dice «beta» ni lleva una versión escrita a mano', () => {
    const mal = fuentes().flatMap((f) => {
      const texto = sinComentarios(leer(f));
      const fallos = [];
      // «beta» como palabra suelta (BETA_MODE, isBetaAllowed o la clave
      // `beta-seen-…` del almacenamiento no son texto que se vea).
      if (/(?<![A-Za-z_-])beta(?![A-Za-z_-])/i.test(texto)) fallos.push(`${f}: «beta»`);
      if (/\bv0\.1\b|v0\.1\.0|v1\.0\.0/.test(texto)) fallos.push(`${f}: versión a mano`);
      return fallos;
    });
    expect(mal).toEqual([]);
  });
});
