// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * #199 · Matrículas, «por empresa y con "Todos los proyectos", como el resto del
 * CRM». Con una empresa en la cabecera salía el muro de «elige un campus», y con
 * «Todos» la lista se quedaba cargando: la pantalla no pedía nada sin un campus.
 */

const { cabecera, get, roles } = vi.hoisted(() => ({ cabecera: { value: {} }, get: vi.fn(), roles: { value: ['superadmin'] } }));

vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => cabecera.value }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: () => true, tieneRol: (...r) => r.some((x) => roles.value.includes(x)) }) }));
vi.mock('@/shared/api/client', () => ({ default: { get, post: vi.fn(), patch: vi.fn() }, API_BASE_URL: '/crm/api' }));

import MatriculasPage from '@/modules/matriculas/pages/MatriculasPage';

afterEach(cleanup);

const VACIA = { success: true, data: [], stats: { total: 0, pendientes: 0, validadas: 0, rechazadas: 0 } };
const pedido = () => new URLSearchParams(get.mock.calls.at(-1)[0].split('?')[1]);
const abrir = () => render(<MemoryRouter initialEntries={['/matriculas']}><MatriculasPage /></MemoryRouter>);

// En MultiCRM aquí se mira que el muro de «elige un campus» de la cabecera deje
// pasar Matrículas. ISEIE no tiene ese muro (ni la cabecera nueva): no aplica.

