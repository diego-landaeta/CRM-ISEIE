// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

/*
  Baja del alumno en la ficha de la venta (25/11, CRM-ISEIE#767, gemela de CRM#1113): dar de baja con
  fecha, motivo y nota; el aviso de las cuotas por cobrar; cambiar y deshacer; el
  historial; sin `conversions.baja_alumno` solo se ve; sin la migración, no sale.
*/

const get = vi.fn();
const put = vi.fn();
const del = vi.fn();
let permisos: Record<string, boolean> = { 'conversions.baja_alumno': true };
vi.mock('@/shared/api/client', () => ({
  default: {
    get: (...a: unknown[]) => get(...a),
    put: (...a: unknown[]) => put(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k: string) => Boolean(permisos[k]) }) }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

const { default: BajaAlumnoCard } = await import('../modules/sales/components/BajaAlumnoCard');

const MOTIVOS = [
  { clave: 'desistimiento', texto: 'Desistimiento en plazo' },
  { clave: 'voluntaria', texto: 'Baja voluntaria' },
  { clave: 'impago', texto: 'Impago' },
  { clave: 'otro', texto: 'Otro' },
];
const AVISOS = { cuotas_pendientes: 2, importe_cuotas_pendientes: 200, pendiente: 200, cobro_automatico: true, suscripcion_activa: false };
const sinBaja = { disponible: true, baja: null, historial: [], avisos: AVISOS, motivos: MOTIVOS };
const conBaja = {
  ...sinBaja,
  baja: { fecha: '2026-11-20', motivo: 'desistimiento', motivo_texto: 'Desistimiento en plazo', nota: 'Lo pidió por correo', por: 'Dayana', at: '2026-11-20T10:00:00Z' },
  historial: [{ id: 1, accion: 'baja', fecha_baja: '2026-11-20', motivo: 'desistimiento', motivo_texto: 'Desistimiento en plazo', nota: 'Lo pidió por correo', usuario: 'Dayana', at: '2026-11-20T10:00:00Z' }],
};

beforeEach(() => {
  permisos = { 'conversions.baja_alumno': true };
  get.mockReset(); put.mockReset(); del.mockReset();
});
afterEach(() => cleanup());

describe('BajaAlumnoCard', () => {
  it('da de baja con fecha, motivo y nota, avisando de las cuotas por cobrar', async () => {
    get.mockResolvedValue({ success: true, data: sinBaja });
    put.mockResolvedValue({ success: true, data: conBaja });
    render(<BajaAlumnoCard conversionId={7} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Dar de baja al alumno' }));
    expect(get).toHaveBeenCalledWith('/conversions/7/baja');
    expect(screen.getByRole('alert')).toHaveTextContent('Quedan 2 cuotas por cobrar');
    expect(screen.getByRole('alert')).toHaveTextContent('cobro automático');
    expect(screen.getByText(/No da de baja en Moodle/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Fecha de baja'), { target: { value: '2026-11-20' } });
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'desistimiento' } });
    fireEvent.change(screen.getByLabelText(/^Nota/), { target: { value: 'Lo pidió por correo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dar de baja' }));

    await waitFor(() => expect(put).toHaveBeenCalledWith('/conversions/7/baja', { fecha: '2026-11-20', motivo: 'desistimiento', nota: 'Lo pidió por correo' }));
    expect(await screen.findByText(/desde el .* · Desistimiento en plazo/, { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText(/Apuntada por Dayana/)).toBeInTheDocument();
    expect(screen.getByText('Historial de la baja (1)')).toBeInTheDocument();
  });

  it('con «Otro» y sin nota no manda nada', async () => {
    get.mockResolvedValue({ success: true, data: sinBaja });
    render(<BajaAlumnoCard conversionId={7} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Dar de baja al alumno' }));
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'otro' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dar de baja' }));
    expect(put).not.toHaveBeenCalled();
  });

  it('de baja: se puede deshacer', async () => {
    get.mockResolvedValue({ success: true, data: conBaja });
    del.mockResolvedValue({ success: true, data: { ...sinBaja, historial: conBaja.historial } });
    render(<BajaAlumnoCard conversionId={7} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Deshacer la baja' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/conversions/7/baja', { data: { nota: null } }));
    expect(await screen.findByText('El alumno sigue en curso.')).toBeInTheDocument();
  });

  it('sin el permiso se ve la baja pero no hay botones', async () => {
    permisos = {};
    get.mockResolvedValue({ success: true, data: conBaja });
    render(<BajaAlumnoCard conversionId={7} />);
    expect(await screen.findByText(/Desistimiento en plazo/, { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /baja/i })).not.toBeInTheDocument();
  });

  it('sin la migración en el servidor no se pinta', async () => {
    get.mockResolvedValue({ success: true, data: { ...sinBaja, disponible: false } });
    const { container } = render(<BajaAlumnoCard conversionId={7} />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
