// @vitest-environment jsdom
//
// Diego, 22/10/2026: «¿por qué en ISEIE dejaron de aparecer los ranking de las
// gestoras para los admin?». «Cómo voy» —el puesto de cada gestora y, a quien
// dirige, el podio y el ranking por lo cobrado— colgaba de PROCESO_EN_PRUEBAS
// desde el 28/09 (480e7de) y en el Dashboard, además, estaba dentro del
// «Cargando datos…» desde el 22/09 (465cdeb): se veía un instante y se iba. El
// 22/10 el frontal de producción salió con la bandera apagada y el ranking
// desapareció de las tres pantallas.
//
// El ranking no es el proceso comercial: está aprobado para producción por su
// cuenta (por lo cobrado desde el 08/10). Estas pruebas apagan la bandera y
// piden que siga saliendo. Como en MultiCRM, donde nunca llevó bandera.
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Las gráficas de Recharts del Dashboard lo piden y jsdom no lo trae.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});

vi.mock('@/shared/lib/enPruebas', () => ({ PROCESO_EN_PRUEBAS: false }));
vi.mock('@/modules/reports/components/ComoVoy', () => ({
  default: (p) => <div data-testid="como-voy" data-medida={p.medida || ''} />,
}));
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({ activeProject: { id: 1, nombre: 'ISEIE' } }),
}));
const dashboard = vi.hoisted(() => ({ loading: false }));
vi.mock('@/shared/hooks/useDashboard', () => ({
  useDashboard: () => ({
    stats: { total: 10, nuevo: 2, convertido: 1, conversionRate: 10 },
    leadsRecientes: [], today: null, loading: dashboard.loading, error: null, refetch: () => {},
  }),
}));
vi.mock('@/modules/ia-dashboard/hooks/useStripeMonitor', () => ({
  useStripeMonitor: () => ({ metrics: null, loading: false }),
}));
vi.mock('@/modules/invoices/components/AvisoHuecosFacturas', () => ({ default: () => null }));
vi.mock('@/modules/sales/components/TopProductsCard', () => ({ default: () => null }));
vi.mock('@/modules/sales/components/CursosVendidosCard', () => ({ default: () => null }));
vi.mock('@/shared/components/dashboard/ConversionFunnel', () => ({ default: () => null }));
vi.mock('@/shared/components/dashboard/PerformanceInsights', () => ({ default: () => null }));

import DashboardPage from '@/shared/pages/DashboardPage';

afterEach(() => { cleanup(); dashboard.loading = false; });

const pintar = () => render(<MemoryRouter><DashboardPage /></MemoryRouter>);

describe('El ranking de gestoras no depende de la bandera del proceso', () => {
  it('el Dashboard YA CARGADO enseña «Cómo voy» con la bandera apagada (antes, nada)', () => {
    pintar();
    expect(screen.getByTestId('como-voy')).toHaveAttribute('data-medida', 'facturado');
  });

  it('y no lo pinta dos veces mientras carga: va en la página, no en el «Cargando datos…»', () => {
    dashboard.loading = true;
    pintar();
    expect(screen.queryByTestId('como-voy')).toBeNull();
  });

  it('Prospectos y Clientes lo pintan sin PROCESO_EN_PRUEBAS delante', () => {
    const src = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
    for (const f of ['modules/leads/pages/LeadsPage.tsx', 'modules/clients/pages/ClientsPage.tsx', 'shared/pages/DashboardPage.jsx']) {
      expect(src(f), f).toMatch(/<ComoVoy\b/);
      expect(src(f), f).not.toMatch(/PROCESO_EN_PRUEBAS\s*&&\s*<ComoVoy/);
    }
  });
});
