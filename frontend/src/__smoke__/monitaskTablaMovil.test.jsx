// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Equipo › Actividad en el móvil (QA de /testeo, 25/11/2026): a 375 px la tabla
 * parecía cortada —no se veía «Proyectos»— y el «Nadie con horas en Monitask en
 * estas fechas.» se quedaba a medias, centrado en una celda del ancho de la tabla.
 *
 * Lo que se defiende, en las tres pestañas (Actividad, Cotejo, Personas):
 *   · cada tabla va dentro de su propia caja que se desliza de lado
 *     (`overflow-x-auto`, enfocable con el teclado) y tiene un ancho mínimo, así
 *     que en el móvil se desliza en vez de estrujarse o ensanchar la página;
 *   · «Cargando…» y la tabla vacía se dicen FUERA de la tabla, enteros.
 *
 * Las medidas de verdad (sin desplazamiento de la página, la caja se desliza) están
 * en el PR (Playwright a 375 y 1280); MultiCRM las tiene en e2e/monitask-tabla-movil.spec.js.
 */

const get = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ default: { get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
vi.mock('@/shared/hooks/usePermission', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => ({ can: () => true }),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'superadmin', funciones: { monitask: true } }, permissions: null }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({}) }));
vi.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({}), useOptionalTheme: () => 'dark' }));

const { default: MonitaskActividadPage } = await import('@/modules/monitask/pages/MonitaskActividadPage');

const ESTADO = { activo: true, conectada: true, ultima_sync_at: '2026-11-25T08:00:00Z', margen_pct: 10, sincronizando: false };
const ACTIVIDAD = [{
  monitask_id: 1, nombre: 'Ana María Rodríguez', correo: 'ana@example.com', colaborador_id: 1, colaborador_nombre: 'Ana María Rodríguez',
  user_id: null, usuario_nombre: null, horas: 120.5, horas_activas: 98.25, actividad_pct: 81.6, dias: 19,
  proyectos: [{ nombre: 'Psiko Aprende', horas: 60 }],
}];
const COTEJO = {
  periodo: '2026-10', margen_pct: 10,
  filas: [{
    colaborador_id: 1, nombre: 'Ana María Rodríguez', email: 'ana@example.com', con_monitask: true, horas_facturadas: 140,
    horas_otras_empresas: 0, horas_monitask: 120.5, horas_activas: 98, actividad_pct: 81.6, dias: 19, sin_cotejo: false,
    diferencia_horas: 19.5, diferencia_pct: 16.2, fuera_de_margen: false, sin_factura: false,
    facturas: [{ id: 1, empresa: 'Psiko Aprende S.L.', horas: 140, modalidad: 'horas', numero_factura: 'F-1', numero_recepcion: null, pagada: false }],
  }],
  resumen: { colaboradores: 1, con_cotejo: 1, factura_de_mas: [], factura_de_menos: [] },
};
const PERSONAS = {
  personas: [{
    monitask_id: 1, nombre: 'Ana María Rodríguez', correo: 'ana@example.com', emparejado: 'correo', colaborador_id: 1,
    colaborador_nombre: 'Ana María Rodríguez', user_id: null, usuario_nombre: null, emparejado_por_nombre: null, ultimo_dia: '2026-11-24',
  }],
  colaboradores: [{ id: 1, nombre: 'Ana María Rodríguez', email: 'ana@example.com', activo: true, user_id: null }],
  usuarios: [],
};
const VACIOS = {
  actividad: [],
  cotejo: { ...COTEJO, filas: [], resumen: { colaboradores: 0, con_cotejo: 0, factura_de_mas: [], factura_de_menos: [] } },
  personas: { personas: [], colaboradores: [], usuarios: [] },
};

function simular(conDatos) {
  get.mockImplementation(async (url) => {
    if (url.startsWith('/monitask/estado')) return { success: true, data: ESTADO };
    if (url.startsWith('/monitask/actividad')) return { success: true, data: conDatos ? ACTIVIDAD : VACIOS.actividad };
    if (url.startsWith('/monitask/cotejo')) return { success: true, data: conDatos ? COTEJO : VACIOS.cotejo };
    if (url.startsWith('/monitask/personas')) return { success: true, data: conDatos ? PERSONAS : VACIOS.personas };
    return { success: true, data: [] };
  });
}

const pintar = (vista) => render(
  <MemoryRouter initialEntries={[`/equipo/actividad?vista=${vista}`]}><MonitaskActividadPage /></MemoryRouter>,
);

const VISTAS = [
  ['actividad', 'Actividad por persona', 'Ana María Rodríguez', 'Nadie con horas en Monitask en estas fechas.'],
  ['cotejo', 'Cotejo con facturas', 'Psiko Aprende S.L.', 'Ningún colaborador con factura o con Monitask ese mes.'],
  ['personas', 'Personas de Monitask', 'ana@example.com', 'Todavía no se ha traído a nadie de Monitask.'],
];

beforeEach(() => { get.mockReset(); });
afterEach(cleanup);

describe('Equipo › Actividad: las tablas se deslizan en su caja', () => {
  for (const [vista, etiqueta, dato] of VISTAS) {
    it(`${vista}: la tabla va en una caja que se desliza de lado y tiene ancho mínimo`, async () => {
      simular(true);
      pintar(vista);
      expect((await screen.findAllByText(dato, { exact: false })).length).toBeGreaterThan(0);
      const caja = screen.getByRole('region', { name: etiqueta });
      expect(caja.className).toMatch(/\boverflow-x-auto\b/);
      expect(caja.getAttribute('tabindex')).toBe('0');
      const tabla = caja.querySelector(':scope > table');
      expect(tabla).not.toBeNull();
      expect(tabla.className).toMatch(/\bmin-w-\[\d+px\]/);
    });
  }

  for (const [vista, etiqueta, , vacio] of VISTAS) {
    it(`${vista} sin nadie: el aviso se lee entero, fuera de la tabla`, async () => {
      simular(false);
      pintar(vista);
      const aviso = await screen.findByText(vacio);
      expect(aviso.closest('table')).toBeNull();
      expect(screen.getByRole('region', { name: etiqueta }).contains(aviso)).toBe(false);
    });
  }
});
