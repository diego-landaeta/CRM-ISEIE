// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Gemela de CRM#900 y #903 (#534 del 360, parte 3; aquí, CRM-ISEIE#367) · El
 * menú por bloques de uso cambia el SITIO, nunca el acceso.
 *
 * La foto del #423 (`menuPorPerfil423`) mira los perfiles de la foto. Aquí, para
 * cada perfil (también el tutor redactor y quien lleva las colaboraciones): lo
 * que se veía con las secciones de antes, llevado a su sitio nuevo (`reubicar`),
 * es exactamente lo que se ve ahora. Lo único que sale, a propósito, son las
 * tres entradas sin pantalla (`menu-sin-proximamente-534`).
 */

afterEach(cleanup);

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null, permissions: null }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({}) }));
vi.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({}), useOptionalTheme: () => 'dark' }));
vi.mock('@/shared/api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

const { NAV_SECTIONS, SECCIONES_DE_ANTES, entradasDeSeccion, canSeeItem, esSoloColaboraciones } = await import('@/shared/components/layout/Sidebar');
const { reubicar, reagruparMenu, REUBICACIONES, BLOQUES_DEL_MENU } = await import('@/shared/components/layout/bloquesDelMenu');
const { CAMBIOS_DE_MENU } = await import('../../../backend/src/modules/permissions/inventario/cambios-aprobados.js');
const { crearCan } = await import('@/shared/hooks/usePermission');
const { rolesDe } = await import('@/shared/lib/roles');
const { resolverPermisos } = await import('../../../backend/src/modules/permissions/resolver.js');
const { PROCESO_EN_PRUEBAS } = await import('@/shared/lib/enPruebas');
const { CERTIFEX_PANEL } = await import('@/shared/lib/certifexPanel');

const persona = (role, extra = {}) => ({ id: 1, role, roles_extra: [], excepciones: {}, factura_manager: false, gestor_colaboraciones: false, usa_mcp: false, ...extra });
const PERFILES = {
  superadmin: persona('superadmin'),
  admin: persona('admin'),
  soporte: persona('soporte'),
  gestora: persona('gestor'),
  project_manager: persona('project_manager'),
  tutor: persona('tutor'),
  tutor_redactor: persona('tutor_redactor'),
  colaborador: persona('colaborador'),
  'gestora+admin': persona('gestor', { roles_extra: ['admin'] }),
  'gestora+tutor': persona('gestor', { roles_extra: ['tutor'] }),
  'gestora con colaboraciones': persona('gestor', { gestor_colaboraciones: true }),
  'gestora con usa_mcp': persona('gestor', { usa_mcp: true }),
  'gestora con diplomas.view': persona('gestor', { excepciones: { 'diplomas.view': true } }),
};

// Lo que sale del menú a propósito (`menu-sin-proximamente-534`).
const QUITADAS = new Set(['Captación › Campañas', 'Captación › Tráfico orgánico', 'Publicidad › Google Ads']);

function visibles(secciones, p) {
  const user = { id: p.id, role: p.role, roles_extra: p.roles_extra, factura_manager: p.factura_manager, gestor_colaboraciones: p.gestor_colaboraciones, usa_mcp: p.usa_mcp };
  const can = crearCan(user, resolverPermisos({ role: p.role, roles_extra: p.roles_extra, excepciones: p.excepciones }).mapa);
  const soloColab = esSoloColaboraciones(user);
  const role = rolesDe(user).length ? rolesDe(user) : ['gestor'];
  const out = [];
  for (const s of secciones) {
    for (const item of entradasDeSeccion(s, { user, can, soloColab })) {
      if (!item.children) { out.push(`${s.label} › ${item.label}`); continue; }
      for (const c of item.children.filter((x) => canSeeItem(x, role, soloColab, user, can))) {
        out.push(`${s.label} › ${item.label} › ${c.label}`);
      }
    }
  }
  return out;
}

describe('el menú por bloques (gemela de CRM#900): solo cambia el sitio', () => {
  for (const [nombre, p] of Object.entries(PERFILES)) {
    it(`${nombre}: lo mismo que antes, en su bloque nuevo`, () => {
      const antes = new Set(visibles(SECCIONES_DE_ANTES, p)
        .filter((e) => !QUITADAS.has(e))
        .map((e) => reubicar(e)));
      const ahora = new Set(visibles(NAV_SECTIONS, p));
      const diferencia = [
        ...[...ahora].filter((x) => !antes.has(x)).map((x) => `+ ${x}`),
        ...[...antes].filter((x) => !ahora.has(x)).map((x) => `- ${x}`),
      ].sort();
      expect(diferencia).toEqual([]);
      // Y la prueba mira algo: todos ven al menos una entrada.
      expect(ahora.size).toBeGreaterThan(0);
    });
  }
});

describe('los bloques', () => {
  it('son los de la maqueta, en su orden, con el equipo de desarrollo al final', () => {
    expect(NAV_SECTIONS.map((s) => s.label)).toEqual(['Hoy', 'Comercial', 'Captación y publicidad', 'Académico', 'Finanzas', 'Análisis', 'Configuración', 'Sistema', 'Equipo de Desarrollo']);
  });

  it('cada reubicación encaja con alguna entrada de antes (no hay ninguna muerta)', () => {
    const direcciones = SECCIONES_DE_ANTES.flatMap((s) => s.items.flatMap((i) => [
      `${s.label} › ${i.label}`, ...(i.children || []).map((c) => `${s.label} › ${i.label} › ${c.label}`),
    ]));
    // Las que dependen de un interruptor de compilación solo existen con él encendido.
    const segunInterruptor = {
      'Principal › Prospectos › Seguimiento de fin de mes': PROCESO_EN_PRUEBAS,
      'Clientes › Diplomas': CERTIFEX_PANEL,
    };
    for (const [antes] of REUBICACIONES) {
      if (segunInterruptor[antes] === false) continue;
      expect(direcciones.some((d) => d === antes || d.startsWith(`${antes} › `)), antes).toBe(true);
    }
  });

  it('ninguna entrada se repite en el menú nuevo', () => {
    const todas = NAV_SECTIONS.flatMap((s) => s.items.flatMap((i) => [`${s.label} › ${i.label}`, ...(i.children || []).map((c) => `${s.label} › ${i.label} › ${c.label}`)]));
    expect(todas.length).toBe(new Set(todas).size);
  });

  it('las tres sin pantalla ya no están', () => {
    const rutas = NAV_SECTIONS.flatMap((s) => s.items.flatMap((i) => [i.to, ...(i.children || []).map((c) => c.to)]));
    for (const r of ['/campaigns', '/seo', '/google-ads']) expect(rutas).not.toContain(r);
  });

  it('el reparto y la salida de las «Próximamente», aprobados por Diego (18/11)', () => {
    expect(BLOQUES_DEL_MENU.aprobadoPor).toBe('Diego, 18/11');
    expect(CAMBIOS_DE_MENU.find((c) => c.id === 'menu-sin-proximamente-534')?.aprobadoPor).toBe('Diego, 18/11');
  });

  it('la cola del día sale del grupo Prospectos a Hoy, con su permiso y su icono', () => {
    const hoy = NAV_SECTIONS.find((s) => s.label === 'Hoy');
    const cola = hoy.items.find((i) => i.to === '/leads/cola');
    expect(cola.permiso).toBe('proceso.view');
    expect(cola.icon).toBeTruthy();
    const comercial = NAV_SECTIONS.find((s) => s.label === 'Comercial');
    const prospectos = comercial.items.find((i) => i.label === 'Prospectos');
    expect(prospectos.children.map((c) => c.to)).not.toContain('/leads/cola');
    expect(prospectos.children.map((c) => c.to)).toContain('/leads');
  });

  it('Ventas sale una sola vez, en Comercial, y ya no en Finanzas', () => {
    const ventas = NAV_SECTIONS.flatMap((s) => s.items.filter((i) => i.to === '/ventas').map(() => s.label));
    expect(ventas).toEqual(['Comercial']);
  });

  it('las comisiones, juntas en Finanzas: las de los tutores justo detrás de las del equipo', () => {
    const finanzas = NAV_SECTIONS.find((s) => s.label === 'Finanzas').items;
    const etiquetas = finanzas.map((i) => i.label);
    expect(etiquetas.indexOf('Comisiones de tutores')).toBe(etiquetas.indexOf('Comisiones') + 1);
    expect(finanzas.find((i) => i.label === 'Comisiones de tutores').to).toBe('/tutores/comisiones');
    expect(etiquetas[0]).toBe('Dashboard');
  });

  it('avisa si una entrada apunta a un grupo que no existe', () => {
    expect(() => reagruparMenu(
      [{ label: 'A', items: [{ label: 'x', to: '/x' }] }], {}, [['A › x', 'B › Grupo › x']],
    )).toThrow(/no existe el grupo/);
  });
});
