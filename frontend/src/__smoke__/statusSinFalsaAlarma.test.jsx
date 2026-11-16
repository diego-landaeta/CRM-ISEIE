// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

/**
 * «Status» decía «Hay incidencias activas» con todo funcionando: pedía
 * `/status/components`, que no existe (404 → sin componentes → alarma), e
 * `/status/incidents?status=active`, que devuelve el historial entero.
 * Ahora lee `GET /status` (componentes + SOLO las incidencias activas).
 */
let respuesta;
const get = vi.fn(async (url) => {
  if (url === '/status') return { data: respuesta };
  throw Object.assign(new Error('404'), { status: 404 });
});
vi.mock('@/shared/api/client', () => ({ default: { get: (...a) => get(...a) } }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: () => false }) }));
vi.mock('@/modules/status/components/PiezasDelSistema', () => ({ default: () => null }));
vi.mock('@/modules/status/components/CorreosEnviados', () => ({ default: () => null }));

const { default: StatusPage } = await import('@/shared/pages/StatusPage');

beforeEach(() => { get.mockClear(); });
afterEach(() => cleanup());

describe('Status sin falsa alarma', () => {
  it('sin incidencias y sin componentes registrados: «Todos los sistemas operativos»', async () => {
    respuesta = { global_status: 'operational', components: [], active_incidents: [] };
    render(<StatusPage />);
    expect(await screen.findByText('Todos los sistemas operativos')).toBeInTheDocument();
    expect(screen.queryByText('Hay incidencias activas')).toBeNull();
    expect(get).toHaveBeenCalledWith('/status');
    expect(get).not.toHaveBeenCalledWith('/status/components');
  });

  it('con una incidencia activa: «Hay incidencias activas» y se enseña', async () => {
    respuesta = {
      global_status: 'degraded',
      components: [{ id: 1, name: 'API', slug: 'api', status: 'operational' }],
      active_incidents: [{ id: 7, title: 'Correo lento', severity: 'warning', status: 'investigating', affects: [], created_at: '2026-11-16T10:00:00Z' }],
    };
    render(<StatusPage />);
    expect(await screen.findByText('Hay incidencias activas')).toBeInTheDocument();
    expect(screen.getByText('Correo lento')).toBeInTheDocument();
  });

  it('un componente caído también es incidencia', async () => {
    respuesta = { global_status: 'operational', components: [{ id: 1, name: 'API', slug: 'api', status: 'major' }], active_incidents: [] };
    render(<StatusPage />);
    expect(await screen.findByText('Hay incidencias activas')).toBeInTheDocument();
  });
});
