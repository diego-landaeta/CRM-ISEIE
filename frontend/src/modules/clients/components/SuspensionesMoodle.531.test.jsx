// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

/**
 * Suspensiones de Moodle en el CRM (gemela de MultiCRM #531), en el frontal:
 *   · la ficha: «Suspendido en Moodle desde … · motivo», qué está suspendido, el historial;
 *     «Reactivado el …»; «Al día» si Moodle nunca avisó; nada si el servidor lo tiene apagado;
 *   · la etiqueta de la cabecera, solo si sigue suspendido;
 *   · el hook pide `/leads/:id/suspensiones-moodle`;
 *   · el filtro «Suspendidos en Moodle» de Clientes: sale solo encendido y se puede quitar.
 *
 *   npx vitest run src/modules/clients/components/SuspensionesMoodle.531.test.jsx
 */
afterEach(() => { cleanup(); });
const get = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ default: { get, post: vi.fn() }, API_BASE_URL: '/api', getAccessToken: () => null, setAccessToken: () => {} }));
// Desde main (25/11) el filtro de gestora va por permiso y alcance (usePermission), no por rol.
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: () => true, veGestoras: true, llevaEquipo: false }) }));

const { default: SuspensionesMoodleBloque, EtiquetaSuspendido } = await import('@/modules/clients/components/SuspensionesMoodle');
const { useSuspensionesMoodle } = await import('@/modules/clients/hooks/useSuspensionesMoodle');
const { default: ClientsFiltersBar } = await import('@/modules/clients/components/ClientsFiltersBar');
const { suspensionesMoodleEncendidas } = await import('@/shared/lib/suspensionesMoodle');

const SUSPENDIDO = {
  disponible: true,
  suspendido: true,
  campus: [{
    projectId: 1, campus: 'ISEIE', estado: 'suspendido', desde: '2026-11-20T10:00:00Z',
    motivo: 'cuota_vencida', motivoTexto: 'Cuota vencida sin pagar desde el 01/11/2026',
    cuenta: false, cursos: [{ id: 2, nombre: 'Curso de prueba' }],
  }],
  historial: [
    { id: 2, projectId: 1, campus: 'ISEIE', ambito: 'curso', curso: { id: 2, nombre: 'Curso de prueba' }, suspendido: true, fecha: '2026-11-20T10:00:00Z', via: 'ws', motivo: 'cuota_vencida', motivoTexto: 'Cuota vencida sin pagar desde el 01/11/2026' },
    { id: 1, projectId: 1, campus: 'ISEIE', ambito: 'cuenta', curso: null, suspendido: false, fecha: '2026-11-10T10:00:00Z', via: 'web', motivo: 'pago', motivoTexto: 'Pagó el 09/11/2026' },
  ],
};
const REACTIVADO = {
  disponible: true,
  suspendido: false,
  campus: [{ projectId: 1, campus: 'ISEIE', estado: 'reactivado', desde: '2026-11-22T10:00:00Z', motivo: 'pago', motivoTexto: 'Pagó el 21/11/2026', cuenta: false, cursos: [] }],
  historial: [],
};

