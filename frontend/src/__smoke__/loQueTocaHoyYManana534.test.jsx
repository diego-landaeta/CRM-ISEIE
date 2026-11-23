// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  CRM#534, parte 4 · «Lo que toca», en Prospectos (Diego, 18/11, PR #883):
  separado en «Hoy» y «Mañana», cada uno con su número, para ver de un vistazo
  qué es de hoy y qué de mañana. Los números y las personas salen de la cola.
*/

const { api } = vi.hoisted(() => ({ api: { resumen: vi.fn(), cola: vi.fn() } }));
vi.mock('@/modules/proceso/api/agenda.api', () => ({
  traerResumen: (...a) => api.resumen(...a),
  traerCola: (...a) => api.cola(...a),
}));

const { default: LoQueTocaHoyYManana } = await import('@/modules/leads/components/LoQueTocaHoyYManana');
const { PROCESO_EN_PRUEBAS } = await import('@/shared/lib/enPruebas');

const persona = (id, nombre, extra = {}) => ({
  lead_id: id, lead_nombre: nombre, paso_nombre: 'Llamar', clave: 'llamar', gestora: 'Ana', producto: 'Máster X', paso_id: id * 10, ...extra,
});

function servidor({ hoy = [], manana = [], resumen } = {}) {
  api.resumen.mockResolvedValue(resumen || { atrasados: 0, hoy: hoy.length, manana: manana.length, esta_semana: 0 });
  api.cola.mockImplementation(async ({ tramo }) => ({ filas: tramo === 'hoy' ? hoy : manana, total: 0, totalPaginas: 1, formaciones: [] }));
}

const abrir = (props = {}) => render(
  <MemoryRouter><LoQueTocaHoyYManana projectId={3} onAbrir={vi.fn()} {...props} /></MemoryRouter>,
);

beforeEach(() => { api.resumen.mockReset(); api.cola.mockReset(); });
afterEach(() => cleanup());

describe('Hoy y Mañana, separados y con su número', () => {
  it('dos pestañas, «Hoy» y «Mañana», cada una con su número', async () => {
    servidor({ hoy: [persona(1, 'Lucía')], manana: [persona(2, 'Pedro'), persona(3, 'Marta')] });
    abrir();
    const hoy = await screen.findByRole('tab', { name: /Hoy/ });
    const manana = screen.getByRole('tab', { name: /Mañana/ });
    expect(await within(hoy).findByText('1')).toBeInTheDocument();
    expect(within(manana).getByText('2')).toBeInTheDocument();
    expect(hoy).toHaveAttribute('aria-selected', 'true');
  });

  it('cada pestaña enseña solo las personas de su día', async () => {
    servidor({ hoy: [persona(1, 'Lucía')], manana: [persona(2, 'Pedro')] });
    abrir();
    expect(await screen.findByText('Lucía')).toBeInTheDocument();
    expect(screen.queryByText('Pedro')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Mañana/ }));
    expect(await screen.findByText('Pedro')).toBeInTheDocument();
    expect(screen.queryByText('Lucía')).toBeNull();
  });

  it('pide a la cola cada día con el ámbito de arriba', async () => {
    servidor();
    abrir({ projectId: null, projectIds: '4,5' });
    await screen.findByText('Hoy no toca nadie.');
    expect(api.resumen).toHaveBeenCalledWith({ projectId: null, projectIds: '4,5' });
    expect(api.cola).toHaveBeenCalledWith(expect.objectContaining({ tramo: 'hoy', projectIds: '4,5' }));
    expect(api.cola).toHaveBeenCalledWith(expect.objectContaining({ tramo: 'manana', projectIds: '4,5' }));
  });

  it('pulsar a alguien abre su panel, como en la lista', async () => {
    servidor({ hoy: [persona(7, 'Lucía')] });
    const onAbrir = vi.fn();
    abrir({ onAbrir });
    fireEvent.click(await screen.findByText('Lucía'));
    expect(onAbrir).toHaveBeenCalledWith(7);
  });

  it('si hay más de los que caben, lleva a la cola con el día puesto', async () => {
    servidor({ hoy: [persona(1, 'Lucía')], resumen: { atrasados: 3, hoy: 12, manana: 0, esta_semana: 0 } });
    abrir();
    const ver = await screen.findByRole('link', { name: /Ver los 12 de hoy en la cola/ });
    expect(ver).toHaveAttribute('href', '/leads/cola?tramo=hoy');
    expect(screen.getByRole('link', { name: /3 atrasados/ })).toHaveAttribute('href', '/leads/cola?tramo=atrasados');
  });

  it('sin nada, lo dice (y conserva los atajos del proceso)', async () => {
    servidor();
    abrir();
    expect(await screen.findByText('Hoy no toca nadie.')).toBeInTheDocument();
    for (const n of ['La cola del día', 'Proceso comercial']) {
      expect(screen.getByRole('link', { name: new RegExp(n) })).toBeInTheDocument();
    }
    // En ISEIE «Seguimiento de fin de mes» va detrás de PROCESO_EN_PRUEBAS, como en el menú.
    expect(!!screen.queryByRole('link', { name: /Seguimiento de fin de mes/ })).toBe(PROCESO_EN_PRUEBAS);
  });
});
