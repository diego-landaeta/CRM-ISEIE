// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';

/**
 * El avance en Moodle en la ficha del cliente (#532):
 *   · un curso sin finalización dice «Sin seguimiento», no «0 %»;
 *   · el estado sale con su texto (terminado, sin acceso desde hace N días, nunca, activo);
 *   · la nota final y las de cada actividad; el aviso del plugin viejo; el error del campus;
 *   · el hook pide `/leads/:id/campus` y «Actualizar» lo pide con `refrescar`.
 *
 *   npx vitest run src/__smoke__/avanceMoodleFicha532.test.jsx (gemela de CRM#871)
 */
const get = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ default: { get, post: vi.fn() }, API_BASE_URL: '/api', getAccessToken: () => null, setAccessToken: () => {} }));

const { default: AvanceMoodleBloque } = await import('@/modules/clients/components/AvanceMoodle');
const { useAvanceMoodle } = await import('@/modules/clients/hooks/useAvanceMoodle');

afterEach(cleanup);

const hace = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
const curso = (x) => ({
  url: `https://campus.test/course/view.php?id=${x.id}`, matriculadoEl: null, ultimoAcceso: hace(2), seguimiento: true,
  progreso: 0, terminado: false, estado: 'activo', diasSinAcceso: 2, notas: null, errorNotas: null, ...x,
});
const DATOS = {
  disponible: true,
  diasSinAccesoMaximos: 14,
  campus: [
    {
      projectId: 1, campus: 'Campus A', campusUrl: 'https://campus.test', error: null, avisoNotas: null,
      alumno: { moodleId: 900, suspendido: false, ultimoAcceso: hace(1), perfilUrl: 'https://campus.test/user/profile.php?id=900' },
      cursos: [
        curso({
          id: 30, nombre: 'Curso con seguimiento', progreso: 40, matriculadoEl: '2026-09-15',
          notas: { final: { nota: 8, texto: '8,00', maxima: 10, porcentaje: null }, actividades: [{ id: 1, nombre: 'Tarea 1', tipo: 'assign', nota: 8, texto: '8,00', maxima: 10, porcentaje: null }] },
        }),
        curso({ id: 31, nombre: 'Curso sin seguimiento', seguimiento: false, progreso: null, estado: 'sin_acceso', diasSinAcceso: 30, ultimoAcceso: hace(30) }),
        curso({ id: 32, nombre: 'Curso terminado', progreso: 100, terminado: true, estado: 'terminado', diasSinAcceso: null }),
        curso({ id: 33, nombre: 'Curso sin entrar', estado: 'sin_acceso', diasSinAcceso: null, ultimoAcceso: null }),
      ],
    },
    { projectId: 2, campus: 'Campus B', campusUrl: null, alumno: null, error: 'El token del campus no vale (caducado o mal copiado).', avisoNotas: null, cursos: [] },
  ],
};

const fila = (nombre) => screen.getByText(nombre).closest('li');

describe('#532 · el bloque «Campus» de la ficha', () => {
  it('cada curso con su %, su estado en texto, la fecha de matrícula y las notas', () => {
    render(<AvanceMoodleBloque datos={DATOS} cargando={false} error={null} onActualizar={() => {}} />);
    expect(within(fila('Curso con seguimiento')).getByText('40%')).toBeTruthy();
    expect(within(fila('Curso con seguimiento')).getByText('Activo')).toBeTruthy();
    expect(within(fila('Curso con seguimiento')).getByText(/Nota final/).closest('p').textContent).toMatch(/8,00\s*\/\s*10/);
    expect(within(fila('Curso con seguimiento')).getByText(/Notas por actividad \(1\)/)).toBeTruthy();
    expect(within(fila('Curso con seguimiento')).getByText(/15\/09\/2026|15 sept|2026-09-15/)).toBeTruthy();
    // Sin finalización: «Sin seguimiento», nunca «0 %».
    expect(within(fila('Curso sin seguimiento')).getByText('Sin seguimiento')).toBeTruthy();
    expect(within(fila('Curso sin seguimiento')).queryByText('0%')).toBeNull();
    expect(within(fila('Curso sin seguimiento')).getByText('Sin acceso desde hace 30 días')).toBeTruthy();
    expect(within(fila('Curso terminado')).getByText('Terminado')).toBeTruthy();
    expect(within(fila('Curso sin entrar')).getAllByText('Nunca ha entrado').length).toBeGreaterThan(0);
    // Un campus que no contesta lo dice y no tapa a los demás.
    expect(screen.getByText(/El token del campus no vale/)).toBeTruthy();
  });

  it('sin campus conectado, lo dice; cargando, no enseña datos viejos de nada', () => {
    const { rerender } = render(<AvanceMoodleBloque datos={{ disponible: true, campus: [] }} cargando={false} error={null} onActualizar={() => {}} />);
    expect(screen.getByText('Sin campus conectado')).toBeTruthy();
    rerender(<AvanceMoodleBloque datos={null} cargando error={null} onActualizar={() => {}} />);
    expect(screen.getByText('Leyendo el campus…')).toBeTruthy();
  });

  it('el hook pide /leads/:id/campus y «Actualizar» lo vuelve a pedir con refrescar', async () => {
    get.mockResolvedValue({ success: true, data: DATOS });
    function Ficha() {
      const a = useAvanceMoodle(7);
      return <AvanceMoodleBloque datos={a.datos} cargando={a.cargando} error={a.error} onActualizar={a.actualizar} />;
    }
    render(<Ficha />);
    await waitFor(() => expect(screen.getByText('Campus A')).toBeTruthy());
    expect(get).toHaveBeenCalledWith('/leads/7/campus', { params: undefined });
    fireEvent.click(screen.getByRole('button', { name: /Actualizar/ }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/leads/7/campus', { params: { refrescar: 1 } }));
  });
});
