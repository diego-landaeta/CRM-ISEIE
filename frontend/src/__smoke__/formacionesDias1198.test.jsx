// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

/**
 * CRM-ISEIE#832 (gemela de CRM#1198) · Formaciones: los días de «se desbloquea» de cada módulo, comprobados contra Moodle.
 *   · el texto del aviso: distintos, faltan en Moodle, puestos allí a mano, desde la matrícula;
 *   · la vista previa avisa en color de aviso en el módulo que no coincide, y no repite
 *     «se quita la restricción» si el aviso ya lo dice;
 *   · si coinciden, o el servidor no lo sabe (plugin anterior), no se enseña nada;
 *   · solo lee: abrir la ficha no lleva nada a Moodle.
 *
 *   npx vitest run src/__smoke__/formacionesDias1198.test.jsx
 */
const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ default: { get, post, put: vi.fn() }, API_BASE_URL: '/api', getAccessToken: () => null, setAccessToken: () => {} }));
vi.mock('@/shared/hooks/useToast', () => ({ toast }));

const { default: LlevarAMoodle } = await import('@/modules/products/components/LlevarAMoodle');
const { textoDelDesbloqueoDistinto } = await import('@/modules/products/lib/moodleFormacion');

beforeEach(() => { get.mockReset(); post.mockReset(); toast.mockReset(); });
afterEach(cleanup);

const formacion = {
  id: 55, project_id: 1, nombre: 'Máster en Voz', tipo_formacion: 'master', tipo_por_nombre: null,
  horas_totales: 1500, horas_texto: null, precio: null, moneda: 'EUR', modalidad: 'Online',
  fecha_inicio: '2027-02-01', fecha_fin: null, fecha_inicio_texto: null, activa: true, de_la_web: false, url_info: null,
  horas_de_los_modulos: 0, tutoras: [],
  cursos_moodle: [{ curso_moodle_id: 9, curso_nombre: 'Máster en Voz', dias_secciones: [null, 7, 30] }],
  modulos: [
    { id: 1, orden: 0, titulo: 'Fundamentos', descripcion: null, horas: null, dias_desbloqueo: null },
    { id: 2, orden: 1, titulo: 'Práctica', descripcion: null, horas: null, dias_desbloqueo: 30 },
    { id: 3, orden: 2, titulo: 'Final', descripcion: null, horas: null, dias_desbloqueo: 45 },
  ],
  moodle: { disponible: true, conectado: true },
};
const vista = (extra) => ({
  success: true,
  data: {
    accion: 'actualizar', nombre: formacion.nombre, tipo: 'master', inicio: null, fin: null,
    secciones: ['Fundamentos', 'Práctica', 'Final'], desbloqueo: [null, 30, 45], quitar_desbloqueo: [null, null, null],
    cursos_unidos: [{ id: 9, nombre: 'Máster en Voz', url: null }], ...extra,
  },
});
const abrir = () => render(<LlevarAMoodle formacion={formacion} campusId={1} pendiente={false} alGuardar={() => {}} />);

describe('el texto del aviso', () => {
  it('distintos, como lo pide la issue', () => {
    expect(textoDelDesbloqueoDistinto({ posicion: 1, modulo: 'X', en_moodle: 15, desde_moodle: 1, aqui: 30 }))
      .toBe('En Moodle tiene 15 días; aquí, 30. Al llevarlo a Moodle se pondrán 30.');
  });

  it('faltan en Moodle, puestos allí a mano, y desde la matrícula', () => {
    expect(textoDelDesbloqueoDistinto({ posicion: 0, modulo: 'X', en_moodle: null, desde_moodle: null, aqui: 1 }))
      .toBe('En Moodle no tiene «se desbloquea»; aquí, 1 día. Al llevarlo a Moodle se pondrán 1.');
    expect(textoDelDesbloqueoDistinto({ posicion: 0, modulo: 'X', en_moodle: 12, desde_moodle: 1, aqui: null }))
      .toBe('En Moodle tiene 12 días; aquí, desde el principio. Al llevarlo a Moodle se quitará la restricción.');
    expect(textoDelDesbloqueoDistinto({ posicion: 0, modulo: 'X', en_moodle: 7, desde_moodle: 3, aqui: 7 }))
      .toBe('En Moodle tiene 7 días desde la matrícula; aquí, desde el inicio del curso. Al llevarlo a Moodle se contarán desde el inicio.');
    expect(textoDelDesbloqueoDistinto({ posicion: 0, modulo: 'X', en_moodle: 7, desde_moodle: 3, aqui: 10 }))
      .toBe('En Moodle tiene 7 días desde la matrícula; aquí, 10. Al llevarlo a Moodle se pondrán 10.');
  });
});

describe('la vista previa del curso unido', () => {
  it('avisa en color de aviso en el módulo que no coincide', async () => {
    get.mockResolvedValue(vista({
      desbloqueo_distinto: [
        { posicion: 1, modulo: 'Práctica', en_moodle: 15, desde_moodle: 1, aqui: 30 },
        { posicion: 2, modulo: 'Final', en_moodle: null, desde_moodle: null, aqui: 45 },
      ],
    }));
    abrir();
    const aviso = await screen.findByText('En Moodle tiene 15 días; aquí, 30. Al llevarlo a Moodle se pondrán 30.');
    expect(aviso).toHaveClass('text-warning');
    expect(aviso.closest('li')).toHaveTextContent(/^Práctica/);
    expect(screen.getByText(/En Moodle no tiene «se desbloquea»; aquí, 45 días/).closest('li')).toHaveTextContent(/^Final/);
    expect(screen.getByTestId('moodle-desbloqueo-distinto')).toHaveTextContent('En Moodle, 2 módulos tienen otros días');
    // Solo lee: abrir la ficha no lleva nada a Moodle.
    expect(post).not.toHaveBeenCalled();
  });

  it('puestos a mano donde aquí no hay: un solo aviso, sin repetir «se quita la restricción»', async () => {
    get.mockResolvedValue(vista({
      quitar_desbloqueo: [12, null, null],
      desbloqueo_distinto: [{ posicion: 0, modulo: 'Fundamentos', en_moodle: 12, desde_moodle: 1, aqui: null }],
    }));
    abrir();
    expect(await screen.findByText(/En Moodle tiene 12 días; aquí, desde el principio/)).toBeInTheDocument();
    expect(screen.queryByText(/se quita la restricción de 12 días/)).toBeNull();
    expect(screen.getByTestId('moodle-desbloqueo-distinto')).toHaveTextContent('En Moodle, un módulo tiene otros días');
  });

  it('si coinciden, no se enseña nada', async () => {
    get.mockResolvedValue(vista({ desbloqueo_distinto: [] }));
    abrir();
    expect(await screen.findByText(/se desbloquea a los 30 días/)).toBeInTheDocument();
    expect(screen.queryByTestId('moodle-desbloqueo-distinto')).toBeNull();
    expect(screen.queryByText(/En Moodle tiene/)).toBeNull();
  });

  it('un servidor sin la comprobación (o un plugin anterior): nada, y no falla', async () => {
    get.mockResolvedValue(vista({}));
    abrir();
    expect(await screen.findByText(/se desbloquea a los 45 días/)).toBeInTheDocument();
    expect(screen.queryByTestId('moodle-desbloqueo-distinto')).toBeNull();
  });
});
