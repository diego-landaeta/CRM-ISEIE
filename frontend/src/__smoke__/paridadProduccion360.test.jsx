// @vitest-environment jsdom
// v2.9.7 · Paridad de producción con el 360 (Diego, 23/11: «ISEIE debe poder hacer
// todo lo del 360»). El menú de producción se construye con VITE_BETA_MODE=true y,
// en ISEIE, sin depender de VITE_PROCESO_EN_PRUEBAS para lo que no es del proceso.
import { describe, it, expect, vi, afterAll } from 'vitest';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, permissions: null }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({}) }));
vi.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({}), useOptionalTheme: () => 'dark' }));
vi.mock('@/shared/api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

// Como el build de producción: modo BETA puesto y VITE_PROCESO_EN_PRUEBAS sin definir.
vi.stubEnv('VITE_BETA_MODE', 'true');
vi.stubEnv('VITE_PROCESO_EN_PRUEBAS', '');
const { isBetaAllowed, BETA_MODE } = await import('@/shared/config/betaConfig');
const { NAV_SECTIONS } = await import('@/shared/components/layout/Sidebar');
afterAll(() => vi.unstubAllEnvs());

const entradas = () => NAV_SECTIONS
  .flatMap((s) => s.items)
  .flatMap((i) => (i.children ? [i, ...i.children] : [i]));
const entrada = (to) => entradas().find((i) => i.to === to);

describe('paridad de producción con el 360', () => {
  it('el modo BETA está puesto en esta prueba', () => {
    expect(BETA_MODE).toBe(true);
  });

  it('Finanzas › Conversiones (/revenue) ya no sale «Próximamente»', () => {
    expect(entrada('/revenue')).toBeTruthy();
    expect(isBetaAllowed('/revenue')).toBe(true);
  });

  it('Novedades está en el menú aunque el build no traiga VITE_PROCESO_EN_PRUEBAS', () => {
    const novedades = entrada('/novedades');
    expect(novedades).toBeTruthy();
    expect(novedades.permiso).toBe('novedades.view');
    expect(isBetaAllowed('/novedades')).toBe(true);
  });

  it('«Productos por categoría» lleva a /products/tree, como en el 360', () => {
    const item = entrada('/products/tree');
    expect(item?.label).toBe('Productos por categoría');
    expect(isBetaAllowed('/products/tree')).toBe(true);
  });

  it('ninguna entrada del menú sale «Próximamente» en producción salvo las que aún no tienen pantalla', () => {
    // Sin pantalla en ninguno de los dos CRM (en el 360 son «Aún no conectado»), o solo en pruebas.
    const sinPantalla = new Set(['/campaigns', '/google-ads', '/seo', '/chat-ia', '/equipo/actividad']);
    const apagadas = entradas()
      .filter((i) => i.to && !i.comingSoon && !sinPantalla.has(i.to))
      .filter((i) => !isBetaAllowed(i.to))
      .map((i) => i.to);
    expect(apagadas).toEqual([]);
  });
});
