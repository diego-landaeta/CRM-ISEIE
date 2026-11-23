// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Suspense } from 'react';
import { render, screen, act, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { esErrorDePieza, recargarUnaVez, lazyConRecarga, VENTANA_MS, _cambiarRecarga } from '@/shared/lib/piezaNueva';

/**
 * Errores de producción del 23/11: quien tenía el CRM abierto antes de desplegar
 * veía «Failed to fetch dynamically imported module …/assets/LeadsPage-xxxx.js»
 * al navegar. Ahora la app recarga UNA vez sola (marca en sessionStorage) y coge
 * la versión nueva; sin bucles.
 */

const MENSAJE = 'Failed to fetch dynamically imported module: https://360crm.tech/crm/assets/LeadsPage-a1b2c3.js';
let reload;

beforeEach(() => {
  reload = vi.fn();
  _cambiarRecarga(reload);
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('qué cuenta como «la pieza ya no existe»', () => {
  it('los mensajes de Chrome, Safari y Firefox', () => {
    expect(esErrorDePieza(new TypeError(MENSAJE))).toBe(true);
    expect(esErrorDePieza(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(esErrorDePieza(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(esErrorDePieza(MENSAJE)).toBe(true);
  });

  it('cualquier otro error, no', () => {
    expect(esErrorDePieza(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(esErrorDePieza(null)).toBe(false);
    expect(esErrorDePieza(undefined)).toBe(false);
  });
});

describe('recarga una vez, sin bucle', () => {
  it('la primera vez recarga y deja la marca', () => {
    expect(recargarUnaVez(new TypeError(MENSAJE), 1_000_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem('chunk-error-reload-ts')).toBe('1000000');
  });

  it('si vuelve a fallar justo después de recargar, no recarga otra vez', () => {
    recargarUnaVez(new TypeError(MENSAJE), 1_000_000);
    expect(recargarUnaVez(new TypeError(MENSAJE), 1_000_000 + 2_000)).toBe(false);
    expect(recargarUnaVez(new TypeError(MENSAJE), 1_000_000 + VENTANA_MS - 1)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('en un despliegue posterior (pasado el rato), sí vuelve a recargar', () => {
    recargarUnaVez(new TypeError(MENSAJE), 1_000_000);
    expect(recargarUnaVez(new TypeError(MENSAJE), 1_000_000 + VENTANA_MS + 1)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('otro error no recarga', () => {
    expect(recargarUnaVez(new Error('otra cosa'))).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('sin sessionStorage (lanza) no recarga: no se sabría si ya se hizo', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    expect(recargarUnaVez(new TypeError(MENSAJE))).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('las páginas perezosas', () => {
  it('si su pieza ya no existe, recarga y se queda en «cargando» en vez de romper la pantalla', async () => {
    const Pagina = lazyConRecarga(() => Promise.reject(new TypeError(MENSAJE)));
    render(<Suspense fallback={<p>Cargando…</p>}><Pagina /></Suspense>);
    await act(async () => { await new Promise((ok) => setTimeout(ok, 0)); });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Cargando…')).toBeTruthy();
  });

  it('si la pieza carga, se pinta como siempre', async () => {
    const Pagina = lazyConRecarga(() => Promise.resolve({ default: () => <p>Prospectos</p> }));
    render(<Suspense fallback={<p>Cargando…</p>}><Pagina /></Suspense>);
    expect(await screen.findByText('Prospectos')).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });

  it('App.jsx usa el `lazy` que recarga, no el de React', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8');
    expect(app).toMatch(/import \{ lazyConRecarga as lazy \} from '@\/shared\/lib\/piezaNueva'/);
    expect(app).not.toMatch(/import \{[^}]*\blazy\b[^}]*\} from 'react'/);
  });
});
