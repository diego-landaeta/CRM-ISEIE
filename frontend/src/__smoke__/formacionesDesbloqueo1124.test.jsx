// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * CRM#1124 · Formaciones: «se desbloquea a los X días» por módulo (gemelas).
 *   · el formulario: de lo guardado a lo escrito, y solo se manda con la fase 2 encendida;
 *   · la ficha enseña el campo en cada módulo solo si se puede llevar a Moodle, y lo guarda;
 *   · «Crear en Moodle» dice a los cuántos días se abre cada sección y enseña los avisos;
 *   · si un módulo que ya llevó días a Moodle se vacía, no es «desde el principio»: se dice
 *     que se quitará la restricción al llevarlo (y la vista previa lo enseña).
 *
 *   npx vitest run src/__smoke__/formacionesDesbloqueo1124.test.jsx
 */
const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ default: { get, post, put }, API_BASE_URL: '/api', getAccessToken: () => null, setAccessToken: () => {} }));
vi.mock('@/shared/hooks/useToast', () => ({ toast }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: () => true }) }));
vi.mock('@/shared/hooks/useCampusDeLaPantalla', () => ({ useCampusDeLaPantalla: () => ({ id: 1 }) }));
vi.mock('@/modules/products/components/AlumnosDeFormacion', () => ({ default: () => null }));

const { default: FormacionEditorPage } = await import('@/modules/products/pages/FormacionEditorPage');
const { default: LlevarAMoodle } = await import('@/modules/products/components/LlevarAMoodle');
const { datosDeForm, diasDelCursoUnido, formDesde, problemaDelForm } = await import('@/modules/products/lib/formacionForm');

beforeEach(() => { get.mockReset(); post.mockReset(); put.mockReset(); toast.mockReset(); });
afterEach(cleanup);

const formacion = (moodle) => ({
  id: 55, project_id: 1, nombre: 'Máster en Voz', tipo_formacion: 'master', tipo_por_nombre: null,
  horas_totales: 1500, horas_texto: '1500 horas', precio: null, moneda: 'EUR', modalidad: 'Online',
  fecha_inicio: '2027-02-01', fecha_fin: null, fecha_inicio_texto: null, activa: true, de_la_web: false, url_info: null,
  horas_de_los_modulos: 0, tutoras: [], cursos_moodle: [],
  modulos: [
    { id: 1, orden: 0, titulo: 'Fundamentos', descripcion: null, horas: null, dias_desbloqueo: null },
    { id: 2, orden: 1, titulo: 'Práctica', descripcion: null, horas: null, dias_desbloqueo: 7 },
  ],
  moodle,
});

describe('el formulario', () => {
  it('lee los días guardados y solo los manda con la fase 2', () => {
    const f = formDesde(formacion());
    expect(f.modulos.map((m) => m.dias)).toEqual(['', '7']);
    expect(datosDeForm(f).modulos[1]).not.toHaveProperty('dias_desbloqueo');
    f.modulos[0].dias = '0';
    expect(datosDeForm(f, { conDesbloqueo: true }).modulos.map((m) => m.dias_desbloqueo)).toEqual([null, 7]);
  });

  it('dice qué días no valen', () => {
    const f = formDesde(formacion());
    for (const malo of ['2,5', '-3', '3651']) {
      f.modulos[1].dias = malo;
      expect(problemaDelForm(f)).toMatch(/días del módulo 2/);
    }
    f.modulos[1].dias = '30';
    expect(problemaDelForm(f)).toBeNull();
  });
});

const abrirFicha = () => render(
  <MemoryRouter initialEntries={['/productos/formaciones/55?campus=1']}>
    <Routes><Route path="/productos/formaciones/:id" element={<FormacionEditorPage />} /></Routes>
  </MemoryRouter>,
);
const respuestas = (f) => (url) => {
  if (url.startsWith('/products/55/formacion?')) return Promise.resolve({ success: true, data: f });
  if (url.startsWith('/products/55/formacion/moodle')) {
    return Promise.resolve({ success: true, data: { accion: 'crear', nombre: f.nombre, tipo: 'master', inicio: null, fin: null, secciones: [], desbloqueo: [], cursos_unidos: [] } });
  }
  return Promise.resolve({ success: true, data: [] });
};

