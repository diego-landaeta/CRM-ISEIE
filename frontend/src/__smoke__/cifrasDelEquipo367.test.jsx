// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

// #367 (gemela de diego-landaeta/CRM#534) · «El equipo este mes»: cada importe con su recuento.
//
// Octubre de 2026 (Manuel): 82 cobros · 18.047,82 € cobrados. Prospectos ponía
// «18.048 € cobrados · 43 ventas» (el 43 eran las ventas NUEVAS) y el Dashboard
// «17.038 € facturados · 77 ventas» (las ventas con factura en el mes). Tres
// números de «ventas» para el mismo mes y ninguno decía qué contaba.
//
// ANTES del arreglo, las dos pantallas fallan: no sale «82 cobros» en ninguna.

vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({ activeProject: { id: 1 }, activeIssuerId: null }),
}));

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

const { default: ComoVoy } = await import('@/modules/reports/components/ComoVoy');

const cifras = (x = {}) => ({
  leads: 0, ventas: 0, vendido: 0, cobrado: 0, cobros: 0,
  cobrado_del_periodo: 0, cobrado_anteriores: 0, cobrado_en_cuotas: 0,
  ventas_anteriores: 0, anteriores_grandes: [], facturado: 0, pendiente: 0, tasa: 0, ...x,
});

// Lo que devuelve /informes/mi-puesto a quien manda, en octubre.
const OCTUBRE = () => ({
  puesto: null, de: 3, nombre: null, ...cifras(),
  tasa_equipo: 13.4, ventas_equipo: 31, cobrado_equipo: 14298.82, facturado_equipo: 0,
  faltan_para_subir: null, mejor_cobrado: 9318.28, mejor_facturado: 0, mejor_ventas: 16,
  tabla: [
    { puesto: 1, user_id: 7, nombre: 'Dayana', ...cifras({ leads: 120, ventas: 16, cobrado: 9318.28, cobros: 38.5, tasa: 13.3 }) },
    { puesto: 2, user_id: 6, nombre: 'Ana', ...cifras({ leads: 90, ventas: 12, cobrado: 4243.04, cobros: 26.5, tasa: 13.3 }) },
    { puesto: 3, user_id: 14, nombre: 'Mar', ...cifras({ leads: 30, ventas: 3, cobrado: 737.5, cobros: 3, tasa: 10 }) },
  ],
  sin_gestora: cifras({ leads: 10, ventas: 12, cobrado: 3749, cobros: 14 }),
  total: cifras({ leads: 250, ventas: 43, vendido: 24184, cobrado: 18047.82, cobros: 82, tasa: 17.6 }),
});

const textoDe = (el) => (el.textContent || '').replace(/\s+/g, ' ');

afterEach(cleanup);

beforeEach(() => {
  respuestas.puesto = OCTUBRE();
  respuestas.facturado = {
    total: { facturado: 17037.82, ventas: 77 },
    gestoras: [{ user_id: 7, nombre: 'Dayana', facturado: 8389, ventas: 36 }],
    sin_gestora: { facturado: 0, ventas: 0 },
  };
});

describe('Prospectos (lo cobrado)', () => {
  it('lo cobrado va con los cobros, y las ventas nuevas aparte y con su nombre', async () => {
    const { container } = render(<ComoVoy />);
    await waitFor(() => expect(screen.getByLabelText('Cómo va el equipo este mes')).toBeTruthy());
    const t = textoDe(container);
    expect(t).toMatch(/18\.048 € cobrados · 82 cobros/);
    expect(t).toMatch(/43 ventas nuevas/);
    // Lo que estaba mal: el 43 pegado a lo cobrado.
    expect(t).not.toMatch(/cobrados · 43 ventas/);
  });

  it('la tasa de arriba dice que es la media de las gestoras', async () => {
    const { container } = render(<ComoVoy />);
    await waitFor(() => expect(screen.getByLabelText('Cómo va el equipo este mes')).toBeTruthy());
    expect(textoDe(container)).toMatch(/Tasa media de las gestoras 13,4 %/);
  });
});

describe('Dashboard (lo facturado)', () => {
  it('dice «ventas facturadas», y al lado lo cobrado con los mismos 82 cobros', async () => {
    const { container } = render(<ComoVoy medida="facturado" />);
    await waitFor(() => expect(textoDe(container)).toMatch(/facturados/));
    const t = textoDe(container);
    expect(t).toMatch(/17\.038 € facturados · 77 ventas facturadas/);
    expect(t).toMatch(/18\.048 € cobrados · 82 cobros/);
  });
});

describe('una gestora', () => {
  it('ve sus cobros y sus ventas nuevas, cada uno con su nombre', async () => {
    respuestas.puesto = {
      ...OCTUBRE(), tabla: null, sin_gestora: null, total: null,
      puesto: 2, nombre: 'Ana', ...cifras({ leads: 90, ventas: 12, cobrado: 4243.04, cobros: 26.5, tasa: 13.3 }),
    };
    const { container } = render(<ComoVoy />);
    await waitFor(() => expect(screen.getByLabelText('Cómo voy este mes')).toBeTruthy());
    expect(textoDe(container)).toMatch(/4\.?243 € cobrados · 26,5 cobros · 12 ventas nuevas/);
  });
});
