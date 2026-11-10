// @vitest-environment jsdom
// Traída de MultiCRM (2.6.0). ISEIE no tiene un setup común de pruebas: el entorno,
// los matchers de jest-dom y la limpieza entre pruebas se ponen aquí.
import '@testing-library/jest-dom/vitest';
import { afterEach as despuesDeCada } from 'vitest';
import { cleanup as limpiar } from '@testing-library/react';

despuesDeCada(limpiar);
if (typeof window !== 'undefined') {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia ??= () => ({ matches: false, media: '', onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// «Pregunta a tus datos» (#30).
//
// Lo que se fija es lo que la pantalla tiene que HACER con la honestidad del
// servidor: no basta con que el servidor marque una cifra como sin comprobar si
// la pantalla la enseña igual que las demas. Y que un «no tengo ese dato» se vea
// como lo que es, no como una respuesta.

const preguntar = vi.fn();
vi.mock('@/modules/ia-analisis/api/preguntar.api', () => {
  class FalloIA extends Error {
    constructor(m, codigo) { super(m); this.codigo = codigo; }
  }
  return { preguntar: (...a) => preguntar(...a), FalloIA };
});

const contexto = { activeProject: { id: 3, nombre: 'ISEIH' }, activeIssuerId: null };
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => contexto }));

import PreguntarPage from '@/modules/ia-analisis/pages/PreguntarPage';
import { FalloIA } from '@/modules/ia-analisis/api/preguntar.api';

const RESPUESTA = {
  respuesta: 'En julio de 2026 se cobraron 12.345,67 € de 120 prospectos.',
  sinDatos: false,
  verificada: true,
  cifrasSinComprobar: [],
  desglose: [
    {
      consulta: 'resumen_general',
      parametros: { from: '2026-07-01', to: '2026-07-31', projectId: 3 },
      datos: { cobrado: 12345.67 },
    },
    {
      consulta: 'ventas_por_asesora',
      parametros: { projectIds: [1, 2] },
      datos: [{ asesora: 'Laura', importe: 500 }, { asesora: 'Ana', importe: 700 }],
    },
  ],
  gasto: { porcentaje: 10, cerca: false, queda: 18, tope: 20, gastado: 2 },
};

const escribir = (texto) => fireEvent.change(screen.getByLabelText('Tu pregunta'), { target: { value: texto } });
const enviar = () => fireEvent.click(screen.getByRole('button', { name: /Preguntar/ }));

beforeEach(() => {
  preguntar.mockReset().mockResolvedValue(RESPUESTA);
  contexto.activeProject = { id: 3, nombre: 'ISEIH' };
  contexto.activeIssuerId = null;
});

describe('el formulario', () => {
  it('no deja preguntar con menos de tres letras ni vacia', () => {
    render(<PreguntarPage />);
    const boton = screen.getByRole('button', { name: /Preguntar/ });
    expect(boton).toBeDisabled();
    escribir('ab');
    expect(boton).toBeDisabled();
    escribir('   ');
    expect(boton).toBeDisabled();
    escribir('¿cuánto se cobró?');
    expect(boton).toBeEnabled();
  });

  it('un ejemplo rellena la pregunta', () => {
    render(<PreguntarPage />);
    fireEvent.click(screen.getByRole('button', { name: /Cuánto se cobró el mes pasado/ }));
    expect(screen.getByLabelText('Tu pregunta')).toHaveValue('¿Cuánto se cobró el mes pasado?');
  });

  it('dice con los datos de quien se contesta', () => {
    render(<PreguntarPage />);
    expect(screen.getByText(/datos de ISEIH/)).toBeInTheDocument();
  });

  it('con una empresa elegida, lo dice; sin nada, habla de todos sus campus', () => {
    contexto.activeIssuerId = 7;
    const { unmount } = render(<PreguntarPage />);
    expect(screen.getByText(/la empresa elegida/)).toBeInTheDocument();
    unmount();

    contexto.activeIssuerId = null;
    contexto.activeProject = { id: -1, nombre: 'Todos' };
    render(<PreguntarPage />);
    expect(screen.getByText(/todos tus campus/)).toBeInTheDocument();
  });
});

describe('al preguntar', () => {
  it('manda la pregunta y el alcance elegido, y enseña la respuesta', async () => {
    render(<PreguntarPage />);
    escribir('¿cuánto se cobró en julio?');
    enviar();

    expect(await screen.findByText(/12\.345,67 €/)).toBeInTheDocument();
    expect(preguntar).toHaveBeenCalledWith('¿cuánto se cobró en julio?', { projectId: 3, issuerId: null });
  });

  it('con «Todos los proyectos» no manda ningun proyecto: lo decide el servidor', async () => {
    contexto.activeProject = { id: -1, nombre: 'Todos' };
    render(<PreguntarPage />);
    escribir('¿cuánto se cobró en julio?');
    enviar();
    await screen.findByText(/12\.345,67 €/);
    expect(preguntar).toHaveBeenCalledWith('¿cuánto se cobró en julio?', { projectId: null, issuerId: null });
  });

  it('Ctrl+Enter tambien pregunta', async () => {
    render(<PreguntarPage />);
    escribir('¿cuánto se cobró en julio?');
    fireEvent.keyDown(screen.getByLabelText('Tu pregunta'), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(preguntar).toHaveBeenCalledTimes(1));
  });

  it('mientras contesta no se puede preguntar otra vez', async () => {
    let resolver;
    preguntar.mockReturnValue(new Promise((r) => { resolver = r; }));
    render(<PreguntarPage />);
    escribir('¿cuánto se cobró en julio?');
    enviar();

    expect(await screen.findByRole('button', { name: /Consultando/ })).toBeDisabled();
    resolver(RESPUESTA);
    await screen.findByText(/12\.345,67 €/);
  });
});

