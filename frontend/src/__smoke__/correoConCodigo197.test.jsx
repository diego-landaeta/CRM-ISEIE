// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  #197 (gemela de CRM#211) · Cambiar el propio correo con un código a la
  dirección nueva.

  «Mi cuenta»: con su contraseña, «Mandarme el código»; con el código, «Cambiar
  mi correo». Quien no tiene «Cambiar su correo» no ve la sección. A un tutor,
  mientras siga el freno de correos a tutores, se le explica en vez del
  formulario (Diego, 06/11).

   npx vitest run src/__smoke__/correoConCodigo197.test.jsx
*/

const avisos = vi.hoisted(() => ({ toast: vi.fn() }));
const api = vi.hoisted(() => ({ post: vi.fn(), patch: vi.fn(), get: vi.fn(), upload: vi.fn() }));
const sesion = vi.hoisted(() => ({ permisos: {}, user: null }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: avisos.toast }));
vi.mock('@/shared/api/client', () => ({ default: api }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: sesion.user,
    permissions: sesion.permisos, alcanceComercial: null, refreshUser: vi.fn(), logout: vi.fn(),
  }),
}));
const FRENADO = 'Ahora mismo el CRM no manda correos a los tutores, así que no te podemos mandar el código. Pide el cambio a administración: el superadmin te lo cambia al momento.';

const { default: ProfilePage } = await import('@/shared/pages/ProfilePage');

const pintar = () => render(<MemoryRouter><ProfilePage /></MemoryRouter>);
const esperar = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  vi.clearAllMocks();
  sesion.permisos = { 'cuenta.cambiar_correo': true };
  sesion.user = { id: 9, nombre: 'Ana', email: 'ana@viejo.com', role: 'gestor', correo_propio_frenado: null };
  api.post.mockResolvedValue({ success: true, data: { email: 'ana@nuevo.com', enviado: true, minutos: 15 } });
  api.patch.mockResolvedValue({ success: true, data: { email: 'ana@nuevo.com', cambiado: true } });
});
afterEach(() => cleanup());

describe('«Mi cuenta» · el correo con código (#197)', () => {
  it('paso 1: con la contraseña actual pide el código a la dirección nueva; todavía no cambia', async () => {
    pintar();
    const form = screen.getByRole('form', { name: 'Cambiar mi correo' });
    fireEvent.change(within(form).getByLabelText('Mi correo nuevo'), { target: { value: 'Ana@Nuevo.com' } });
    // Sin contraseña no se puede pedir.
    expect(within(form).getByRole('button', { name: 'Mandarme el código' })).toBeDisabled();
    fireEvent.change(within(form).getByLabelText('Mi contraseña actual'), { target: { value: 'secreta' } });
    fireEvent.submit(form);
    await esperar();
    expect(api.post).toHaveBeenCalledWith('/auth/me/email/codigo', { email: 'ana@nuevo.com', password: 'secreta' });
    expect(api.patch).not.toHaveBeenCalledWith('/auth/me/email', expect.anything());
    expect(screen.getByRole('form', { name: 'Confirmar mi correo nuevo' })).toBeInTheDocument();
  });

  it('paso 2: con las 6 cifras del código, cambia', async () => {
    pintar();
    const form = screen.getByRole('form', { name: 'Cambiar mi correo' });
    fireEvent.change(within(form).getByLabelText('Mi correo nuevo'), { target: { value: 'ana@nuevo.com' } });
    fireEvent.change(within(form).getByLabelText('Mi contraseña actual'), { target: { value: 'secreta' } });
    fireEvent.submit(form);
    await esperar();
    const paso2 = screen.getByRole('form', { name: 'Confirmar mi correo nuevo' });
    const campo = within(paso2).getByLabelText(/El código que te ha llegado a ana@nuevo.com/);
    // Solo cifras, y como mucho seis.
    fireEvent.change(campo, { target: { value: '12a34567' } });
    expect(campo.value).toBe('123456');
    fireEvent.submit(paso2);
    await esperar();
    expect(api.patch).toHaveBeenCalledWith('/auth/me/email', { codigo: '123456' });
  });

  it('el mismo correo de ahora no se puede pedir', () => {
    pintar();
    const form = screen.getByRole('form', { name: 'Cambiar mi correo' });
    fireEvent.change(within(form).getByLabelText('Mi correo nuevo'), { target: { value: 'ANA@viejo.com' } });
    fireEvent.change(within(form).getByLabelText('Mi contraseña actual'), { target: { value: 'secreta' } });
    expect(within(form).getByRole('button', { name: 'Mandarme el código' })).toBeDisabled();
  });

  it('sin «Cambiar su correo» no sale la sección', () => {
    sesion.permisos = {};
    pintar();
    expect(screen.queryByRole('form', { name: 'Cambiar mi correo' })).toBeNull();
    expect(screen.getByText(/pídeselo a administración/)).toBeInTheDocument();
  });

  it('a un tutor con el freno puesto se le explica de entrada, sin pedirle la contraseña', () => {
    sesion.user = { id: 21, nombre: 'Juan', email: 'juan@viejo.com', role: 'tutor', correo_propio_frenado: FRENADO };
    pintar();
    expect(screen.getByRole('status')).toHaveTextContent(/no manda correos a los tutores/);
    expect(screen.queryByRole('form', { name: 'Cambiar mi correo' })).toBeNull();
    // Y la pista del campo Email no le dice que lo cambie abajo.
    expect(screen.queryByText(/Puedes cambiarlo abajo/)).toBeNull();
  });

  it('si al pedirlo el servidor dice que está frenado, lo explica sin error y no pide el código', async () => {
    api.post.mockResolvedValue({ success: true, data: { email: 'ana@nuevo.com', enviado: false, frenado: true, motivo: FRENADO } });
    pintar();
    const form = screen.getByRole('form', { name: 'Cambiar mi correo' });
    fireEvent.change(within(form).getByLabelText('Mi correo nuevo'), { target: { value: 'ana@nuevo.com' } });
    fireEvent.change(within(form).getByLabelText('Mi contraseña actual'), { target: { value: 'secreta' } });
    fireEvent.submit(form);
    await esperar();
    expect(screen.getByRole('status')).toHaveTextContent(/no manda correos a los tutores/);
    expect(screen.queryByRole('form', { name: 'Confirmar mi correo nuevo' })).toBeNull();
    expect(avisos.toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
  });
});
