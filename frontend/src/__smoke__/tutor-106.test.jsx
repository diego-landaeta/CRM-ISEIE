// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';

/*
  «Tutor» (nuevo tutor, editar tutor y añadir formación) con las piezas
  comunes (#106): no había ni Field ni la clase común —cada campo con sus
  clases y dos estilos de etiqueta—, la fila de «Sus cursos» no se apilaba en
  el móvil (cuatro columnas fijas) y las ayudas iban a 11 px.
*/

vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'superadmin' } }) }));
// La misma lista siempre: una nueva en cada pintado relanza la carga sin fin
// (también la de las formaciones de «Añadir formación», que mira `projects`, #384).
const CAMPUS = vi.hoisted(() => [{ id: 1, nombre: 'ISEIE' }]);
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({ activeProject: { id: 1 }, projects: CAMPUS, activeIssuer: null, activeIssuerId: null }),
}));
vi.mock('@/shared/api/client', () => ({
  default: {
    // Un curso en el catálogo, para elegirlo en «Añadir formación».
    get: vi.fn((url) => Promise.resolve({ success: true, data: String(url).startsWith('/products') ? [{ id: 11, nombre: 'Curso Prueba', precio: 100 }] : [] })),
  },
}));
vi.mock('@/modules/tutores/components/Entregables', () => ({ default: () => null }));
// La ficha también enseña sus consultas (#187): tienen su propia prueba.
vi.mock('@/modules/tutores/components/ConsultasDelTutor', () => ({ default: () => null }));
// En ISEIE el aviso del cambio de correo vive en shared/lib/credenciales.
vi.mock('@/modules/tutores/api/tutores.api', () => ({
  tutoresApi: {
    listar: vi.fn().mockResolvedValue({ success: true, data: [
      { id: 3, nombre: 'Tutora Prueba', email: 'tutora@prueba.local', iban: 'ES00', active: true, es_de_este_proyecto: true, formaciones: 0 },
    ] }),
    colaboraciones: vi.fn().mockResolvedValue({ success: true, data: [] }),
    ajustes: vi.fn().mockResolvedValue({ success: true, data: { aplica_desde: '2026-08-01', pct_por_defecto: 10 } }),
    alta: vi.fn().mockResolvedValue({ success: false, error: 'no' }),
    crearColaboracion: vi.fn().mockResolvedValue({ success: false, error: 'no' }),
    guardarPerfil: vi.fn().mockResolvedValue({ success: false }),
  },
}));

import TutoresPage from '@/modules/tutores/pages/TutoresPage';
import { toast } from '@/shared/hooks/useToast';
import { tutoresApi } from '@/modules/tutores/api/tutores.api';

afterEach(cleanup);

const esperar = () => act(async () => { await new Promise((ok) => setTimeout(ok, 0)); });
const abrirPagina = async () => {
  const r = render(<TutoresPage />);
  await esperar();
  return r;
};
const camposDe = (form) => [...form.querySelectorAll('input:not([type=checkbox]):not([type=hidden]), textarea')];

