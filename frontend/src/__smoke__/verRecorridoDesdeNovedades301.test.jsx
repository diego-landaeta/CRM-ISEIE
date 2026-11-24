// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

/**
 * 3.0.0 · «Ver recorrido» desde Novedades (Diego, 24/11: «actualiza Novedades
 * para ver y que los recorridos estén actualizados»).
 *
 *  · La novedad con recorrido trae «Ver recorrido», que va a SU pantalla con
 *    `?recorrido=<id>`; sin permiso para ese recorrido, no sale el botón.
 *  · `RecorridoDeLaDireccion` (una vez en AppLayout) lo abre al llegar y quita
 *    el parámetro. Sin parámetro no abre nada (#1012: nada se abre solo).
 */
const permisos = { lista: [] };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 7, role: 'admin', email: 'a@ejemplo.test' } }) }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => permisos.lista.includes(k) }) }));
vi.mock('@/modules/novedades/api/novedades.api', () => ({
  traerNovedades: vi.fn(async () => ({
    crm: { nombre: 'CRM', color: '#123456' },
    actual: '3.0.0',
    versiones: [{
      version: '3.0.0', fecha: '2026-11-24', titulo: 'Versión 3.0.0', intro: 'Lo nuevo.', arreglos: [],
      grupos: [{ titulo: 'Recorridos', items: [
        { titulo: 'Links', texto: 'Los links.', roles: ['admin'], ruta: '/links-pago', boton: 'Ir a Links', recorrido: 'links-pago' },
        { titulo: 'Conciliación', texto: 'Cuadrar.', roles: ['admin'], ruta: '/accounting/conciliacion', boton: 'Ir', recorrido: 'conciliacion-facturas' },
      ] }],
    }],
  })),
  traerEnvios: vi.fn(async () => []),
  bajarPdf: vi.fn(),
  enviarNovedades: vi.fn(),
}));

const { default: NovedadesPage } = await import('@/modules/novedades/pages/NovedadesPage');
const { default: RecorridoDeLaDireccion, rutaConRecorrido } = await import('@/shared/components/layout/RecorridoDeLaDireccion');
const lanzador = await import('@/shared/lib/lanzadorRecorridos');

function Direccion() {
  const l = useLocation();
  return <output data-testid="dir">{l.pathname + l.search}</output>;
}
function Activo() {
  const { recorrido } = lanzador.useRecorridoActivo();
  return <output data-testid="activo">{recorrido ? recorrido.titulo : 'ninguno'}</output>;
}
const montar = (entrada) => render(
  <MemoryRouter initialEntries={[entrada]}>
    <RecorridoDeLaDireccion />
    <Activo />
    <Routes><Route path="*" element={<Direccion />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => { permisos.lista = []; lanzador.cerrarRecorrido(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('rutaConRecorrido', () => {
  it('añade el parámetro, también si la ruta ya trae otros o un ancla', () => {
    expect(rutaConRecorrido('/links-pago', 'links-pago')).toBe('/links-pago?recorrido=links-pago');
    expect(rutaConRecorrido('/x?a=1', 'y')).toBe('/x?a=1&recorrido=y');
    expect(rutaConRecorrido('/x#z', 'y')).toBe('/x?recorrido=y#z');
  });
});

describe('Novedades: «Ver recorrido»', () => {
  it('sale con permiso y lleva a la pantalla DEL recorrido', async () => {
    permisos.lista = ['links_pago.ver_todos', 'facturas.gestionar'];
    render(<MemoryRouter><NovedadesPage /></MemoryRouter>);
    const botones = await screen.findAllByRole('link', { name: /Ver recorrido/ });
    const destinos = botones.map((b) => b.getAttribute('href'));
    expect(destinos).toContain('/links-pago?recorrido=links-pago');
    // La novedad apunta a /accounting/conciliacion; el recorrido vive en su pestaña.
    expect(destinos).toContain('/accounting/conciliacion/facturas?recorrido=conciliacion-facturas');
  });

  it('sin permiso para el recorrido, solo «Ir a…»', async () => {
    render(<MemoryRouter><NovedadesPage /></MemoryRouter>);
    expect(await screen.findByRole('link', { name: /Ir a Links/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Ver recorrido/ })).toBeNull();
  });
});

describe('RecorridoDeLaDireccion', () => {
  it('con ?recorrido= y permiso, lo abre al llegar y limpia la dirección', async () => {
    vi.useFakeTimers();
    permisos.lista = ['links_pago.ver_todos'];
    montar('/links-pago?recorrido=links-pago');
    expect(screen.getByTestId('activo').textContent).toBe('ninguno');
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByTestId('activo').textContent).toBe('Links de pago');
    expect(screen.getByTestId('dir').textContent).toBe('/links-pago');
  });

  it('sin parámetro no abre nada (nada se abre solo, #1012)', async () => {
    vi.useFakeTimers();
    permisos.lista = ['links_pago.ver_todos'];
    montar('/links-pago');
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(screen.getByTestId('activo').textContent).toBe('ninguno');
  });

  it('sin permiso, o con un id que no existe, no abre y limpia la dirección', async () => {
    vi.useFakeTimers();
    montar('/links-pago?recorrido=links-pago');
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByTestId('activo').textContent).toBe('ninguno');
    expect(screen.getByTestId('dir').textContent).toBe('/links-pago');
    permisos.lista = ['links_pago.ver_todos'];
    montar('/links-pago?recorrido=no-existe');
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getAllByTestId('activo').every((n) => n.textContent === 'ninguno')).toBe(true);
  });
});
