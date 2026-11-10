// @vitest-environment jsdom
// ISEIE no tiene un setup común de pruebas: el entorno y la limpieza entre
// pruebas se ponen aquí (como en ambitoEmpresa-346).
import { afterEach as despuesDeCada } from 'vitest';
import { cleanup as limpiar } from '@testing-library/react';

despuesDeCada(limpiar);
if (typeof window !== 'undefined') {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia ??= () => ({ matches: false, media: '', onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
}

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * #631 · Ninguna pantalla se abre a quien el servidor le niega los datos
 * (CRM-ISEIE#358, gemela de CRM#643).
 *
 * La auditoría del 03/11/2026 encontró pantallas que se abrían a la gestora, al
 * project manager o a soporte y luego daban 403. Ahora la ruta, las pestañas de
 * sección y los accesos rápidos miran el mismo permiso que el menú
 * (`rutaPermitida`). Los mapas de permisos son los del servidor
 * (`resolverPermisos`), por rol.
 *
 * Lo que cambia frente al 360: aquí las rutas son las de ISEIE (`/leads`,
 * `/accounting/…`), las pestañas de sección las pinta `SectionTabs` y Status
 * tiene una parte pública, así que no se esconde: dentro, las piezas y los
 * correos piden `status.view`.
 */

const auth = vi.hoisted(() => ({ user: null, permissions: null }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
const proyecto = vi.hoisted(() => ({ value: {} }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => proyecto.value }));
vi.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({}), useOptionalTheme: () => 'dark' }));
// Respuestas con la forma de cada pantalla, para que se pinten sin romperse.
const cliente = vi.hoisted(() => ({
  get: vi.fn(async (url) => {
    const u = String(url);
    if (u.startsWith('/status/piezas')) return { success: true, data: { global: 'bien', comprobado: new Date().toISOString(), arribaDesdeMs: 60000, piezas: [] } };
    if (u.startsWith('/status/correos')) return { success: true, data: { envios: [], resumen: { enviado: 0, fallido: 0, bloqueado: 0 } } };
    return { success: true, data: [] };
  }),
  post: vi.fn(),
}));
vi.mock('@/shared/api/client', () => ({ default: cliente }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

const { NAV_SECTIONS, rutaPermitida } = await import('@/shared/components/layout/Sidebar');
const { crearCan } = await import('@/shared/hooks/usePermission');
const { resolverPermisos } = await import('../../../backend/src/modules/permissions/resolver.js');
const { default: SubNav } = await import('@/shared/components/ui/SubNav');
const { default: AccesosClave } = await import('@/shared/components/ui/AccesosClave');
const { default: SectionTabs } = await import('@/shared/components/layout/SectionTabs');
const { default: StatusPage } = await import('@/shared/pages/StatusPage');

const ROLES = ['admin', 'soporte', 'gestor', 'project_manager', 'tutor', 'colaborador'];
const quien = (role) => ({ id: 1, role, roles_extra: [], active: true });
const mapaDe = (role) => resolverPermisos({ role }).mapa;
const canDe = (role) => crearCan(quien(role), mapaDe(role));

/** Las entradas del menú con permiso. */
function entradasConPermiso() {
  const out = [];
  const recorrer = (items) => {
    for (const it of items || []) {
      if (it.to && !it.href && it.permiso) out.push(it);
      if (it.children) recorrer(it.children);
    }
  };
  for (const s of NAV_SECTIONS) recorrer(s.items);
  return out;
}
const claves = (it) => [...[].concat(it.permiso), ...[].concat(it.oPermiso || [])];

describe('#631 · rutaPermitida', () => {
  it.each(ROLES)('%s: ninguna pantalla del menú se abre sin alguno de sus permisos', (role) => {
    const can = canDe(role);
    const fugas = [];
    for (const ruta of new Set(entradasConPermiso().map((it) => it.to))) {
      const suyas = entradasConPermiso().filter((it) => it.to === ruta);
      const conPermiso = suyas.some((it) => claves(it).some((k) => can(k) === true));
      if (rutaPermitida(ruta, can) && !conPermiso) fugas.push(ruta);
    }
    expect(fugas).toEqual([]);
  });

  it('el superadmin lo abre todo', () => {
    const can = crearCan(quien('superadmin'), {});
    for (const it of entradasConPermiso()) expect(rutaPermitida(it.to, can)).toBe(true);
  });

  it('una ruta que no está en el menú no se decide aquí (la ficha de un prospecto, por ejemplo)', () => {
    expect(rutaPermitida('/leads/123', () => false)).toBe(true);
  });

  it('la barra final no cambia nada', () => {
    expect(rutaPermitida('/accounting/receivable/', () => false)).toBe(false);
  });

  it('el Banco también se abre con solo verlo (`whatsapp.banco`); el chat, no', () => {
    expect(rutaPermitida('/whatsapp/banco', (k) => k === 'whatsapp.banco')).toBe(true);
    expect(rutaPermitida('/whatsapp', (k) => k === 'whatsapp.banco')).toBe(false);
    expect(rutaPermitida('/whatsapp/chat', (k) => k === 'whatsapp.banco')).toBe(false);
  });

  it('WhatsApp: Banco y el chat por `/whatsapp` piden usarlo o supervisarlo', () => {
    for (const ruta of ['/whatsapp', '/whatsapp/banco']) {
      expect(rutaPermitida(ruta, () => false)).toBe(false);
      expect(rutaPermitida(ruta, (k) => k === 'whatsapp.supervisar')).toBe(true);
      expect(rutaPermitida(ruta, (k) => k === 'whatsapp.usar')).toBe(true);
    }
  });

  it('las de la auditoría siguen al permiso del servidor', () => {
    const PANTALLAS = {
      '/accounting/receivable': ['accounting.por_cobrar'],
      '/payroll': ['payroll.view'],
      '/accounting/integrations': ['integrations.view'],
      '/woocommerce': ['woocommerce.view'],
      '/configuracion/categorias-arbol': ['products.categorias'],
      '/leads/duplicados': ['leads.duplicados'],
      '/tutores': ['tutores.gestionar'],
      '/tareas/revisar': ['tasks.close'],
      // Y verlo (`whatsapp.banco`): el project manager, que ve todo (Diego, 04/11).
      '/whatsapp/banco': ['whatsapp.usar', 'whatsapp.supervisar', 'whatsapp.banco'],
    };
    for (const role of ROLES) {
      const can = canDe(role);
      for (const [ruta, ks] of Object.entries(PANTALLAS)) {
        expect([role, ruta, rutaPermitida(ruta, can)]).toEqual([role, ruta, ks.some((k) => can(k) === true)]);
      }
    }
  });
});

describe('#631 · pestañas y accesos rápidos', () => {
  const TABS = [
    { label: 'Stripe', to: '/accounting/pagos-stripe' },
    { label: 'Nóminas', to: '/payroll' },
    { label: 'Por cobrar', to: '/accounting/receivable' },
  ];

  it('SubNav esconde la pestaña sin permiso', () => {
    auth.user = quien('gestor');
    auth.permissions = { 'stripe.view': true };
    render(<MemoryRouter><SubNav tabs={TABS} /></MemoryRouter>);
    expect(screen.getByText('Stripe')).toBeTruthy();
    expect(screen.queryByText('Nóminas')).toBeNull();
    expect(screen.queryByText('Por cobrar')).toBeNull();
  });

  it('SubNav las enseña todas mientras no han llegado los permisos', () => {
    auth.user = quien('gestor');
    auth.permissions = null;
    render(<MemoryRouter><SubNav tabs={TABS} /></MemoryRouter>);
    for (const t of TABS) expect(screen.getByText(t.label)).toBeTruthy();
  });

  it('AccesosClave esconde el acceso sin permiso', () => {
    auth.user = quien('gestor');
    auth.permissions = { 'stripe.view': true };
    const Icono = () => null;
    render(
      <MemoryRouter>
        <AccesosClave accesos={TABS.map((t) => ({ ...t, detail: '', icon: Icono }))} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Stripe')).toBeTruthy();
    expect(screen.queryByText('Por cobrar')).toBeNull();
  });

  it('SectionTabs (Finanzas) esconde la pestaña sin permiso', () => {
    // Un admin al que se le ha quitado «Por cobrar»: por rol la pestaña sale,
    // pero el servidor le daría 403.
    auth.user = quien('admin');
    auth.permissions = { ...mapaDe('admin'), 'accounting.por_cobrar': false };
    render(<MemoryRouter initialEntries={['/ventas']}><SectionTabs /></MemoryRouter>);
    expect(screen.getByText('Ventas')).toBeTruthy();
    expect(screen.queryByText('Cuentas por cobrar')).toBeNull();
  });

  it('SectionTabs las enseña todas mientras no han llegado los permisos', () => {
    auth.user = quien('admin');
    auth.permissions = null;
    render(<MemoryRouter initialEntries={['/ventas']}><SectionTabs /></MemoryRouter>);
    expect(screen.getByText('Cuentas por cobrar')).toBeTruthy();
  });
});

describe('#631 · Status solo pide lo que se puede ver', () => {
  const comoRol = (role) => {
    auth.user = quien(role);
    auth.permissions = mapaDe(role);
    proyecto.value = { activeProject: { id: 2, nombre: 'ISEIE' }, projects: [{ id: 2 }] };
    cliente.get.mockClear();
  };
  const pedidas = () => cliente.get.mock.calls.map(([u]) => String(u).split('?')[0]);
  const montar = (El) => render(<MemoryRouter><El /></MemoryRouter>);

  it('sin `status.view` (gestora): ni piezas ni correos; lo público, sí', async () => {
    comoRol('gestor');
    expect(mapaDe('gestor')['status.view']).not.toBe(true);
    montar(StatusPage);
    await new Promise((ok) => setTimeout(ok, 0));
    expect(pedidas()).not.toContain('/status/piezas');
    expect(pedidas()).not.toContain('/status/correos');
    expect(pedidas()).toContain('/status/incidents');
  });

  it('con soporte: también las piezas y los correos', async () => {
    comoRol('soporte');
    montar(StatusPage);
    await new Promise((ok) => setTimeout(ok, 0));
    expect(pedidas()).toEqual(expect.arrayContaining(['/status/piezas', '/status/correos']));
  });
});