describe('el listado sigue a la cabecera', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue(VACIA);
  });

  it('con una empresa: pide esa empresa y no un campus', async () => {
    cabecera.value = { activeIssuerId: 7, activeIssuer: { nombre: 'CEDIA' }, activeProject: { id: -1 } };
    abrir();
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(pedido().get('issuerId')).toBe('7');
    expect(pedido().get('projectId')).toBeNull();
    expect(await screen.findByText('0 matrículas en CEDIA')).toBeTruthy();
  });

  it('con «Todos los proyectos»: pide sin campus y no se queda cargando', async () => {
    cabecera.value = { activeIssuerId: null, activeIssuer: null, activeProject: { id: -1 } };
    abrir();
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(pedido().get('projectId')).toBeNull();
    expect(pedido().get('issuerId')).toBeNull();
    expect(await screen.findByText('Aún no ha llegado ninguna solicitud')).toBeTruthy();
  });

  it('con un campus: ese campus, como antes', async () => {
    cabecera.value = { activeIssuerId: null, activeIssuer: null, activeProject: { id: 3, nombre: 'ISEIE Online' } };
    abrir();
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(pedido().get('projectId')).toBe('3');
    expect(await screen.findByText('0 matrículas en ISEIE Online')).toBeTruthy();
  });

  it('arriba, la cifra de Solicitudes', async () => {
    cabecera.value = { activeIssuerId: 7, activeIssuer: { nombre: 'CEDIA' }, activeProject: { id: -1 } };
    get.mockResolvedValue({ ...VACIA, stats: { ...VACIA.stats, total: 9, solicitudes: 4 } });
    abrir();
    const tarjeta = (await screen.findByText('Solicitudes')).parentElement;
    expect(tarjeta.textContent).toContain('4');
  });

  it('cada estado con su color del tema: Solicitud azul, Datos validados índigo (del tema), y los demás', async () => {
    cabecera.value = { activeIssuerId: null, activeIssuer: null, activeProject: { id: -1 } };
    const estados = ['solicitud_admision', 'datos_validados', 'pendiente', 'validada', 'rechazada'];
    get.mockResolvedValue({ ...VACIA, data: estados.map((estado, i) => ({ id: i + 1, estado, lead_nombre: `P${i}` })) });
    abrir();
    const etiqueta = async (texto) => (await screen.findAllByText(texto))[0].className;
    expect(await etiqueta('Solicitud admisión')).toContain('bg-info-soft');
    expect(await etiqueta('Datos validados')).toContain('bg-indigo-soft');
    expect(await etiqueta('Pendiente')).toContain('bg-warning-soft');
    expect(await etiqueta('Validada')).toContain('bg-success-soft');
    expect(await etiqueta('Rechazada')).toContain('bg-destructive-soft');
  });

  it('las columnas de Diego: Persona · Curso · Empresa · campus · Recibida · Estado · Documentos · Venta', async () => {
    cabecera.value = { activeIssuerId: null, activeIssuer: null, activeProject: { id: -1 } };
    get.mockResolvedValue({ ...VACIA, data: [
      { id: 1, estado: 'solicitud_admision', lead_nombre: 'María López', lead_email: 'maria@x.es', curso: 'Máster en Psicología',
        campus_nombre: 'ISEIE Madrid', recibida_at: '2026-10-01T09:12:00Z', conversion_id: null, gestora_nombre: 'Lucía',
        documentos: { dni_frente: true, dni_dorso: false, foto: false, titulo: false, firma: false } },
      { id: 2, estado: 'validada', lead_nombre: 'Hugo Pascual', curso: 'Máster en Logopedia', campus_nombre: 'ISEIE Bogotá',
        recibida_at: '2026-09-28T10:00:00Z', conversion_id: 44, documentos: { dni_frente: true, titulo: true, firma: true } },
    ] });
    abrir();
    await screen.findAllByText('María López');
    const cabeceras = screen.getAllByRole('columnheader').map((th) => th.textContent);
    expect(cabeceras.slice(0, 8)).toEqual(['Persona', 'Curso', 'Empresa · campus', 'Gestora', 'Recibida (hora de Madrid)', 'Estado', 'Documentos', 'Venta']);
    // La gestora de su ficha (13/11/2026), o «Sin gestora».
    expect(screen.getAllByText('Lucía').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sin gestora').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Máster en Psicología').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ISEIE Madrid').length).toBeGreaterThan(0);
    // Documentos: los cinco de Diego, con su nombre al pasar el ratón; una marca
    // en el que llegó y un hueco en los que faltan.
    const recibido = screen.getAllByLabelText('DNI (delante): recibido')[0];
    expect(recibido.querySelector('[data-marca="recibido"]')).not.toBeNull();
    for (const falta of ['DNI (detrás): falta', 'Foto: falta', 'Título: falta', 'Firma: falta']) {
      const icono = screen.getAllByLabelText(falta)[0];
      expect(icono.querySelector('[data-marca]')).toBeNull();
      expect(icono.className).toContain('border-dashed');
    }
    // Venta: el enlace si la hay; si no, «Sin venta».
    expect(screen.getAllByText('Sin venta').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Ver venta' })[0].getAttribute('href')).toBe('/ventas/44');
  });

  it('«Recibida» en hora de Madrid, la misma con la que filtra el servidor, se mire desde donde se mire', async () => {
    cabecera.value = { activeIssuerId: null, activeIssuer: null, activeProject: { id: -1 } };
    // 22:13 UTC del 11/10: en Venezuela, 11 oct a las 18:13; en Madrid, 12 oct a las 00:13.
    get.mockResolvedValue({ ...VACIA, data: [{ id: 1, estado: 'pendiente', lead_nombre: 'Juan Martínez', recibida_at: '2026-10-11T22:13:00Z' }] });
    abrir();
    await screen.findAllByText('Juan Martínez');
    expect(screen.getAllByText(/12 oct 2026, 0?0:13/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/11 oct 2026/)).toBeNull();
  });

  it('sin matrículas ni filtros: el texto de Diego para empezar', async () => {
    cabecera.value = { activeIssuerId: null, activeIssuer: null, activeProject: { id: -1 } };
    abrir();
    expect(await screen.findByText('Aún no ha llegado ninguna solicitud')).toBeTruthy();
    expect(screen.getByText('Conecta el formulario de admisión en la pestaña Webhooks de admisión.')).toBeTruthy();
  });

  it('con filtros y sin resultados: lo dice, y «Quitar filtros» los quita', async () => {
    cabecera.value = { activeIssuerId: null, activeIssuer: null, activeProject: { id: -1 } };
    abrir();
    await screen.findByText('Aún no ha llegado ninguna solicitud');
    fireEvent.change(screen.getByLabelText('Buscar por nombre, email o DNI'), { target: { value: 'nadie' } });
    expect(await screen.findByText('Ninguna matrícula con estos filtros')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtros' }));
    await screen.findByText('Aún no ha llegado ninguna solicitud');
    expect(pedido().get('search')).toBeNull();
    expect(screen.getByLabelText('Buscar por nombre, email o DNI').value).toBe('');
  });

  it('el desplegable «Filtros», como en Prospectos: estado, curso, campus de la empresa y fechas', async () => {
    cabecera.value = {
      activeIssuerId: 7, activeIssuer: { nombre: 'CEDIA' }, activeProject: { id: -1 },
      projects: [
        { id: 1, nombre: 'ISEIE Madrid', sociedad_emisora_id: 7 },
        { id: 3, nombre: 'ISEIE Bogotá', sociedad_emisora_id: 7 },
        { id: 2, nombre: 'ISEIE Online', sociedad_emisora_id: 9 },
      ],
    };
    // Los campus del filtro los da el servidor (los del ámbito; con «Todos», sin los de pruebas).
    get.mockResolvedValue({ ...VACIA, cursos: ['Máster en Logopedia', 'Máster en Psicología Clínica'],
      campus: [{ id: 1, nombre: 'ISEIE Madrid' }, { id: 3, nombre: 'ISEIE Bogotá' }] });
    abrir();
    await waitFor(() => expect(get).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: /Filtros/ }));
    // El campus: solo los de la empresa de la cabecera.
    const campus = screen.getByLabelText('Campus');
    expect([...campus.options].map((o) => o.textContent)).toEqual(['Todos los campus', 'ISEIE Madrid', 'ISEIE Bogotá']);
    // Los cursos, los que manda el servidor.
    await waitFor(() => expect([...screen.getByLabelText('Curso').options].map((o) => o.value)).toContain('Máster en Logopedia'));

    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'pendiente' } });
    fireEvent.change(screen.getByLabelText('Curso'), { target: { value: 'Máster en Logopedia' } });
    fireEvent.change(screen.getByLabelText('Campus'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Recibida desde'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Recibida hasta'), { target: { value: '2026-10-12' } });
    await waitFor(() => expect(pedido().get('hasta')).toBe('2026-10-12'));
    expect(pedido().get('issuerId')).toBe('7');
    expect(pedido().get('estado')).toBe('pendiente');
    expect(pedido().get('curso')).toBe('Máster en Logopedia');
    expect(pedido().get('campusId')).toBe('3');
    expect(pedido().get('desde')).toBe('2026-10-01');

    // El botón cuenta los filtros puestos, y cada píldora se quita con su ✕.
    expect(screen.getByRole('button', { name: /Filtros/ }).textContent).toContain('4');
    fireEvent.click(screen.getByRole('button', { name: 'Quitar el filtro ISEIE Bogotá' }));
    await waitFor(() => expect(pedido().get('campusId')).toBeNull());
    expect(pedido().get('curso')).toBe('Máster en Logopedia');
  });

  it('con un campus en la cabecera no hay campus que elegir', async () => {
    cabecera.value = { activeIssuerId: null, activeIssuer: null, activeProject: { id: 3, nombre: 'ISEIE Online' },
      projects: [{ id: 1, nombre: 'ISEIE Madrid', sociedad_emisora_id: 7 }, { id: 3, nombre: 'ISEIE Online', sociedad_emisora_id: 9 }] };
    abrir();
    await waitFor(() => expect(get).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: /Filtros/ }));
    expect(screen.queryByLabelText('Campus')).toBeNull();
    expect(screen.getByLabelText('Curso')).toBeTruthy();
  });

  it('los webhooks, sin un campus elegido, piden elegirlo en vez de buscar el del «proyecto −1»', async () => {
    cabecera.value = { activeIssuerId: 7, activeIssuer: { nombre: 'CEDIA' }, activeProject: { id: -1 } };
    abrir();
    await waitFor(() => expect(get).toHaveBeenCalled());
    get.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Webhooks/ }));
    expect(await screen.findByText('Elige un campus')).toBeTruthy();
    expect(get.mock.calls.some(([url]) => url.startsWith('/webhook-tokens'))).toBe(false);
  });
});

