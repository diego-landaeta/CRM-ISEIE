// @vitest-environment jsdom
// CRM-ISEIE#761 (gemela de CRM#1105) · El rol «Líder de equipo»: lo de una gestora y
// lo de su equipo, sin administración. El menú de verdad (NAV_SECTIONS) con el mapa
// de permisos que le da el SERVIDOR (resolver.js + catalogo.js), y «Cómo voy» con su
// puesto en su equipo.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, permissions: null }) }));
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({ activeProject: { id: 1 }, activeIssuerId: null }),
}));
vi.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({}), useOptionalTheme: () => 'dark' }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
const respuestas = vi.hoisted(() => ({ puesto: null }));
vi.mock('@/shared/api/client', () => ({
  default: {
    get: vi.fn(async (url) => {
      if (String(url).startsWith('/informes/mi-puesto')) return { success: true, data: respuestas.puesto };
      return { success: true, data: null };
    }),
    post: vi.fn(),
  },
}));

const { NAV_SECTIONS, canSeeItem } = await import('@/shared/components/layout/Sidebar');
const { ROLES_DE_GESTORA, esRolDeGestora } = await import('@/shared/lib/roles');
const { NOMBRE_ROL } = await import('@/shared/lib/rolesAsignables');
const { NOMBRE_DEL_ROL, CADA_DIA } = await import('@/shared/lib/recorridoGeneral');
const { resolverPermisos } = await import('../../../backend/src/modules/permissions/resolver.js');
const { default: ComoVoy } = await import('@/modules/reports/components/ComoVoy');

afterEach(() => cleanup());

const mapaDe = (role) => resolverPermisos({ role, roles_extra: [] }).mapa;
const LIDER = mapaDe('lider_equipo');
const GESTORA = mapaDe('gestor');

function loQueVe(roles, mapa) {
  const can = (k) => mapa[k] === true;
  const pasa = (item) => canSeeItem(item, roles, false, {}, can);
  return NAV_SECTIONS.flatMap((s) => s.items).filter(pasa).flatMap((it) => (it.children ? it.children.filter(pasa) : [it]))
    .map((it) => it.to).filter(Boolean);
}

describe('el rol en la pantalla', () => {
  it('se llama «Líder de equipo» y trabaja como una gestora', () => {
    expect(NOMBRE_ROL.lider_equipo).toBe('Líder de equipo');
    expect(NOMBRE_DEL_ROL.lider_equipo).toBe('Líder de equipo');
    expect(CADA_DIA.lider_equipo).toMatch(/equipo/);
    expect(ROLES_DE_GESTORA).toEqual(['gestor', 'lider_equipo']);
    expect(esRolDeGestora('lider_equipo')).toBe(true);
    expect(esRolDeGestora('admin')).toBe(false);
  });

  it('el servidor le da lo de la gestora y lo de equipo, nada de administración', () => {
    const deGestora = Object.keys(GESTORA).filter((k) => GESTORA[k]);
    expect(deGestora.filter((k) => !LIDER[k])).toEqual([]);
    for (const k of ['reports.puesto_ajeno', 'reports.view', 'ventas.view_equipo', 'leads.assign', 'whatsapp.supervisar', 'equipos.su_equipo']) {
      expect(LIDER[k], k).toBe(true);
    }
    for (const k of ['users.view', 'users.create', 'roles.view', 'integrations.view', 'accounting.view', 'expenses.view',
      'facturas.emitir', 'facturas.configurar', 'mcp.usar', 'credentials.view', 'links_pago.ver_todos', 'equipos.gestionar']) {
      expect(LIDER[k], k).not.toBe(true);
    }
  });
});

describe('menú · líder de equipo (CRM-ISEIE#761)', () => {
  it('ve lo de una gestora: prospectos, la cola, ventas, su WhatsApp, por cobrar', () => {
    const ve = loQueVe(['lider_equipo'], LIDER);
    expect(ve).toEqual(expect.arrayContaining(['/leads', '/leads/cola', '/ventas', '/whatsapp/chat', '/accounting/receivable', '/preferencias']));
  });

  it('y lo de su equipo: la actividad de WhatsApp de sus gestoras', () => {
    expect(loQueVe(['lider_equipo'], LIDER)).toContain('/whatsapp/actividad');
    expect(loQueVe(['gestor'], GESTORA)).not.toContain('/whatsapp/actividad');
  });

  it('nada de administración', () => {
    const ve = loQueVe(['lider_equipo'], LIDER);
    for (const no of ['/accounting', '/expenses', '/accounting/payable', '/commissions', '/payroll', '/accounting/facturas',
      '/accounting/integrations', '/accounting/facturas-colaboradores', '/registro', '/conexion/moodle', '/conexion/conectores',
      '/conexion/webhooks', '/conexion/asignacion-leads', '/tutores', '/woocommerce', '/configuracion/categorias-arbol', '/tareas/configurar', '/leads/revision-duplicados']) {
      expect(ve, no).not.toContain(no);
    }
  });

  it('lo que la gestora ve por su rol, la líder también (con los mismos permisos, la misma lista)', () => {
    expect(loQueVe(['lider_equipo'], GESTORA)).toEqual(loQueVe(['gestor'], GESTORA));
  });
});

describe('«Cómo voy» de la líder', () => {
  const cifras = (x = {}) => ({
    leads: 0, ventas: 0, vendido: 0, cobrado: 0, cobros: 0,
    cobrado_del_periodo: 0, cobrado_anteriores: 0, cobrado_en_cuotas: 0,
    ventas_anteriores: 0, anteriores_grandes: [], facturado: 0, pendiente: 0, tasa: 0, ...x,
  });
  const datos = (lider) => ({
    puesto: 2, de: 3, nombre: 'Raquel', ...cifras({ leads: 20, ventas: 3, cobrado: 900, tasa: 15 }),
    tasa_equipo: 12, ventas_equipo: 9, cobrado_equipo: 3000, facturado_equipo: 0,
    faltan_para_subir: 300, mejor_cobrado: 1200, mejor_facturado: 0, mejor_ventas: 4,
    tabla: [
      { puesto: 1, user_id: 2, nombre: 'Fabiola', ...cifras({ leads: 30, ventas: 4, cobrado: 1200, tasa: 13.3 }) },
      { puesto: 2, user_id: 5, nombre: 'Raquel', ...cifras({ leads: 20, ventas: 3, cobrado: 900, tasa: 15 }) },
      { puesto: 3, user_id: 12, nombre: 'Malena', ...cifras({ leads: 25, ventas: 2, cobrado: 900, tasa: 8 }) },
    ],
    sin_gestora: null, total: null, lider,
  });

  it('la tabla de su equipo y, además, su puesto en él', async () => {
    respuestas.puesto = datos(true);
    render(<ComoVoy />);
    await waitFor(() => expect(screen.getByLabelText('Cómo va el equipo este mes')).toBeTruthy());
    expect((screen.getByTestId('como-voy-lider').textContent || '').replace(/\s+/g, ' ')).toMatch(/Tú: puesto 2 de 3/);
  });

  it('a quien manda sin ser líder no le sale la línea de su puesto', async () => {
    respuestas.puesto = datos(false);
    render(<ComoVoy />);
    await waitFor(() => expect(screen.getByLabelText('Cómo va el equipo este mes')).toBeTruthy());
    expect(screen.queryByTestId('como-voy-lider')).toBeNull();
  });
});
