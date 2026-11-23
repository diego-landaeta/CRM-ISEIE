// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * El menú, por permiso y no por rol (gemela de CRM#1046; #230: «el rol solo vale
 * para el ALCANCE»).
 *
 * Una gestora con permisos de admin dados como excepción perdía entradas como
 * «Productos» aunque tuviera `products.view`: la entrada pedía el rol de admin.
 * Ahora una entrada que pide `permiso` sale a quien lo tiene, sea cual sea su
 * rol; `roles` solo decide a quién se le enseña de serie lo que no pide permiso.
 *
 * Y lo que NO tiene que pasar: que a una gestora normal le salgan entradas
 * nuevas solo porque su rol ya trae el permiso de serie. Las que están en ese
 * caso llevan `seguirPorRol` hasta que se decida. En ISEIE «Productos» ya la veía
 * quien tiene `products.view` (no lleva `roles`).
 */

afterEach(cleanup);

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, permissions: null }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({}) }));
vi.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({}), useOptionalTheme: () => 'dark' }));
vi.mock('@/shared/api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

const { NAV_SECTIONS, entradasDeSeccion, canSeeItem, esSoloColaboraciones } = await import('@/shared/components/layout/Sidebar');
const { crearCan } = await import('@/shared/hooks/usePermission');
const { rolesDe } = await import('@/shared/lib/roles');
const { resolverPermisos } = await import('../../../backend/src/modules/permissions/resolver.js');

const persona = (role, extra = {}) => ({ id: 1, role, roles_extra: [], gestor_colaboraciones: false, ...extra });

/** Las entradas que ve (`Sección › Entrada`, y `› Hijo` en un grupo), con su mapa del servidor. */
function menuDe(user, { excepciones = {} } = {}) {
  const mapa = resolverPermisos({ role: user.role, roles_extra: user.roles_extra, excepciones }).mapa;
  const can = crearCan(user, mapa);
  const soloColab = esSoloColaboraciones(user);
  const ctx = { user, can, soloColab };
  const out = [];
  for (const s of NAV_SECTIONS) {
    for (const item of entradasDeSeccion(s, ctx)) {
      if (item.children) {
        for (const c of item.children.filter((c) => canSeeItem(c, rolesDe(user), soloColab, user, can))) {
          out.push({ linea: `${s.label} › ${item.label} › ${c.label}`, item: c, can });
        }
      } else {
        out.push({ linea: `${s.label} › ${item.label}`, item, can });
      }
    }
  }
  return out;
}

/** Las que ve SOLO por el permiso: su rol no está en `roles` y no tiene el `oPermiso`. */
const nuevasPorPermiso = (user, opciones) => menuDe(user, opciones)
  .filter(({ item, can }) => Array.isArray(item.roles) && !rolesDe(user).some((r) => item.roles.includes(r))
    && !(item.oPermiso && [].concat(item.oPermiso).some((p) => can(p))))
  .map(({ linea }) => linea)
  .sort();

const lineas = (user, opciones) => menuDe(user, opciones).map(({ linea }) => linea);

const ve = (menu, entrada) => menu.some((l) => l.endsWith(`› ${entrada}`));

describe('menú por permiso, no por rol', () => {
  it('a una gestora normal no le aparece nada nuevo', () => {
    expect(nuevasPorPermiso(persona('gestor'))).toEqual([]);
  });

  it('una gestora con products.view dado como excepción ve «Productos»', () => {
    expect(ve(lineas(persona('gestor'), { excepciones: { 'products.view': true } }), 'Productos')).toBe(true);
  });

  it('sin products.view (quitado como excepción) no lo ve', () => {
    expect(ve(lineas(persona('gestor'), { excepciones: { 'products.view': false } }), 'Productos')).toBe(false);
  });

  it('una gestora con un permiso de admin dado (registro.view) ve su entrada', () => {
    expect(ve(lineas(persona('gestor')), 'Registro')).toBe(false);
    expect(ve(lineas(persona('gestor'), { excepciones: { 'registro.view': true } }), 'Registro')).toBe(true);
  });

  it('lo que sigue por rol (`seguirPorRol`) no le sale a la gestora aunque su rol traiga el permiso', () => {
    const menu = lineas(persona('gestor'));
    for (const e of ['Conversiones', 'Ingresos', 'Conciliación', 'Pagos Stripe', 'Pendientes de facturar', 'Email', 'Formularios', 'Widget web']) {
      expect(ve(menu, e), e).toBe(false);
    }
  });

  it('el tutor, el colaborador y el tutor redactor siguen con su recorte', () => {
    const exc = { 'products.view': true, 'registro.view': true };
    for (const r of ['tutor', 'colaborador', 'tutor_redactor']) {
      const menu = lineas(persona(r), { excepciones: exc });
      expect(ve(menu, 'Productos'), r).toBe(false);
      expect(ve(menu, 'Registro'), r).toBe(false);
    }
  });
});