// Revisión independiente del 15/10.
describe('lo que salió en la revisión', () => {
  beforeEach(() => { vi.clearAllMocks(); roles.value = ['superadmin']; get.mockResolvedValue(VACIA); });
  const fila = { id: 1, estado: 'solicitud_admision', lead_nombre: 'María López', documentos: {} };
  const conFila = async (url) => (url.startsWith('/matriculas?') ? { ...VACIA, data: [fila] } : { success: true, data: fila });

  it('la gestora no ve los botones de estado (el servidor no la deja: le daba 403)', async () => {
    roles.value = ['gestor'];
    cabecera.value = { activeIssuerId: null, activeIssuer: null, activeProject: { id: -1 } };
    get.mockImplementation(conFila);
    abrir();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Ver detalle de matrícula' }))[0]);
    await screen.findByRole('heading', { name: 'María López' });
    expect(screen.queryByRole('button', { name: /Validar datos/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Rechazar/ })).toBeNull();
  });

  it('el admin sí los ve', async () => {
    roles.value = ['admin'];
    cabecera.value = { activeIssuerId: null, activeIssuer: null, activeProject: { id: -1 } };
    get.mockImplementation(conFila);
    abrir();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Ver detalle de matrícula' }))[0]);
    expect(await screen.findByRole('button', { name: /Validar datos/ })).toBeTruthy();
  });

  it('«Ver más» pide la página siguiente y la añade debajo', async () => {
    cabecera.value = { activeIssuerId: null, activeIssuer: null, activeProject: { id: -1 } };
    const pagina = (n) => Array.from({ length: n === 1 ? 50 : 10 }, (_, i) => ({ id: n * 100 + i, estado: 'pendiente', lead_nombre: `P${n}-${i}`, documentos: {} }));
    get.mockImplementation(async (url) => {
      const p = Number(new URLSearchParams(url.split('?')[1]).get('page'));
      return { ...VACIA, data: pagina(p), pagination: { total: 60 } };
    });
    abrir();
    const boton = await screen.findByRole('button', { name: 'Ver más (50 de 60)' });
    fireEvent.click(boton);
    await waitFor(() => expect(screen.queryByRole('button', { name: /Ver más/ })).toBeNull());
    expect(pedido().get('page')).toBe('2');
    expect(screen.getAllByText('P2-9').length).toBeGreaterThan(0);
    expect(screen.getAllByText('P1-0').length).toBeGreaterThan(0);
  // Pinta 60 filas dos veces (tabla y tarjetas): con la máquina cargada pasa de
  // los 5 s por defecto sin que haya nada mal.
  }, 20000);

  it('con un campus filtrado, el subtítulo es el de ese campus', async () => {
    cabecera.value = { activeIssuerId: null, activeIssuer: null, activeProject: { id: -1 } };
    get.mockResolvedValue({ ...VACIA, stats: { ...VACIA.stats, total: 2 }, campus: [{ id: 3, nombre: 'ISEIE Bogotá' }, { id: 1, nombre: 'ISEIE Madrid' }] });
    abrir();
    fireEvent.click(await screen.findByRole('button', { name: /Filtros/ }));
    fireEvent.change(screen.getByLabelText('Campus'), { target: { value: '3' } });
    expect(await screen.findByText('2 matrículas en ISEIE Bogotá')).toBeTruthy();
    expect(pedido().get('campusId')).toBe('3');
  });
});
