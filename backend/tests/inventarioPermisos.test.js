import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * #423, fase 1 · El inventario de permisos dice la verdad y está al día.
 *
 * - Ninguna ruta tiene un guardia que no sepamos leer: si alguien añade uno
 *   nuevo sin regla (`conRegla`), aquí falla, porque entonces no podemos decir
 *   quién puede.
 * - Cada comprobación a mano apuntada en `manuales.js` existe: si se renombra
 *   el controlador, la entrada se queda colgando y aquí falla.
 * - `docs/PERMISOS.md` y `inventario.json` son lo que sale del código ahora.
 *   Se regeneran con `npm run permisos:inventario`.
 * - La copia congelada de las reglas (`legado.js`) da lo mismo que los guardias
 *   de verdad para cada rol.
 */

const aqui = path.dirname(fileURLToPath(import.meta.url));
const { construirInventario, inventarioEnMarkdown, inventarioEnJson, PUERTAS, personaDePrueba, puedeAntes, ANTES } =
  await import('../src/modules/permissions/inventario/index.js');
const legado = await import('../src/modules/permissions/inventario/legado.js');

let filas;
beforeAll(async () => { filas = await construirInventario(); }, 60_000);

describe('inventario de permisos (#423)', () => {
  it('ninguna ruta tiene un guardia sin clasificar', () => {
    const sin = filas.filter((f) => f.tipo === 'ruta' && f.guardias.some((g) => g.tipo === 'sin_regla'))
      .map((f) => `${f.id}: ${f.guardias.filter((g) => g.tipo === 'sin_regla').map((g) => g.nombre).join(', ')}`);
    expect(sin).toEqual([]);
  });

  it('cada comprobación a mano apunta a funciones que tienen ruta', () => {
    const colgando = [];
    for (const p of PUERTAS) {
      for (const c of p.controladores) {
        if (!filas.some((f) => f.tipo === 'ruta' && f.modulo === p.modulo && f.controlador === c)) colgando.push(`${p.id} → ${p.modulo}.${c}`);
      }
      expect(typeof legado.manual[p.regla], p.id).toBe('function');
    }
    expect(colgando).toEqual([]);
  });

  // Sin los \r: en Windows git puede dejar el fichero con CRLF.
  const leer = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

  it('docs/PERMISOS.md está al día', () => {
    const md = leer(path.resolve(aqui, '../../docs/PERMISOS.md'));
    expect(md === inventarioEnMarkdown(filas), 'Ejecuta `npm run permisos:inventario` en backend/').toBe(true);
  });

  it('inventario.json está al día', () => {
    const json = leer(path.resolve(aqui, '../src/modules/permissions/inventario/inventario.json'));
    expect(json === inventarioEnJson(filas), 'Ejecuta `npm run permisos:inventario` en backend/').toBe(true);
  });

  it('cubre todos los módulos que se montan', () => {
    const modulos = new Set(filas.map((f) => f.modulo));
    const dirs = fs.readdirSync(path.resolve(aqui, '../src/modules'))
      .filter((d) => fs.existsSync(path.resolve(aqui, '../src/modules', d, 'index.js')));
    expect(dirs.filter((d) => !modulos.has(d))).toEqual([]);
  });
});

describe('la copia congelada (legado.js) lee los guardias como el código', () => {
  const fila = (id) => filas.find((f) => f.id === id);

  it('roleGuard deja pasar a soporte por el atajo; soloRoles no', () => {
    const conRoleGuard = fila('GET /api/accounting/dashboard'); // roleGuard('admin','superadmin')
    expect(puedeAntes(personaDePrueba('soporte'), conRoleGuard)).toBe(true);
    expect(puedeAntes(personaDePrueba('gestor'), conRoleGuard)).toBe(false);
    const conSoloRoles = fila('GET /api/mcp/panel/personas'); // soloRoles('superadmin','admin')
    expect(puedeAntes(personaDePrueba('soporte'), conSoloRoles)).toBe(false);
    expect(puedeAntes(personaDePrueba('admin'), conSoloRoles)).toBe(true);
  });

  it('un rol añadido cuenta en roleGuard', () => {
    const r = fila('GET /api/accounting/dashboard');
    expect(puedeAntes(personaDePrueba('gestor', { roles_extra: ['admin'] }), r)).toBe(true);
  });

  it('el colaborador solo entra a sus rutas', () => {
    expect(puedeAntes(personaDePrueba('colaborador'), fila('GET /api/leads/'))).toBe(false);
    expect(puedeAntes(personaDePrueba('colaborador'), fila('GET /api/notifications/'))).toBe(true);
  });

  it('checkPermission no mira los roles de más; rolOPermiso sí', () => {
    // Una gestora que además es admin: por roles_extra tiene facturas_colaborador.gestionar...
    const g = personaDePrueba('gestor', { roles_extra: ['admin'] });
    expect(puedeAntes(g, fila('GET /api/facturas-colaborador/colaboradores'))).toBe(false);
    // ...y con rolOPermiso (Diplomas) entra por el rol añadido.
    // En el inventario CONGELADO: en el vivo ya no queda ningún rolOPermiso (#423, fase 4).
    const diplomas = [...ANTES.values()].find((f) => f.tipo === 'ruta' && f.modulo === 'certifex'
      && f.guardias.some((x) => x.tipo === 'rolOPermiso'));
    expect(puedeAntes(g, diplomas)).toBe(true);
  });

  it('las casillas abren lo suyo: factura_manager la cola, gestor_colaboraciones Tutores', () => {
    const cola = fila('POST /api/invoices/cola/generar');
    expect(puedeAntes(personaDePrueba('admin'), cola)).toBe(false); // el admin NO
    expect(puedeAntes(personaDePrueba('gestor', { factura_manager: true }), cola)).toBe(true);
    const tutores = fila('GET /api/tutores/');
    expect(puedeAntes(personaDePrueba('gestor'), tutores)).toBe(false);
    expect(puedeAntes(personaDePrueba('gestor', { gestor_colaboraciones: true }), tutores)).toBe(true);
  });

  it('una excepción personal manda sobre el rol en checkPermission', () => {
    const r = fila('GET /api/facturas-colaborador/colaboradores');
    expect(puedeAntes(personaDePrueba('admin', { excepciones: { 'facturas_colaborador.gestionar': false } }), r)).toBe(false);
    expect(puedeAntes(personaDePrueba('gestor', { excepciones: { 'facturas_colaborador.gestionar': true } }), r)).toBe(true);
  });
});
