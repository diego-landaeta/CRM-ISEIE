// @vitest-environment jsdom
// Gemela de la de MultiCRM. ISEIE no tiene un setup común de pruebas: el entorno,
// los matchers de jest-dom y la limpieza entre pruebas se ponen aquí.
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react';

/**
 * CRM#533 · La salud de las conexiones de cada campus: una fila por campus, una
 * casilla por conexión con su color, su última señal y el motivo si falla; y
 * «Comprobar ahora», de todos o de un campus. El servidor es de pega.
 */

const ctx = vi.hoisted(() => ({ valor: {} }));
const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ctx.valor }));
vi.mock('@/shared/api/client', () => ({ default: { get, post, put: vi.fn(), delete: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

const { default: SaludDeLasConexiones } = await import('@/modules/accounting/components/SaludDeLasConexiones');

const CONEXIONES = [
  { clave: 'stripe', titulo: 'Stripe' },
  { clave: 'moodle', titulo: 'Moodle' },
];
const vacia = (resumen) => ({ estado: 'sin_configurar', resumen, ultimaSenal: null, queSenal: null, motivo: null, comprobado: null });
const SALUD = {
  comprobado: '2026-11-17T12:00:00Z',
  conexiones: CONEXIONES,
  campus: [
    { id: 1, nombre: 'Psiko Aprende', peor: 'bien', casillas: {
      stripe: { estado: 'bien', resumen: 'Cobros al día (último cargo hace 3 h)', ultimaSenal: '2026-11-17T11:55:00Z', queSenal: 'Última sincronización', motivo: null, comprobado: null,
        datos: { webhook: { estado: 'desactivado', texto: 'Webhook desactivado: no ha llegado ningún aviso.' } } },
      moodle: vacia('Campus sin conectar'),
    } },
    { id: 2, nombre: 'Fono Aprende', peor: 'caida', casillas: {
      stripe: vacia('Sin clave de Stripe'),
      moodle: { estado: 'caida', resumen: 'No conecta con el campus', ultimaSenal: null, queSenal: null, motivo: 'El token del campus no vale (caducado o mal copiado).', comprobado: '2026-11-17T11:00:00Z' },
    } },
  ],
};

afterEach(cleanup);

beforeEach(() => {
  get.mockReset(); post.mockReset();
  get.mockResolvedValue({ success: true, data: SALUD });
  ctx.valor = { activeProject: { id: -1 }, activeIssuerId: null };
});

describe('#533 · Salud de las conexiones', () => {
  it('pinta cada campus con sus casillas, la última señal y el motivo del fallo', async () => {
    render(<SaludDeLasConexiones />);
    const tabla = await screen.findByRole('table', { name: 'Salud de las conexiones por campus' });
    expect(get).toHaveBeenCalledWith('/integrations/salud', { params: {} });
    const filas = within(tabla).getAllByRole('row');
    expect(filas).toHaveLength(3);
    expect(within(filas[1]).getByText('Psiko Aprende')).toBeInTheDocument();
    expect(within(filas[1]).getByText(/Webhook desactivado/)).toBeInTheDocument();
    expect(within(filas[1]).getByText(/Última señal/)).toBeInTheDocument();
    expect(within(filas[2]).getAllByText('Caída').length).toBeGreaterThan(0);
    expect(within(filas[2]).getByText('El token del campus no vale (caducado o mal copiado).')).toBeInTheDocument();
    expect(screen.getByText('1 campus con algo caído')).toBeInTheDocument();
    // El primer render carga el módulo y los iconos: en un equipo lento pasa de 5 s.
  }, 20000);

  it('con una empresa arriba, pide la de esa empresa', async () => {
    ctx.valor = { activeProject: { id: -1 }, activeIssuerId: 7 };
    render(<SaludDeLasConexiones />);
    await screen.findByRole('table');
    expect(get).toHaveBeenCalledWith('/integrations/salud', { params: { issuerId: 7 } });
  });

  it('con un campus arriba, el suyo; con `deTodos` (ISEIE), todos los de quien mira', async () => {
    ctx.valor = { activeProject: { id: 5 }, activeIssuerId: null };
    const { unmount } = render(<SaludDeLasConexiones />);
    await screen.findByRole('table');
    expect(get).toHaveBeenLastCalledWith('/integrations/salud', { params: { projectId: 5 } });
    unmount();
    render(<SaludDeLasConexiones deTodos />);
    await screen.findByRole('table');
    expect(get).toHaveBeenLastCalledWith('/integrations/salud', { params: {} });
  });

  it('«Comprobar ahora» de todos y «Comprobar» de un campus', async () => {
    const arreglada = { ...SALUD, campus: [SALUD.campus[0], { ...SALUD.campus[1], peor: 'bien', casillas: {
      ...SALUD.campus[1].casillas,
      moodle: { estado: 'bien', resumen: 'Conectado (probado hace 0 min)', ultimaSenal: '2026-11-17T12:01:00Z', queSenal: null, motivo: null, comprobado: '2026-11-17T12:01:00Z' },
    } }] };
    post.mockResolvedValue({ success: true, data: arreglada });
    render(<SaludDeLasConexiones />);
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Comprobar ahora las conexiones de Fono Aprende' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/integrations/salud/comprobar', { projectId: 2 }, { params: {} }));
    await waitFor(() => expect(screen.queryByText('El token del campus no vale (caducado o mal copiado).')).not.toBeInTheDocument());
    expect(screen.getByText('Ningún campus con algo caído')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Comprobar ahora$/ }));
    await waitFor(() => expect(post).toHaveBeenLastCalledWith('/integrations/salud/comprobar', {}, { params: {} }));
  });

  it('si no carga, lo dice', async () => {
    get.mockRejectedValue(new Error('500'));
    render(<SaludDeLasConexiones />);
    expect(await screen.findByText('No se pudo cargar la salud de las conexiones.')).toBeInTheDocument();
  });
});
