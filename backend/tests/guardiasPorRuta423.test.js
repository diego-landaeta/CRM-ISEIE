import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * #423, fase 4 · Cada guardia, probado: quién entra y quién se lleva un 403.
 *
 * Recorre TODAS las rutas de todos los módulos, coge el `puede('clave')` que
 * lleva cada una —el mismo objeto que monta Express— y lo ejecuta con:
 *   - cada rol fijo, sin nada más: entra si y solo si su rol trae la clave;
 *   - una gestora con la clave dada por excepción: entra;
 *   - un admin con la clave quitada por excepción: 403 (salvo que la ruta
 *     acepte otra clave que sí tenga);
 *   - sin sesión: 401.
 * El mapa sale del resolver de verdad (`resolver.js`), sin base.
 */

vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
const { registrar } = await import('./helpers/permisosSinBase.js');
const { SYSTEM_ROLE_DEFAULTS } = await import('../src/modules/permissions/permissions.defaults.js');

const MODULOS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/modules');
const ROLES = ['admin', 'gestor', 'soporte', 'project_manager', 'tutor', 'colaborador', 'superadmin'];

/** [{ id, claves, guardia }] de todas las rutas que llevan `puede`. */
async function rutasConGuardia() {
  const salida = [];
  const recorrer = (pila, base, delRouter) => {
    const previos = [...delRouter];
    for (const capa of pila) {
      if (capa.route) {
        const fns = [...previos, ...capa.route.stack.map((s) => s.handle)];
        const guardia = fns.find((f) => f?.regla?.tipo === 'puede');
        if (guardia) {
          for (const m of Object.keys(capa.route.methods)) {
            salida.push({ id: `${m.toUpperCase()} ${base}${capa.route.path}`, claves: guardia.regla.claves, guardia });
          }
        }
      } else if (capa.handle?.stack) {
        const src = capa.regexp?.source || '';
        const fin = src.indexOf('\\/?(?=');
        recorrer(capa.handle.stack, base + (src.startsWith('^') && fin > 0 ? src.slice(1, fin).split('\\/').join('/') : ''), previos);
      } else if (capa.handle?.regla?.tipo === 'puede') {
        previos.push(capa.handle);
      }
    }
  };
  for (const d of fs.readdirSync(MODULOS).filter((x) => fs.existsSync(path.join(MODULOS, x, 'index.js')))) {
    const mod = (await import(path.join(MODULOS, d, 'index.js'))).default;
    recorrer(mod.router.stack, mod.prefix, []);
  }
  return salida;
}

/** Pasa la petición por el guardia: 'pasa', o el código del error. */
function probar(guardia, user) {
  return new Promise((resolve) => {
    guardia({ user, headers: {} }, {}, (err) => resolve(err ? err.statusCode : 'pasa'));
  });
}

let id = 1000;
const persona = (role, extra = {}) => registrar({ userId: ++id, role, ...extra });

const rutas = await rutasConGuardia();

describe('cada guardia, quién entra y quién no (#423)', () => {
  it('hay guardias que probar (si no, el recorrido está mal)', () => {
    expect(rutas.length).toBeGreaterThan(500);
  });

  it('cada rol fijo entra solo a lo que su rol trae', async () => {
    const mal = [];
    for (const r of rutas) {
      for (const rol of ROLES) {
        const esperado = rol === 'superadmin' || r.claves.some((c) => SYSTEM_ROLE_DEFAULTS[rol]?.[c] === true);
        const res = await probar(r.guardia, persona(rol));
        if ((res === 'pasa') !== esperado) mal.push(`${rol} · ${r.id}: ${res}`);
        if (res !== 'pasa' && res !== 403) mal.push(`${rol} · ${r.id}: ${res} en vez de 403`);
      }
    }
    expect(mal).toEqual([]);
  });

  it('una excepción dada abre la puerta, y una quitada la cierra', async () => {
    const mal = [];
    for (const r of rutas) {
      const clave = r.claves[0];
      // Una gestora con la clave dada (si su rol no puede tenerla nunca, no cuenta).
      const g = persona('gestor', { excepciones: { [clave]: true } });
      if ((await probar(r.guardia, g)) !== 'pasa') mal.push(`gestora con ${clave} · ${r.id}`);
      // Un admin con TODAS las claves de la ruta quitadas.
      const a = persona('admin', { excepciones: Object.fromEntries(r.claves.map((c) => [c, false])) });
      if ((await probar(r.guardia, a)) !== 403) mal.push(`admin sin ${r.claves.join('/')} · ${r.id}`);
    }
    expect(mal).toEqual([]);
  });

  it('sin sesión, 401', async () => {
    for (const r of rutas.slice(0, 20)) expect(await probar(r.guardia, undefined)).toBe(401);
  });
});
