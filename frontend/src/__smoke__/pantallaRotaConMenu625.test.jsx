// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Outlet, Link, useLocation } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';
import ErrorBoundary from '@/shared/components/layout/ErrorBoundary';

/*
  Una pantalla rota no se lleva el CRM entero (CRM#625, ISEIE#352).

  En la auditoría del 03/11, Novedades reventaba (`v.arreglos.length` de una
  versión sin arreglos) y el aviso «Algo se ha roto» tapaba toda la ventana,
  sin menú; y navegando por la app se quedaba puesto hasta recargar, porque el
  único ErrorBoundary estaba encima del Router. La causa ya se arregló (#372 aquí,
  CRM#645 y CRM#786 en MultiCRM); esto es para la próxima pantalla que reviente.
*/

function Rota() {
  const v = {};
  return <p>{v.arreglos.length}</p>;
}

// El mismo montaje que AppLayout: la pantalla dentro de un `key={pathname}`.
function Marco() {
  const { pathname } = useLocation();
  return (
    <div>
      <nav><Link to="/otra">Ir a otra pantalla</Link></nav>
      <div key={pathname}>
        <ErrorBoundary dentro>
          <Outlet />
        </ErrorBoundary>
      </div>
    </div>
  );
}

const montar = () => render(
  <MemoryRouter initialEntries={['/novedades']}>
    <Routes>
      <Route element={<Marco />}>
        <Route path="/novedades" element={<Rota />} />
        <Route path="/otra" element={<p>Otra pantalla</p>} />
      </Route>
    </Routes>
  </MemoryRouter>,
);

describe('una pantalla que revienta, dentro del marco (#625)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('enseña el aviso y el menú sigue ahí', () => {
    montar();
    expect(screen.getByText('Algo se ha roto')).toBeTruthy();
    expect(screen.getByText('Ir a otra pantalla')).toBeTruthy();
  });

  it('el aviso no ocupa toda la ventana', () => {
    montar();
    expect(screen.getByRole('alert').className).not.toMatch(/min-h-screen/);
  });

  it('al ir a otra pantalla el aviso se va, sin recargar', () => {
    montar();
    fireEvent.click(screen.getByText('Ir a otra pantalla'));
    expect(screen.queryByText('Algo se ha roto')).toBeNull();
    expect(screen.getByText('Otra pantalla')).toBeTruthy();
  });

  it('el de fuera (el de main.jsx) sigue siendo de pantalla completa', () => {
    render(<ErrorBoundary><Rota /></ErrorBoundary>);
    expect(screen.getByRole('alert').className).toMatch(/min-h-screen/);
  });
});

describe('AppLayout monta la pantalla así', () => {
  it('ErrorBoundary `dentro`, dentro del `key={pathname}` y alrededor del <Outlet />', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../shared/components/layout/AppLayout.jsx'), 'utf8');
    expect(src).toMatch(/key=\{pathname\}[\s\S]{0,400}<ErrorBoundary dentro>[\s\S]{0,400}<Outlet \/>[\s\S]{0,300}<\/ErrorBoundary>/);
  });
});
