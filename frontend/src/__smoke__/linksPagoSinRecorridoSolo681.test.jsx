// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  CRM-ISEIE#681 (gemela de CRM#1012; Diego, 23/11): en producción de ISEIE el
  recorrido de Links de pago se abría solo al entrar y tapaba «Crear link de pago».

    · Entrar en Links de pago (la pantalla de verdad, con su lista cargada) no
      abre ningún recorrido, ni pasado el rato en que antes salía solo.
    · «Crear link de pago» queda libre.
    · «Recorrido», arriba a la derecha, lo abre.
*/

const get = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ default: { get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
const permisos = vi.hoisted(() => new Set());
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => permisos.has(k), llevaEquipo: false }) }));
const sesion = vi.hoisted(() => ({ user: null }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: sesion.user, permissions: null, logout: vi.fn() }) }));
vi.mock('@/contexts/ProjectContext', () => {
  const p = { id: 1, nombre: 'Campus Uno', modules: null };
  return {
    useProjectContext: () => ({
      activeProject: p, projects: [p], isAllProjects: false,
      activeIssuer: null, activeIssuerId: null, switchProject: vi.fn(), switchIssuer: vi.fn(),
    }),
  };
});
vi.mock('@/contexts/ThemeContext', () => {
  const tema = { theme: 'light', toggleTheme: vi.fn() };
  return { useTheme: () => tema, useOptionalTheme: () => tema };
});
vi.mock('@/shared/hooks/useAmbito', () => ({ useIdsDelAmbito: () => [1], useProyectosDelAmbito: () => [] }));
vi.mock('@/shared/components/layout/CabeceraContext', () => ({ useCabecera: () => null }));

const { default: LinksDePagoPage } = await import('@/modules/links-pago/pages/LinksDePagoPage');
const { default: BotonRecorrido } = await import('@/shared/components/layout/BotonRecorrido');
const { default: PresentadorRecorrido } = await import('@/shared/components/layout/PresentadorRecorrido');
const { _reiniciarLanzador } = await import('@/shared/lib/lanzadorRecorridos');

const LINK = {
  id: 40, project_id: 1, project_nombre: 'Campus Uno', lead_id: 3, lead_nombre: 'Alumna Prueba', conversion_id: 81,
  venta_producto_nombre: 'Máster de prueba', product_id: 5, product_nombre: 'Máster de prueba',
  created_by: 2, creado_por_nombre: 'Gestora Uno', precio_catalogo: '1000.00', importe: '370.00', descuento_pct: '0',
  moneda: 'EUR', modalidad: 'unico', estado: 'creado', url: 'https://buy.stripe.com/test_40', caduca_el: '2026-11-26T10:00:00Z',
  pagado_el: null, anulado_por_nombre: null, anulado_el: null, motivo_anulacion: null, created_at: '2026-11-19T10:00:00Z',
};

const CONFIG = {
  project_id: 1, descuento_max_pct: 0, caducidad_dias: 7, caducidad_max_dias: 30,
  cuotas_admitidas: false, cuotas_max: 12, monedas: ['EUR'], moneda_defecto: 'EUR',
};
const CURSOS = [{ id: 5, nombre: 'Máster de prueba', precio: '1000.00', moneda: 'EUR' }];

const RECORRIDO = '[aria-labelledby="recorrido-titulo"]';

beforeEach(() => {
  localStorage.clear();
  _reiniciarLanzador();
  permisos.clear();
  for (const k of ['links_pago.crear', 'links_pago.ver_todos', 'whatsapp.usar']) permisos.add(k);
  sesion.user = { id: 2, role: 'gestor', nombre: 'Gestora Uno', funciones: { links_pago: true } };
  get.mockReset();
  get.mockImplementation(async (url) => {
    if (url === '/links-pago') return { success: true, data: [LINK], pagination: { total: 1, page: 1, limit: 25, totalPages: 1 } };
    if (String(url).startsWith('/links-pago/config')) return { success: true, data: CONFIG };
    if (url === '/products') return { success: true, data: CURSOS };
    if (url === '/links-pago/cuotas-disponibles') return { success: true, data: { disponible: true, motivo: null, cuotas_max: 12 } };
    if (String(url).startsWith('/whatsapp/conexion')) return { success: true, data: { configurado: false, conectado: false } };
    return { success: true, data: [] };
  });
  window.matchMedia = window.matchMedia || ((q) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); });

const pintar = () => render(
  <MemoryRouter initialEntries={['/links-pago']}>
    <BotonRecorrido />
    <LinksDePagoPage />
    <PresentadorRecorrido />
  </MemoryRouter>,
);

describe('Links de pago: el recorrido solo con el botón (#681)', () => {
  it('al entrar, con la lista cargada y pasado el rato, no se abre ningún recorrido', async () => {
    pintar();
    expect(await screen.findByText('Venta n.º 81')).toBeInTheDocument();
    // Antes salía solo a los 0,8 s de tener la pantalla lista.
    await new Promise((r) => setTimeout(r, 1800));
    expect(document.querySelector(RECORRIDO)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    // «Crear link de pago» queda libre: abre su asistente.
    fireEvent.click(screen.getAllByRole('button', { name: /Crear link de pago/ })[0]);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(document.querySelector(RECORRIDO)).toBeNull();
  });

  it('ni aunque sea la primera vez de esa persona (nada guardado en el navegador)', async () => {
    localStorage.clear();
    pintar();
    await screen.findByText('Venta n.º 81');
    await new Promise((r) => setTimeout(r, 1800));
    expect(document.querySelector(RECORRIDO)).toBeNull();
  });

  it('«Recorrido» de arriba lo abre', async () => {
    pintar();
    await screen.findByText('Venta n.º 81');
    fireEvent.click(screen.getByRole('button', { name: 'Recorrido' }));
    expect(await screen.findByRole('dialog', { name: 'Links de pago' })).toBeInTheDocument();
  });

  it('y el «Ver recorrido» de la propia pantalla, también', async () => {
    pintar();
    await screen.findByText('Venta n.º 81');
    fireEvent.click(screen.getByRole('button', { name: /^Ver recorrido/ }));
    expect(await screen.findByRole('dialog', { name: 'Links de pago' })).toBeInTheDocument();
  });
});