describe('Tutor (#106)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('nuevo tutor: cada campo con el Field común, enlazado, y con la clase común', async () => {
    await abrirPagina();
    fireEvent.click(screen.getByRole('button', { name: /Nuevo tutor/ }));
    for (const nombre of [/^Nombre y apellidos/, /^Correo/, 'DNI / NIF', 'Teléfono', 'IBAN', /^Contraseña/, '%', 'Lo lleva desde']) {
      expect(screen.getByLabelText(nombre)).toBeTruthy();
    }
    const form = screen.getByLabelText(/^Nombre y apellidos/).closest('form');
    // El buscador de cursos es una pieza común aparte (BuscadorEnLista) con su
    // propio campo por dentro: no es de este formulario.
    for (const c of camposDe(form).filter((c) => !c.className.includes('bg-transparent'))) {
      expect(c.className).toMatch(/bg-muted\/50/);
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

  it('editar tutor: el Field común, las ayudas con su campo y «Cobra desde» igual', async () => {
    await abrirPagina();
    fireEvent.click(screen.getByText('Tutora Prueba'));
    await esperar();
    fireEvent.click(screen.getByRole('button', { name: /Editar datos/ }));
    const ayudaDe = (campo) => campo.closest('div.min-w-0').textContent;
    expect(ayudaDe(screen.getByLabelText(/^Correo/))).toMatch(/Es con lo que entra al CRM/);
    expect(ayudaDe(screen.getByLabelText('IBAN'))).toMatch(/Los espacios se quitan solos/);
    const cobra = screen.getByLabelText('Cobra desde');
    expect(cobra.className).toMatch(/bg-muted\/50/);
    for (const c of camposDe(cobra.closest('form'))) expect(c.className).toMatch(/bg-muted\/50/);
  });

  it('añadir formación: porcentaje y fechas con el Field común y en fila que se apila', async () => {
    await abrirPagina();
    fireEvent.click(screen.getByText('Tutora Prueba'));
    await esperar();
    fireEvent.click(screen.getByRole('button', { name: /Añadir formación/ }));
    const pct = screen.getByLabelText(/^Porcentaje/);
    expect(pct.className).toMatch(/bg-muted\/50/);
    expect(screen.getByLabelText('Hasta').className).toMatch(/bg-muted\/50/);
    expect(pct.closest('div.min-w-0').parentElement.className).toMatch(/grid-cols-1 sm:grid-cols-3/);
  });
});

// Visto en la prueba a mano de la #106: el globo «Rellene este campo» del
// navegador. Ahora avisa el CRM, comprobando lo mismo que comprobaba el navegador.
// Visto en la prueba de ISEIE (aquí pasaba igual): Escape solo cerraba
// «Nuevo tutor» y «Añadir formación»; «Editar tutor» o «Retirar», no.
describe('Tutor: Escape cierra cada ventana (#106)', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  // En ISEIE el botón de editar al tutor se llama «Editar datos».
  for (const boton of [/Nuevo tutor/, /Editar datos/, /^Retirar/, /Añadir formación/]) {
    it(`«${boton.source.replace(/[\^\\/]/g, '')}»`, async () => {
      await abrirPagina();
      if (!/Nuevo/.test(boton.source)) { fireEvent.click(screen.getAllByText('Tutora Prueba')[0]); await esperar(); }
      fireEvent.click(screen.getAllByRole('button', { name: boton })[0]);
      expect(document.querySelector('div.fixed.inset-0')).not.toBeNull();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(document.querySelector('div.fixed.inset-0')).toBeNull();
    });
  }
});

