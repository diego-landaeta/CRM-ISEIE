// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

/**
 * CRM#1113 / CRM-ISEIE#767 · Formaciones desde el CRM, fase 2 (gemelas):
 *   · la ficha enseña, antes de pulsar «Crear en Moodle», la categoría, el nombre corto,
 *     que nace oculto y una sección por módulo; se pueden cambiar la categoría y el
 *     nombre corto, y es lo que se manda;
 *   · con el curso ya unido, «Actualizar» y el enlace al curso;
 *   · sin el interruptor (o sin permiso) no se pide nada;
 *   · Integraciones › Moodle: la categoría de cada tipo, con las categorías del Moodle.
 *
 *   npx vitest run src/test/formacionesMoodleFase2.test.jsx      (360)
 *   npx vitest run src/__smoke__/formacionesMoodleFase2.test.jsx (ISEIE)
 */
const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ default: { get, post, put }, API_BASE_URL: '/api', getAccessToken: () => null, setAccessToken: () => {} }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

const { default: LlevarAMoodle } = await import('@/modules/products/components/LlevarAMoodle');
const { default: CategoriasFormacionesMoodle } = await import('@/modules/accounting/components/CategoriasFormacionesMoodle');
const { etiquetaDeCategoria, opcionesDeCategoria, problemaDelNombreCorto } = await import('@/modules/products/lib/moodleFormacion');

beforeEach(() => { get.mockReset(); post.mockReset(); put.mockReset(); });
afterEach(cleanup);

const CATEGORIAS = [
  { id: 3, nombre: 'Cursos', ruta: null, cursos: 2 },
  { id: 12, nombre: 'FACULTAD DE MEDICINA', ruta: null, cursos: 51 },
  { id: 17, nombre: 'FACULTAD DE MEDICINA', ruta: null, cursos: 36 },
  { id: 7, nombre: 'Diplomados', ruta: null, cursos: 4 },
];

const FORMACION = {
  id: 55, project_id: 1, nombre: 'Curso de Canto', modulos: [{ id: 1, titulo: 'Respiración' }, { id: 2, titulo: 'Técnica' }],
  cursos_moodle: [], moodle: { disponible: true, conectado: true },
};

const VISTA_CREAR = {
  accion: 'crear', nombre: 'Curso de Canto', tipo: 'curso', inicio: '2027-03-01', fin: null,
  secciones: ['Respiración', 'Técnica'], cursos_unidos: [],
  categoria: { id: 3, nombre: 'Cursos', origen: 'propuesta' }, categorias: CATEGORIAS, fuente_categorias: 'cursos',
  nombre_corto: { valor: 'CUR-CANTO-2027-2', propuesto: 'CUR-CANTO-2027', origen: 'regla', ajustado: true },
  visible: false, aviso: null,
};

describe('cómo se enseñan las categorías', () => {
  it('con el nombre repetido (facultades de ISEIE), el id al lado; la primera opción es la de por defecto', () => {
    expect(etiquetaDeCategoria(CATEGORIAS[1], CATEGORIAS)).toBe('FACULTAD DE MEDICINA (id 12, 51 cursos)');
    expect(etiquetaDeCategoria(CATEGORIAS[0], CATEGORIAS)).toBe('Cursos (2 cursos)');
    expect(opcionesDeCategoria(CATEGORIAS)[0]).toEqual({ value: 0, label: 'La de por defecto del Moodle' });
    expect(problemaDelNombreCorto('x'.repeat(251))).toMatch(/250/);
    expect(problemaDelNombreCorto('CUR-X-2027')).toBeNull();
  });
});

