// @vitest-environment jsdom
// Traída de MultiCRM (2.6.0) y adaptada. ISEIE no tiene un setup común de
// pruebas: el entorno, los matchers de jest-dom y la limpieza se ponen aquí.
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

/*
  Reportes, solo con permiso (prueba de Diana del 30/10, #203 B, en MultiCRM):
  quien llegaba por la dirección sin permiso veía la página en blanco y avisos
  de «No tienes permiso». Ahora va al Dashboard, sin pedir nada.

  En ISEIE el permiso es `reports.mis_informes`, no `reports.view`: la pantalla
  se arma con `/informes/panel`, que también ven las gestoras (lo suyo), y
  quitárselas sería romper lo que ya usan.
*/

const get = vi.fn();
vi.mock('@/shared/api/client', () => ({ default: { get: (...a) => get(...a) }, APP_BASE_URL: '' }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({ activeProject: null }) }));
let permisos = null;
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 4, role: 'gestor' }, permissions: permisos, activeProject: null }),
}));

const { default: ReportsPage } = await import('@/shared/pages/ReportsPage');

const pintar = () => render(
  <MemoryRouter initialEntries={['/informes']}>
    <Routes>
      <Route path="/dashboard" element={<p>Dashboard</p>} />
      <Route path="/informes" element={<ReportsPage />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => { get.mockReset(); });
afterEach(cleanup);

describe('Reportes, solo con «reports.mis_informes»', () => {
  it('quien no puede ver informes va al Dashboard, sin pedir el informe', () => {
    permisos = { 'leads.view': true };
    pintar();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it('mientras no ha llegado el mapa de permisos, ni se pinta ni se pide nada', () => {
    permisos = null;
    const { container } = pintar();
    expect(container).toBeEmptyDOMElement();
    expect(get).not.toHaveBeenCalled();
  });
});
