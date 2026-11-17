import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

/*
  #772 · El informe mensual para la gestoría, en Reportes.

  - Solo con el permiso `reports.informe_mensual`.
  - Pide el mes anterior y la empresa de la pantalla.
  - Pinta por equipo y por comercial, y dice si el envío automático está apagado.
*/

const get = vi.fn();
vi.mock('@/shared/api/client', () => ({
  default: { get: (...a) => get(...a) },
  API_BASE_URL: '/crm/api',
  getAccessToken: () => null,
}));
let permisos = { 'reports.informe_mensual': true };
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => !!permisos[k] }) }));
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({ projects: [{ id: 1, sociedad_emisora_id: 3, sociedad_nombre: 'CEDIA Investigación SL' }] }),
}));

const { default: InformeMensual } = await import('@/modules/reports/components/InformeMensual');

const cifras = (n) => ({ leads: 0, ventas: n, vendido: n * 100, cobrado: n * 50, cobros: n, facturado: n * 40, pendiente: 0 });
const DATOS = {
  periodo: '2026-10', mes: 'octubre de 2026', desde: '2026-10-01', hasta: '2026-10-31',
  equipos: [
    { equipo: 'Equipo de Raquel', lider: 'Raquel', comerciales: 2, ...cifras(3) },
    { equipo: 'Sin equipo', lider: null, comerciales: 1, ...cifras(1) },
  ],
  comerciales: [
    { id: 7, nombre: 'Yolanda', equipo: 'Equipo de Raquel', tasa_conversion: 0, ...cifras(2) },
    { id: 9, nombre: 'Ana', equipo: 'Sin equipo', tasa_conversion: 0, ...cifras(1) },
  ],
  total: cifras(4),
  envio: { activo: false, dia: 1, hora: '09:00', con_destinatarios: false },
};

beforeEach(() => {
  permisos = { 'reports.informe_mensual': true };
  get.mockReset();
  get.mockResolvedValue({ success: true, data: DATOS });
});

describe('el informe mensual en Reportes (#772)', () => {
  it('sin el permiso no se pinta ni se pide', () => {
    permisos = {};
    const { container } = render(<InformeMensual issuerId={3} />);
    expect(container).toBeEmptyDOMElement();
    expect(get).not.toHaveBeenCalled();
  });

  it('pide el mes anterior de la empresa y pinta equipos y comerciales', async () => {
    render(<InformeMensual issuerId={3} />);
    await screen.findByText('Yolanda');
    expect(screen.getAllByText('Equipo de Raquel').length).toBeGreaterThan(0);
    const url = get.mock.calls[0][0];
    expect(url).toMatch(/^\/informe-mensual\?periodo=\d{4}-\d{2}&issuerId=3$/);
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    expect(url).toContain(`periodo=${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    expect(screen.getByText('Yolanda')).toBeInTheDocument();
    expect(screen.getAllByText('Sin equipo').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /ZIP de facturas/ })).toBeEnabled();
  });

  it('dice que el envío automático está apagado', async () => {
    render(<InformeMensual issuerId={3} />);
    await waitFor(() => expect(screen.getByText(/Envío automático a la gestoría: apagado/)).toBeInTheDocument());
  });
});
