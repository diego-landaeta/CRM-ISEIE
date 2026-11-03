// @vitest-environment jsdom
// Gemela de MultiCRM (frontend/src/test/ventasCabecera79.test.jsx), paridad 2.6.0 (02/11).
// En ISEIE no hay rediseño de cabecera (#79) ni submenú de Finanzas: lo que se
// trae es que desde Ventas (Finanzas › Ingresos) se llega a un clic a «Análisis
// de ventas» y a «Sin formación» (#41). El menú desplegable de «Nueva venta» que
// se cierra al pulsar fuera es del 360: en ISEIE «Nueva venta» es un botón.
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// La pantalla pide datos al arrancar: se quedan esperando, que para la
// cabecera da igual.
vi.mock('@/shared/api/client', () => ({ default: { get: () => new Promise(() => {}), post: vi.fn() } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'admin' } }) }));
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({
    activeProject: { id: 1, nombre: 'Campus de prueba' }, activeIssuer: null, activeIssuerId: null,
    projects: [{ id: 1, nombre: 'Campus de prueba' }], switchProject: vi.fn(), switchIssuer: vi.fn(),
  }),
}));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: () => true }) }));

const { default: IncomePage } = await import('@/modules/accounting/pages/IncomePage');

function abrir(ruta) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/accounting/income" element={<IncomePage />} />
        <Route path="/ventas/analisis" element={<p>pantalla de análisis</p>} />
        <Route path="/ventas/sin-formacion" element={<p>ventas sin formación</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

// Sin `globals` en vitest, Testing Library no limpia sola entre pruebas.
afterEach(cleanup);

describe('la cabecera de Ventas', () => {
  it('se ve «Análisis» y lleva a Análisis de ventas', () => {
    abrir('/accounting/income');
    fireEvent.click(screen.getByRole('button', { name: 'Análisis' }));
    expect(screen.getByText('pantalla de análisis')).toBeInTheDocument();
  });

  it('se ve «Sin formación» y lleva a esa pantalla (#41)', () => {
    abrir('/accounting/income');
    fireEvent.click(screen.getByRole('button', { name: 'Sin formación' }));
    expect(screen.getByText('ventas sin formación')).toBeInTheDocument();
  });
});