describe('Tutor: avisa el CRM, no el navegador (#106)', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  const aviso = (title) => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title, variant: 'destructive' }));
  const enviar = async (campo) => { await act(async () => { fireEvent.submit(campo.closest('form')); }); };
  const escribir = (campo, value) => fireEvent.change(campo, { target: { value } });

  it('nuevo tutor: sin nombre, sin correo bueno o con el % fuera de 0-100, no se da de alta', async () => {
    await abrirPagina();
    fireEvent.click(screen.getByRole('button', { name: /Nuevo tutor/ }));
    const nombre = screen.getByLabelText(/^Nombre y apellidos/);
    expect(nombre.closest('form').noValidate).toBe(true);
    // Todo vacío: todo lo que falta, en un solo aviso.
    await enviar(nombre);
    aviso('Faltan datos');
    expect(toast.mock.calls.at(-1)[0].description).toBe('Falta el nombre en «Nombre y apellidos» y el correo en «Correo».');
    escribir(nombre, 'Ana Tutora');
    escribir(screen.getByLabelText(/^Correo/), 'ana@');
    await enviar(nombre);
    aviso('Correo no válido');
    // Lo mal escrito también va en la misma lista.
    escribir(screen.getByLabelText(/^Contraseña/), 'corta');
    await enviar(nombre);
    aviso('Faltan datos');
    expect(toast.mock.calls.at(-1)[0].description).toMatch(/un correo válido en «Correo».*una contraseña de al menos 8 caracteres/);
    escribir(screen.getByLabelText(/^Correo/), 'ana@prueba.local');
    await enviar(nombre);
    aviso('Contraseña demasiado corta');
    expect(tutoresApi.alta).not.toHaveBeenCalled();
  });

  it('nuevo tutor: con todo bien, se da de alta como antes', async () => {
    await abrirPagina();
    fireEvent.click(screen.getByRole('button', { name: /Nuevo tutor/ }));
    escribir(screen.getByLabelText(/^Nombre y apellidos/), 'Ana Tutora');
    escribir(screen.getByLabelText(/^Correo/), 'ana@prueba.local');
    await enviar(screen.getByLabelText(/^Nombre y apellidos/));
    expect(tutoresApi.alta).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Ana Tutora', email: 'ana@prueba.local' }));
  });

  it('nuevo tutor: el % del curso y el correo, igual que los comprobaba el navegador', async () => {
    await abrirPagina();
    fireEvent.click(screen.getByRole('button', { name: /Nuevo tutor/ }));
    const nombre = screen.getByLabelText(/^Nombre y apellidos/);
    escribir(nombre, 'Ana Tutora');
    escribir(screen.getByLabelText(/^Correo/), 'ana@prueba.local');
    // Escrito fuera de 0-100, se para aunque no haya curso elegido.
    escribir(screen.getByLabelText('%'), '150');
    await enviar(nombre);
    aviso('Porcentaje no válido');
    expect(tutoresApi.alta).not.toHaveBeenCalled();
    // Vacío vale: se toma el de por defecto. Y «a@b» lo aceptaba el navegador.
    escribir(screen.getByLabelText('%'), '');
    escribir(screen.getByLabelText(/^Correo/), 'ana@prueba');
    await enviar(nombre);
    expect(tutoresApi.alta).toHaveBeenCalledWith(expect.objectContaining({ email: 'ana@prueba' }));
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

  it('editar tutor: sin nombre o con un correo mal escrito, no se guarda', async () => {
    await abrirPagina();
    fireEvent.click(screen.getByText('Tutora Prueba'));
    await esperar();
    fireEvent.click(screen.getByRole('button', { name: /Editar datos/ }));
    const nombre = screen.getByLabelText(/^Nombre y apellidos/);
    expect(nombre.closest('form').noValidate).toBe(true);
    escribir(nombre, '');
    await enviar(nombre);
    aviso('Falta el nombre');
    escribir(nombre, 'Tutora Prueba');
    escribir(screen.getByLabelText(/^Correo/), 'tutora@');
    await enviar(nombre);
    aviso('Correo no válido');
    expect(tutoresApi.guardarPerfil).not.toHaveBeenCalled();
  });

  it('añadir formación: el porcentaje de 0 a 100 (con medios) y la fecha «Desde»', async () => {
    await abrirPagina();
    fireEvent.click(screen.getByText('Tutora Prueba'));
    await esperar();
    fireEvent.click(screen.getByRole('button', { name: /Añadir formación/ }));
    const pct = screen.getByLabelText(/^Porcentaje/);
    expect(pct.closest('form').noValidate).toBe(true);
    // El buscador con su etiqueta, como en «Nuevo tutor».
    const curso = screen.getByLabelText(/^Curso/);
    // Sin curso y sin porcentaje: los dos, y vacío dice «Falta», no «no válido».
    escribir(pct, '');
    await enviar(pct);
    aviso('Faltan datos');
    expect(toast.mock.calls.at(-1)[0].description).toBe('Falta el curso en «Curso» y el porcentaje en «Porcentaje».');
    escribir(curso, 'Curso');
    fireEvent.click(await screen.findByRole('button', { name: /Curso Prueba/ }));
    for (const malo of ['150', '-1', '7.3']) {
      escribir(pct, malo);
      await enviar(pct);
      aviso('Porcentaje no válido');
    }
    escribir(pct, '7.5');
    escribir(screen.getByLabelText(/^Desde/), '');
    await enviar(pct);
    aviso('Falta la fecha');
    expect(tutoresApi.crearColaboracion).not.toHaveBeenCalled();
    escribir(screen.getByLabelText(/^Desde/), '2026-09-01');
    await enviar(pct);
    expect(tutoresApi.crearColaboracion).toHaveBeenCalledWith(expect.objectContaining({ productId: 11, pct: 7.5, desde: '2026-09-01' }));
  });
});
