// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

/*
  «Tutor» (nuevo tutor, datos del tutor, añadir y editar formación) con las
  piezas comunes (#106), como en MultiCRM: no había ni Field ni la clase
  común, la fila de «Sus cursos» no se apilaba en el móvil (cuatro columnas
  fijas) y las ayudas iban a 11 px.
*/

vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'superadmin' } }) }));
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({ activeProject: { id: 1 }, projects: [{ id: 1, nombre: 'ISEIE' }] }),
}));
vi.mock('@/shared/api/client', () => ({
  default: {
    // Un curso en el catálogo, para elegirlo en «Añadir formación».
    get: vi.fn((url) => Promise.resolve({ success: true, data: String(url).startsWith('/products') ? [{ id: 11, nombre: 'Curso Prueba', precio: 100 }] : [] })),
  },
}));
vi.mock('@/modules/tutores/components/Entregables', () => ({ default: () => null }));
vi.mock('@/modules/tutores/api/tutores.api', () => ({
  tutoresApi: {
    listar: vi.fn().mockResolvedValue({ success: true, data: [
      { id: 3, nombre: 'Tutora Prueba', email: 'tutora@prueba.local', iban: 'ES00', banco: 'BBVA', dni_nif: '1', telefono: '1', active: true, es_de_este_proyecto: true, formaciones: 0 },
    ] }),
    colaboraciones: vi.fn().mockResolvedValue({ success: true, data: [] }),
    ajustes: vi.fn().mockResolvedValue({ success: true, data: { aplica_desde: '2026-08-01', pct_por_defecto: 10 } }),
    alta: vi.fn().mockResolvedValue({ success: false, error: 'no' }),
    crearColaboracion: vi.fn().mockResolvedValue({ success: false, error: 'no' }),
    editarColaboracion: vi.fn().mockResolvedValue({ success: false }),
  },
}));

import TutoresPage from '@/modules/tutores/pages/TutoresPage';
import { toast } from '@/shared/hooks/useToast';
import { tutoresApi } from '@/modules/tutores/api/tutores.api';

const esperar = () => act(async () => { await new Promise((ok) => setTimeout(ok, 0)); });
const abrirPagina = async () => {
  const r = render(<TutoresPage />);
  await esperar();
  return r;
};
const elegirTutora = async () => {
  fireEvent.click(screen.getByText('Tutora Prueba'));
  await esperar();
};

describe('Tutor (#106)', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => cleanup());

  it('nuevo tutor: cada campo con el Field común, enlazado, y con la clase común', async () => {
    await abrirPagina();
    fireEvent.click(screen.getByRole('button', { name: /Nuevo tutor/ }));
    for (const nombre of [/^Nombre y apellidos/, /^Correo/, 'DNI / NIF', 'Teléfono', 'IBAN', /^Contraseña/, '%', 'Lo lleva desde']) {
      expect(screen.getByLabelText(nombre).className).toMatch(/bg-muted\/50/);
    }
    expect(screen.getAllByText('(obligatorio)').length).toBeGreaterThanOrEqual(2);
  });

  // Visto en la prueba a mano: la contraseña no tenía etiqueta, solo el título
  // «Cómo entra» y el texto gris de ejemplo. Ahora es un campo como los demás.
  it('nuevo tutor: la contraseña con su etiqueta y la ayuda debajo, sin «Cómo entra»', async () => {
    await abrirPagina();
    fireEvent.click(screen.getByRole('button', { name: /Nuevo tutor/ }));
    const clave = screen.getByLabelText(/^Contraseña/);
    expect(clave.id).toBe('alta-clave');
    expect(document.querySelector('label[for="alta-clave"]').textContent).toMatch(/^Contraseña/);
    expect(clave.closest('div.min-w-0').textContent).toMatch(/Cópiala|correo|Con contraseña/);
    expect(screen.queryByText('Cómo entra')).toBeNull();
    // Tampoco dentro de una frase (el texto de debajo del título lo decía).
    expect(screen.queryByText(/cómo entra/i)).toBeNull();
  });

  it('nuevo tutor: la fila de «Sus cursos» se apila en el móvil', async () => {
    await abrirPagina();
    fireEvent.click(screen.getByRole('button', { name: /Nuevo tutor/ }));
    const fila = screen.getByLabelText('%').closest('div.min-w-0').parentElement;
    expect(fila.className).toMatch(/grid-cols-2 sm:grid-cols-\[/);
  });

  it('datos del tutor: el Field común, la ayuda con su campo y «Cobra desde» igual', async () => {
    await abrirPagina();
    await elegirTutora();
    fireEvent.click(screen.getByRole('button', { name: /Editar datos/ }));
    for (const nombre of ['Nombre', 'DNI / NIF', 'Teléfono', 'IBAN', 'Banco', 'Correo', 'Cobra desde']) {
      expect(screen.getByLabelText(nombre).className).toMatch(/bg-muted\/50/);
    }
    expect(screen.getByLabelText('IBAN').closest('div.min-w-0').textContent).toMatch(/Los espacios se quitan solos/);
  });

  it('añadir formación: porcentaje y fechas con el Field común, en fila que se apila', async () => {
    await abrirPagina();
    await elegirTutora();
    fireEvent.click(screen.getByRole('button', { name: /Añadir formación/ }));
    const pct = screen.getByLabelText(/^Porcentaje/);
    expect(pct.className).toMatch(/bg-muted\/50/);
    expect(screen.getByLabelText('Hasta').className).toMatch(/bg-muted\/50/);
    expect(pct.closest('div.min-w-0').parentElement.className).toMatch(/grid-cols-1 sm:grid-cols-3/);
  });
});

