// @vitest-environment jsdom
// Gemela de MultiCRM (frontend/src/test/menuFacturacionGestora.test.jsx), paridad 2.6.0 (02/11),
// con el `canSeeItem` de ISEIE (role, soloColaboraciones, permisos, can) y su ruta
// /accounting/facturas.
//
// La entrada «Facturación» del menú para una gestora que factura (Diego, 23/10/2026:
// «a Yolanda no le salen las funciones de facturación»). La casilla `factura_manager`
// es ahora una excepción de la persona (#230, gemela de CRM#423): `facturas.emitir`,
// y la entrada pide esa clave del catálogo. Quien factura la ve; quien no, no.
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, permissions: null }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({}) }));
vi.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({}), useOptionalTheme: () => 'dark' }));
vi.mock('@/shared/api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

const { NAV_SECTIONS, canSeeItem } = await import('@/shared/components/layout/Sidebar');

const entrada = (to) => NAV_SECTIONS.flatMap((s) => s.items).find((i) => i.to === to && !i.projectType);
// Como el `can` de verdad para una gestora: el mapa de Roles no tiene `factura_manager`.
const can = (lista) => (k) => lista.includes(k);
const seVe = (item, roles, user, permisos = []) => canSeeItem(item, roles, false, user, can(permisos));

describe('menú › Facturación', () => {
  const facturacion = entrada('/accounting/facturas');
  const yolanda = { role: 'gestor', roles_extra: ['tutor'], factura_manager: true };

  it('existe y pide «facturas.emitir» (la casilla, ya como permiso)', () => {
    expect([].concat(facturacion?.permiso)).toContain('facturas.emitir');
  });

  it('a Yolanda (gestora + tutora, con la casilla → facturas.emitir) le sale', () => {
    expect(seVe(facturacion, ['gestor', 'tutor'], yolanda, ['facturas.emitir'])).toBe(true);
  });

  it('a una gestora con la casilla → facturas.emitir, también', () => {
    expect(seVe(facturacion, ['gestor'], { role: 'gestor', factura_manager: true }, ['facturas.emitir'])).toBe(true);
  });

  it('a una gestora sin la casilla, no', () => {
    expect(seVe(facturacion, ['gestor'], { role: 'gestor', factura_manager: false })).toBe(false);
  });

  it('a admin, por su rol (facturas.emitir de serie)', () => {
    expect(seVe(facturacion, ['admin'], { role: 'admin' }, ['facturas.emitir'])).toBe(true);
  });
});

describe('las claves del sistema de Roles siguen pasando por `can`', () => {
  it('«Historial de tareas» (tasks.view_own) solo con el permiso; «Por revisar» ya no está (CRM-ISEIE#419)', () => {
    const item = entrada('/tareas/historial');
    expect(item?.permiso).toBe('tasks.view_own');
    expect(seVe(item, ['admin'], { role: 'admin' }, [])).toBe(false);
    expect(seVe(item, ['admin'], { role: 'admin' }, ['tasks.view_own'])).toBe(true);
    expect(entrada('/tareas/revisar')).toBeFalsy();
  });

  it('una entrada sin permiso ni roles pasa siempre', () => {
    expect(seVe({ to: '/x' }, ['gestor'], { role: 'gestor' }, [])).toBe(true);
  });
});