describe('la ficha: qué se va a crear en Moodle', () => {
  it('enseña categoría, nombre corto, oculto y una sección por módulo; manda lo elegido', async () => {
    get.mockResolvedValue({ success: true, data: VISTA_CREAR });
    post.mockResolvedValue({ success: true, data: { curso: { cursoId: 9, nombre: 'Curso de Canto', nombreCorto: 'MIO-1', creado: true, visible: false, secciones: [], sobran: 0 }, formacion: FORMACION } });
    const alGuardar = vi.fn();
    render(<LlevarAMoodle formacion={FORMACION} campusId={1} pendiente={false} alGuardar={alGuardar} />);

    const categoria = await screen.findByLabelText('Categoría');
    expect(get).toHaveBeenCalledWith('/products/55/formacion/moodle?projectId=1');
    expect(categoria).toHaveValue('3');
    expect(screen.getByText(/propuesta por su nombre/)).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre corto')).toHaveValue('CUR-CANTO-2027-2');
    expect(screen.getByText(/«CUR-CANTO-2027» ya existe en el campus/)).toBeInTheDocument();
    expect(screen.getByText(/Oculto a los alumnos/)).toBeInTheDocument();
    expect(screen.getByText('Respiración')).toBeInTheDocument();
    expect(screen.getByText('Técnica')).toBeInTheDocument();

    fireEvent.change(categoria, { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Nombre corto'), { target: { value: ' MIO-1 ' } });
    fireEvent.click(screen.getByRole('button', { name: /Crear en Moodle/ }));
    expect(screen.getByText(/en Diplomados, con el nombre corto «MIO-1» y 2 secciones/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Crear curso' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/products/55/formacion/moodle', { projectId: 1, categoria: 7, nombre_corto: 'MIO-1' }));
    await waitFor(() => expect(alGuardar).toHaveBeenCalledWith(FORMACION));
  });

  it('con el curso unido: «Actualizar», el enlace y sin tocar categoría ni nombre corto', async () => {
    get.mockResolvedValue({
      success: true,
      data: {
        ...VISTA_CREAR, accion: 'actualizar', categoria: null, nombre_corto: null, visible: null, categorias: undefined,
        cursos_unidos: [{ id: 501, nombre: 'Curso de Canto', url: 'https://campus.test/course/view.php?id=501' }],
      },
    });
    post.mockResolvedValue({ success: true, data: { curso: { cursoId: 501, creado: false, visible: false, secciones: [], sobran: 0 }, formacion: FORMACION } });
    render(<LlevarAMoodle formacion={{ ...FORMACION, cursos_moodle: [{ curso_moodle_id: 501, curso_nombre: 'Curso de Canto' }] }} campusId={1} pendiente={false} alGuardar={() => {}} />);
    const enlace = await screen.findByRole('link', { name: /Curso de Canto/ });
    expect(enlace).toHaveAttribute('href', 'https://campus.test/course/view.php?id=501');
    expect(screen.queryByLabelText('Categoría')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Actualizar en Moodle/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/products/55/formacion/moodle', { projectId: 1 }));
  });

  it('con cambios sin guardar no deja pulsar', async () => {
    get.mockResolvedValue({ success: true, data: VISTA_CREAR });
    render(<LlevarAMoodle formacion={FORMACION} campusId={1} pendiente alGuardar={() => {}} />);
    await screen.findByLabelText('Categoría');
    expect(screen.getByRole('button', { name: /Crear en Moodle/ })).toBeDisabled();
    expect(screen.getByText('Guarda antes los cambios.')).toBeInTheDocument();
  });

  it('sin el interruptor o sin permiso, nada: ni se pregunta al servidor', () => {
    const { container } = render(<LlevarAMoodle formacion={{ ...FORMACION, moodle: { disponible: false, conectado: true } }} campusId={1} pendiente={false} alGuardar={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    expect(get).not.toHaveBeenCalled();
  });
});

describe('Integraciones › Moodle: la categoría de cada tipo', () => {
  it('lee las categorías del Moodle, enseña lo guardado y guarda lo elegido', async () => {
    get.mockResolvedValue({
      success: true,
      data: {
        fuente: 'cursos', categorias: CATEGORIAS,
        propuesta: { curso: { id: 3, nombre: 'Cursos' }, diplomado: { id: 7, nombre: 'Diplomados' }, master: null },
        guardadas: { master: 0 },
        efectivas: {},
      },
    });
    put.mockResolvedValue({ success: true, data: { guardadas: {} } });
    render(<CategoriasFormacionesMoodle projectId={4} />);
    expect(get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Ver las categorías del Moodle/ }));

    const cursos = await screen.findByLabelText('Categoría para cursos');
    expect(get).toHaveBeenCalledWith('/integrations/moodle/categorias?projectId=4');
    expect(cursos).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Proponer por el nombre (ahora: Cursos)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Categoría para másteres')).toHaveValue('0');
    expect(screen.getAllByRole('option', { name: 'FACULTAD DE MEDICINA (id 17, 36 cursos)' })).toHaveLength(3);

    fireEvent.change(screen.getByLabelText('Categoría para diplomados'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar categorías/ }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/integrations/moodle/categorias', {
      projectId: 4, categorias: { curso: null, diplomado: 12, master: 0 },
    }));
  });
});
