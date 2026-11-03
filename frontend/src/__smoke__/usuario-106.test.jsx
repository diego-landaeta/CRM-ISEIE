// @vitest-environment jsdom
// Traída de MultiCRM (2.6.0) y adaptada. ISEIE no tiene un setup común de
// pruebas: el entorno, los matchers de jest-dom y la limpieza se ponen aquí.
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

/*
  «Usuario» (alta y edición) como los demás formularios (#106). En MultiCRM es
  `UserFormDialog`; en ISEIE son `InviteUserModal` y `EditUserModal`, dentro de
  Configuración. Lo que se trae:
    - todo lo que falta, en un solo aviso que dice dónde (antes decía solo lo
      primero, y vacío no es «demasiado corto»);
    - el aviso del correo dice cómo escribirlo;
    - Escape cierra (visto en la prueba de ISEIE: no cerraba);
    - sin autocompletado del navegador.
*/

const avisos = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: avisos.toast }));
vi.mock('@/shared/api/client', () => ({ default: { get: vi.fn().mockResolvedValue({ data: [] }), post: vi.fn(), patch: vi.fn() } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'admin' }, projects: [] }) }));
vi.mock('@/modules/permissions/components/PermisosDePersona', () => ({ default: () => null }));

const { InviteUserModal, EditUserModal } = await import('@/shared/pages/SettingsPage');

const usuario = { id: 4, nombre: 'Laura', email: 'laura@empresa.com', role: 'gestor', projects: [] };
const onClose = vi.fn();
const alta = () => render(<InviteUserModal projects={[]} onClose={onClose} onCreated={vi.fn()} />);
const edicion = () => render(<EditUserModal user={usuario} projects={[]} onClose={onClose} onSaved={vi.fn()} />);

beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

describe('Usuario (#106) · alta', () => {
  it('todo vacío: todo lo que falta, en un solo aviso', () => {
    alta();
    fireEvent.click(screen.getByRole('button', { name: 'Invitar' }));
    expect(avisos.toast).toHaveBeenLastCalledWith(expect.objectContaining({
      title: 'Faltan datos',
      description: 'Falta el nombre en «Nombre y apellido», el email en «Email» y al menos un campus en «Proyectos asignados».',
    }));
  });

  it('un nombre de una letra no es «falta el nombre»: dice cuánto tiene que tener', () => {
    alta();
    fireEvent.change(screen.getByLabelText(/^Nombre y apellido/), { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invitar' }));
    expect(avisos.toast.mock.calls.at(-1)[0].description).toMatch(/^Falta un nombre de al menos 2 letras en «Nombre y apellido», el email/);
  });

  it('el aviso del correo dice cómo escribirlo', () => {
    alta();
    fireEvent.change(screen.getByLabelText(/^Nombre y apellido/), { target: { value: 'Ana Test' } });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'ana@' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invitar' }));
    expect(avisos.toast.mock.calls.at(-1)[0].description).toMatch(/un email válido en «Email» \(nombre@dominio\.com\)/);
  });

  it('sin autocompletado del navegador en nombre y correo', () => {
    alta();
    expect(screen.getByLabelText(/^Nombre y apellido/)).toHaveAttribute('autocomplete', 'off');
    expect(screen.getByLabelText(/^Email/)).toHaveAttribute('autocomplete', 'off');
  });

  it('Escape cierra la ventana', () => {
    alta();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('Usuario (#106) · edición', () => {
  it('si solo falta una cosa, su aviso de siempre', () => {
    edicion();
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(avisos.toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Falta el nombre', description: 'Escríbelo en «Nombre».' }));
  });

  it('Escape cierra la ventana', () => {
    edicion();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