describe('la ficha de la formación', () => {
  it('con la fase 2: el campo en cada módulo, y se guarda', async () => {
    const f = formacion({ disponible: true, conectado: true });
    get.mockImplementation(respuestas(f));
    put.mockResolvedValue({ success: true, data: f });
    abrirFicha();
    const primero = await screen.findByLabelText('Se desbloquea a los … días, módulo 1');
    expect(primero).toHaveValue(null);
    expect(screen.getByLabelText('Se desbloquea a los … días, módulo 2')).toHaveValue(7);
    expect(screen.getAllByText(/vacío: desde el principio/)).toHaveLength(1);
    fireEvent.change(primero, { target: { value: '14' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const [, cuerpo] = put.mock.calls[0];
    expect(cuerpo.modulos.map((m) => m.dias_desbloqueo)).toEqual([14, 7]);
  });

  it('sin la fase 2 (producción): ni se ve ni se manda', async () => {
    const f = formacion({ disponible: false, conectado: true });
    get.mockImplementation(respuestas(f));
    put.mockResolvedValue({ success: true, data: f });
    abrirFicha();
    const titulo = await screen.findByLabelText('Título del módulo 1');
    expect(screen.queryByLabelText(/Se desbloquea a los/)).toBeNull();
    fireEvent.change(titulo, { target: { value: 'Fundamentos 2' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0][1].modulos.every((m) => !('dias_desbloqueo' in m))).toBe(true);
  });
});

describe('Crear en Moodle', () => {
  it('dice a los cuántos días se abre cada sección y enseña el aviso del plugin', async () => {
    const f = formacion({ disponible: true, conectado: true });
    get.mockResolvedValue({
      success: true,
      data: {
        accion: 'actualizar', nombre: f.nombre, tipo: 'master', inicio: null, fin: null, secciones: ['Fundamentos', 'Práctica'],
        desbloqueo: [null, 7], cursos_unidos: [{ id: 9, nombre: 'Máster en Voz', url: null }],
      },
    });
    post.mockResolvedValue({
      success: true,
      data: { curso: { cursoId: 9, creado: false, visible: false, secciones: [], sobran: 0, avisos: ['El campus no tiene activo el plugin «Fecha relativa»…'] }, formacion: f },
    });
    render(<LlevarAMoodle formacion={{ ...f, cursos_moodle: [{ curso_moodle_id: 9, curso_nombre: 'Máster en Voz' }] }} campusId={1} pendiente={false} alGuardar={() => {}} />);
    expect(await screen.findByText(/se desbloquea a los 7 días/)).toBeInTheDocument();
    expect(screen.getAllByText(/se desbloquea a los/)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Actualizar en Moodle/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Aviso de Moodle', variant: 'warning' })));
  });
});

describe('vaciar los días con el curso ya llevado a Moodle (revisión de Diego)', () => {
  it('la ficha no dice «desde el principio»: dice que se quitará al llevarlo', async () => {
    const f = { ...formacion({ disponible: true, conectado: true }), cursos_moodle: [{ curso_moodle_id: 9, curso_nombre: 'Máster en Voz', dias_secciones: [null, 7] }] };
    get.mockImplementation(respuestas(f));
    abrirFicha();
    const segundo = await screen.findByLabelText('Se desbloquea a los … días, módulo 2');
    expect(screen.queryByText(/se quitará la restricción/)).toBeNull();
    fireEvent.change(segundo, { target: { value: '' } });
    expect(screen.getByText(/Ahora tiene 7 días en Moodle: se quitará la restricción al llevarlo a Moodle/)).toBeInTheDocument();
    // El primero nunca tuvo días en Moodle: ese sí es «desde el principio».
    expect(screen.getAllByText(/vacío: desde el principio/)).toHaveLength(1);
  });

  it('sin curso unido, vaciar es «desde el principio»', () => {
    expect(diasDelCursoUnido({ cursos_moodle: [] })).toEqual([]);
    expect(diasDelCursoUnido({ cursos_moodle: [{ curso_moodle_id: 9, curso_nombre: null, dias_secciones: [null, 7] }] })).toEqual([0, 7]);
  });

  it('la vista previa dice que se quita la restricción', async () => {
    const f = formacion({ disponible: true, conectado: true });
    get.mockResolvedValue({
      success: true,
      data: {
        accion: 'actualizar', nombre: f.nombre, tipo: 'master', inicio: null, fin: null, secciones: ['Fundamentos', 'Práctica'],
        desbloqueo: [null, null], quitar_desbloqueo: [null, 7], cursos_unidos: [{ id: 9, nombre: 'Máster en Voz', url: null }],
      },
    });
    render(<LlevarAMoodle formacion={{ ...f, cursos_moodle: [{ curso_moodle_id: 9, curso_nombre: 'Máster en Voz' }] }} campusId={1} pendiente={false} alGuardar={() => {}} />);
    expect(await screen.findByText(/se quita la restricción de 7 días/)).toBeInTheDocument();
    expect(screen.queryByText(/se desbloquea a los/)).toBeNull();
  });
});
