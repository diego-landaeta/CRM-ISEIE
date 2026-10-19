// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';

/*
  «Usuario» (invitar y editar, en Configuración) con las piezas comunes
  (#106), como en MultiCRM: el Field compartido en cada campo (el asterisco
  iba escrito en el texto), el rol con el desplegable del CRM, la clase común
  y avisos que dicen dónde y cómo.
*/

const avisos = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: avisos.toast }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'superadmin' } }) }));
vi.mock('@/shared/components/ui/useConfirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/shared/pages/MarcaSection', () => ({ default: () => null }));
vi.mock('@/shared/api/client', () => ({
  default: {
    get: vi.fn((url) => Promise.resolve(url.startsWith('/users?')
      ? { success: true, data: [{ id: 4, nombre: 'Laura', email: 'laura@empresa.com', role: 'gestor', is_active: true, projects: [] }] }
      : { success: true, data: [] })),
    post: vi.fn(), patch: vi.fn(), delete: vi.fn(),
  },
}));

import SettingsPage from '@/shared/pages/SettingsPage';

const abrirPagina = async () => {
  const r = render(<MemoryRouter><SettingsPage /></MemoryRouter>);
  await act(async () => { await new Promise((ok) => setTimeout(ok, 0)); });
  return r;
};
const abrirInvitar = async () => {
  const r = await abrirPagina();
  fireEvent.click(screen.getByRole('button', { name: /Invitar usuario/ }));
  return r;
};
const abrirEditar = async () => {
  const r = await abrirPagina();
  fireEvent.click(screen.getByRole('button', { name: /^Editar$/ }));
  return r;
};

describe('Usuario (#106)', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => cleanup());

  it('invitar: el Field común, el rol con el desplegable del CRM y la clase común', async () => {
    const { container } = await abrirInvitar();
    const nombre = screen.getByLabelText(/^Nombre y apellido/);
    expect(nombre.className).toMatch(/bg-muted\/50/);
    expect(screen.getByLabelText(/^Email/).className).toMatch(/bg-muted\/50/);
    expect(screen.getByRole('combobox', { name: 'Rol' })).toBeInTheDocument();
    expect(container.querySelector('select')).toBeNull();
    // El asterisco ya no va escrito dentro del texto: lo pone el Field.
    expect(screen.queryByText('Nombre y apellido *')).toBeNull();
    expect(screen.getAllByText('(obligatorio)').length).toBeGreaterThanOrEqual(3);
  });

  it('invitar: el aviso del correo dice dónde y cómo escribirlo', async () => {
    await abrirInvitar();
    fireEvent.change(screen.getByLabelText(/^Nombre y apellido/), { target: { value: 'Ana Test' } });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'ana@' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invitar' }));
    // Sin campus, va en la misma lista que el campus que falta.
    expect(avisos.toast.mock.calls.at(-1)[0].description).toMatch(/un email válido en «Email» \(nombre@dominio\.com\)/);
  });

  // Todo vacío: todo lo que falta, en un solo aviso (visto en la prueba a
  // mano: decía solo «Falta el nombre», y vacío no es «demasiado corto»).
  it('invitar: con todo vacío, todo lo que falta a la vez; con una letra, «demasiado corto» en la lista', async () => {
    await abrirInvitar();
    fireEvent.click(screen.getByRole('button', { name: 'Invitar' }));
    expect(avisos.toast).toHaveBeenLastCalledWith(expect.objectContaining({
      title: 'Faltan datos',
      description: 'Falta el nombre en «Nombre y apellido», el email en «Email» y al menos un campus en «Proyectos asignados».',
    }));
    fireEvent.change(screen.getByLabelText(/^Nombre y apellido/), { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invitar' }));
    expect(avisos.toast.mock.calls.at(-1)[0].description).toMatch(/^Falta un nombre de al menos 2 letras en «Nombre y apellido», el email/);
    expect(avisos.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: '✓ Usuario invitado' }));
  });

  it('si solo falta una cosa, su aviso de siempre (invitar y editar)', async () => {
    await abrirInvitar();
    // Soporte no necesita campus: solo falta el nombre.
    fireEvent.click(screen.getByRole('combobox', { name: 'Rol' }));
    fireEvent.mouseDown(screen.getByRole('option', { name: /^Soporte/ }));
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'ana@empresa.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invitar' }));
    expect(avisos.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Falta el nombre', description: 'Escríbelo en «Nombre y apellido».' }));
    fireEvent.change(screen.getByLabelText(/^Nombre y apellido/), { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invitar' }));
    expect(avisos.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Nombre demasiado corto', description: 'En «Nombre y apellido», al menos 2 caracteres.' }));
    cleanup();
    await abrirEditar();
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(avisos.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Falta el nombre', description: 'Escríbelo en «Nombre».' }));
  });

  it('editar: sin nombre y con el correo mal, los dos en un solo aviso', async () => {
    await abrirEditar();
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'laura@' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(avisos.toast).toHaveBeenLastCalledWith(expect.objectContaining({
      title: 'Faltan datos',
      description: 'Falta el nombre en «Nombre» y un email válido en «Email» (nombre@dominio.com).',
    }));
  });

  // Visto en la revisión en el navegador: «Y además es…» y «Proyectos
  // asignados» eran etiquetas de Field que no apuntaban a ningún campo. Son
  // grupos: fieldset y legend, como en MultiCRM.
  it('invitar y editar: ninguna etiqueta suelta; los grupos, con su legend', async () => {
    const sueltas = (c) => [...c.querySelectorAll('label')]
      .filter((l) => !l.querySelector('input') && (!l.htmlFor || !document.getElementById(l.htmlFor)))
      .map((l) => l.textContent.trim());
    const { container } = await abrirInvitar();
    expect(sueltas(container)).toEqual([]);
    expect([...container.querySelectorAll('legend')].map((l) => l.textContent)).toContain('Proyectos asignados * (obligatorio)');
    cleanup();
    const editar = await abrirEditar();
    expect(sueltas(editar.container)).toEqual([]);
    expect([...editar.container.querySelectorAll('legend')].map((l) => l.textContent)).toEqual(expect.arrayContaining(['Y además es…', 'Proyectos asignados']));
  });

  // Visto en la prueba de ISEIE: Escape no cerraba ninguna de las dos.
  it('invitar y editar: Escape cierra la ventana; con el rol abierto, solo el desplegable', async () => {
    await abrirInvitar();
    const rol = screen.getByRole('combobox', { name: 'Rol' });
    fireEvent.click(rol);
    fireEvent.keyDown(rol, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Invitar' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Invitar' })).toBeNull();
    cleanup();
    await abrirEditar();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Guardar' })).toBeNull();
  });

  it('editar: cada campo con su Field, y las ayudas con su campo', async () => {
    const { container } = await abrirEditar();
    expect(container.querySelector('select')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Rol' })).toBeInTheDocument();
    const ayudaDe = (campo) => campo.closest('div.min-w-0').textContent;
    expect(ayudaDe(screen.getByLabelText(/^Email/))).toMatch(/Es con lo que entra/);
    expect(ayudaDe(screen.getByLabelText('Teléfono (WhatsApp)'))).toMatch(/widget de WhatsApp/);
    expect(ayudaDe(screen.getByLabelText('Cambiar contraseña'))).toMatch(/Mínimo 8 caracteres/);
    for (const campo of container.querySelectorAll('input[type=text], input[type=email], input:not([type])')) {
      expect(campo.className).toMatch(/bg-muted\/50/);
    }
  });
});
