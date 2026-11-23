import { describe, it, expect, vi } from 'vitest';

/**
 * «Matrículas» pasa a llamarse «Solicitud de admisión» (Diego, 17/11/2026), y la
 * ven TODAS las gestoras: también quien tiene la gestora como rol de más.
 *
 * El menú se calcula como en la pantalla (`entradasDeSeccion` + `canSeeItem`) con
 * el mapa de permisos del servidor (`resolverPermisos`): si alguien vuelve a
 * esconderla por rol o le cambia el nombre, esto falla. La dirección no cambia
 * (/matriculas): los enlaces de los correos siguen valiendo.
 */

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, permissions: null }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({}) }));
vi.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({}), useOptionalTheme: () => 'dark' }));
vi.mock('@/shared/api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

const { NAV_SECTIONS, entradasDeSeccion, esSoloColaboraciones } = await import('@/shared/components/layout/Sidebar');
const { crearCan } = await import('@/shared/hooks/usePermission');
const { resolverPermisos } = await import('../../../backend/src/modules/permissions/resolver.js');

function menuDe(role, roles_extra = []) {
  const user = { id: 1, role, roles_extra };
  const mapa = resolverPermisos({ role, roles_extra }).mapa;
  const can = crearCan(user, mapa);
  const ctx = { user, can, modules: undefined, projectType: 'educacion', soloColab: esSoloColaboraciones(user) };
  return NAV_SECTIONS.flatMap((s) => entradasDeSeccion(s, ctx).map((i) => ({ seccion: s.label, ...i })));
}

describe('Solicitud de admisión en el menú', () => {
  it.each([
    ['una gestora', 'gestor', []],
    ['quien tiene la gestora como rol de más', 'colaborador', ['gestor']],
    ['un admin', 'admin', []],
  ])('%s la ve en Comercial, con su nombre nuevo y la misma dirección', (_n, role, extra) => {
    const entrada = menuDe(role, extra).find((i) => i.to === '/matriculas');
    expect(entrada).toBeTruthy();
    // En «Comercial» desde el reparto por bloques (gemela de CRM#900); antes, «Clientes».
    expect(entrada.seccion).toBe('Comercial');
    expect(entrada.label).toBe('Solicitud de admisión');
  });

  it('ya no queda ninguna entrada que se llame «Matrículas»', () => {
    const etiquetas = NAV_SECTIONS.flatMap((s) => s.items.flatMap((i) => [i.label, ...(i.children || []).map((c) => c.label)]));
    expect(etiquetas).not.toContain('Matrículas');
  });

});