// Visto en la prueba de ISEIE: Escape solo cerraba «Nuevo tutor» y «Añadir
// formación»; «Editar datos» o «Retirar» se quedaban abiertas.
describe('Tutor: Escape cierra cada ventana (#106)', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => cleanup());
  for (const boton of [/Nuevo tutor/, /Editar datos/, /^Retirar/, /Añadir formación/]) {
    it(`«${boton.source.replace(/[\^\\/]/g, '')}»`, async () => {
      await abrirPagina();
      if (!/Nuevo/.test(boton.source)) await elegirTutora();
      fireEvent.click(screen.getAllByRole('button', { name: boton })[0]);
      expect(document.querySelector('div.fixed.inset-0')).not.toBeNull();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(document.querySelector('div.fixed.inset-0')).toBeNull();
    });
  }
});

// Visto en la prueba a mano de la #106: el globo «Rellene este campo» del
// navegador. Ahora avisa el CRM, comprobando lo mismo que comprobaba el navegador.
describe('Tutor: avisa el CRM, no el navegador (#106)', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => cleanup());
  const aviso = (title) => expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ title, variant: 'destructive' }));
  const lista = () => toast.mock.calls.at(-1)[0].description;
  const enviar = async (campo) => { await act(async () => { fireEvent.submit(campo.closest('form')); }); };
  const escribir = (campo, value) => fireEvent.change(campo, { target: { value } });

  it('nuevo tutor: sin nombre, sin correo bueno, sin contraseña o con el % fuera de 0-100, no se da de alta', async () => {
    await abrirPagina();
    fireEvent.click(screen.getByRole('button', { name: /Nuevo tutor/ }));
    const nombre = screen.getByLabelText(/^Nombre y apellidos/);
    expect(nombre.closest('form').noValidate).toBe(true);
    // Todo vacío: todo lo que falta, en un solo aviso (#106).
    escribir(screen.getByLabelText(/^Contraseña/), '');
    await enviar(nombre);
    aviso('Faltan datos');
    expect(lista()).toBe('Falta el nombre en «Nombre y apellidos», el correo en «Correo» y la contraseña (escríbela o pulsa «Generar»).');
    // Si solo falta una cosa, su aviso de siempre.
    escribir(screen.getByLabelText(/^Contraseña/), 'larga-de-sobra');
    escribir(screen.getByLabelText(/^Correo/), 'ana@prueba.local');
    await enviar(nombre);
    aviso('Falta el nombre');
    escribir(nombre, 'Ana Tutora');
    escribir(screen.getByLabelText(/^Correo/), '');
    await enviar(nombre);
    aviso('Falta el correo');
    escribir(screen.getByLabelText(/^Correo/), 'ana@');
    await enviar(nombre);
    aviso('Correo no válido');
    // Lo mal escrito también va en la misma lista.
    escribir(screen.getByLabelText(/^Contraseña/), 'corta');
    escribir(screen.getByLabelText('%'), '150');
    await enviar(nombre);
    aviso('Faltan datos');
    expect(lista()).toBe('Falta un correo válido en «Correo» (nombre@dominio.com), una contraseña de al menos 8 caracteres y un % del curso de 0 a 100.');
    escribir(screen.getByLabelText('%'), '');
    escribir(screen.getByLabelText(/^Correo/), 'ana@prueba.local');
    // Sin correos a tutores, la contraseña es obligatoria (required={sinCorreos}).
    escribir(screen.getByLabelText(/^Contraseña/), '');
    await enviar(nombre);
    aviso('Falta la contraseña');
    escribir(screen.getByLabelText(/^Contraseña/), 'corta');
    await enviar(nombre);
    aviso('Contraseña demasiado corta');
    escribir(screen.getByLabelText(/^Contraseña/), 'larga-de-sobra');
    for (const malo of ['150', '-1', '7.3']) {
      escribir(screen.getByLabelText('%'), malo);
      await enviar(nombre);
      aviso('Porcentaje no válido');
    }
    expect(tutoresApi.alta).not.toHaveBeenCalled();
  });

  it('nuevo tutor: con todo bien, se da de alta como antes (el % vacío tampoco lo paraba)', async () => {
    await abrirPagina();
    fireEvent.click(screen.getByRole('button', { name: /Nuevo tutor/ }));
    escribir(screen.getByLabelText(/^Nombre y apellidos/), 'Ana Tutora');
    escribir(screen.getByLabelText(/^Correo/), 'ana@prueba.local');
    escribir(screen.getByLabelText('%'), '');
    await enviar(screen.getByLabelText(/^Nombre y apellidos/));
    expect(tutoresApi.alta).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Ana Tutora', email: 'ana@prueba.local' }));
  });

  it('nuevo tutor: el % del curso con algo que no es un número va en el aviso', async () => {
    await abrirPagina();
    fireEvent.click(screen.getByRole('button', { name: /Nuevo tutor/ }));
    escribir(screen.getByLabelText(/^Nombre y apellidos/), 'Ana Tutora');
    escribir(screen.getByLabelText(/^Correo/), 'ana@prueba.local');
    Object.defineProperty(screen.getByLabelText('%'), 'validity', { value: { badInput: true } });
    await enviar(screen.getByLabelText(/^Nombre y apellidos/));
    aviso('Número no válido');
    expect(tutoresApi.alta).not.toHaveBeenCalled();
  });

  it('añadir formación: el porcentaje de 0 a 100 (con medios) y la fecha «Desde»', async () => {
    await abrirPagina();
    await elegirTutora();
    fireEvent.click(screen.getByRole('button', { name: /Añadir formación/ }));
    const pct = screen.getByLabelText(/^Porcentaje/);
    expect(pct.closest('form').noValidate).toBe(true);
    // Sin curso, sin porcentaje ni fecha: todo en un solo aviso, y vacío dice
    // «Falta», no «no válido» (visto en la prueba a mano).
    escribir(pct, '');
    escribir(screen.getByLabelText(/^Desde/), '');
    await enviar(pct);
    aviso('Faltan datos');
    expect(lista()).toBe('Falta el curso en «Curso», el porcentaje en «Porcentaje» y la fecha en «Desde».');
    escribir(screen.getByLabelText(/^Curso/), 'Curso');
    fireEvent.click(await screen.findByRole('button', { name: /Curso Prueba/ }));
    for (const malo of ['150', '-1', '7.3']) {
      escribir(pct, malo);
      await enviar(pct);
      expect(lista()).toMatch(/un porcentaje de 0 a 100 en «Porcentaje»|En «Porcentaje», un número de 0 a 100/);
    }
    escribir(pct, '7.5');
    await enviar(pct);
    aviso('Falta la fecha');
    expect(tutoresApi.crearColaboracion).not.toHaveBeenCalled();
    escribir(screen.getByLabelText(/^Desde/), '2026-09-01');
    await enviar(pct);
    expect(tutoresApi.crearColaboracion).toHaveBeenCalledWith(expect.objectContaining({ pct: 7.5, desde: '2026-09-01' }));
  });

  it('editar formación: lo mismo, el porcentaje y la fecha «Desde»', async () => {
    const antes = tutoresApi.colaboraciones.getMockImplementation();
    tutoresApi.colaboraciones.mockResolvedValue({ success: true, data: [{
      id: 7, tutor_id: 3, product_id: 1, pct: '10', vigente_desde: '2026-08-01', vigente_hasta: null, activa: true,
      notas: null, tutor: 'Tutora Prueba', formacion: 'Curso X', precio: '100', project_id: 1, proyecto: 'ISEIE',
      rige_hoy: true, entrego_foto: false, entrego_video: false, modulos_pct: 0,
    }] });
    try {
      await abrirPagina();
      await elegirTutora();
      fireEvent.click(screen.getByRole('button', { name: /^Editar$/ }));
      const pct = screen.getByLabelText(/^Porcentaje/);
      expect(pct.closest('form').noValidate).toBe(true);
      for (const malo of ['101', '-0.5', '12.25']) {
        escribir(pct, malo);
        await enviar(pct);
        aviso('Porcentaje no válido');
      }
      // Vacío dice «Falta», no «no válido»; y aquí no se pide curso: ya lo tiene.
      escribir(pct, '');
      escribir(screen.getByLabelText(/^Desde/), '');
      await enviar(pct);
      aviso('Faltan datos');
      expect(lista()).toBe('Falta el porcentaje en «Porcentaje» y la fecha en «Desde».');
      escribir(pct, '12.5');
      await enviar(pct);
      aviso('Falta la fecha');
      expect(tutoresApi.editarColaboracion).not.toHaveBeenCalled();
      escribir(screen.getByLabelText(/^Desde/), '2026-09-01');
      await enviar(pct);
      expect(tutoresApi.editarColaboracion).toHaveBeenCalledWith(7, expect.objectContaining({ pct: 12.5, desde: '2026-09-01' }));
    } finally {
      tutoresApi.colaboraciones.mockImplementation(antes);
    }
  });
});