describe('lo que dice de la respuesta', () => {
  it('verificada: dice que cada cifra sale de los datos', async () => {
    render(<PreguntarPage />);
    escribir('¿cuánto se cobró en julio?');
    enviar();
    expect(await screen.findByText(/Cada cifra de la respuesta sale de los datos/)).toBeInTheDocument();
  });

  it('con cifras sin comprobar, las ENSEÑA marcadas y no dice que esta verificada', async () => {
    preguntar.mockResolvedValue({ ...RESPUESTA, verificada: false, cifrasSinComprobar: ['4.321', '17,5'] });
    render(<PreguntarPage />);
    escribir('¿cuánto se cobró en julio?');
    enviar();

    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent('4.321, 17,5');
    expect(aviso).toHaveTextContent(/no salen directamente de los datos/);
    expect(screen.queryByText(/Cada cifra de la respuesta sale de los datos/)).not.toBeInTheDocument();
  });

  it('«no tengo ese dato» se ve como aviso neutro, sin sello de verificada', async () => {
    preguntar.mockResolvedValue({
      respuesta: 'No tengo ese dato. Las consultas que puedo hacer son…',
      sinDatos: true, verificada: false, cifrasSinComprobar: [], desglose: [],
    });
    render(<PreguntarPage />);
    escribir('¿qué campaña rinde mejor?');
    enviar();

    expect(await screen.findByText(/No tengo ese dato/)).toBeInTheDocument();
    expect(screen.queryByText(/Cada cifra de la respuesta/)).not.toBeInTheDocument();
    expect(screen.queryByText(/De dónde sale/)).not.toBeInTheDocument();
  });

  it('avisa cuando el gasto del mes esta cerca del tope', async () => {
    preguntar.mockResolvedValue({ ...RESPUESTA, gasto: { porcentaje: 85, cerca: true, queda: 3, tope: 20, gastado: 17 } });
    render(<PreguntarPage />);
    escribir('¿cuánto se cobró en julio?');
    enviar();
    expect(await screen.findByText(/Llevas el 85 % del tope de gasto en IA de este mes \(quedan 3 USD\)/)).toBeInTheDocument();
  });
});

describe('el desglose', () => {
  it('enseña cada consulta con los parametros que se usaron de verdad', async () => {
    render(<PreguntarPage />);
    escribir('¿cuánto se cobró en julio?');
    enviar();

    expect(await screen.findByText('De dónde sale')).toBeInTheDocument();
    expect(screen.getByText('Resumen del periodo')).toBeInTheDocument();
    expect(screen.getByText('Ventas por asesora')).toBeInTheDocument();
    expect(screen.getByText(/from = 2026-07-01 · to = 2026-07-31 · projectId = 3/)).toBeInTheDocument();
    // La lista de campus aparece escrita, no como [object Object].
    expect(screen.getByText(/projectIds = 1, 2/)).toBeInTheDocument();
  });

  it('una lista de filas se pinta como tabla', async () => {
    render(<PreguntarPage />);
    escribir('¿cuánto se cobró en julio?');
    enviar();
    await screen.findByText('De dónde sale');

    expect(screen.getByRole('columnheader', { name: 'asesora' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Laura' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '700' })).toBeInTheDocument();
  });
});

describe('cuando falla', () => {
  it.each([
    ['TOPE', 'Se alcanzó el tope de gasto en IA de este mes.'],
    ['SIN_CLAVE', 'Falta la clave de Anthropic.'],
    ['IA_NO_RESPONDE', 'La IA no ha respondido.'],
    ['RATE_LIMITED', 'Demasiadas preguntas seguidas. Espera un minuto.'],
  ])('%s: enseña el mensaje del servidor', async (codigo, mensaje) => {
    preguntar.mockRejectedValue(new FalloIA(mensaje, codigo));
    render(<PreguntarPage />);
    escribir('¿cuánto se cobró en julio?');
    enviar();

    expect(await screen.findByRole('alert')).toHaveTextContent(mensaje);
    // Y se puede volver a intentar.
    expect(screen.getByRole('button', { name: /Preguntar/ })).toBeEnabled();
  });

  it('una pregunta anterior no se queda al lado de un error', async () => {
    render(<PreguntarPage />);
    escribir('¿cuánto se cobró en julio?');
    enviar();
    await screen.findByText(/12\.345,67 €/);

    preguntar.mockRejectedValue(new FalloIA('La IA no ha respondido.', 'IA_NO_RESPONDE'));
    escribir('otra pregunta distinta');
    enviar();

    await screen.findByRole('alert');
    expect(screen.queryByText(/12\.345,67 €/)).not.toBeInTheDocument();
  });
});