describe('#531 · el estado en Moodle de la ficha', () => {
  it('suspendido: desde cuándo, el motivo según el CRM, qué está suspendido y el historial', () => {
    render(<SuspensionesMoodleBloque datos={SUSPENDIDO} cargando={false} error={null} />);
    expect(screen.getByText(/Suspendido en Moodle desde el/).textContent).toMatch(/20 nov/);
    expect(screen.getAllByText('Motivo según el CRM: Cuota vencida sin pagar desde el 01/11/2026')).toHaveLength(1);
    expect(screen.getByText('Suspendido: Curso de prueba')).toBeTruthy();
    expect(screen.getByText('Historial de cambios (2)')).toBeTruthy();
    expect(screen.getByText(/desde una integración \(Make…\)/)).toBeTruthy();
    expect(screen.getByText('Pagó el 09/11/2026')).toBeTruthy();
  });

  it('reactivado: «Reactivado el …» con el pago; sin avisos: «Al día»; apagado: nada', () => {
    const { rerender, container } = render(<SuspensionesMoodleBloque datos={REACTIVADO} cargando={false} error={null} />);
    expect(screen.getByText(/Reactivado el/).textContent).toMatch(/22 nov/);
    expect(screen.getByText('Pagó el 21/11/2026')).toBeTruthy();
    rerender(<SuspensionesMoodleBloque datos={{ disponible: true, suspendido: false, campus: [], historial: [] }} cargando={false} error={null} />);
    expect(screen.getByText('Al día')).toBeTruthy();
    rerender(<SuspensionesMoodleBloque datos={{ disponible: false, suspendido: false, campus: [], historial: [] }} cargando={false} error={null} />);
    expect(container.textContent).toBe('');
  });

  it('la etiqueta de la cabecera, solo si sigue suspendido', () => {
    const { rerender, container } = render(<EtiquetaSuspendido datos={SUSPENDIDO} />);
    expect(screen.getByText('Suspendido en Moodle')).toBeTruthy();
    rerender(<EtiquetaSuspendido datos={REACTIVADO} />);
    expect(container.textContent).toBe('');
  });

  it('el hook pide /leads/:id/suspensiones-moodle', async () => {
    get.mockResolvedValue({ success: true, data: SUSPENDIDO });
    function Ficha() {
      const s = useSuspensionesMoodle(7);
      return <SuspensionesMoodleBloque datos={s.datos} cargando={s.cargando} error={s.error} />;
    }
    render(<Ficha />);
    await waitFor(() => expect(screen.getByText(/Suspendido en Moodle desde el/)).toBeTruthy());
    expect(get).toHaveBeenCalledWith('/leads/7/suspensiones-moodle');
  });
});

describe('#531 · el filtro «Suspendidos en Moodle» de Clientes', () => {
  const base = {
    user: { role: 'admin' }, search: '', setSearch: () => {}, filterResp: '', setFilterResp: () => {},
    filterProducto: '', setFilterProducto: () => {}, filterInstallments: '', setFilterInstallments: () => {},
    sortBy: 'nombre', setSortBy: () => {},
    gestores: [], productos: [], totalBackend: 3,
  };

  it('encendido: se elige en «Filtros» y sale como píldora que se quita', () => {
    const setFilterMoodle = vi.fn();
    const { rerender } = render(<ClientsFiltersBar {...base} filterMoodle="" setFilterMoodle={setFilterMoodle} />);
    fireEvent.click(screen.getByRole('button', { name: /Filtros/ }));
    fireEvent.change(screen.getByLabelText('Estado en Moodle'), { target: { value: 'suspendidos' } });
    expect(setFilterMoodle).toHaveBeenCalledWith('suspendidos');
    rerender(<ClientsFiltersBar {...base} filterMoodle="suspendidos" setFilterMoodle={setFilterMoodle} />);
    expect(screen.getAllByText('Suspendidos en Moodle').length).toBeGreaterThan(0);
  });

  it('apagado en el servidor: ni el filtro ni la píldora', () => {
    render(<ClientsFiltersBar {...base} filterMoodle="suspendidos" />);
    fireEvent.click(screen.getByRole('button', { name: /Filtros/ }));
    expect(screen.queryByLabelText('Estado en Moodle')).toBeNull();
    expect(screen.queryByText('Suspendidos en Moodle')).toBeNull();
  });

  it('el interruptor: lo que diga el servidor manda; sin saberlo, lo de compilar', () => {
    expect(suspensionesMoodleEncendidas(true)).toBe(true);
    expect(suspensionesMoodleEncendidas(false)).toBe(false);
    expect(typeof suspensionesMoodleEncendidas(undefined)).toBe('boolean');
  });
});
