// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Gemela de CRM#884 (#534 del 360, parte 5; aquí, #367) · El Dashboard como «Hoy».
 *
 *   · Arriba, las cifras clave con su nombre y su recuento (las de octubre de
 *     Manuel en el 360: 18.048 € cobrados · 82 cobros, 17.038 € facturados ·
 *     77 ventas, 43 ventas nuevas) y dos alertas que llevan a Prospectos
 *     (`/leads`) con el filtro que hace el servidor.
 *   · Debajo, la cola del día (solo con el proceso en pruebas). Lo demás, plegado.
 *   · «Productos vendidos»: top 10 y «Ver todos».
 */

afterEach(cleanup);

vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({ activeProject: { id: 1 }, activeIssuerId: null }),
}));

const navegar = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => navegar }));

const respuestas = vi.hoisted(() => ({ puesto: null, facturado: null }));
vi.mock('@/shared/api/client', () => ({
  default: {
    get: vi.fn(async (url) => {
      if (url.startsWith('/informes/mi-puesto')) return { success: true, data: respuestas.puesto };
      if (url.startsWith('/ventas/facturado')) return { success: true, data: respuestas.facturado };
      return { success: true, data: null };
    }),
  },
}));

const { default: CifrasDeHoy } = await import('@/shared/components/dashboard/CifrasDeHoy');
const { default: CursosVendidosCard } = await import('@/modules/sales/components/CursosVendidosCard');
const { qfDelServidor } = await import('@/modules/leads/lib/filtrosRapidos');

const texto = (el) => (el.textContent || '').replace(/\s+/g, ' ');

beforeEach(() => {
  navegar.mockReset();
  respuestas.puesto = {
    tabla: [],
    total: { leads: 250, ventas: 43, vendido: 24184, cobrado: 18047.82, cobros: 82 },
  };
  respuestas.facturado = {
    total: { facturado: 17037.82, ventas: 77 },
    gestoras: [], sin_gestora: { facturado: 0, ventas: 0 },
    productos: Array.from({ length: 14 }, (_, i) => ({ product_id: i + 1, producto: `Curso ${i + 1}`, ventas: 14 - i, facturado: 100 })),
  };
});

const pintar = (props = {}) => render(
  <MemoryRouter>
    <CifrasDeHoy stats={{ sin_asignar: 566 }} today={{ nuevos_mes: 310, nuevos_hoy: 12, inactivos: 1726 }} {...props} />
  </MemoryRouter>,
);

describe('las cifras de hoy', () => {
  it('cada importe con su recuento, como en «El equipo este mes»', async () => {
    const { container } = pintar();
    await waitFor(() => expect(texto(container)).toMatch(/Facturado/));
    const t = texto(container);
    expect(t).toMatch(/Cobrado\s*18\.048\s*€\s*82 cobros · este mes/);
    expect(t).toMatch(/Facturado\s*17\.038\s*€\s*77 ventas facturadas · este mes/);
    expect(t).toMatch(/Ventas nuevas\s*43\s*24\.184\s*€ vendidos · este mes/);
    expect(t).toMatch(/Prospectos nuevos\s*310\s*este mes · 12 hoy/);
  });

  it('las dos alertas llevan a Prospectos con el filtro del servidor', async () => {
    pintar();
    fireEvent.click(screen.getByText('sin gestora').closest('button'));
    expect(navegar).toHaveBeenCalledWith('/leads?qf=sin-gestora');
    fireEvent.click(screen.getByText('sin actividad').closest('button'));
    expect(navegar).toHaveBeenCalledWith('/leads?qf=sin-actividad');
    expect(texto(screen.getByText('sin gestora').closest('button'))).toMatch(/566/);
    // En español, Intl no separa los millares con cuatro cifras: «1726».
    expect(texto(screen.getByText('sin actividad').closest('button'))).toMatch(/1726/);
    // Esos dos filtros los manda la lista al servidor, como todos los rápidos
    // desde la gemela de la #132 del 360; uno desconocido, no.
    expect(qfDelServidor('sin-gestora')).toBe('sin-gestora');
    expect(qfDelServidor('sin-actividad')).toBe('sin-actividad');
    expect(qfDelServidor('urgent')).toBe('urgent');
    expect(qfDelServidor('otra-cosa')).toBe('');
  });

  it('una gestora (sin tabla) ve lo suyo y sin la tarjeta Facturado', async () => {
    respuestas.puesto = { tabla: null, ventas: 5, vendido: 900, cobrado: 1200, cobros: 6 };
    const { container } = pintar();
    await waitFor(() => expect(texto(container)).toMatch(/Cobrado/));
    expect(texto(container)).toMatch(/1200\s*€\s*6 cobros/);
    expect(texto(container)).not.toMatch(/Facturado/);
  });
});

describe('Productos vendidos: top 10 y «Ver todos»', () => {
  it('enseña 10 y despliega el resto', async () => {
    const { container } = render(<CursosVendidosCard projectId={1} medida="facturado" />);
    await waitFor(() => expect(screen.getByText('Curso 1')).toBeInTheDocument());
    expect(container.querySelectorAll('li p.text-sm').length).toBe(10);
    fireEvent.click(screen.getByText('Ver todos (14)'));
    expect(container.querySelectorAll('li p.text-sm').length).toBe(14);
    expect(screen.getByText('Ver solo los 10 primeros')).toBeInTheDocument();
  });
});

describe('el Dashboard: cifras, cola y lo demás plegado', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'shared/pages/DashboardPage.jsx'), 'utf8');
  const devuelve = src.slice(src.indexOf('<AvisoHuecosFacturas'));

  it('arriba las cifras y la cola; después, los plegables', () => {
    const cifras = devuelve.indexOf('<CifrasDeHoy');
    const cola = devuelve.indexOf('<ParaHoyYManana');
    const primerPlegable = devuelve.indexOf('<BloquePlegable');
    expect(cifras).toBeGreaterThan(0);
    expect(cola).toBeGreaterThan(cifras);
    expect(primerPlegable).toBeGreaterThan(cola);
  });

  it('la cola, solo con el proceso en pruebas (como en Prospectos)', () => {
    expect(devuelve).toMatch(/\{PROCESO_EN_PRUEBAS && <ParaHoyYManana/);
  });

  it('el ranking, los productos, el embudo, ayer y hoy y los recientes, plegados y cerrados de entrada', () => {
    for (const [clave, dentro] of [
      ['dashboard-equipo', '<ComoVoy'], ['dashboard-productos', '<CursosVendidosCard'],
      ['dashboard-embudo', '<ConversionFunnel'], ['dashboard-ayer-hoy', 'Tu día de hoy'],
      ['dashboard-recientes', 'Prospectos recientes'],
    ]) {
      const a = devuelve.indexOf(`clave="${clave}"`);
      const b = devuelve.indexOf('</BloquePlegable>', a);
      expect(a, clave).toBeGreaterThan(0);
      expect(devuelve.slice(a, b), clave).toContain(dentro);
      expect(devuelve.slice(a, devuelve.indexOf('>', a)), clave).toContain('abiertoPorDefecto={false}');
    }
  });

  it('el título es el día', () => {
    expect(src).toMatch(/title=\{`Hoy, \$\{todayDate\}`\}/);
  });
});
