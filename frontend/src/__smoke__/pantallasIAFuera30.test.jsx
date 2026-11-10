import { describe, it, expect, vi, afterEach } from 'vitest';
import { isValidElement } from 'react';
import { Routes, Navigate, createRoutesFromChildren, matchRoutes } from 'react-router-dom';

/*
  #30 (aquí #11) · Las pantallas de IA del CRM, fuera (Diego, 10/11/2026): «el
  chatbot de IA del propio CRM ya no va, porque se usa Claude por el MCP».

  «Pregunta a tus datos» y «Chat IA» (que era «Próximamente») no salen en el
  menú ni en el buscador (Ctrl+K), para ningún rol; y quien entra por su
  dirección va al inicio (/dashboard), sin «Página no encontrada». ISEIE no tiene «Análisis
  IA» ni dock flotante. El código se queda: con `VITE_PANTALLAS_IA=1` vuelven
  (la última prueba). La gemela vive en MultiCRM (`src/test/pantallasIAFuera30`).
*/

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, permissions: null }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({}) }));
vi.mock('@/shared/api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

const { PANTALLAS_IA, RUTAS_IA } = await import('@/shared/lib/pantallasIA');
const { NAV_SECTIONS } = await import('@/shared/components/layout/Sidebar');
const { paginasDelBuscador } = await import('@/shared/components/ui/CommandPalette');
const { crearCan } = await import('@/shared/hooks/usePermission');
const { resolverPermisos } = await import('../../../backend/src/modules/permissions/resolver.js');

const NOMBRES_IA = ['Análisis IA', 'Pregunta a tus datos', 'Chat IA'];
const ROLES = ['superadmin', 'admin', 'soporte', 'gestor', 'project_manager', 'tutor', 'colaborador'];

/** Usuario y `can` como los da /auth/me; `todo` = con TODOS los permisos (el peor caso). */
function ctxDe(role, { todo = false } = {}) {
  const mapa = resolverPermisos({ role, roles_extra: [], customRole: null, excepciones: {} }).mapa;
  const user = { id: 1, role, roles_extra: [], gestor_colaboraciones: false };
  return { user, can: todo ? () => true : crearCan(user, mapa) };
}

/** Todas las entradas del menú, con sus hijos, sin filtrar por nadie. */
const todasLasEntradas = (secciones) => secciones.flatMap((s) =>
  s.items.flatMap((it) => (it.children ? [it, ...it.children] : [it])));

describe('#30 · las pantallas de IA del CRM, fuera del menú (Diego, 10/11)', () => {
  it('el interruptor está apagado por defecto', () => {
    expect(PANTALLAS_IA).toBe(false);
  });

  it('el menú no tiene ninguna, ni por nombre ni por dirección (tampoco «Próximamente»)', () => {
    const entradas = todasLasEntradas(NAV_SECTIONS);
    expect(entradas.length).toBeGreaterThan(30);
    expect(entradas.filter((e) => NOMBRES_IA.includes(e.label)).map((e) => e.label)).toEqual([]);
    expect(entradas.filter((e) => RUTAS_IA.includes(e.to)).map((e) => e.to)).toEqual([]);
  });

  for (const role of ROLES) {
    it(`${role}: el buscador (Ctrl+K) no las encuentra, ni con todos los permisos`, () => {
      for (const todo of [false, true]) {
        const paginas = paginasDelBuscador(ctxDe(role, { todo }));
        expect(paginas.filter((p) => RUTAS_IA.includes(p.to) || NOMBRES_IA.includes(p.label))).toEqual([]);
      }
    });
  }
});

describe('#30 · entrar por la dirección lleva al inicio, sin error', () => {
  // Las rutas salen del propio App.jsx, como en `menuSinRutasRotas.test.jsx`.
  function buscarRoutes(el) {
    if (!el) return null;
    if (Array.isArray(el)) {
      for (const x of el) { const r = buscarRoutes(x); if (r) return r; }
      return null;
    }
    if (!isValidElement(el)) return null;
    if (el.type === Routes) return el;
    return buscarRoutes(el.props?.children);
  }

  it.each([...RUTAS_IA, '/ai-chat'])('%s → /dashboard', async (ruta) => {
    const { default: App } = await import('@/App');
    const RUTAS = createRoutesFromChildren(buscarRoutes(App()).props.children);
    const m = matchRoutes(RUTAS, ruta);
    expect(m, ruta).toBeTruthy();
    const ultima = m[m.length - 1];
    // Ni la página de error (`*`) ni la pantalla: una redirección al inicio.
    expect(ultima.route.path).not.toBe('*');
    const el = ultima.route.element;
    expect(isValidElement(el) && el.type === Navigate, ruta).toBe(true);
    // El inicio de ISEIE: `/` solo redirige a /dashboard (`RootRedirect`).
    expect(el.props.to).toBe('/dashboard');
  }, 60000);
});

describe('#30 · se vuelven a encender en un solo sitio', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('con VITE_PANTALLAS_IA=1 vuelven al menú', async () => {
    vi.stubEnv('VITE_PANTALLAS_IA', '1');
    vi.resetModules();
    const { PANTALLAS_IA: encendido } = await import('@/shared/lib/pantallasIA');
    expect(encendido).toBe(true);
    const { NAV_SECTIONS: menu } = await import('@/shared/components/layout/Sidebar');
    const aDonde = todasLasEntradas(menu).map((e) => e.to);
    // «Pregunta a tus datos», además, solo en pruebas (`SOLO_EN_PRUEBAS`): aquí lo es.
    for (const p of RUTAS_IA) expect(aDonde, p).toContain(p);
  }, 60000);
});
