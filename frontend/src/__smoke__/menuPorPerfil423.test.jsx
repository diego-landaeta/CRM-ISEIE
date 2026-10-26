// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * #423 · Qué menú ve cada perfil, y que no cambie sin querer.
 *
 * La foto `fixtures/menu-por-perfil-423.json` es el menú de `staging` de ISEIE
 * del 26/10/2026 (#230, gemela de CRM#423), antes de tocar ningún permiso: es el
 * «antes», sacado con el Sidebar y el can() de entonces. Cada perfil lleva el mapa que le daba
 * `/auth/me` (la copia congelada del backend, `inventario/legado.js`). Si el
 * menú de alguien cambia, falla, salvo lo que esté en `CAMBIOS_APROBADOS`: lo
 * que se cambia a propósito y Diego tiene que aprobar.
 *
 * Para rehacer la foto (solo si se sabe por qué): ACTUALIZAR_MENU_423=1.
 */

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, permissions: null }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({}) }));
vi.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({}), useOptionalTheme: () => 'dark' }));
vi.mock('@/shared/api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

const { NAV_SECTIONS, entradasDeSeccion, canSeeItem, esSoloColaboraciones } = await import('@/shared/components/layout/Sidebar');
const { crearCan } = await import('@/shared/hooks/usePermission');
const { rolesDe } = await import('@/shared/lib/roles');
const legado = await import('../../../backend/src/modules/permissions/inventario/legado.js');
// El mapa de AHORA: el resolver del servidor, con las casillas ya convertidas en
// excepciones como hace la migración 222 (#423).
const { resolverPermisos } = await import('../../../backend/src/modules/permissions/resolver.js');
const { excepcionesDeCasillas } = await import('../../../backend/src/modules/permissions/casillas.js');
const { tareasSinEfectoAntes } = await import('../../../backend/src/modules/permissions/inventario/en-uso-antes.js');
// Y sin lo que la 222 archiva: `tasks.*` de quien no pasaba la puerta del tablero (punto 6).
const sinArchivadas = (p) => Object.fromEntries(Object.entries(p.excepciones)
  .filter(([k]) => !tareasSinEfectoAntes(k, [p.role, ...p.roles_extra])));
const mapaDeAhora = (p) => resolverPermisos({
  role: p.role, roles_extra: p.roles_extra, customRole: p.custom_role,
  excepciones: { ...excepcionesDeCasillas(p), ...sinArchivadas(p) },
}).mapa;

const FOTO = path.resolve(__dirname, 'fixtures/menu-por-perfil-423.json');

const persona = (role, extra = {}) => ({
  id: 1, role, roles_extra: [], active: true, custom_role: null, excepciones: {}, ajustesRol: [],
  factura_manager: false, editar_fechas_factura: false, gestor_colaboraciones: false,
  usa_mcp: false, usa_whatsapp: null, ...extra,
});

export const PERFILES = {
  superadmin: persona('superadmin'),
  admin: persona('admin'),
  soporte: persona('soporte'),
  gestora: persona('gestor'),
  project_manager: persona('project_manager'),
  tutor: persona('tutor'),
  colaborador: persona('colaborador'),
  'gestora+admin': persona('gestor', { roles_extra: ['admin'] }),
  'gestora+tutor': persona('gestor', { roles_extra: ['tutor'] }),
  'gestora con factura_manager': persona('gestor', { factura_manager: true }),
  'gestora con editar_fechas_factura': persona('gestor', { editar_fechas_factura: true }),
  'gestora con gestor_colaboraciones': persona('gestor', { gestor_colaboraciones: true }),
  'gestora con usa_mcp': persona('gestor', { usa_mcp: true }),
  'gestora con diplomas.view': persona('gestor', { excepciones: { 'diplomas.view': true } }),
  'gestora con tasks.close': persona('gestor', { excepciones: { 'tasks.view_own': true, 'tasks.close': true, 'tasks.manage': true } }),
};

/** Lo que el CRM le pasa al menú: el usuario como lo devuelve /auth/me, y su mapa. */
export function menuDe(p, { mapa = legado.mapaDePermisos(p) } = {}) {
  const user = {
    id: p.id, role: p.role, roles_extra: p.roles_extra,
    factura_manager: p.factura_manager, editar_fechas_factura: p.editar_fechas_factura,
    gestor_colaboraciones: p.gestor_colaboraciones, usa_mcp: p.usa_mcp,
  };
  const can = crearCan(user, mapa);
  const soloColab = esSoloColaboraciones(user);
  const ctx = { user, can, soloColab };
  const role = rolesDe(user).length ? rolesDe(user) : ['gestor'];
  const out = [];
  for (const s of NAV_SECTIONS) {
    for (const item of entradasDeSeccion(s, ctx)) {
      if (item.children) {
        const hijos = item.children.filter((c) => canSeeItem(c, role, soloColab, user, can));
        for (const c of hijos) out.push(`${s.label} › ${item.label} › ${c.label}`);
      } else {
        out.push(`${s.label} › ${item.label}`);
      }
    }
  }
  return out;
}

/**
 * Lo que cambia a propósito respecto a la foto, por perfil: `+` aparece, `-`
 * desaparece. Está en la lista única para Diego (`cambios-aprobados.js`,
 * `CAMBIOS_DE_MENU`), con la ruta que demuestra que no cambia el acceso.
 */
const { cambiosDeMenuPorPerfil } = await import('../../../backend/src/modules/permissions/inventario/cambios-aprobados.js');
export const CAMBIOS_APROBADOS = cambiosDeMenuPorPerfil();

describe('menú por perfil (#423)', () => {
  const ahora = Object.fromEntries(Object.entries(PERFILES).map(([k, p]) => [k, menuDe(p, { mapa: mapaDeAhora(p) })]));

  if (process.env.ACTUALIZAR_MENU_423 === '1' || !fs.existsSync(FOTO)) {
    fs.mkdirSync(path.dirname(FOTO), { recursive: true });
    fs.writeFileSync(FOTO, JSON.stringify(ahora, null, 1) + '\n');
  }
  const foto = JSON.parse(fs.readFileSync(FOTO, 'utf8'));

  for (const perfil of Object.keys(PERFILES)) {
    it(`${perfil}: el mismo menú que antes, salvo lo aprobado`, () => {
      const antes = new Set(foto[perfil] || []);
      const despues = new Set(ahora[perfil]);
      const diferencias = [
        ...[...despues].filter((x) => !antes.has(x)).map((x) => `+ ${x}`),
        ...[...antes].filter((x) => !despues.has(x)).map((x) => `- ${x}`),
      ].sort();
      expect(diferencias).toEqual([...(CAMBIOS_APROBADOS[perfil] || [])].sort());
    });
  }

  it('la foto de ISEIE: Facturación ya la veían el admin y la gestora con la casilla (allí no estaba el fallo del 360)', () => {
    expect(foto.admin).toContain('Finanzas › Facturación');
    expect(foto['gestora con factura_manager']).toContain('Finanzas › Facturación');
    expect(foto.gestora).not.toContain('Finanzas › Facturación');
  });
});
