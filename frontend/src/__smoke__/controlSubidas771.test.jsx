// @vitest-environment jsdom
// ISEIE no tiene un setup común de pruebas: el entorno y la limpieza entre pruebas se ponen aquí.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Control de subidas por curso (#771), en pantalla:
 *   · en la ficha, la lista de tres puntos; quien lleva las subidas los marca,
 *     el resto solo los ve;
 *   · un curso sin lista: quien puede, la abre con un botón;
 *   · en la página, la vista «Control de subidas» solo para quien tiene
 *     «Gestionar colaboraciones», y abre con «Solo atrasadas».
 */

const auth = vi.hoisted(() => ({ valor: { user: { id: 1, role: 'gestor' }, permissions: {} } }));
const api = vi.hoisted(() => ({
  resumen: vi.fn(async () => ({ campus: [], total: { abiertos: 0, retrasados: 0, sin_tutora: 0, alumnas_esperando: 0 }, carga_por_tutora: null, indicadores: null })),
  listar: vi.fn(async () => []),
  controlSubidas: vi.fn(async () => ({ puntos: [], plazo_dias: 7, avisos_activos: false, filas: [] })),
  marcarSubida: vi.fn(async () => []),
  abrirSubidas: vi.fn(async () => ({ creados: 3, subidas: [] })),
}));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ({ activeIssuerId: null }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth.valor }));
vi.mock('@/modules/cursos-pendientes/api/cursosPendientes.api', () => ({ cursosApi: api }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

afterEach(cleanup);

const { default: SubidasDelCurso } = await import('@/modules/cursos-pendientes/components/SubidasDelCurso');
const { default: CursosPendientesPage } = await import('@/modules/cursos-pendientes/pages/CursosPendientesPage');

const punto = (clave, nombre, extra = {}) => ({
  id: nombre.length, curso_id: 9, punto: clave, nombre, fecha_limite: '2026-11-20', hecho: false, hecho_at: null, hecho_por: null,
  enlace: null, nota: null, desde: '2026-11-13T10:00:00Z', atrasado: false, dias_esperando: 4, dias_de_retraso: -3, ...extra,
});
const TRES = [
  punto('videos_youtube', 'Vídeos de los directores en YouTube', { hecho: true, hecho_at: '2026-11-14T10:00:00Z', hecho_por: 'Responsable de subidas' }),
  punto('modulos_moodle', 'Módulos subidos al Moodle', { atrasado: true, dias_de_retraso: 2, fecha_limite: '2026-11-15' }),
  punto('datos_directores_web', 'Datos de los directores enviados para la web'),
];

beforeEach(() => { Object.values(api).forEach((f) => f.mockClear()); });

describe('la lista de subidas en la ficha del curso', () => {
  it('quien lleva las subidas marca un punto', async () => {
    const onCambio = vi.fn();
    render(<SubidasDelCurso cursoId={9} subidas={TRES} puedeMarcar cancelado={false} onCambio={onCambio} />);
    expect(screen.getByText('Subidas de contenido (1/3)')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Módulos subidos al Moodle'));
    await waitFor(() => expect(api.marcarSubida).toHaveBeenCalledWith(9, 'modulos_moodle', { hecho: true }));
    await waitFor(() => expect(onCambio).toHaveBeenCalled());
  });

  it('lo atrasado se dice, con los días de retraso', () => {
    render(<SubidasDelCurso cursoId={9} subidas={TRES} puedeMarcar={false} cancelado={false} onCambio={() => {}} />);
    expect(screen.getByText(/2 d tarde/)).toBeTruthy();
  });

  it('sin el permiso, se ve pero no se marca', () => {
    render(<SubidasDelCurso cursoId={9} subidas={TRES} puedeMarcar={false} cancelado={false} onCambio={() => {}} />);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByText('Módulos subidos al Moodle')).toBeTruthy();
  });

  it('un curso sin lista: quien puede, la abre; quien no, no ve nada', async () => {
    const { container, unmount } = render(<SubidasDelCurso cursoId={9} subidas={[]} puedeMarcar={false} cancelado={false} onCambio={() => {}} />);
    expect(container.textContent).toBe('');
    unmount();
    render(<SubidasDelCurso cursoId={9} subidas={[]} puedeMarcar cancelado={false} onCambio={() => {}} />);
    fireEvent.click(screen.getByText('Abrir la lista de subidas'));
    await waitFor(() => expect(api.abrirSubidas).toHaveBeenCalledWith(9));
  });
});

describe('la vista «Control de subidas» de la página', () => {
  const abrir = () => render(<MemoryRouter><CursosPendientesPage /></MemoryRouter>);

  it('sin «Gestionar colaboraciones» no aparece', async () => {
    auth.valor = { user: { id: 1, role: 'gestor' }, permissions: {} };
    abrir();
    await waitFor(() => expect(api.listar).toHaveBeenCalled());
    expect(screen.queryByText('Control de subidas')).toBeNull();
  });

  it('con el permiso aparece, y abre con «Solo atrasadas»', async () => {
    auth.valor = { user: { id: 2, role: 'gestor' }, permissions: { 'tutores.gestionar': true } };
    abrir();
    fireEvent.click(await screen.findByText('Control de subidas'));
    await waitFor(() => expect(api.controlSubidas).toHaveBeenCalled());
    expect(api.controlSubidas.mock.calls.at(-1)[0]).toMatchObject({ soloAtrasadas: true });
    expect(await screen.findByText('No hay subidas atrasadas')).toBeTruthy();
  });
});

// QA de /testeo del 18/11.
describe('detalles del QA de /testeo del 18/11', () => {
  it('la fecha límite no deja una anterior al día en que se abrió la lista', async () => {
    const { toast } = await import('@/shared/hooks/useToast');
    const conApertura = TRES.map((s) => ({ ...s, abierta_el: '2026-11-13' }));
    render(<SubidasDelCurso cursoId={9} subidas={conApertura} puedeMarcar cancelado={false} onCambio={() => {}} />);
    const fecha = screen.getByLabelText('Fecha límite: Datos de los directores enviados para la web');
    expect(fecha.getAttribute('min')).toBe('2026-11-13');
    fireEvent.change(fecha, { target: { value: '2026-11-05' } });
    fireEvent.blur(fecha);
    expect(api.marcarSubida).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', description: expect.stringMatching(/anterior al día en que se abrió/) }));
    expect(fecha.value).toBe('2026-11-20');
    // El mismo día de la apertura, sí.
    fireEvent.change(fecha, { target: { value: '2026-11-13' } });
    fireEvent.blur(fecha);
    await waitFor(() => expect(api.marcarSubida).toHaveBeenCalledWith(9, 'datos_directores_web', { fecha_limite: '2026-11-13' }));
  });

  it('en el móvil cada curso es una tarjeta con el retraso a la vista', async () => {
    auth.valor = { user: { id: 2, role: 'gestor' }, permissions: { 'tutores.gestionar': true } };
    api.controlSubidas.mockResolvedValueOnce({
      puntos: [], plazo_dias: 7, avisos_activos: false,
      filas: [{ ...TRES[1], curso: 'Máster de prueba', campus: 'Fono Aprende', project_id: 3, estado_curso: 'entregado' }],
    });
    render(<MemoryRouter><CursosPendientesPage /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Control de subidas'));
    const tarjetas = await screen.findByRole('list', { name: 'Subidas pendientes' });
    expect(tarjetas.className).toContain('sm:hidden');
    expect(tarjetas.textContent).toContain('Máster de prueba');
    expect(tarjetas.textContent).toContain('2 d tarde');
  });
});
