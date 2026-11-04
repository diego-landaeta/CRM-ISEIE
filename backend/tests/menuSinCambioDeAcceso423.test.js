import { describe, it, expect, beforeAll } from 'vitest';

/**
 * #423, QA de Diego (22/10) · punto 6. Los cambios del menú (`CAMBIOS_DE_MENU`)
 * no pueden esconder un cambio de acceso: lo que aparece tiene que llevar a una
 * ruta que ya respondía ANTES, y lo que desaparece a una que ya daba 403 antes
 * y la sigue dando. Se comprueba con las reglas congeladas de antes y con el
 * resolver de ahora (las casillas ya convertidas, como hace la 239).
 */

process.env.LOG_LEVEL = 'silent';
const inv = await import('../src/modules/permissions/inventario/index.js');
const { CAMBIOS_DE_MENU, cambioPrevisto } = await import('../src/modules/permissions/inventario/cambios-aprobados.js');
const { resolverPermisos } = await import('../src/modules/permissions/resolver.js');
const { excepcionesDeCasillas } = await import('../src/modules/permissions/casillas.js');

// Los perfiles de la foto del menú (frontend/src/test/menuPorPerfil423.test.jsx).
const PERFILES = {
  admin: inv.personaDePrueba('admin'),
  soporte: inv.personaDePrueba('soporte'),
  project_manager: inv.personaDePrueba('project_manager'),
  'gestora con factura_manager': inv.personaDePrueba('gestor', { factura_manager: true }),
  'gestora+admin': inv.personaDePrueba('gestor', { roles_extra: ['admin'] }),
  gestora: inv.personaDePrueba('gestor'),
  'gestora+tutor': inv.personaDePrueba('gestor', { roles_extra: ['tutor'] }),
  'gestora con editar_fechas_factura': inv.personaDePrueba('gestor', { editar_fechas_factura: true }),
  'gestora con usa_mcp': inv.personaDePrueba('gestor', { usa_mcp: true }),
  'gestora con diplomas.view': inv.personaDePrueba('gestor', { excepciones: { 'diplomas.view': true } }),
  'gestora con tasks.close': inv.personaDePrueba('gestor', { excepciones: { 'tasks.view_own': true, 'tasks.close': true, 'tasks.manage': true } }),
};

let porId;
beforeAll(async () => {
  porId = new Map((await inv.construirInventario()).map((f) => [f.id, f]));
}, 60000);

const casos = CAMBIOS_DE_MENU.flatMap((c) => Object.entries(c.perfiles).flatMap(([perfil, lineas]) =>
  lineas.map((l) => ({ id: c.id, acompanaA: c.acompanaA, perfil, signo: l[0], entrada: l.slice(2), ruta: c.rutas[l.slice(2)] }))));

describe('los cambios del menú no cambian el acceso (#423, punto 6)', () => {
  it('cada entrada tiene su ruta y su perfil', () => {
    expect(casos.length).toBeGreaterThan(0);
    for (const x of casos) {
      expect(x.ruta, `${x.perfil} · ${x.entrada}`).toBeTruthy();
      expect(PERFILES[x.perfil], x.perfil).toBeTruthy();
    }
  });

  it('lo que aparece ya respondía antes, y lo que se va ya daba 403 (y lo sigue dando)', () => {
    const mal = [];
    for (const x of casos) {
      const p = PERFILES[x.perfil];
      const fila = porId.get(x.ruta);
      if (!fila) { mal.push(`${x.ruta}: no existe`); continue; }
      const mapa = resolverPermisos({ role: p.role, roles_extra: p.roles_extra, excepciones: excepcionesDeCasillas(p) }).mapa;
      const antes = inv.puedeAntes(p, fila);
      const despues = inv.puedeDespues(p, fila, mapa);
      const esperado = x.signo === '+';
      // El menú que acompaña a un cambio de ACCESO aprobado (p. ej. `webhooks-solo-admin`, 2.6.0):
      // la ruta cambia de verdad, y ese cambio tiene que estar en la lista de Diego.
      if (x.acompanaA) {
        const aprobado = cambioPrevisto(x.ruta, p.role)?.id === x.acompanaA;
        if (antes === esperado || despues !== esperado || !aprobado) mal.push(`${x.perfil} ${x.signo} ${x.entrada} (${x.ruta}): antes ${antes}, ahora ${despues}, aprobado ${aprobado}`);
        continue;
      }
      // Un cambio de ACCESO aprobado aparte (`CAMBIOS`, p. ej. `admin-ve-claves`,
      // CRM#632): antes no entraba, y el menú enseña lo que ahora sí abre.
      const aprobado = [p.role, ...(p.roles_extra || [])].some((r) => cambioPrevisto(x.ruta, r));
      if (aprobado && !antes && despues === esperado) continue;
      if (antes !== esperado || despues !== esperado) mal.push(`${x.perfil} ${x.signo} ${x.entrada} (${x.ruta}): antes ${antes}, ahora ${despues}`);
    }
    expect(mal).toEqual([]);
  });
});
